const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');
const Campaign = require('../models/OutreachCampaign');
const Dispatch = require('../models/OutreachDispatch');
const Runtime = require('../models/OutreachRuntime');
const Receipt = require('../models/DeliveryEventReceipt');
const Suppression = require('../models/RecipientSuppression');

const { calculateRetentionCutoff, pruneOldMailLogs, initRetentionScheduler } = require('../services/retentionService');
const { parseArgs, strictParseInt } = require('../scripts/retentionCleanup');
const { duplicateReason } = require('../services/campaignService');
const { applyEvent } = require('../services/signedDeliveryEventService');

let mongo, server, base, userA, userB, company;
const fixedNow = new Date('2026-11-14T12:00:00.000Z');

const request = async (path, method = 'GET', body, owner = userA) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${jwt.sign({ _id: String(owner._id) }, process.env.JWT_SECRET)}`,
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, data: await response.json() };
};

before(async () => {
  process.env.JWT_SECRET = 'retention-synthetic-secret-12345';
  process.env.OUTREACH_SENDING_ENABLED = 'false';
  process.env.OUTREACH_WORKER_ENABLED = 'false';
  process.env.OUTREACH_MAX_DAILY = '450';
  process.env.OUTREACH_GLOBAL_MAX_DAILY = '450';
  process.env.MAIL_STATUS_WEBHOOK_ENABLED = 'true';
  process.env.MAIL_STATUS_WEBHOOK_SECRET = '0123456789abcdef0123456789abcdef';

  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    User, Contact, Company, MailLog, DeliveryLedger,
    Campaign, Dispatch, Runtime, Receipt, Suppression
  ].map(m => m.init()));

  const app = express();
  app.use(express.json());
  app.use('/mail', require('../routes/mail'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 300000 });

after(async () => {
  if (server) await new Promise(r => server.close(r));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    User, Contact, Company, MailLog, DeliveryLedger,
    Campaign, Dispatch, Runtime, Receipt, Suppression
  ].map(m => m.deleteMany({})));

  userA = await User.create({
    name: 'Owner A',
    email: 'owner-a@example.com',
    passwordHash: 'fixture-hash',
    dailyEmailLimit: 450,
    smtpConfigs: [{
      _id: new mongoose.Types.ObjectId(),
      name: 'Primary A',
      user: 'sender-a@example.com',
      pass: 'secret',
      host: 'smtp.example.com',
      port: 465,
      isDefault: true
    }]
  });
  process.env.MAIL_STATUS_WEBHOOK_OWNER_ID = String(userA._id);

  userB = await User.create({
    name: 'Owner B',
    email: 'owner-b@example.com',
    passwordHash: 'fixture-hash',
    dailyEmailLimit: 450,
    smtpConfigs: [{
      _id: new mongoose.Types.ObjectId(),
      name: 'Primary B',
      user: 'sender-b@example.com',
      pass: 'secret',
      host: 'smtp.example.com',
      port: 465,
      isDefault: true
    }]
  });

  company = await Company.create({
    name: 'Target Acme Corp',
    domain: 'acme.example'
  });
});

test('fresh source outcomes: all four outcomes (failed, sent, delivered, bounced) archive accurately without schema default interference', async () => {
  const oldSentAt = new Date('2026-11-08T00:00:00Z');
  const outcomes = ['failed', 'sent', 'delivered', 'bounced'];
  const createdLogs = [];

  for (const st of outcomes) {
    const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: `${st}@acme.com` });
    const log = await MailLog.create({
      userId: userA._id,
      contactId: contact._id,
      recipientEmail: `${st}@acme.com`,
      senderEmail: 'sender-a@example.com',
      subject: `Subject ${st}`,
      body: `Body ${st}`,
      status: st,
      bounceReason: st === 'bounced' ? '550 Mailbox not found' : '',
      sentAt: oldSentAt,
      providerMessageId: `<msg-${st}@provider.example>`,
      messageHash: `hash-${st}`
    });
    createdLogs.push({ status: st, id: log._id, contactId: contact._id });
  }

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true });
  assert.equal(report.eligible, 4);
  assert.equal(report.archived, 4);
  assert.equal(report.deleted, 4);
  assert.equal(await MailLog.countDocuments(), 0);

  // Verify each outcome in DeliveryLedger matches the EXACT source status
  for (const item of createdLogs) {
    const ledger = await DeliveryLedger.findOne({ originalMailLogId: item.id }).lean();
    assert.ok(ledger);
    assert.equal(ledger.status, item.status, `Expected ledger status to be "${item.status}", but got "${ledger.status}"`);

    // Verify duplicateReason semantics: failed and bounced outreach do NOT match ['sent', 'delivered'] duplicateReason filter
    const reason = await duplicateReason(userA._id, item.contactId, `${item.status}@acme.com`);
    if (['failed', 'bounced'].includes(item.status)) {
      assert.equal(reason, null, `${item.status} outreach must not trigger duplicateReason ['sent','delivered'] filter`);
    } else {
      assert.equal(reason, 'Already sent: contact or recipient history');
    }
  }
});

test('stale/retry transitions: monotonic promotions and canonical identity guards', async () => {
  const oldSentAt = new Date('2026-11-07T00:00:00Z');
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'transition@acme.com' });

  // 1. Existing ledger failed -> source sent: promoted to sent
  const logSent = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'transition@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Sent outreach',
    body: 'Body',
    status: 'sent',
    sentAt: oldSentAt,
    providerMessageId: '<msg-trans-1@provider.example>'
  });
  await DeliveryLedger.create({
    originalMailLogId: logSent._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'transition@acme.com',
    senderEmail: 'sender-a@example.com',
    status: 'failed',
    sentAt: oldSentAt
  });

  // 2. Existing ledger sent -> source delivered: promoted to delivered
  const logDelivered = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'delivered@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Delivered outreach',
    body: 'Body',
    status: 'delivered',
    sentAt: oldSentAt,
    providerMessageId: '<msg-trans-2@provider.example>'
  });
  await DeliveryLedger.create({
    originalMailLogId: logDelivered._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'delivered@acme.com',
    senderEmail: 'sender-a@example.com',
    status: 'sent',
    sentAt: oldSentAt
  });

  // 3. Existing ledger bounced -> source sent: higher status bounced is PRESERVED
  const logBounced = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'bounced@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Bounced outreach',
    body: 'Body',
    status: 'sent', // source was recorded as sent
    sentAt: oldSentAt,
    providerMessageId: '<msg-trans-3@provider.example>'
  });
  await DeliveryLedger.create({
    originalMailLogId: logBounced._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'bounced@acme.com',
    senderEmail: 'sender-a@example.com',
    status: 'bounced',
    bounceReason: '5.1.1 Recipient mailbox unavailable',
    sentAt: oldSentAt
  });

  // 4. Identity mismatch: existing ledger has different recipient -> MUST fail closed and NOT delete source
  const logMismatched = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'correct@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Mismatch outreach',
    body: 'Body',
    status: 'sent',
    sentAt: oldSentAt,
    providerMessageId: '<msg-trans-4@provider.example>'
  });
  await DeliveryLedger.create({
    originalMailLogId: logMismatched._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'wrong-recipient@acme.com', // Mismatched recipient
    senderEmail: 'sender-a@example.com',
    status: 'sent',
    sentAt: oldSentAt
  });

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true });
  assert.equal(report.eligible, 4);
  assert.equal(report.archived, 3);
  assert.equal(report.deleted, 3); // Mismatched one must NOT be deleted

  assert.equal((await DeliveryLedger.findOne({ originalMailLogId: logSent._id })).status, 'sent');
  assert.equal((await DeliveryLedger.findOne({ originalMailLogId: logDelivered._id })).status, 'delivered');
  assert.equal((await DeliveryLedger.findOne({ originalMailLogId: logBounced._id })).status, 'bounced');

  // Mismatched record must remain safe in MailLog
  const remaining = await MailLog.findById(logMismatched._id);
  assert.ok(remaining);
  assert.equal(remaining.recipientEmail, 'correct@acme.com');
});

test('CAS delete barrier hook: concurrent mutation of providerMessageId and messageHash rejects deletion', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'barrier@acme.com' });
  const oldSentAt = new Date('2026-11-06T00:00:00Z');

  const log = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'barrier@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Barrier Subject',
    body: 'Barrier Body',
    status: 'sent',
    sentAt: oldSentAt,
    providerMessageId: '<original-provider-id@provider.example>',
    messageHash: 'orig-hash'
  });

  // Inject a hook that runs after archive and verification, but IMMEDIATELY before deleteOne
  const beforeDeleteHook = async (verifiedLogs) => {
    // Mutate providerMessageId and messageHash concurrently in the database
    await MailLog.updateOne(
      { _id: log._id },
      { $set: { providerMessageId: '<new-concurrent-id@provider.example>', messageHash: 'new-hash' } }
    );
  };

  const report = await pruneOldMailLogs({
    now: fixedNow,
    retentionHours: 48,
    allowGlobal: true,
    beforeDeleteHook
  });

  // CAS filter must fail to match due to providerMessageId/messageHash mismatch -> deleted: 0
  assert.equal(report.deleted, 0);

  // MailLog source record MUST be preserved with the new concurrent values
  const preserved = await MailLog.findById(log._id);
  assert.ok(preserved);
  assert.equal(preserved.providerMessageId, '<new-concurrent-id@provider.example>');
  assert.equal(preserved.messageHash, 'new-hash');
});

test('fenced lease expiry: stale worker is preempted by successor and cannot execute destructive deletes', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'fenced@acme.com' });
  const oldSentAt = new Date('2026-11-05T00:00:00Z');

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'fenced@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Fenced Subject',
    body: 'Fenced Body',
    status: 'sent',
    sentAt: oldSentAt
  });

  // Inject hook between archive and delete simulating lease expiration / successor worker stealing lease
  const beforeDeleteHook = async () => {
    const successorToken = crypto.randomUUID();
    await Runtime.updateOne(
      { _id: 'retention_worker' },
      { $set: { leaseToken: successorToken, leaseUntil: new Date(Date.now() + 120000) } }
    );
  };

  // Stale worker must throw / abort when verifying lease ownership before delete
  await assert.rejects(
    async () => pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true, beforeDeleteHook }),
    /Retention worker lease expired or preempted/
  );

  // Stale worker was fenced: MailLog record was NOT deleted!
  assert.equal(await MailLog.countDocuments(), 1);
});

test('CLI strict parsing: rejects fractional numbers, non-numeric suffixes, and unknown arguments', () => {
  assert.equal(strictParseInt('48', '--hours', 1, 87600), 48);
  assert.throws(() => strictParseInt('1.5', '--hours', 1, 87600), /Fractional, negative, or non-numeric/);
  assert.throws(() => strictParseInt('48abc', '--hours', 1, 87600), /Fractional, negative, or non-numeric/);
  assert.throws(() => strictParseInt('-5', '--hours', 1, 87600), /Fractional, negative, or non-numeric/);
  assert.throws(() => strictParseInt('0', '--hours', 1, 87600), /must be an integer between 1 and 87600/);

  assert.throws(() => parseArgs(['--unknown-flag']), /Unknown argument/);
  assert.throws(() => parseArgs(['--hours']), /Missing value for --hours/);
});

test('exact boundary behavior: cutoff equality retains, cutoff-1ms prunes, cutoff+1ms retains', async () => {
  const cutoff = calculateRetentionCutoff(fixedNow, 48); // 2026-11-12T12:00:00.000Z

  const contact = await Contact.create({ userId: userA._id, company: company.name, email: 'boundary@example.com' });

  // Exactly at cutoff (sentAt === cutoff) -> MUST be retained (< cutoff rule)
  const logExact = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'exact@example.com',
    subject: 'Exact Boundary',
    body: 'Exact body',
    status: 'sent',
    sentAt: cutoff
  });

  // 1ms newer than cutoff -> MUST be retained
  const logNewer = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'newer@example.com',
    subject: 'Newer Boundary',
    body: 'Newer body',
    status: 'sent',
    sentAt: new Date(cutoff.getTime() + 1)
  });

  // 1ms older than cutoff -> MUST be pruned
  const logOlder = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'older@example.com',
    subject: 'Older Boundary',
    body: 'Older body',
    status: 'sent',
    sentAt: new Date(cutoff.getTime() - 1)
  });

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true });
  assert.equal(report.eligible, 1);
  assert.equal(report.archived, 1);
  assert.equal(report.deleted, 1);

  const remaining = await MailLog.find().sort({ sentAt: 1 }).lean();
  assert.equal(remaining.length, 2);
  assert.equal(String(remaining[0]._id), String(logExact._id));
  assert.equal(String(remaining[1]._id), String(logNewer._id));

  const ledger = await DeliveryLedger.find().lean();
  assert.equal(ledger.length, 1);
  assert.equal(String(ledger[0].originalMailLogId), String(logOlder._id));
  assert.equal(ledger[0].recipientEmail, 'older@example.com');
});

test('webhook deduplicates overlap and rejects cross-store ambiguity between distinct deliveries', async () => {
  const email = 'ambiguity@example.com';
  const providerMessageId = '<shared-provider-id@provider.example>';
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email });

  // Scenario A: Overlap (Same delivery in both stores) -> Deduplicates cleanly without 409
  const overlapLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: email,
    providerMessageId,
    subject: 'Overlap Subj',
    body: 'Overlap Body',
    sentAt: new Date('2026-11-05T00:00:00Z'),
    status: 'sent'
  });

  await DeliveryLedger.create({
    originalMailLogId: overlapLog._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: email,
    providerMessageId,
    sentAt: overlapLog.sentAt,
    status: 'sent'
  });

  const eventA = { eventId: 'evt_overlap_01', messageId: providerMessageId, recipientEmail: email, eventType: 'permanent_failure', enhancedStatus: '5.1.1' };
  const digestA = crypto.createHash('sha256').update(JSON.stringify(eventA)).digest('hex');

  const resultA = await applyEvent({ event: eventA, userId: userA._id, digest: digestA });
  assert.equal(resultA.outcome, 'confirmed_recipient_failure');
  assert.equal((await MailLog.findById(overlapLog._id)).status, 'bounced');
  assert.equal((await DeliveryLedger.findOne({ originalMailLogId: overlapLog._id })).status, 'bounced');

  // Scenario B: Ambiguity across stores (Two DIFFERENT historical deliveries with same providerMessageId)
  const secondProviderId = '<ambiguous-msg-id@provider.example>';
  const differentEmail = 'ambig2@example.com';
  await Contact.create({ userId: userA._id, company: 'Acme', email: differentEmail });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: differentEmail,
    providerMessageId: secondProviderId,
    subject: 'Recent delivery',
    body: 'Body',
    sentAt: new Date('2026-11-13T00:00:00Z'),
    status: 'sent'
  });

  await DeliveryLedger.create({
    originalMailLogId: new mongoose.Types.ObjectId(),
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: differentEmail,
    providerMessageId: secondProviderId,
    sentAt: new Date('2026-11-01T00:00:00Z'),
    status: 'sent'
  });

  const eventB = { eventId: 'evt_ambig_02', messageId: secondProviderId, recipientEmail: differentEmail, eventType: 'permanent_failure', enhancedStatus: '5.1.1' };
  const digestB = crypto.createHash('sha256').update(JSON.stringify(eventB)).digest('hex');

  // MUST fail closed with 409
  await assert.rejects(
    async () => applyEvent({ event: eventB, userId: userA._id, digest: digestB }),
    /No unique owned sent-message match/
  );
});

test('true owner isolation: scoped cleanup for User A leaves User B older records completely untouched', async () => {
  const contactA = await Contact.create({ userId: userA._id, company: 'Co A', email: 'targetA@example.com' });
  const contactB = await Contact.create({ userId: userB._id, company: 'Co B', email: 'targetB@example.com' });

  const oldDate = new Date('2026-11-05T00:00:00Z');
  await MailLog.create({
    userId: userA._id,
    contactId: contactA._id,
    recipientEmail: 'targetA@example.com',
    subject: 'Old A',
    body: 'Body A',
    sentAt: oldDate
  });

  const logB = await MailLog.create({
    userId: userB._id,
    contactId: contactB._id,
    recipientEmail: 'targetB@example.com',
    subject: 'Old B',
    body: 'Body B',
    sentAt: oldDate
  });

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, userId: userA._id });
  assert.equal(report.eligible, 1);
  assert.equal(report.deleted, 1);
  assert.equal(report.scope, `user:${userA._id}`);

  assert.equal(await MailLog.countDocuments({ userId: userA._id }), 0);
  assert.equal(await DeliveryLedger.countDocuments({ userId: userA._id }), 1);

  assert.equal(await MailLog.countDocuments({ userId: userB._id }), 1);
  assert.equal(await DeliveryLedger.countDocuments({ userId: userB._id }), 0);
  const remainingB = await MailLog.findById(logB._id);
  assert.ok(remainingB);
  assert.equal(remainingB.recipientEmail, 'targetB@example.com');
});

test('legacy records: handles blank/missing recipientEmail and absent providerMessageId cleanly', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'legacy@acme.com' });
  const oldSentAt = new Date('2026-11-04T00:00:00Z');

  const legacyLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: '',
    providerMessageId: '',
    subject: 'Legacy Subject',
    body: 'Legacy Body',
    sentAt: oldSentAt,
    status: 'sent'
  });

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true });
  assert.equal(report.archived, 1);
  assert.equal(report.deleted, 1);

  const ledger = await DeliveryLedger.findOne({ originalMailLogId: legacyLog._id });
  assert.ok(ledger);
  assert.equal(ledger.recipientEmail, '');
  assert.equal(ledger.providerMessageId, '');
});

test('quota deduplication: delivery present in both MailLog and DeliveryLedger counted exactly once', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'quota-test@acme.com' });
  const todaySentAt = new Date('2026-11-14T08:00:00Z');

  const log = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'quota-test@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Today Outreach',
    body: 'Body',
    status: 'sent',
    sentAt: todaySentAt
  });

  await DeliveryLedger.create({
    originalMailLogId: log._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'quota-test@acme.com',
    senderEmail: 'sender-a@example.com',
    status: 'sent',
    sentAt: todaySentAt
  });

  const statusRes = await request('/mail/queue-status', 'GET', null, userA);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.sentToday, 1);
  assert.equal(statusRes.data.remaining, 449);
  assert.equal(statusRes.data.accounts[0].sentToday, 1);
});

test('Logs API: rolling 48h window with bounded pagination and array fallback', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'test@acme.com' });
  const nowMs = Date.now();

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'recent1@acme.com',
    subject: 'Recent 1',
    body: 'Body 1',
    status: 'sent',
    sentAt: new Date(nowMs - 2 * 3600 * 1000)
  });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'recent2@acme.com',
    subject: 'Recent 2',
    body: 'Body 2',
    status: 'sent',
    sentAt: new Date(nowMs - 24 * 3600 * 1000)
  });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'older@acme.com',
    subject: 'Older than 48h',
    body: 'Older Body',
    status: 'sent',
    sentAt: new Date(nowMs - 72 * 3600 * 1000)
  });

  const resPage1 = await request('/mail/logs?page=1&limit=1', 'GET', null, userA);
  assert.equal(resPage1.status, 200);
  assert.equal(resPage1.data.retentionHours, 48);
  assert.equal(resPage1.data.totalInWindow, 2);
  assert.equal(resPage1.data.logs.length, 1);
  assert.equal(resPage1.data.totalPages, 2);

  const resArray = await request('/mail/logs?format=array', 'GET', null, userA);
  assert.equal(resArray.status, 200);
  assert.ok(Array.isArray(resArray.data));
  assert.equal(resArray.data.length, 2);
});

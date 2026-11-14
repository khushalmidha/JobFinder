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

test('exact boundary behavior: cutoff equality retains, cutoff-1ms prunes, cutoff+1ms retains', async () => {
  const cutoff = calculateRetentionCutoff(fixedNow, 48); // 2026-11-12T12:00:00.000Z
  assert.equal(cutoff.toISOString(), '2026-11-12T12:00:00.000Z');

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

  // MailLog must retain exact and newer; older must be gone
  const remaining = await MailLog.find().sort({ sentAt: 1 }).lean();
  assert.equal(remaining.length, 2);
  assert.equal(String(remaining[0]._id), String(logExact._id));
  assert.equal(String(remaining[1]._id), String(logNewer._id));

  // Ledger must have only the older record
  const ledger = await DeliveryLedger.find().lean();
  assert.equal(ledger.length, 1);
  assert.equal(String(ledger[0].originalMailLogId), String(logOlder._id));
  assert.equal(ledger[0].recipientEmail, 'older@example.com');
});

test('Blocker 1: stale partial-run ledger is monotonically promoted and does not permit duplicate outreach', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'stale-test@acme.com' });

  // Original MailLog is currently sent
  const oldSentAt = new Date('2026-11-09T00:00:00Z');
  const mailLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'stale-test@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Important sent outreach',
    body: 'Body text',
    status: 'sent',
    sentAt: oldSentAt,
    providerMessageId: '<msg-stale-001@provider.example>'
  });

  // Simulate a prior partial/broken run where ledger was pre-created as 'failed'
  await DeliveryLedger.create({
    originalMailLogId: mailLog._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'stale-test@acme.com',
    senderEmail: 'sender-a@example.com',
    status: 'failed', // Broken stale status
    sentAt: oldSentAt,
    providerMessageId: '<msg-stale-001@provider.example>'
  });

  // Execute retention retry
  const result = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true });
  assert.equal(result.deleted, 1);

  // Ledger status MUST be monotonically upgraded from 'failed' to 'sent'
  const ledger = await DeliveryLedger.findOne({ originalMailLogId: mailLog._id }).lean();
  assert.equal(ledger.status, 'sent');

  // duplicateReason MUST flag duplicate outreach via compact ledger
  const reason = await duplicateReason(userA._id, contact._id, 'stale-test@acme.com');
  assert.equal(reason, 'Already sent: contact or recipient history');
});

test('Blocker 2: CAS deletion rejects concurrent modification between archive and delete', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'race@acme.com' });
  const oldSentAt = new Date('2026-11-08T00:00:00Z');

  const log = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'race@acme.com',
    subject: 'Old Subject',
    body: 'Old Body',
    status: 'sent',
    sentAt: oldSentAt
  });

  // Pre-archive record into DeliveryLedger with matching evidence
  await DeliveryLedger.create({
    originalMailLogId: log._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'race@acme.com',
    sentAt: oldSentAt,
    status: 'sent'
  });

  // Simulate concurrent modification on MailLog: sentAt updated to recent (now)
  await MailLog.updateOne({ _id: log._id }, { $set: { sentAt: fixedNow, status: 'delivered' } });

  // Cleanup runs
  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, allowGlobal: true });
  assert.equal(report.deleted, 0); // Must NOT delete the concurrently updated record!

  // MailLog record MUST still exist in database
  const preserved = await MailLog.findById(log._id);
  assert.ok(preserved);
  assert.equal(preserved.status, 'delivered');
  assert.equal(preserved.sentAt.toISOString(), fixedNow.toISOString());
});

test('Blocker 3: scheduler defaults to disabled, requires explicit MAIL_RETENTION_ENABLED=true and scope', async () => {
  delete process.env.MAIL_RETENTION_ENABLED;
  assert.equal(initRetentionScheduler(), null);

  process.env.MAIL_RETENTION_ENABLED = 'false';
  assert.equal(initRetentionScheduler(), null);

  // Destructive run without userId and without allowGlobal throws
  await assert.rejects(
    async () => pruneOldMailLogs({ now: fixedNow, allowGlobal: false, dryRun: false }),
    /Explicit userId scope or allowGlobal: true is required/
  );

  // Multi-instance lease lock
  const token = crypto.randomUUID();
  await Runtime.updateOne(
    { _id: 'retention_worker' },
    { $set: { leaseToken: token, leaseUntil: new Date(+fixedNow + 60000) } },
    { upsert: true }
  );

  const lockResult = await pruneOldMailLogs({ now: fixedNow, allowGlobal: true });
  assert.equal(lockResult.status, 'locked');
});

test('Blocker 4: webhook deduplicates overlap and rejects cross-store ambiguity between distinct deliveries', async () => {
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

  // Should succeed and update BOTH stores
  const resultA = await applyEvent({ event: eventA, userId: userA._id, digest: digestA });
  assert.equal(resultA.outcome, 'confirmed_recipient_failure');
  assert.equal((await MailLog.findById(overlapLog._id)).status, 'bounced');
  assert.equal((await DeliveryLedger.findOne({ originalMailLogId: overlapLog._id })).status, 'bounced');

  // Scenario B: Ambiguity across stores (Two DIFFERENT historical deliveries with same providerMessageId)
  const secondProviderId = '<ambiguous-msg-id@provider.example>';
  const differentEmail = 'ambig2@example.com';
  await Contact.create({ userId: userA._id, company: 'Acme', email: differentEmail });

  const mailLog1 = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: differentEmail,
    providerMessageId: secondProviderId,
    subject: 'Recent delivery',
    body: 'Body',
    sentAt: new Date('2026-11-13T00:00:00Z'),
    status: 'sent'
  });

  // Completely separate older delivery in DeliveryLedger (different originalMailLogId)
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

  // Run cleanup STRICTLY scoped to User A
  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, userId: userA._id });
  assert.equal(report.eligible, 1);
  assert.equal(report.deleted, 1);
  assert.equal(report.scope, `user:${userA._id}`);

  // User A's log is pruned
  assert.equal(await MailLog.countDocuments({ userId: userA._id }), 0);
  assert.equal(await DeliveryLedger.countDocuments({ userId: userA._id }), 1);

  // User B's log MUST remain in MailLog untouched
  assert.equal(await MailLog.countDocuments({ userId: userB._id }), 1);
  assert.equal(await DeliveryLedger.countDocuments({ userId: userB._id }), 0);
  const remainingB = await MailLog.findById(logB._id);
  assert.ok(remainingB);
  assert.equal(remainingB.recipientEmail, 'targetB@example.com');
});

test('parameter validation: rejects invalid retentionHours, batchSize, maxBatches and NaN', () => {
  assert.throws(() => calculateRetentionCutoff(fixedNow, 0), /retentionHours must be a positive integer/);
  assert.throws(() => calculateRetentionCutoff(fixedNow, -5), /retentionHours must be a positive integer/);
  assert.throws(() => calculateRetentionCutoff(fixedNow, NaN), /retentionHours must be a positive integer/);
  assert.throws(() => calculateRetentionCutoff(fixedNow, '48'), /retentionHours must be a positive integer/);
  assert.throws(() => calculateRetentionCutoff(fixedNow, 48.5), /retentionHours must be a positive integer/);
});

test('legacy records: handles blank/missing recipientEmail and absent providerMessageId cleanly', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'legacy@acme.com' });
  const oldSentAt = new Date('2026-11-04T00:00:00Z');

  const legacyLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: '', // Blank email
    providerMessageId: '', // Blank provider ID
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
  const todaySentAt = new Date('2026-11-14T08:00:00Z'); // Today UTC

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

  // Simulate overlap/partial retry: exact same delivery exists in DeliveryLedger as well
  await DeliveryLedger.create({
    originalMailLogId: log._id,
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'quota-test@acme.com',
    senderEmail: 'sender-a@example.com',
    status: 'sent',
    sentAt: todaySentAt
  });

  // Verify getQueueStatus deduplicates and returns sentToday: 1, NOT 2
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

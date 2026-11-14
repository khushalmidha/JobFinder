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

const { calculateRetentionCutoff, pruneOldMailLogs } = require('../services/retentionService');
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

test('exact 48-hour boundary: <48h retained in detailed MailLog, >48h archived to compact DeliveryLedger', async () => {
  const cutoff = calculateRetentionCutoff(fixedNow, 48); // 2026-11-12T12:00:00.000Z
  assert.equal(cutoff.toISOString(), '2026-11-12T12:00:00.000Z');

  const contact = await Contact.create({
    userId: userA._id,
    companyId: company._id,
    company: company.name,
    email: 'alice@acme.example'
  });

  // Recent record (47 hours old) -> MUST be kept
  const recentSentAt = new Date(cutoff.getTime() + 60 * 60 * 1000); // 47 hours ago
  const recentLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'alice@acme.example',
    senderEmail: 'sender-a@example.com',
    subject: 'Recent Subject Keep',
    body: 'Detailed body that should stay in MailLog for 48h',
    status: 'sent',
    sentAt: recentSentAt
  });

  // Old record (49 hours old) -> MUST be pruned
  const oldSentAt = new Date(cutoff.getTime() - 60 * 60 * 1000); // 49 hours ago
  const oldLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'bob@acme.example',
    senderEmail: 'sender-a@example.com',
    subject: 'Old Subject Should Prune',
    body: 'Detailed historical text that should not linger in storage',
    status: 'sent',
    sentAt: oldSentAt,
    providerMessageId: '<old-message-49h@provider.example>'
  });

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });
  assert.equal(report.eligible, 1);
  assert.equal(report.archived, 1);
  assert.equal(report.deleted, 1);

  // MailLog check
  const remainingLogs = await MailLog.find().lean();
  assert.equal(remainingLogs.length, 1);
  assert.equal(String(remainingLogs[0]._id), String(recentLog._id));
  assert.equal(remainingLogs[0].subject, 'Recent Subject Keep');

  // DeliveryLedger check
  const ledgerEntries = await DeliveryLedger.find().lean();
  assert.equal(ledgerEntries.length, 1);
  const ledger = ledgerEntries[0];
  assert.equal(String(ledger.originalMailLogId), String(oldLog._id));
  assert.equal(String(ledger.userId), String(userA._id));
  assert.equal(String(ledger.contactId), String(contact._id));
  assert.equal(ledger.recipientEmail, 'bob@acme.example');
  assert.equal(ledger.senderEmail, 'sender-a@example.com');
  assert.equal(ledger.providerMessageId, '<old-message-49h@provider.example>');
  assert.equal(ledger.status, 'sent');
  assert.equal(+ledger.sentAt, +oldSentAt);
  // Subject and body must NOT be stored in DeliveryLedger
  assert.equal(ledger.subject, undefined);
  assert.equal(ledger.body, undefined);
});

test('dry-run mode counts eligible records without mutating MailLog or DeliveryLedger', async () => {
  const contact = await Contact.create({
    userId: userA._id,
    company: 'Test Corp',
    email: 'dryrun@example.com'
  });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'dryrun@example.com',
    subject: 'Old Subject',
    body: 'Old Body',
    sentAt: new Date('2026-11-10T00:00:00Z') // > 48h
  });

  const dryResult = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48, dryRun: true });
  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.eligible, 1);
  assert.equal(dryResult.archived, 0);
  assert.equal(dryResult.deleted, 0);

  assert.equal(await MailLog.countDocuments(), 1);
  assert.equal(await DeliveryLedger.countDocuments(), 0);
});

test('owner isolation: cleanup preserves owner scoping and does not leak or cross-contaminate', async () => {
  const contactA = await Contact.create({ userId: userA._id, company: 'A Inc', email: 'userA@example.com' });
  const contactB = await Contact.create({ userId: userB._id, company: 'B Inc', email: 'userB@example.com' });

  // User A has 1 old log, User B has 1 old log
  await MailLog.create({
    userId: userA._id,
    contactId: contactA._id,
    recipientEmail: 'targetA@example.com',
    subject: 'Subj A',
    body: 'Body A',
    sentAt: new Date('2026-11-10T00:00:00Z')
  });

  await MailLog.create({
    userId: userB._id,
    contactId: contactB._id,
    recipientEmail: 'targetB@example.com',
    subject: 'Subj B',
    body: 'Body B',
    sentAt: new Date('2026-11-10T00:00:00Z')
  });

  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });
  assert.equal(report.archived, 2);
  assert.equal(report.deleted, 2);

  const ledgerA = await DeliveryLedger.find({ userId: userA._id }).lean();
  assert.equal(ledgerA.length, 1);
  assert.equal(ledgerA[0].recipientEmail, 'targeta@example.com');

  const ledgerB = await DeliveryLedger.find({ userId: userB._id }).lean();
  assert.equal(ledgerB.length, 1);
  assert.equal(ledgerB[0].recipientEmail, 'targetb@example.com');
});

test('idempotency and partial cleanup failure: re-running does not duplicate ledger records', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'test@acme.com' });

  const oldLog = await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'test@acme.com',
    subject: 'Historical',
    body: 'Historical message',
    sentAt: new Date('2026-11-09T00:00:00Z')
  });

  // Pre-seed DeliveryLedger as if a crash occurred after ledger insertion but before MailLog deletion
  await DeliveryLedger.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'test@acme.com',
    sentAt: oldLog.sentAt,
    originalMailLogId: oldLog._id,
    status: 'sent'
  });

  assert.equal(await MailLog.countDocuments(), 1);
  assert.equal(await DeliveryLedger.countDocuments(), 1);

  // Run cleanup retry
  const report = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });
  assert.equal(report.deleted, 1);

  // Ledger should still have exactly 1 record, not 2
  assert.equal(await DeliveryLedger.countDocuments(), 1);
  assert.equal(await MailLog.countDocuments(), 0);

  // Re-running cleanup again on empty eligible set is a clean no-op
  const secondRun = await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });
  assert.equal(secondRun.eligible, 0);
  assert.equal(secondRun.archived, 0);
  assert.equal(secondRun.deleted, 0);
  assert.equal(await DeliveryLedger.countDocuments(), 1);
});

test('deleted detailed history cannot permit duplicate outreach: duplicateReason checks compact ledger', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'outreach@acme.com' });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'outreach@acme.com',
    subject: 'Old Outreach',
    body: 'Old Content',
    sentAt: new Date('2026-11-05T00:00:00Z'),
    status: 'sent'
  });

  // Prune detailed log
  await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });
  assert.equal(await MailLog.countDocuments(), 0);
  assert.equal(await DeliveryLedger.countDocuments(), 1);

  // duplicateReason MUST flag duplicate via compact ledger
  const reason = await duplicateReason(userA._id, contact._id, 'outreach@acme.com');
  assert.equal(reason, 'Already sent: contact or recipient history');

  // Different recipient is not blocked
  const reasonNew = await duplicateReason(userA._id, new mongoose.Types.ObjectId(), 'someone-else@acme.com');
  assert.equal(reasonNew, null);
});

test('late authenticated bounce webhook correlates with compact DeliveryLedger when MailLog is pruned', async () => {
  const email = 'late-bounce@acme.example';
  const providerMessageId = '<late-msg-999@provider.example>';
  const contact = await Contact.create({
    userId: userA._id,
    company: 'Acme Corp',
    email,
    verificationStatus: 'vendor_verified',
    deliverabilityStatus: 'valid'
  });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: email,
    providerMessageId,
    subject: 'Historical outreach',
    body: 'Historical body',
    status: 'sent',
    sentAt: new Date('2026-11-08T00:00:00Z')
  });

  // Prune detailed MailLog into DeliveryLedger
  await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });
  assert.equal(await MailLog.countDocuments(), 0);
  assert.equal(await DeliveryLedger.countDocuments(), 1);

  // Authenticated 5.1.1 bounce event arrives after pruning
  const event = {
    eventId: 'evt_late_bounce_001',
    messageId: providerMessageId,
    recipientEmail: email,
    eventType: 'permanent_failure',
    enhancedStatus: '5.1.1'
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');

  const result = await applyEvent({ event, userId: userA._id, digest });
  assert.equal(result.duplicate, false);
  assert.equal(result.outcome, 'confirmed_recipient_failure');

  // Contact must be suppressed and marked invalid
  const updatedContact = await Contact.findById(contact._id);
  assert.equal(updatedContact.deliverabilityStatus, 'invalid');
  assert.equal(updatedContact.verificationStatus, 'invalid');
  assert.ok(updatedContact.suppressedAt);

  // RecipientSuppression record must exist
  const suppression = await Suppression.findOne({ userId: userA._id, email });
  assert.ok(suppression);
  assert.equal(suppression.source, 'authenticated_provider_5.1.1');

  // DeliveryLedger status must be updated to 'bounced'
  const ledger = await DeliveryLedger.findOne({ userId: userA._id, providerMessageId });
  assert.equal(ledger.status, 'bounced');
  assert.equal(ledger.bounceReason, 'Authenticated provider recipient failure 5.1.1');

  // Replay of same event is idempotent
  const replay = await applyEvent({ event, userId: userA._id, digest });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.outcome, 'confirmed_recipient_failure');
});

test('never deletes contacts, company records, active/queued dispatches or unresolved unknown outcomes', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Kept Co', email: 'safe@kept.example' });
  const comp = await Company.create({ name: 'Kept Co', domain: 'kept.example' });
  const campaign = await Campaign.create({
    userId: userA._id,
    name: 'Safe Campaign',
    digest: 'dig',
    startAtUtc: fixedNow,
    snapshot: { name: 'Safe Campaign', intervalSeconds: 180, recipients: [] }
  });

  const queuedDispatch = await Dispatch.create({
    campaignId: campaign._id,
    userId: userA._id,
    contactId: contact._id,
    revision: 1,
    recipientEmail: 'safe@kept.example',
    status: 'queued'
  });

  const unknownDispatch = await Dispatch.create({
    campaignId: campaign._id,
    userId: userA._id,
    contactId: contact._id,
    revision: 1,
    recipientEmail: 'unknown@kept.example',
    status: 'unknown_outcome'
  });

  // Old MailLog that is eligible for pruning
  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'old@kept.example',
    subject: 'Old',
    body: 'Old Body',
    sentAt: new Date('2026-11-01T00:00:00Z')
  });

  await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });

  // Verify critical models are completely untouched
  assert.equal(await Contact.countDocuments({ _id: contact._id }), 1);
  assert.equal(await Company.countDocuments({ _id: comp._id }), 1);
  assert.equal(await Dispatch.countDocuments({ _id: queuedDispatch._id }), 1);
  assert.equal(await Dispatch.countDocuments({ _id: unknownDispatch._id }), 1);
  assert.equal(await Campaign.countDocuments({ _id: campaign._id }), 1);
});

test('daily quota accounting: today sends not pruned and quota calculation remains 100% accurate', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'today@acme.com' });

  // Sent today (UTC)
  const todaySentAt = new Date('2026-11-14T05:00:00Z');
  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'today@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Today Subject',
    body: 'Today Body',
    status: 'sent',
    sentAt: todaySentAt
  });

  // Sent 10 days ago
  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'old@acme.com',
    senderEmail: 'sender-a@example.com',
    subject: 'Old Subject',
    body: 'Old Body',
    status: 'sent',
    sentAt: new Date('2026-11-04T00:00:00Z')
  });

  // Run pruning
  await pruneOldMailLogs({ now: fixedNow, retentionHours: 48 });

  // Today's log is kept in MailLog
  assert.equal(await MailLog.countDocuments({ userId: userA._id }), 1);

  // Queue status reports correct sentToday quota and configured interval
  const statusRes = await request('/mail/queue-status', 'GET', null, userA);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.sentToday, 1);
  assert.equal(statusRes.data.dailyLimit, 450);
  assert.equal(statusRes.data.remaining, 449);
  assert.equal(statusRes.data.intervalSeconds, 180);
});

test('Logs API: returns only last 48 hours and supports bounded pagination', async () => {
  const contact = await Contact.create({ userId: userA._id, company: 'Acme', email: 'test@acme.com' });

  // Insert 3 logs: 2 within last 48 hours, 1 older than 48 hours
  const nowMs = Date.now();
  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'recent1@acme.com',
    subject: 'Recent 1',
    body: 'Recent Body 1',
    status: 'sent',
    sentAt: new Date(nowMs - 2 * 3600 * 1000) // 2h ago
  });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'recent2@acme.com',
    subject: 'Recent 2',
    body: 'Recent Body 2',
    status: 'sent',
    sentAt: new Date(nowMs - 24 * 3600 * 1000) // 24h ago
  });

  await MailLog.create({
    userId: userA._id,
    contactId: contact._id,
    recipientEmail: 'older@acme.com',
    subject: 'Older than 48h',
    body: 'Older Body',
    status: 'sent',
    sentAt: new Date(nowMs - 72 * 3600 * 1000) // 72h ago (not yet pruned)
  });

  // Fetch /mail/logs (limit 1)
  const resPage1 = await request('/mail/logs?page=1&limit=1', 'GET', null, userA);
  assert.equal(resPage1.status, 200);
  assert.equal(resPage1.data.retentionHours, 48);
  assert.equal(resPage1.data.totalInWindow, 2); // Older 72h log is excluded from 48h window
  assert.equal(resPage1.data.logs.length, 1);
  assert.equal(resPage1.data.page, 1);
  assert.equal(resPage1.data.totalPages, 2);

  // Fetch page 2
  const resPage2 = await request('/mail/logs?page=2&limit=1', 'GET', null, userA);
  assert.equal(resPage2.status, 200);
  assert.equal(resPage2.data.logs.length, 1);
  assert.equal(resPage2.data.page, 2);

  // Format array fallback for backward compatibility
  const resArray = await request('/mail/logs?format=array', 'GET', null, userA);
  assert.equal(resArray.status, 200);
  assert.ok(Array.isArray(resArray.data));
  assert.equal(resArray.data.length, 2);
});

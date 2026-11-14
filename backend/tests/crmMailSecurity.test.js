const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User'), Contact = require('../models/Contact'), Company = require('../models/Company');
const Reminder = require('../models/OutreachReminder'), MailLog = require('../models/MailLog'), Receipt = require('../models/DeliveryEventReceipt');
const Job = require('../models/JobOpening'), Lead = require('../models/PublicRecruitmentLead');
const Suppression = require('../models/RecipientSuppression');
const crm = require('../services/outreachCrmService');
const delivery = require('../services/signedDeliveryEventService');
const { mailboxOptions } = require('../services/secureMailboxService');
const { parseDeliveryStatus } = require('../services/deliveryStatusParser');
let mongo, server, base, owner, other, contact, token;
const key = 'test-only-crm-auth-key';
const secret = 'test-only-webhook-key-at-least-32-characters';
const fixture = (extra = {}) => ({ company: 'Fixture Employer', email: 'careers@employer.example', status: 'sent', verificationStatus: 'publicly_sourced', provenance: [{ url: 'https://employer.example/careers', provider: 'official_page' }], ...extra });
before(async () => {
  process.env.JWT_SECRET = key; process.env.OUTREACH_SENDING_ENABLED = 'false';
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all([User, Contact, Company, Reminder, MailLog, Receipt, Job, Lead, Suppression].map(M => M.init()));
  const app = express(); app.use('/hooks', require('../routes/webhook')); app.use(express.json()); app.use('/crm', require('../routes/crm'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 300000 });
beforeEach(async () => {
  await Promise.all([User, Contact, Company, Reminder, MailLog, Receipt, Job, Lead, Suppression].map(M => M.deleteMany({})));
  owner = await User.create({ email: 'owner@fixture.example', name: 'Owner', passwordHash: 'fake' });
  other = await User.create({ email: 'other@fixture.example', name: 'Other', passwordHash: 'fake' });
  contact = await Contact.create(fixture({ userId: owner._id }));
  token = jwt.sign({ _id: String(owner._id) }, key);
  process.env.MAIL_STATUS_WEBHOOK_ENABLED = 'true'; process.env.MAIL_STATUS_WEBHOOK_SECRET = secret; process.env.MAIL_STATUS_WEBHOOK_OWNER_ID = String(owner._id);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (mongo) await mongo.stop(); });
const request = (path, method = 'GET', body, auth = token) => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const reminderInput = () => ({ contactId: String(contact._id), dueAt: new Date(Date.now() + 3600000).toISOString(), subject: 'Follow up on SWE opening', body: 'Reviewed fixture text only.', note: 'Check exact role first' });
const eventInput = (extra = {}) => ({ eventId: 'fixture-event-1', messageId: '<fixture-1@provider.example>', recipientEmail: contact.email, eventType: 'permanent_failure', enhancedStatus: '5.1.1', ...extra });
function signed(event, seconds = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(event)); const timestamp = String(seconds);
  return { raw, headers: { 'x-jobfinder-timestamp': timestamp, 'x-jobfinder-signature': crypto.createHmac('sha256', secret).update(timestamp + '.').update(raw).digest('hex') } };
}
async function log(extra = {}) { return MailLog.create({ userId: owner._id, contactId: contact._id, recipientEmail: contact.email, providerMessageId: '<fixture-1@provider.example>', subject: 'Historical', body: 'Historical fixture', ...extra }); }

test('signed endpoint rejects disabled, unsigned, stale and tampered events without mutations', async () => {
  const input = signed(eventInput());
  assert.throws(() => delivery.authenticate(input.raw, {}, process.env), /signature/);
  assert.throws(() => delivery.authenticate(Buffer.from('{}'), input.headers), /signature/);
  assert.throws(() => delivery.authenticate(input.raw, input.headers, { ...process.env, MAIL_STATUS_WEBHOOK_ENABLED: 'false' }), /disabled/);
  const stale = signed(eventInput(), Math.floor(Date.now() / 1000) - 301);
  assert.throws(() => delivery.authenticate(stale.raw, stale.headers), /signature/);
  assert.equal((await request('/hooks/mail-status', 'POST', eventInput(), null)).status, 401);
  assert.equal(await Receipt.countDocuments(), 0); assert.equal((await Contact.findById(contact._id)).status, 'sent');
});
test('exact signed 5.1.1 maps owned history, preserves old suppression and is replay-idempotent', async () => {
  const old = await Contact.create(fixture({ userId: owner._id, email: 'CAREERS@employer.example', suppressedAt: new Date(), suppressionReason: 'Keep confirmed prior audit', status: 'replied' }));
  const alien = await Contact.create(fixture({ userId: other._id }));
  await log(); const input = signed(eventInput());
  const send = () => fetch(base + '/hooks/mail-status', { method: 'POST', headers: { 'content-type': 'application/json', ...input.headers }, body: input.raw });
  assert.equal((await send()).status, 200);
  assert.equal((await (await send()).json()).duplicate, true);
  assert.equal((await Contact.findById(contact._id)).deliverabilityStatus, 'invalid');
  assert.equal((await Contact.findById(old._id)).suppressionReason, 'Keep confirmed prior audit');
  assert.equal((await Contact.findById(old._id)).status, 'replied');
  assert.equal((await Contact.findById(alien._id)).deliverabilityStatus, 'unverified');
  assert.equal((await MailLog.findOne({ userId: owner._id })).status, 'bounced');
  const reused = signed(eventInput({ enhancedStatus: '5.7.1' }));
  await assert.rejects(delivery.applyEvent(delivery.authenticate(reused.raw, reused.headers)), /reused/);
});
test('transient, quota and policy events do not invalidate mailboxes; recipient/message mismatch fails closed', async () => {
  await log();
  for (const status of ['4.2.0', '5.2.2', '5.7.1']) {
    const input = signed(eventInput({ eventId: status, enhancedStatus: status }));
    assert.equal((await delivery.applyEvent(delivery.authenticate(input.raw, input.headers))).outcome, 'inconclusive_no_suppression');
  }
  const mismatch = signed(eventInput({ recipientEmail: 'other@employer.example' }));
  await assert.rejects(delivery.applyEvent(delivery.authenticate(mismatch.raw, mismatch.headers)), /unique owned/);
  assert.equal((await Contact.findById(contact._id)).deliverabilityStatus, 'unverified');
  assert.equal((await MailLog.findOne()).status, 'sent');
});
test('ambiguous duplicate message IDs and in-progress receipts require reconciliation', async () => {
  await log(); await log(); const input = signed(eventInput());
  await assert.rejects(delivery.applyEvent(delivery.authenticate(input.raw, input.headers)), /unique owned/);
  await MailLog.deleteOne({});
  const authenticated = delivery.authenticate(input.raw, input.headers);
  await Receipt.create({ eventId: authenticated.event.eventId, digest: authenticated.digest });
  await assert.rejects(delivery.applyEvent(authenticated), /reconciliation/);
  assert.equal((await Contact.findById(contact._id)).deliverabilityStatus, 'unverified');
});
test('IMAP pins a public IP, verifies original TLS hostname, blocks private/unsupported hosts', async () => {
  let resolved;
  const options = await mailboxOptions({ host: 'smtp.gmail.com', user: 'fixture', pass: 'fake' }, async host => { resolved = host; return [{ address: '8.8.8.8' }]; });
  assert.equal(resolved, 'imap.gmail.com'); assert.equal(options.host, '8.8.8.8'); assert.equal(options.servername, 'imap.gmail.com'); assert.equal(options.tls.rejectUnauthorized, true);
  await assert.rejects(mailboxOptions({ host: '127.0.0.1', user: 'x', pass: 'x' }), /supported/);
  await assert.rejects(mailboxOptions({ host: 'smtp.gmail.com', user: 'x', pass: 'x' }, async () => [{ address: '127.0.0.1' }]), /Private/);
});
test('DSN parser ignores arbitrary body emails, returns only exact structured final recipients for review', () => {
  assert.deepEqual(parseDeliveryStatus('Failed to send. Please contact help@example.com or manager@example.com'), []);
  const result = parseDeliveryStatus('Original-Message-ID: <fixture@provider.example>\r\n\r\nFinal-Recipient: rfc822; careers@example.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; failed manager@example.com');
  assert.equal(result.length, 1); assert.equal(result[0].recipientEmail, 'careers@example.com'); assert.equal(result[0].messageId, '<fixture@provider.example>');
});
test('CRM requires authentication and owner scope; date/body validation cannot create sends', async () => {
  assert.equal((await request('/crm/overview', 'GET', null, null)).status, 401);
  assert.equal((await request('/crm/reminders', 'POST', reminderInput())).status, 200);
  const alien = await Contact.create(fixture({ userId: other._id }));
  assert.equal((await request('/crm/reminders', 'POST', { ...reminderInput(), contactId: String(alien._id) })).status, 404);
  await assert.rejects(crm.createReminder(owner._id, { ...reminderInput(), dueAt: '2020-01-01T00:00:00Z' }), /future/);
  await assert.rejects(crm.createReminder(owner._id, { ...reminderInput(), subject: 'a\nb' }), /one line/);
  assert.equal(await MailLog.countDocuments(), 0); assert.equal(await Reminder.countDocuments(), 1);
  const found = await (await request('/crm/contacts?q=fixture')).json(); assert.equal(found.contacts.length, 1);
});
test('reminder revisions prevent stale writes and draft reads recheck recipient suppression', async () => {
  const row = await crm.createReminder(owner._id, reminderInput());
  assert.equal((await crm.draft(owner._id, row._id)).sent, false);
  await Contact.create(fixture({ userId: owner._id, optOutAt: new Date() }));
  await assert.rejects(crm.draft(owner._id, row._id), /suppressed|suppression/);
  await crm.closeReminder(owner._id, row._id, { status: 'cancelled', revision: 1 });
  await assert.rejects(crm.closeReminder(owner._id, row._id, { status: 'completed', revision: 1 }), /changed/);
  await assert.rejects(crm.closeReminder(other._id, row._id, { status: 'completed', revision: 2 }), /not owned/);
});
test('manual reply cancels duplicate recipient reminders while preserving invalid suppression/history', async () => {
  const duplicate = await Contact.create(fixture({ userId: owner._id, email: 'CAREERS@employer.example' }));
  await crm.createReminder(owner._id, reminderInput());
  await crm.createReminder(owner._id, { ...reminderInput(), contactId: String(duplicate._id) });
  await log(); await Contact.updateOne({ _id: duplicate._id }, { $set: { suppressedAt: new Date(), suppressionReason: 'Prior audit', deliverabilityStatus: 'invalid' } });
  await crm.recordReplyOrOptOut(owner._id, contact._id, { snippet: 'Please apply via the employer careers page.' });
  assert.equal(await Reminder.countDocuments({ status: 'cancelled' }), 2);
  const preserved = await Contact.findById(duplicate._id); assert.equal(preserved.deliverabilityStatus, 'invalid'); assert.equal(preserved.suppressionReason, 'Prior audit');
  assert.equal(await MailLog.countDocuments(), 1);
});
test('confirmed opt-out blocks all owned duplicates, not another account, and cancels reminders', async () => {
  const alien = await Contact.create(fixture({ userId: other._id }));
  await crm.createReminder(owner._id, reminderInput());
  await assert.rejects(crm.recordReplyOrOptOut(owner._id, contact._id, {}, true), /Confirm/);
  await crm.recordReplyOrOptOut(owner._id, contact._id, { confirmed: true }, true);
  assert.ok((await Contact.findById(contact._id)).optOutAt); assert.equal((await Contact.findById(alien._id)).optOutAt, undefined);
  assert.equal(await Reminder.countDocuments({ status: 'cancelled' }), 1);
  await assert.rejects(crm.createReminder(owner._id, reminderInput()), /suppressed|suppression/);
});
test('RecruiterGraph links explicit employer IDs, excludes other owners and retains unverified salary', async () => {
  const company = await Company.create({ name: 'Linked Employer', domain: 'employer.example' });
  await Contact.updateOne({ _id: contact._id }, { $set: { companyId: company._id } });
  await Contact.create(fixture({ userId: other._id, companyId: company._id, email: 'private@employer.example' }));
  await Job.create({ companyId: company._id, company: company.name, title: 'SWE I', url: 'https://employer.example/jobs/1' });
  const result = await crm.overview(owner._id);
  assert.equal(result.graph.length, 1); assert.equal(result.graph[0].contacts.length, 1); assert.equal(result.graph[0].jobs.length, 1);
  assert.equal(result.graph[0].company.qualificationStatus, 'research_needed'); assert.equal(result.graph[0].score, 45);
  assert.equal(JSON.stringify(result).includes('private@employer.example'), false);
});

test('persistent opt-out survives deleting/recreating the contact and blocks approved-campaign recipients', async () => {
  await crm.recordReplyOrOptOut(owner._id, contact._id, { confirmed: true }, true);
  await Contact.deleteOne({ _id: contact._id });
  const recreated = await Contact.create(fixture({ userId: owner._id }));
  assert.match(await crm.blockedReason(owner._id, recreated.toObject()), /persistent suppression/);
  const { recipientReason } = require('../services/campaignService');
  assert.match(await recipientReason(owner, recreated.toObject(), { overrideSalary: true }), /persistent suppression/);
  assert.equal(await Suppression.countDocuments({ userId: owner._id }), 1);
});

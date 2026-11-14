const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const Campaign = require('../models/OutreachCampaign');
const Dispatch = require('../models/OutreachDispatch');
const Runtime = require('../models/OutreachRuntime');
const MailLog = require('../models/MailLog');
const RecipientSuppression = require('../models/RecipientSuppression');

const campaignService = require('../services/campaignService');
const { runCampaignWorkerOnce } = require('../services/campaignWorkerService');

const fixedNow = new Date('2026-11-14T10:00:00.000Z');
let mongo, server, base, userA, userB, companyA, contactA1, contactA2, contactBlocked;

const request = async (path, method = 'GET', body, owner = userA) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${jwt.sign({ _id: String(owner._id) }, process.env.JWT_SECRET)}`,
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};

before(async () => {
  process.env.JWT_SECRET = 'immediate-campaign-test-secret';
  process.env.OUTREACH_SENDING_ENABLED = 'false';
  process.env.OUTREACH_WORKER_ENABLED = 'false';
  process.env.OUTREACH_MAX_DAILY = '450';
  process.env.OUTREACH_GLOBAL_MAX_DAILY = '450';

  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User, Contact, Company, Campaign, Dispatch, Runtime, MailLog, RecipientSuppression].map(M => M.init()));

  const app = express();
  app.use(express.json());
  app.use('/mail', require('../routes/mail'));
  app.use('/campaigns', require('../routes/campaigns'));

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
}, 300000);

after(async () => {
  if (server) await new Promise(r => server.close(r));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([User, Contact, Company, Campaign, Dispatch, Runtime, MailLog, RecipientSuppression].map(M => M.deleteMany({})));

  userA = await User.create({
    name: 'Khushal Midha',
    email: 'khushal@example.com',
    college: 'Delhi Technological University',
    cgpa: '9.2',
    phone: '+919876543210',
    resumeLink: 'https://example.com/resume.pdf',
    candidateProfile: {
      college: 'Delhi Technological University',
      cgpa: '9.2',
      phone: '+919876543210',
      fullName: 'Khushal Midha'
    },
    passwordHash: 'fixture-password',
    blockedCompanies: ['Blacklisted Corp'],
    smtpConfigs: [{
      _id: 'smtp-account-1',
      name: 'Primary Gmail',
      host: 'smtp.gmail.com',
      port: 465,
      user: 'khushalmidha@gmail.com',
      pass: 'FAKE_APP_PASSWORD'
    }]
  });

  userB = await User.create({
    name: 'Other Recruiter',
    email: 'other@example.org',
    passwordHash: 'fixture-password',
    smtpConfigs: [{
      _id: 'smtp-other-1',
      name: 'Other SMTP',
      host: 'smtp.example.org',
      port: 465,
      user: 'other@example.org',
      pass: 'FAKE_PASSWORD'
    }]
  });

  const fixtureDate = new Date(Date.now() - 86400000);
  companyA = await Company.create({
    name: 'American Express',
    domain: 'aexp.com',
    careersUrl: 'https://aexp.com/careers',
    salaryEvidence: [{
      role: 'SDE 1',
      roleFamily: 'software_engineering',
      level: 'entry',
      experienceMin: 0,
      experienceMax: 2,
      location: 'India',
      indiaEligibility: true,
      indiaEligibilitySourceUrl: 'https://aexp.com/jobs',
      salarySourceUrl: 'https://aexp.com/jobs',
      salaryBaseMinINR: 1800000,
      salaryBaseMaxINR: 1800000,
      currency: 'INR',
      payPeriod: 'year',
      baseVsCTC: 'fixed_base',
      salarySourceType: 'official_job',
      reportedOn: fixtureDate,
      lastCheckedAt: fixtureDate,
      evidenceConfidence: 'high',
      evidenceExcerpt: 'Verified base pay fixture'
    }]
  });

  contactA1 = await Contact.create({
    userId: userA._id,
    companyId: companyA._id,
    company: companyA.name,
    hrName: 'Vaishnavi Pathak',
    email: 'vaishnavi.pathak1@aexp.com',
    verificationStatus: 'publicly_sourced',
    provenance: [{ url: 'https://aexp.com/careers', provider: 'fixture', observedAt: fixedNow }],
    status: 'pending'
  });

  contactA2 = await Contact.create({
    userId: userA._id,
    companyId: companyA._id,
    company: companyA.name,
    hrName: 'Tiesha Showers',
    email: 'tiesha.d.showers@aexp.com',
    verificationStatus: 'publicly_sourced',
    provenance: [{ url: 'https://aexp.com/careers', provider: 'fixture', observedAt: fixedNow }],
    status: 'pending'
  });

  contactBlocked = await Contact.create({
    userId: userA._id,
    company: 'Blacklisted Corp',
    hrName: 'Blocked Recruiter',
    email: 'recruiter@blacklisted.com',
    verificationStatus: 'publicly_sourced',
    provenance: [{ url: 'https://blacklisted.com/careers', provider: 'fixture', observedAt: fixedNow }],
    status: 'pending'
  });
});

test('immediate preview generates exact interpolated frozen snapshot, digests, and categorizes exclusions', async () => {
  const payload = {
    contactIds: [String(contactA1._id), String(contactA2._id), String(contactBlocked._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Referral for SDE 1 at {{companyName}}',
    bodyOverride: 'Hello {{hrName}},\n\nI am {{userName}} from {{college}} (CGPA {{cgpa}}). Please see my resume: {{resumeLink}}.'
  };

  const res = await request('/mail/preview', 'POST', payload);
  assert.equal(res.status, 200);
  assert.equal(res.data.eligibleCount, 2);
  assert.equal(res.data.blockedCount, 1);
  assert.ok(res.data.digest, 'Must provide SHA-256 digest');
  assert.ok(res.data.campaignId, 'Must create a draft campaign');

  // Check exclusion reason
  assert.equal(res.data.blocked[0].contactId, String(contactBlocked._id));
  assert.match(res.data.blocked[0].reason, /do-not-contact list/i);

  // Check exact interpolation on snapshot recipients
  const r1 = res.data.snapshot.recipients.find(r => r.contactId === String(contactA1._id));
  assert.equal(r1.subject, 'Referral for SDE 1 at American Express');
  assert.match(r1.body, /Hello Vaishnavi Pathak/);
  assert.match(r1.body, /I am Khushal Midha from Delhi Technological University \(CGPA 9\.2\)/);
  assert.match(r1.body, /https:\/\/example\.com\/resume\.pdf/);

  // Verify campaign stored in draft state
  const draft = await Campaign.findById(res.data.campaignId);
  assert.equal(draft.state, 'draft');
  assert.equal(draft.snapshot.immediate, true);
  assert.equal(draft.digest, res.data.digest);
});

test('arbitrary POST /mail/send without approved digest is strictly rejected', async () => {
  // Empty body
  const emptyRes = await request('/mail/send', 'POST', {});
  assert.equal(emptyRes.status, 403);

  // Unapproved arbitrary contacts list
  const unapprovedRes = await request('/mail/send', 'POST', {
    contactIds: [String(contactA1._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Arbitrary'
  });
  assert.equal(unapprovedRes.status, 403);
  assert.match(unapprovedRes.data.error, /preview/i);
});

test('approval binds strictly to digest; tampering or mismatch fails closed', async () => {
  const preview = await request('/mail/preview', 'POST', {
    contactIds: [String(contactA1._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Immediate outreach to {{companyName}}',
    bodyOverride: 'Hello {{hrName}}'
  });
  assert.equal(preview.status, 200);

  // Wrong digest
  const badDigestRes = await request('/mail/send', 'POST', {
    campaignId: preview.data.campaignId,
    approvedDigest: '0000000000000000000000000000000000000000000000000000000000000000'
  });
  assert.equal(badDigestRes.status, 400);
  assert.match(badDigestRes.data.error, /changed/i);

  // Tamper with draft campaign snapshot in DB
  await Campaign.updateOne({ _id: preview.data.campaignId }, { $set: { 'snapshot.senderEmail': 'tampered@example.com' } });
  const tamperedRes = await request('/mail/send', 'POST', {
    campaignId: preview.data.campaignId,
    approvedDigest: preview.data.digest
  });
  assert.equal(tamperedRes.status, 400);
});

test('evidence change after preview (suppression / opt-out / duplicate) fails approval closed', async () => {
  const preview = await request('/mail/preview', 'POST', {
    contactIds: [String(contactA1._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Outreach to {{companyName}}',
    bodyOverride: 'Hello {{hrName}}'
  });
  assert.equal(preview.status, 200);

  // Recipient opts out before approval is submitted
  await Contact.updateOne({ _id: contactA1._id }, { $set: { optOutAt: new Date() } });

  const approveRes = await request('/mail/send', 'POST', {
    campaignId: preview.data.campaignId,
    approvedDigest: preview.data.digest
  });
  assert.equal(approveRes.status, 400);
  assert.match(approveRes.data.error, /changed/i);
});

test('immediate outreach executes through SAME durable campaign worker without schedule wait', async () => {
  const preview = await request('/mail/preview', 'POST', {
    contactIds: [String(contactA1._id), String(contactA2._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Job Referral at {{companyName}}',
    bodyOverride: 'Greetings {{hrName}}, please consider me.'
  });
  assert.equal(preview.status, 200);

  const approveRes = await request('/mail/send', 'POST', {
    campaignId: preview.data.campaignId,
    approvedDigest: preview.data.digest
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.data.status, 'scheduled');

  // Verify dispatches created with queued status
  const dispatches = await Dispatch.find({ campaignId: preview.data.campaignId }).sort({ _id: 1 });
  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[0].status, 'queued');

  // Run the durable campaign worker at fixedNow (immediate!)
  let sentCount = 0;
  const fakeSend = async (sender, row) => {
    sentCount++;
    assert.equal(sender.email, 'khushalmidha@gmail.com');
    assert.ok(row.recipientEmail);
    return { providerMessageId: `fake-msg-${sentCount}` };
  };

  // First dispatch executes immediately using current time
  const runTime = new Date();
  const tick1 = await runCampaignWorkerOnce({ now: runTime, enabled: () => true, send: fakeSend });
  assert.equal(tick1.status, 'sent');
  assert.equal(sentCount, 1);

  // Check MailLog and Contact status
  const log1 = await MailLog.findOne({ dispatchId: dispatches[0]._id });
  assert.ok(log1);
  assert.equal(log1.status, 'sent');
  assert.equal(log1.recipientEmail, contactA1.email.toLowerCase());

  const updatedContact1 = await Contact.findById(contactA1._id);
  assert.equal(updatedContact1.status, 'sent');

  // Second dispatch is in cooldown until interval (180s)
  const cooldownTick = await runCampaignWorkerOnce({ now: new Date(+runTime + 60000), enabled: () => true, send: fakeSend });
  assert.equal(cooldownTick.status, 'cooldown');
  assert.equal(sentCount, 1);

  // At +180s, second dispatch executes
  const tick2 = await runCampaignWorkerOnce({ now: new Date(+runTime + 180000), enabled: () => true, send: fakeSend });
  assert.equal(tick2.status, 'sent');
  assert.equal(sentCount, 2);

  // Campaign completes
  const completedCampaign = await Campaign.findById(preview.data.campaignId);
  assert.equal(completedCampaign.state, 'completed');
});

test('dashboard pause/resume operates only on eligible owned campaigns', async () => {
  // Create an approved active campaign for User A
  const pA = await request('/mail/preview', 'POST', {
    contactIds: [String(contactA1._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Subj A',
    bodyOverride: 'Body A'
  });
  await request('/mail/send', 'POST', { campaignId: pA.data.campaignId, approvedDigest: pA.data.digest });

  // Create a cancelled campaign for User A
  const pCancel = await request('/mail/preview', 'POST', {
    contactIds: [String(contactA2._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Subj Cancel',
    bodyOverride: 'Body Cancel'
  });
  await request('/mail/send', 'POST', { campaignId: pCancel.data.campaignId, approvedDigest: pCancel.data.digest });
  await Campaign.updateOne({ _id: pCancel.data.campaignId }, { $set: { state: 'cancelled' } });

  // Pause active queue from dashboard
  const pauseRes = await request('/mail/pause-queue', 'POST');
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.data.paused, 1);
  assert.equal(pauseRes.data.isPaused, true);

  // Verify cancelled campaign was NOT modified
  const cCancel = await Campaign.findById(pCancel.data.campaignId);
  assert.equal(cCancel.state, 'cancelled');

  // Verify queue status reflects paused
  const qStatus1 = await request('/mail/queue-status', 'GET');
  assert.equal(qStatus1.data.isPaused, true);

  // Resume active queue from dashboard
  const resumeRes = await request('/mail/resume-queue', 'POST');
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.data.resumed, 1);
  assert.equal(resumeRes.data.isPaused, false);

  // Cancelled campaign still remains cancelled
  assert.equal((await Campaign.findById(pCancel.data.campaignId)).state, 'cancelled');
  // Paused campaign is back to scheduled
  assert.equal((await Campaign.findById(pA.data.campaignId)).state, 'scheduled');
});

test('dashboard resumeQueue strictly refuses to resume if unresolved unknown outcome exists', async () => {
  const pA = await request('/mail/preview', 'POST', {
    contactIds: [String(contactA1._id)],
    smtpId: 'smtp-account-1',
    subjectOverride: 'Subj A',
    bodyOverride: 'Body A'
  });
  await request('/mail/send', 'POST', { campaignId: pA.data.campaignId, approvedDigest: pA.data.digest });
  await request('/mail/pause-queue', 'POST');

  // Inject unresolved unknown outcome on a dispatch owned by User A
  await Dispatch.updateOne({ campaignId: pA.data.campaignId }, { $set: { status: 'unknown_outcome' } });

  const resumeRes = await request('/mail/resume-queue', 'POST');
  assert.equal(resumeRes.status, 409);
  assert.match(resumeRes.data.error, /unknown delivery outcomes/i);
  assert.equal(resumeRes.data.requiresReconciliation, true);

  // Verify campaign stayed paused
  assert.equal((await Campaign.findById(pA.data.campaignId)).state, 'paused');
});

test('multi-tenant isolation: User A cannot preview, approve, pause or resume User B campaigns', async () => {
  // User B creates a preview
  const contactB = await Contact.create({
    userId: userB._id,
    companyId: companyA._id,
    company: companyA.name,
    hrName: 'Other HR',
    email: 'other.hr@aexp.com',
    verificationStatus: 'publicly_sourced',
    provenance: [{ url: 'https://aexp.com/careers', provider: 'fixture', observedAt: fixedNow }],
    status: 'pending'
  });

  const pB = await request('/mail/preview', 'POST', {
    contactIds: [String(contactB._id)],
    smtpId: 'smtp-other-1',
    subjectOverride: 'Subj B',
    bodyOverride: 'Body B'
  }, userB);
  assert.equal(pB.status, 200);

  // User A tries to approve User B's campaign -> fails
  const approveAttack = await request('/mail/send', 'POST', {
    campaignId: pB.data.campaignId,
    approvedDigest: pB.data.digest
  }, userA);
  assert.equal(approveAttack.status, 400);

  // User B approves legitimately
  await request('/mail/send', 'POST', {
    campaignId: pB.data.campaignId,
    approvedDigest: pB.data.digest
  }, userB);

  // User A pauses queue -> only User A's campaigns affected, User B remains scheduled
  await request('/mail/pause-queue', 'POST', {}, userA);
  const campB = await Campaign.findById(pB.data.campaignId);
  assert.equal(campB.state, 'scheduled');
});

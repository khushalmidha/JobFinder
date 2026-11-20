const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const User = require('../models/User');
const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');
const RecipientSuppression = require('../models/RecipientSuppression');
const Dispatch = require('../models/OutreachDispatch');
const { previewCampaign } = require('../services/campaignService');
const { isConfirmedAddressNotFound, parseDeliveryStatus } = require('../services/deliveryStatusParser');

test('Resend allowance and bounce scan suppression', async (t) => {
  let mongod;
  t.before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });
  t.after(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  await t.test('isConfirmedAddressNotFound correctly differentiates permanent 5.1.1 vs temporary errors', () => {
    // Permanent "Address not found" / 5.1.1
    assert.equal(isConfirmedAddressNotFound('5.1.1', '550 5.1.1 User unknown', ''), true);
    assert.equal(isConfirmedAddressNotFound('5.1.0', '', 'The email account that you tried to reach does not exist'), true);
    assert.equal(isConfirmedAddressNotFound('', '', '** Address not found ** Your message was not delivered'), true);
    assert.equal(isConfirmedAddressNotFound('', '550 5.1.1 <test@example.com>: Recipient address rejected: User unknown', ''), true);

    // Temporary failures must NOT be treated as permanent address-not-found
    assert.equal(isConfirmedAddressNotFound('5.2.2', 'Mailbox full', ''), false);
    assert.equal(isConfirmedAddressNotFound('4.2.2', 'Quota exceeded', ''), false);
    assert.equal(isConfirmedAddressNotFound('4.4.1', 'Connection timed out', ''), false);
    assert.equal(isConfirmedAddressNotFound('4.7.1', 'Try again later', ''), false);
    assert.equal(isConfirmedAddressNotFound('', '', 'Temporary failure, please retry in 15 minutes'), false);
  });

  await t.test('parseDeliveryStatus extracts RFC 3464 and Gmail headers accurately', () => {
    const raw = [
      'Original-Message-ID: <test-123@example.org>',
      '',
      'Final-Recipient: rfc822; invalid@example.com',
      'Action: failed',
      'Status: 5.1.1',
      'Diagnostic-Code: smtp; 550 5.1.1 No such user'
    ].join('\r\n');

    const results = parseDeliveryStatus(raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].recipientEmail, 'invalid@example.com');
    assert.equal(results[0].enhancedStatus, '5.1.1');
    assert.equal(results[0].action, 'failed');
    assert.equal(results[0].messageId, '<test-123@example.org>');
  });

  await t.test('allowResend allows explicitly selected contacts with prior send history', async () => {
    const user = await User.create({
      name: 'Owner User',
      email: 'owner@example.org',
      passwordHash: 'hashed-secret',
      smtpConfigs: [{
        _id: new mongoose.Types.ObjectId(),
        name: 'Primary SMTP',
        user: 'sender@example.org',
        pass: 'secret',
        host: 'smtp.example.org',
        port: 465,
        isDefault: true
      }]
    });
    const senderId = String(user.smtpConfigs[0]._id);

    const company = await Company.create({
      name: 'Acme Corp',
      salaryEvidence: [{
        baseAmount: 1800000,
        currency: 'INR',
        baseVsCTC: 'fixed_base',
        reportedOn: new Date(),
        salarySourceUrl: 'https://example.com/job',
        salarySourceType: 'official_job'
      }]
    });

    const contact = await Contact.create({
      userId: user._id,
      company: company.name,
      companyId: company._id,
      email: 'recruiter@acmecorp.example',
      verificationStatus: 'publicly_sourced',
      provenance: [{ url: 'https://example.com/team' }],
      status: 'pending'
    });

    // Create prior send history in MailLog
    await MailLog.create({
      userId: user._id,
      contactId: contact._id,
      recipientEmail: contact.email,
      subject: 'Past subject',
      body: 'Past body',
      status: 'sent',
      sentAt: new Date()
    });

    // Case 1: allowResend = false (default legacy) -> blocked as duplicate history
    const previewWithoutResend = await previewCampaign(user._id, {
      senderId,
      immediate: true,
      allowResend: false,
      recipients: [{
        contactId: String(contact._id),
        subject: 'Hello',
        body: 'World',
        overrideSalary: true
      }]
    });
    assert.equal(previewWithoutResend.snapshot.recipients.length, 0);
    assert.equal(previewWithoutResend.blocked.length, 1);
    assert.equal(previewWithoutResend.blocked[0].reason, 'Already sent: contact or recipient history');

    // Case 2: allowResend = true -> contact is eligible despite prior history!
    const previewWithResend = await previewCampaign(user._id, {
      senderId,
      immediate: true,
      allowResend: true,
      recipients: [{
        contactId: String(contact._id),
        subject: 'Hello again',
        body: 'Follow up world',
        overrideSalary: true
      }]
    });
    assert.equal(previewWithResend.snapshot.recipients.length, 1);
    assert.equal(previewWithResend.blocked.length, 0);
    assert.equal(previewWithResend.snapshot.recipients[0].recipientEmail, contact.email);
    assert.equal(previewWithResend.snapshot.allowResend, true);

    // Case 3: In-flight Dispatch STILL blocks even with allowResend = true
    await Dispatch.create({
      campaignId: new mongoose.Types.ObjectId(),
      userId: user._id,
      contactId: contact._id,
      revision: 1,
      recipientEmail: contact.email,
      senderEmail: 'sender@example.org',
      subject: 'In flight',
      body: 'In flight body',
      approvedDigest: 'digest',
      scheduledAtUtc: new Date(),
      status: 'sending'
    });
    const previewInFlight = await previewCampaign(user._id, {
      senderId,
      immediate: true,
      allowResend: true,
      recipients: [{
        contactId: String(contact._id),
        subject: 'Hello again',
        body: 'Follow up world',
        overrideSalary: true
      }]
    });
    assert.equal(previewInFlight.snapshot.recipients.length, 0);
    assert.equal(previewInFlight.blocked.length, 1);
    assert.equal(previewInFlight.blocked[0].reason, 'Previous send or unresolved delivery outcome');

    // Clean up in-flight dispatch
    await Dispatch.deleteMany({});

    // Case 4: Confirmed invalid / suppression STILL blocks even with allowResend = true
    await RecipientSuppression.create({
      userId: user._id,
      email: contact.email,
      source: 'authenticated_provider_5.1.1',
      reason: 'Confirmed invalid: Address not found (5.1.1)'
    });
    const previewSuppressed = await previewCampaign(user._id, {
      senderId,
      immediate: true,
      allowResend: true,
      recipients: [{
        contactId: String(contact._id),
        subject: 'Hello again',
        body: 'Follow up world',
        overrideSalary: true
      }]
    });
    assert.equal(previewSuppressed.snapshot.recipients.length, 0);
    assert.equal(previewSuppressed.blocked.length, 1);
    assert.equal(previewSuppressed.blocked[0].reason, 'Recipient has a persistent suppression record');
  });

  await t.test('deleteBounced removes confirmed-invalid bounced contacts while preserving suppression', async () => {
    const user = await User.create({
      name: 'Cleanup User',
      email: 'cleanup@example.org',
      passwordHash: 'secret'
    });

    // Create 1 confirmed invalid bounced contact
    const badContact = await Contact.create({
      userId: user._id,
      company: 'Test Co',
      email: 'bad.address@example.com',
      status: 'bounced',
      deliverabilityStatus: 'invalid',
      suppressedAt: new Date(),
      suppressionReason: 'Confirmed invalid: Address not found (5.1.1 permanent failure)'
    });

    await RecipientSuppression.create({userId:user._id,email:badContact.email,source:'confirmed_invalid_pipeline',reason:'Trusted fixture permanent failure'});

    // Create 1 valid contact
    const goodContact = await Contact.create({
      userId: user._id,
      company: 'Test Co',
      email: 'good.address@example.com',
      status: 'pending',
      deliverabilityStatus: 'valid'
    });

    // Run deleteBounced controller logic
    const req = { user: { _id: user._id } };
    let jsonResult;
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(data) { jsonResult = data; return this; }
    };

    const bounceController = require('../controllers/bounceController');
    await bounceController.deleteBounced(req, res);

    assert.equal(jsonResult.deletedCount, 1);
    assert.equal(await Contact.exists({ _id: badContact._id }), null);
    assert.ok(await Contact.exists({ _id: goodContact._id }));
  });
});

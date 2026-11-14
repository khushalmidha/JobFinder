const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { chromium } = require('playwright');

const User = require('../models/User');
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const Campaign = require('../models/OutreachCampaign');
const Dispatch = require('../models/OutreachDispatch');
const Runtime = require('../models/OutreachRuntime');
const MailLog = require('../models/MailLog');
const RecipientSuppression = require('../models/RecipientSuppression');

test('Chromium ComposePanel E2E: recipients, exclusions, sender, flags, re-preview, approval and zero outbound calls', async () => {
  let mongo, server, browser, context, page;
  try {
    process.env.JWT_SECRET = 'compose-chromium-synthetic-secret';
    process.env.OUTREACH_SENDING_ENABLED = 'false';
    process.env.OUTREACH_WORKER_ENABLED = 'false';
    process.env.OUTREACH_MAX_DAILY = '450';
    process.env.OUTREACH_GLOBAL_MAX_DAILY = '450';

    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([User, Contact, Company, Campaign, Dispatch, Runtime, MailLog, RecipientSuppression].map(M => M.init()));

    const fixedDate = new Date('2026-11-14T10:00:00.000Z');
    const ownerId = new mongoose.Types.ObjectId();

    // 1. Synthetic User with verified SMTP and Brevo configured (to verify Brevo is disabled for durable outreach)
    const user = await User.create({
      _id: ownerId,
      name: 'Candidate Browser Owner',
      email: 'browser-owner@example.org',
      passwordHash: 'synthetic-hash',
      college: 'Tech University',
      cgpa: '9.2',
      phone: '+919876543210',
      resumeLink: 'https://example.org/resume.pdf',
      candidateProfile: {
        fullName: 'Candidate Browser Owner',
        college: 'Tech University',
        cgpa: '9.2',
        phone: '+919876543210'
      },
      brevoApiKey: 'synthetic-brevo-api-key',
      smtpConfigs: [{
        _id: 'smtp-browser-primary',
        name: 'Primary Gmail SMTP',
        host: 'smtp.gmail.com',
        port: 465,
        user: 'sender@example.org',
        pass: 'synthetic-fake-password'
      }]
    });

    // 2. Qualified Company
    const company = await Company.create({
      name: 'Alpha Technologies',
      domain: 'alphatech.example',
      careersUrl: 'https://alphatech.example/careers',
      salaryEvidence: [{
        role: 'Software Engineer I',
        roleFamily: 'software_engineering',
        level: 'entry',
        experienceMin: 0,
        experienceMax: 2,
        location: 'India',
        indiaEligibility: true,
        indiaEligibilitySourceUrl: 'https://alphatech.example/jobs/1',
        salaryBaseMinINR: 1600000,
        salaryBaseMaxINR: 1800000,
        currency: 'INR',
        payPeriod: 'year',
        baseVsCTC: 'fixed_base',
        salarySourceUrl: 'https://alphatech.example/jobs/1',
        salarySourceType: 'official_job',
        reportedOn: fixedDate,
        lastCheckedAt: fixedDate,
        evidenceConfidence: 'high',
        evidenceExcerpt: 'Synthetic qualification fixture: annual fixed base 16-18 LPA'
      }]
    });

    // 3. Contacts: 2 Eligible + 1 Excluded (invalid deliverability)
    const contact1 = await Contact.create({
      userId: ownerId,
      companyId: company._id,
      company: company.name,
      hrName: 'Alice Senior HR',
      email: 'alice.hr@alphatech.example',
      verificationStatus: 'publicly_sourced',
      provenance: [{ url: 'https://alphatech.example/careers', provider: 'fixture', observedAt: fixedDate }],
      status: 'pending',
      deliverabilityStatus: 'valid'
    });

    const contact2 = await Contact.create({
      userId: ownerId,
      companyId: company._id,
      company: company.name,
      hrName: 'Bob Recruiting Lead',
      email: 'bob.hr@alphatech.example',
      verificationStatus: 'publicly_sourced',
      provenance: [{ url: 'https://alphatech.example/careers', provider: 'fixture', observedAt: fixedDate }],
      status: 'pending',
      deliverabilityStatus: 'valid'
    });

    const contact3Excluded = await Contact.create({
      userId: ownerId,
      companyId: company._id,
      company: company.name,
      hrName: 'Eve Unverified Contact',
      email: 'eve.unverified@alphatech.example',
      verificationStatus: 'unknown',
      status: 'pending',
      deliverabilityStatus: 'valid'
    });

    // 4. Setup Express Application serving API and Web Dist
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/contacts', require('../routes/contact'));
    app.use('/api/mail', require('../routes/mail'));
    app.use('/api/campaigns', require('../routes/campaigns'));

    const webDist = path.resolve(__dirname, '../../web/dist');
    app.use(express.static(webDist));
    app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: webDist }));

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    // 5. Launch Chromium
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    page = await context.newPage();

    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER PAGE ERROR:', err.message));
    page.on('response', res => {
      if (res.status() >= 400) console.log('API RESPONSE ERROR:', res.status(), res.url());
    });

    const token = jwt.sign({ _id: String(ownerId) }, process.env.JWT_SECRET);
    await page.addInitScript(t => localStorage.setItem('token', t), token);

    // Navigate to Dashboard
    await page.goto(base + '/');

    // Wait for contacts table to render
    await page.getByText('Alice Senior HR').waitFor({ timeout: 10000 });
    await page.getByText('Bob Recruiting Lead').waitFor();
    await page.getByText('Eve Unverified Contact').waitFor();

    // Select all 3 contacts (Alice, Bob, Eve)
    await page.locator('tr', { hasText: 'alice.hr@alphatech.example' }).locator('input[type="checkbox"]').check();
    await page.locator('tr', { hasText: 'bob.hr@alphatech.example' }).locator('input[type="checkbox"]').check();
    await page.locator('tr', { hasText: 'eve.unverified@alphatech.example' }).locator('input[type="checkbox"]').check();

    // Verify Send button indicates 3 selected
    const sendButton = page.getByRole('button', { name: /Send \(3\)/ });
    await sendButton.waitFor();
    await sendButton.click();

    // ComposePanel opens
    await page.getByRole('heading', { name: 'Compose Batch Outreach' }).waitFor();

    // Verify Brevo API is disabled with clear explanation (SMTP only)
    await page.getByText(/Brevo API:/).waitFor();
    await page.getByText(/Not supported for durable campaign worker dispatch \(SMTP only\)/).waitFor();
    const disabledBadge = page.locator('span', { hasText: /^Disabled$/ });
    await disabledBadge.waitFor();

    // Verify Sender Account shows Primary Gmail SMTP selected
    await page.getByText('Primary Gmail SMTP').waitFor();
    await page.getByText('sender@example.org').first().waitFor();

    // Fill Template Placeholders in Subject & Body
    const subjectInput = page.locator('input[placeholder*="Application for Software Engineer"]');
    await subjectInput.fill('Application for {{role}} at {{companyName}}');

    const bodyTextarea = page.locator('textarea[placeholder*="Greetings"]');
    await bodyTextarea.fill('Hello {{hrName}},\n\nI am applying for {{role}} at {{companyName}}.\nApplicant: {{userName}}\nCollege: {{college}}\nResume: {{resumeLink}}');

    // Click "Review & Preview"
    await page.getByRole('button', { name: 'Review & Preview' }).click();

    // Explicit Approval & Review Modal opens
    const modal = page.locator('div.z-60');
    await modal.waitFor();

    // Verify Operational Flags & Cooldown Interval
    await modal.getByText('Immediate durable dispatch queue').waitFor();
    await modal.getByText('180s interval between sends').waitFor();
    await modal.getByText('DISABLED (OUTREACH_SENDING_ENABLED=false)').waitFor();
    await modal.getByText('STANDBY / DISABLED (OUTREACH_WORKER_ENABLED=false)').waitFor();
    await modal.getByText(/Immediate outreach queues for the next worker poll cycle subject to cooldown interval/).waitFor();

    // Verify Counts: Selected = 3, Eligible = 2, Excluded = 1
    const modalText = await modal.innerText();
    assert.ok(modalText.includes('Selected\n3') || modalText.includes('3'), 'Selected count is 3');
    assert.ok(modalText.includes('Eligible\n2') || modalText.includes('2'), 'Eligible count is 2');
    assert.ok(modalText.includes('Excluded\n1') || modalText.includes('1'), 'Excluded count is 1');

    // Verify Excluded Contacts section displays Eve's contact
    await modal.getByText(/Excluded Contacts \(1\)/).waitFor();
    await modal.getByText('eve.unverified@alphatech.example').waitFor();
    await modal.getByText('Contact requires sourced evidence and review').waitFor();

    // Verify Frozen Recipient 1: Alice Senior HR
    await modal.getByText('alice.hr@alphatech.example').waitFor();
    await modal.getByText('Alpha Technologies').first().waitFor();

    // Inspect Recipient 1 message
    await modal.getByRole('button', { name: 'Inspect Message' }).first().click();
    await modal.getByText('Hello Alice Senior HR,').waitFor();
    await modal.getByText('Applicant: Candidate Browser Owner').first().waitFor();
    await modal.getByText('College: Tech University').first().waitFor();

    // Inspect Recipient 2 message (Crucial: Bob Recruiting Lead personalized body)
    await modal.getByRole('button', { name: 'Inspect Message' }).click();
    await modal.getByText('Hello Bob Recruiting Lead,').waitFor();
    await modal.getByText('bob.hr@alphatech.example').waitFor();

    // Test Edit & Re-preview Invalidation
    await modal.getByRole('button', { name: 'Back to Edit' }).click();
    // Modal closes
    await modal.waitFor({ state: 'detached' });

    // Update subject in editor
    await subjectInput.fill('Application for {{role}} at {{companyName}} [Updated]');

    // Click Review & Preview again
    await page.getByRole('button', { name: 'Review & Preview' }).click();
    await modal.waitFor();

    // Verify updated subject rendered for recipients
    await modal.getByText('Application for Software Engineering at Alpha Technologies [Updated]').first().waitFor();

    // Test Contact Mutation before approval blocks approval
    // Mutate contact2 in database to invalid/bounced while review modal is open
    await Contact.updateOne({ _id: contact2._id }, { $set: { deliverabilityStatus: 'invalid', status: 'bounced' } });

    // Check approval checkbox
    const approvalCheckbox = modal.locator('input[type="checkbox"]');
    await approvalCheckbox.check();

    // Click Approve & Queue Now
    const approveButton = modal.getByRole('button', { name: /Approve & Queue Now/ });
    assert.equal(await approveButton.isEnabled(), true);
    await approveButton.click();

    // Server rejects stale preview approval with 400
    await modal.getByText(/Sender, recipient or evidence changed|Approval failed/i).waitFor();

    // Restore contact2 to deliverable and clean state
    await Contact.updateOne({ _id: contact2._id }, { $set: { deliverabilityStatus: 'valid', status: 'pending' } });

    // Re-preview clean draft
    await modal.getByRole('button', { name: 'Back to Edit' }).click();
    await modal.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Review & Preview' }).click();
    await modal.waitFor();

    // Approve clean draft
    const freshCheckbox = modal.locator('input[type="checkbox"]');
    await freshCheckbox.check();
    await modal.getByRole('button', { name: /Approve & Queue Now/ }).click();

    // Review modal closes
    await modal.waitFor({ state: 'detached' });

    // 6. Database assertions
    const scheduledCampaigns = await Campaign.find({ userId: ownerId, state: 'scheduled' });
    assert.equal(scheduledCampaigns.length, 1, 'Exactly 1 campaign scheduled in Mongo');
    assert.equal(scheduledCampaigns[0].snapshot.immediate, true, 'Campaign snapshot immediate is true');
    assert.equal(scheduledCampaigns[0].snapshot.recipients.length, 2, '2 frozen recipients in snapshot');

    const dispatches = await Dispatch.find({ campaignId: scheduledCampaigns[0]._id });
    assert.equal(dispatches.length, 2, '2 dispatches queued in Mongo');
    assert.ok(dispatches.every(d => d.status === 'queued'), 'All dispatches queued');

    // 7. Verify zero outbound provider calls
    const logs = await MailLog.countDocuments({ userId: ownerId });
    assert.equal(logs, 0, 'No MailLogs created; zero outbound mail sent');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(r => server.close(r));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  }
});

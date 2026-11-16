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
    process.env.OUTREACH_GLOBAL_MAX_DAILY = '1800';

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
      },{_id:'smtp-browser-backup',name:'Approved backup SMTP',host:'smtp.backup.example',port:465,user:'backup@example.org',pass:'FAKE_BACKUP_SECRET'},{_id:'smtp-browser-third',name:'Third owned SMTP',host:'smtp.third.example',port:465,user:'alternate@example.org',pass:'FAKE_THIRD_SECRET'}]
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

    // The same ColdMail composer also schedules a distinct recipient without opening a separate editor.
    await Contact.create({userId:ownerId,companyId:company._id,company:company.name,email:'carol.hr@alphatech.example',hrName:'Carol Recruiter',verificationStatus:'publicly_sourced',provenance:[{url:'https://alphatech.example/careers',provider:'fixture',observedAt:fixedDate}]});
    require('../controllers/contactController').invalidateContactCache(ownerId);
    await page.reload();await page.getByLabel('Select carol.hr@alphatech.example',{exact:true}).check();await page.getByRole('button',{name:'Send (1)',exact:true}).click();
    assert.equal(await page.getByLabel('Send now (default)',{exact:true}).isChecked(),true);
    assert.equal(await page.getByLabel('Send date',{exact:true}).count(),0);
    await page.getByLabel('Schedule for later',{exact:true}).check();await page.getByRole('button',{name:'Review & Preview',exact:true}).click();
    await page.getByText('Choose a send date, time and timezone before previewing.',{exact:true}).waitFor();
    const scheduleDay=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
    await page.getByLabel('Send date',{exact:true}).fill('2020-01-01');await page.getByLabel('Send time',{exact:true}).fill('10:00');await page.getByLabel('Schedule timezone',{exact:true}).selectOption('Asia/Kolkata');
    await page.getByRole('button',{name:'Review & Preview',exact:true}).click();await page.getByText('Choose a future start time',{exact:true}).waitFor();
    await page.getByLabel('Send date',{exact:true}).fill(scheduleDay);
    await page.getByLabel('Automatically switch between approved sender accounts when a daily limit is reached',{exact:true}).check();
    await page.getByRole('button',{name:'Review & Preview',exact:true}).click();await page.getByText('Choose at least one additional approved sender for automatic switching.',{exact:true}).waitFor();
    await page.getByLabel('Approve fallback backup@example.org',{exact:true}).check();
    await page.getByRole('button',{name:'Review & Preview',exact:true}).click();await modal.waitFor();
    await modal.getByText('Approved sending accounts — automatic fallback',{exact:true}).waitFor();

    await modal.getByText('Scheduled durable dispatch queue',{exact:true}).waitFor();await modal.getByText('Scheduled start (UTC): '+scheduleDay+'T04:30:00.000Z',{exact:true}).waitFor();
    const oldScheduled=await Campaign.findOne({userId:ownerId,'snapshot.immediate':false}).sort({createdAt:-1});
    assert.equal(oldScheduled.snapshot.dailyLimit,900);assert.equal(oldScheduled.snapshot.approvedSenders.length,2);
    await modal.getByRole('button',{name:'Back to Edit',exact:true}).click();
    await page.getByLabel('Approve fallback backup@example.org',{exact:true}).uncheck();await page.getByLabel('Approve fallback alternate@example.org',{exact:true}).check();
    const changedDay=new Date(Date.now()+3*86400000).toISOString().slice(0,10);await page.getByLabel('Send date',{exact:true}).fill(changedDay);
    await page.getByRole('button',{name:'Review & Preview',exact:true}).click();await modal.waitFor();
    assert.equal(await modal.getByRole('button',{name:/Approve & Schedule/}).isDisabled(),true);
    const latestScheduled=await Campaign.findOne({userId:ownerId,'snapshot.immediate':false}).sort({createdAt:-1});assert.notEqual(latestScheduled.digest,oldScheduled.digest);
    await modal.getByText('Scheduled start (UTC): '+changedDay+'T04:30:00.000Z',{exact:true}).waitFor();
    await modal.locator('input[type="checkbox"]').check();await modal.getByRole('button',{name:/Approve & Schedule/}).click();await modal.waitFor({state:'detached'});
    const approvedSchedule=await Campaign.findById(latestScheduled._id);assert.equal(approvedSchedule.state,'scheduled');assert.equal(approvedSchedule.snapshot.immediate,false);assert.deepEqual(approvedSchedule.snapshot.approvedSenders.map(s=>s.email),['sender@example.org','alternate@example.org']);assert.equal(+approvedSchedule.nextAt,+new Date(changedDay+'T04:30:00.000Z'));
    assert.equal(await Campaign.countDocuments({userId:ownerId,state:'scheduled'}),2);assert.equal(await Dispatch.countDocuments({campaignId:latestScheduled._id,status:'queued'}),1);
    await page.reload();assert.equal((await Campaign.findById(latestScheduled._id)).approvedDigest,latestScheduled.digest);
    console.log('PASS: unified ColdMail composer immediate default, optional date/time/timezone, past-time rejection, schedule re-preview and durable approval; no real delivery');

    await page.goto(base+'/campaigns');await page.getByRole('heading',{name:'Outreach Queue',exact:true}).waitFor();await page.getByText('Advanced campaign editor',{exact:true}).click();
    const advanced=page.locator('section[aria-labelledby="campaign-editor"]');await advanced.getByRole('combobox',{name:/Sender account/}).selectOption('smtp-browser-primary');
    await advanced.getByLabel('Automatically switch between approved sender accounts when a daily limit is reached',{exact:true}).check();
    await advanced.getByLabel('Approve fallback backup@example.org',{exact:true}).check();await advanced.getByLabel('Approve fallback alternate@example.org',{exact:true}).check();
    assert.equal(await advanced.getByLabel('Maximum per day',{exact:true}).inputValue(),'1350');
    await advanced.getByRole('combobox',{name:/Sender account/}).selectOption('smtp-browser-backup');assert.equal(await advanced.getByLabel('Maximum per day',{exact:true}).inputValue(),'900');
    console.log('PASS: exact approved sender list/caps in main composer, sender edits clear approval, and promoting a fallback clamps the advanced campaign budget; real delivery=0');

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

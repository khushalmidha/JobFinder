const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { chromium } = require('playwright');
const companyImport = require('../services/companyImportService');
const career = require('../services/careerWatchService');
const { SmartApplyStore } = require('../smartApply/store');
const { SmartApplyEngine } = require('../smartApply/engine');
const { rankJob } = require('../smartApply/ranking');
const { importLeads } = require('../services/professionalSheetService');
const { headers, syncContacts } = require('../services/googleContactSheet');

test('company import, official job, reviewed profile, dropdown and approved contact sync', async t => {
  const mongo = await MongoMemoryServer.create();
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  await mongoose.connect(mongo.getUri());
  const model = name => require('../models/' + name);
  const owner = await model('User').create({ name: 'Fixture', email: 'fixture@example.org', passwordHash: 'fixture', role: 'admin' });
  const userId = owner._id;
  await model('CompanyProspect').init();
  const source = {source:'workflow-fixture', companies:[{
    companyName:'Example Employer', regionGroup:'India', careersUrl:'https://employer.example/careers'
  }]};
  for (let i = 0; i < 2; i++) {
    const preview = await companyImport.previewImport(userId, source);
    await companyImport.applyImport(userId, preview.runId, preview.digest);
  }
  assert.equal(await model('CompanyProspect').countDocuments(), 1);
  await model('CareerWatchConfig').create({ userId, enabled:true, discoverContacts:false, dailyRequestLimit:100 });
  await model('CareerWatchTask').create({ userId, company:'Example Employer', domain:'employer.example', careersUrl:source.companies[0].careersUrl, nextScanAt:new Date(0) });
  const fixture = {
    '@type':'JobPosting', title:'Backend intern', description:'Graduating July 2027. Six months internship with PPO conversion. Java.',
    url:'https://employer.example/jobs/1', jobLocation:{ address:{addressLocality:'Bengaluru'} }
  };
  const result = await career.runCareerWatchOnce({ userId, dryRun:false, fetchPage:async url => ({
    status:200, text:url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : '<script type="application/ld+json">' + JSON.stringify(fixture) + '</script>'
  }) });
  assert.equal(result.jobsFound, 1);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'jobfinder-workflow-'));
  const store = new SmartApplyStore(folder);
  t.after(() => { store.close(); fs.rmSync(folder,{recursive:true,force:true}); });
  const pdf = path.join(folder,'reviewed.pdf');
  const bytes = Buffer.from('%PDF-1.4\n% local fixture');
  fs.writeFileSync(pdf,bytes);
  store.set('profile', {_resume:{sha256:crypto.createHash('sha256').update(bytes).digest('hex')}, identity:{name:'Fixture Candidate'}, education:[{degree:'Bachelor of Technology'}], skills:{languages:['Java']}});
  store.set('reviewed', true);
  const profile = store.get('profile');
  const job = await model('CareerWatchJob').findOne().lean();
  assert.equal(job.graduationFit, 'fits');
  assert.equal(job.remoteEligibility, 'unknown');
  assert.equal(job.sponsorship, 'unknown');
  assert.ok(rankJob(job,profile).matchScore > 1);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  let submissions = 0;
  await page.route('http://localhost/**', async route => {
    if (route.request().method() !== 'GET') { submissions++; return route.abort(); }
    await route.fulfill({contentType:'text/html',body:
      '<form method="post"><button type="button" aria-label="Degree" aria-haspopup="listbox" data-control="choices">Select degree</button><label>Resume PDF<input type="file"></label><button>Submit</button></form>' +
      '<div id="choices" role="listbox" hidden><div role="option">Bachelor of Technology</div></div>' +
      '<script>const b=document.querySelector("[data-control]"),l=document.querySelector("[role=listbox]");b.onclick=()=>setTimeout(()=>{b.setAttribute("aria-controls","choices");l.hidden=false},250);l.firstChild.onclick=()=>{const next=b.cloneNode();next.textContent="Bachelor of Technology";next.dataset.value=next.textContent;b.replaceWith(next);l.hidden=true};</script>'
    });
  });
  await page.goto('http://localhost/apply');
  const engine = new SmartApplyEngine(page,{ profile, allowedHosts:['localhost'] });
  await engine.preview();
  assert.equal(await page.getByRole('button',{name:'Degree'}).innerText(),'Select degree');
  const report = await engine.fill();
  assert.equal(report.fields.filter(field=>field.outcome==='verified').length,1);
  assert.equal((await engine.attachReviewedResume(pdf)).status,'selected_locally');
  assert.equal(await page.locator('input[type="file"]').evaluate(el=>el.files[0].name),'reviewed.pdf');
  assert.equal(submissions,0);

  const lead = await model('ProfessionalLead').create({ userId, company:'Example Employer', domain:'employer.example',
    email:'careers@employer.example', kind:'role_inbox', sourceUrl:source.companies[0].careersUrl, observedAt:new Date() });
  const options = {userId,leadIds:[lead._id],domainCheck:async()=>({status:'mx_found',hosts:['mx.employer.example']}),
    probe:async()=>({status:'unreachable',mailboxVerified:false}),reserve:async()=>{}};
  assert.equal((await importLeads(options)).added,1);
  assert.equal((await importLeads(options)).duplicates,1);
  const contact = await model('Contact').findOne({userId}).lean();
  const { renderTemplateText } = require('../services/outreachTemplateService');
  const draft = renderTemplateText('Hello {{hrName}}, I am interested in {{role}} at {{companyName}}. {{jobLink}}', {
    contact, roleOverride:job.title, jobLinkOverride:job.url
  });
  assert.match(draft,/Backend intern at Example Employer/);
  assert.equal(await model('MailLog').countDocuments(),0);
  assert.equal(store.awaitingConfirmation(job.url),true);
  assert.equal(store.awaitingConfirmation(job.url),false);
  assert.throws(()=>store.confirmApplication(job.url,''),/confirmation reference/);
  assert.equal(store.confirmApplication(job.url,'fixture-confirmation'),true);
  assert.equal(store.confirmApplication(job.url,'duplicate'),false);

  const values = [headers];
  let appends = 0;
  const sync = { destination:{spreadsheetId:'test',tab:'Contacts'}, leads:[lead],
    client:{read:async()=>structuredClone(values),append:async rows=>{appends++; values.push(...rows); throw Error('Lost reply');}} };
  const preview = await syncContacts(sync);
  assert.equal(preview.rows.length,1);
  assert.equal(appends,0);
  assert.equal((await syncContacts({...sync,approvedDigest:preview.digest})).status,'needs_reconciliation');
  assert.equal((await syncContacts({...sync,approvedDigest:preview.digest})).status,'needs_reconciliation');
  assert.equal((await syncContacts({...sync,reconcile:true})).status,'reconciled');
  assert.equal((await syncContacts({...sync,approvedDigest:preview.digest})).status,'already_present');
  assert.equal(appends,1);
  const absent = {...sync,destination:{spreadsheetId:'other',tab:'Contacts'},client:{
    read:async()=>[headers],append:async()=>{ appends++; throw Error('Unknown append outcome'); }
  }};
  const absentPreview = await syncContacts(absent);
  assert.equal((await syncContacts({...absent,approvedDigest:absentPreview.digest})).status,'needs_reconciliation');
  assert.equal((await syncContacts({...absent,reconcile:true})).status,'needs_reconciliation');
  assert.equal((await syncContacts({...absent,approvedDigest:absentPreview.digest})).status,'needs_reconciliation');
  assert.equal(appends,2);
});


test('job evidence keeps ambiguous geography, visa and range statements unknown', () => {
  const { postingEvidence } = require('../services/jobPostingEvidence');
  assert.equal(postingEvidence({description:'Graduating June 2027.'}).graduationFit,'outside');
  assert.equal(postingEvidence({description:'Graduating July 2027.'}).graduationFit,'fits');
  const ambiguous = postingEvidence({description:'Graduating 2026 or 2027. Remote may be possible. Visa sponsorship may be available.'});
  assert.equal(ambiguous.graduationFit,'unknown');
  assert.equal(ambiguous.remoteEligibility,'unknown');
  assert.equal(ambiguous.sponsorship,'unknown');
  assert.equal(postingEvidence({description:'No remote from India. Visa sponsorship is not available.'}).remoteEligibility,'unknown');
});

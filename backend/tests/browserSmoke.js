// Real Chromium + built MV3 extension + real temporary MongoDB. Synthetic data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { chromium } = require('playwright');
async function main() {
  let mongo, server, context, page;
  const screenshots=path.resolve(__dirname,'../../artifacts');fs.mkdirSync(screenshots,{recursive:true});
  let submissions=0;
  try {
    process.env.JWT_SECRET='synthetic-browser-test-only';process.env.OUTREACH_SENDING_ENABLED='false';
    mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());
    const Company=require('../models/Company'), Job=require('../models/JobOpening'), Contact=require('../models/Contact');
    const owner=new mongoose.Types.ObjectId();const date=new Date();
    await require('../models/User').create({_id:owner,name:'Synthetic Browser Owner',email:'browser-owner@example.org',passwordHash:'synthetic-not-a-login',role:'admin',smtpConfigs:[{_id:'browser-smtp',name:'Synthetic SMTP',host:'smtp.example.org',port:465,user:'sender@example.org',pass:'synthetic-unused-password'}]});
    const company=await Company.create({name:'Synthetic Demo Employer',domain:'employer.example',careersUrl:'https://employer.example/careers',salaryEvidence:[{role:'Software Engineer I',roleFamily:'software_engineering',level:'entry',experienceMin:0,experienceMax:2,location:'India',indiaEligibility:true,indiaEligibilitySourceUrl:'https://employer.example/jobs/1',salaryBaseMinINR:1600000,salaryBaseMaxINR:1800000,currency:'INR',payPeriod:'year',baseVsCTC:'fixed_base',salarySourceUrl:'https://employer.example/jobs/1',salarySourceType:'official_job',reportedOn:date,lastCheckedAt:date,evidenceConfidence:'high',evidenceExcerpt:'Synthetic browser fixture only: annual fixed base 16–18 LPA'}]});
    await Job.create({companyId:company._id,company:company.name,title:'Software Engineer I',url:'https://employer.example/jobs/1'});
    await Contact.create({userId:owner,companyId:company._id,company:company.name,email:'careers@employer.example',verificationStatus:'publicly_sourced',provenance:[{url:'https://employer.example/careers',provider:'synthetic_fixture',observedAt:date}]});
    let verificationMail = null;
    const app=express();app.use(express.json());app.use('/api/research',require('../routes/research'));
    app.use('/api/auth/email-verification',require('../routes/emailVerification').createRouter({
      config:()=>({enabled:true,configured:true,secret:'synthetic-browser-verification-secret-32',from:'trusted@example.org'}),
      sendCode:async(_config,mail)=>{verificationMail=mail;}
    }));
    app.use('/api/auth',require('../routes/auth'));
    app.use('/api/campaigns',require('../routes/campaigns'));app.use('/api/company-imports',require('../routes/companyImport'));
    app.use('/api/contacts',require('../routes/contact'));app.use('/api/mail',require('../routes/mail'));
    app.use('/api/crm',require('../routes/crm'));app.use('/api/contact-intake',require('../routes/contactIntake'));
    await Promise.all(['OutreachCampaign','OutreachDispatch','OutreachRuntime'].map(m=>require(`../models/${m}`).init()));
    app.all('/submitted',(_req,res)=>{submissions++;res.send('Unexpected submission');});
    app.get('/fixture',(_req,res)=>res.type('html').send(`<!doctype html><title>Synthetic form QA</title><h1>Local Workday / Google-style fixture</h1><p>No real employer or applicant data.</p><form action="/submitted"><label>First name <input id="first" data-automation-id="legalNameSection_firstName"></label><label>Expected salary <input id="salary"></label><button type="button" role="combobox" aria-label="Country" aria-controls="countries">Select</button><div id="countries" role="listbox" hidden><div role="option">India</div></div><div role="combobox" aria-label="State" aria-controls="states">Canada</div><div id="states" hidden><div role="option">Karnataka</div></div><label><input id="consent" type="checkbox">I consent to use my email</label><button>Submit application</button></form><script>window.blocked=0;const trigger=document.querySelector('button[role=combobox]');trigger.onclick=()=>{document.querySelector('#countries').hidden=false};document.querySelector('[role=option]').onclick=()=>{trigger.setAttribute('data-value','India');trigger.textContent='India';for(const method of ['submit','requestSubmit']){try{document.querySelector('form')[method]()}catch{window.blocked++}}};</script>`));
    app.get('/one-click-fixture', (_req, res) => res.type('html').send(`<!doctype html>
      <form action="/submitted">
        <label>Degree <select required id="degree"><option value="placeholder" disabled selected>Choose degree</option><option value="btech">B.Tech</option></select></label>
        <div id="dependent"></div>
        <label>Tell us about yourself <textarea id="intro" required></textarea></label>
        <label>Describe a project <textarea id="project"></textarea></label>
        <label>Expected salary <input id="salary"></label>
        <button>Submit application</button>
      </form>
      <script>
        document.querySelector('#degree').onchange = () => {
          document.querySelector('#dependent').innerHTML = '<label>College <input id="college"></label>';
        };
      </script>`));
    app.get('/background-fixture', (_req, res) => res.type('html').send(`<!doctype html>
      <form action="/submitted">
        <div><div><label>Name *</label></div><div><input id="full"></div></div>
        <div><div><label>Phone *</label></div><div><input id="phone" type="tel"></div></div>
        <button type="button" role="combobox" aria-label="Degree" aria-controls="degrees">Choose degree</button>
        <div id="degrees" role="listbox" hidden></div>
        <button>Submit application</button>
      </form>
      <script>
        const trigger = document.querySelector('[role=combobox]');
        trigger.onclick = () => { window.waiting = true; };
        window.showChoices = () => {
          const box = document.querySelector('#degrees');
          const choice = document.createElement('div');
          choice.setAttribute('role', 'option');
          choice.textContent = 'B.Tech';
          choice.onclick = () => {
            trigger.textContent = 'B.Tech';
            box.hidden = true;
            try { trigger.form.requestSubmit(); } catch { window.submitBlocked = true; }
          };
          box.append(choice);
          box.hidden = false;
        };
      </script>`));
    const web=path.resolve(__dirname,'../../web/dist');app.use(express.static(web));app.get('/{*splat}',(_req,res)=>res.sendFile('index.html',{root:web}));
    await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`;
    const extensionPath=path.resolve(__dirname,'../../extension/dist');
    context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],viewport:{width:1440,height:1100}});
    await context.route('**/*',route=>{const url=route.request().url();return url.startsWith(base) || url.startsWith('chrome-extension:') || url.startsWith('data:') ? route.continue() : route.abort();});
    let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:20000});
    const extensionId=new URL(worker.url()).host;
    const fixture=await context.newPage();await fixture.goto(base+'/fixture');
    const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/index.html`);
    const result=await popup.evaluate(async({base})=>{
      await chrome.storage.local.set({candidateProfileReviewed:true,candidateProfileVersion:1,candidateProfile:{firstName:'Example',email:'applicant@example.org',location:{country:'India',state:'Karnataka'}}});
      const [tab]=await chrome.tabs.query({url:base+'/fixture'});
      const preview=await chrome.tabs.sendMessage(tab.id,{action:'JF_PREVIEW'},{frameId:0});
      const [fill,duplicateFill]=await Promise.all([
        chrome.tabs.sendMessage(tab.id,{action:'JF_FILL'},{frameId:0}),
        chrome.tabs.sendMessage(tab.id,{action:'JF_FILL'},{frameId:0})
      ]);
      return {preview,fill,duplicateFill};
    },{base});
    assert.equal(result.preview.state,'PLAN');assert.equal(result.fill.success,true);assert.equal(result.fill.filledCount,2);
    assert.equal(result.duplicateFill.success,false);
    assert.equal(await fixture.locator('#first').inputValue(),'Example');assert.equal(await fixture.locator('#salary').inputValue(),'');
    assert.equal(await fixture.locator('#consent').isChecked(),false);assert.equal(await fixture.locator('[aria-label="State"]').textContent(),'Canada');
    assert.equal(await fixture.evaluate(()=>window.blocked),2);assert.equal(submissions,0);assert.equal(fixture.url(),base+'/fixture');
    await fixture.screenshot({path:path.join(screenshots,'form-browser-smoke.png'),fullPage:true});
    console.log('PASS: packaged MV3 preview/fill, prefilled preservation, sensitive fields, main-world submit/requestSubmit guards; submissions=0');
    // Exercise actual built React import/review controls, not just normalization helpers.
    await popup.getByText('Edit candidate profile', { exact:true }).click();
    const canonical={identity:{name:'Reviewed Synthetic Applicant',email:'reviewed@example.org',phone:'+919000000001'},education:[{institute:'Synthetic University',degree:'B.Tech',branch:'Computer Science',cgpa:8.8,end:'2027-07'}],preferences:{work_authorization:'TODO'},projects:[{name:'Synthetic Ranking',one_line:'Built a ranking fixture using Python'}]};
    await popup.getByLabel('Import resume profile JSON').setInputFiles({name:'synthetic-profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(canonical))});
    await popup.getByText('Imported locally. Review the facts and save before filling.',{exact:true}).waitFor();
    assert.equal((await popup.evaluate(()=>chrome.storage.local.get('candidateProfileReviewed'))).candidateProfileReviewed,false);
    await popup.getByRole('button',{name:'Save reviewed profile',exact:true}).click();
    await popup.getByText('Confirm the profile facts before saving.',{exact:true}).waitFor();
    await popup.getByLabel('I reviewed these facts against my selected resume.').check();
    await popup.getByRole('button',{name:'Save reviewed profile',exact:true}).click();
    await popup.getByText('Profile saved locally. Preview the current step.',{exact:true}).waitFor();
    const reviewed=await popup.evaluate(()=>chrome.storage.local.get(['candidateProfile','candidateProfileReviewed','candidateProfileVersion']));
    assert.equal(reviewed.candidateProfile.firstName,'Reviewed');assert.equal(reviewed.candidateProfile.preferences.work_authorization,null);assert.equal(reviewed.candidateProfileReviewed,true);
    // The popup is a regular extension tab in headless Chromium. Point its active-tab
    // lookup at the local fixture so the real button and message path can be exercised.
    await fixture.goto(base + '/one-click-fixture');
    await popup.evaluate(async ({ base }) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      const [target] = await query({ url: base + '/one-click-fixture' });
      chrome.tabs.query = options => options.active ? Promise.resolve([target]) : query(options);
    }, { base });
    await popup.getByRole('button', { name: 'Fill this step', exact: true }).click();
    await popup.getByText(/2 verified fills/).waitFor();
    assert.equal(await fixture.locator('#degree').inputValue(), 'btech');
    assert.equal(await fixture.locator('#college').inputValue(), 'Synthetic University');
    assert.equal(await fixture.locator('#salary').inputValue(), '');
    assert.equal(await fixture.locator('#intro').inputValue(), '');
    const draft = popup.getByLabel('Answer: Tell us about yourself', { exact: true });
    assert.match(await draft.inputValue(), /Synthetic University/);
    await draft.locator('..').getByRole('button', { name: 'Approve, remember & fill' }).click();
    await popup.getByText(/1 verified fills/).waitFor();
    assert.match(await fixture.locator('#intro').inputValue(), /Synthetic University/);
    await popup.evaluate(() => {
      Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
        async create() {
          return {
            async prompt(payload) {
              const input = JSON.parse(payload);
              if (input.question !== 'Describe a project' || payload.includes('reviewed@example.org') ||
                  input.resumeDetails.supportingEvidence[0]?.text !== 'Built a ranking fixture using Python') {
                throw new Error('Incorrect AI draft evidence');
              }
              return 'I built a ranking fixture using Python.';
            },
            destroy() {}
          };
        }
      } });
    });
    await popup.getByLabel('Answer: Describe a project', { exact: true }).locator('../..')
      .getByRole('button', { name: 'Draft with AI', exact: true }).click();
    await popup.getByLabel('Built a ranking fixture using Python', { exact: true }).check();
    await popup.getByRole('button', { name: 'Draft with Chrome AI', exact: true }).click();
    assert.equal(await popup.getByLabel('Review written answer').inputValue(), 'I built a ranking fixture using Python.');
    assert.equal(await fixture.locator('#project').inputValue(), '');
    await popup.getByRole('button', { name: 'Approve & fill this question', exact: true }).click();
    await fixture.waitForFunction(() => document.querySelector('#project').value === 'I built a ranking fixture using Python.');
    assert.equal(submissions, 0);
    console.log('PASS: one-click popup, dependent field re-scan and reviewed resume draft; submissions=0');
    await popup.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.sendMessage(tab.id,{action:'JF_PREVIEW'},{frameId:0});});
    await popup.getByLabel('Candidate profile JSON').fill(JSON.stringify({...canonical,identity:{...canonical.identity,name:'Edited Synthetic Applicant'}},null,2));
    assert.equal((await popup.evaluate(()=>chrome.storage.local.get('candidateProfileReviewed'))).candidateProfileReviewed,false);
    const changed=await popup.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{action:'JF_FILL'},{frameId:0});});
    assert.equal(changed.success,false);assert.match(changed.error,/Profile changed/);assert.equal(submissions,0);
    console.log('PASS: actual MV3 JSON file import, mandatory fact review, canonical save and edit invalidation; submissions=0');
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto(base + '/background-fixture?first'), second.goto(base + '/background-fixture?second')]);
    const popupUrl = `chrome-extension://${extensionId}/index.html`;
    const firstPopup = await context.newPage();
    const secondPopup = await context.newPage();
    await Promise.all([firstPopup.goto(popupUrl), secondPopup.goto(popupUrl)]);
    await firstPopup.evaluate(() => chrome.storage.local.set({ candidateProfileReviewed:true }));
    const startFill = (ui, url) => ui.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url });
      return chrome.tabs.sendMessage(tab.id, { action: 'JF_START_FILL' }, { frameId: 0 });
    }, url);
    const startedFirst = await startFill(firstPopup, first.url());
    assert.equal(startedFirst.running, true);
    await firstPopup.close();
    const startedSecond = await startFill(secondPopup, second.url());
    assert.equal(startedSecond.running, true);
    await secondPopup.close();
    for (const form of [first, second]) {
      await form.waitForFunction(() => window.waiting);
      assert.equal(await form.locator('#full').inputValue(), 'Reviewed Synthetic Applicant');
      assert.notEqual(await form.locator('#phone').inputValue(), '');
      await form.evaluate(() => window.showChoices());
    }
    const recoveredPopup = await context.newPage();
    await recoveredPopup.goto(popupUrl);
    for (const form of [first, second]) {
      await form.waitForFunction(() => document.querySelector('[role=combobox]').textContent === 'B.Tech');
      await form.waitForFunction(() => window.submitBlocked);
      const status = await recoveredPopup.evaluate(async url => {
        const [tab] = await chrome.tabs.query({ url });
        for (let attempt = 0; attempt < 20; attempt++) {
          const result = await chrome.tabs.sendMessage(tab.id, { action: 'JF_STATUS' }, { frameId: 0 });
          if (!result.running) return result;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Background fill never completed');
      }, form.url());
      assert.equal(status.result.filledCount, 3);
    }
    assert.equal(submissions, 0);
    await Promise.all([first.close(), second.close(), recoveredPopup.close()]);
    console.log('PASS: two tab fills survive popup closure, reports recover and submits stay blocked');
    page=await context.newPage();const token=jwt.sign({_id:String(owner)},process.env.JWT_SECRET);
    page.on('pageerror',error=>console.error('Browser page error:',error.message));
    page.on('response',response=>{if(response.url().includes('/api/') && response.status()>=400)console.error('API failed:',response.status(),response.url());});
    await page.addInitScript(value=>localStorage.setItem('token',value),token);
    await page.setViewportSize({width:1440,height:1100});await page.goto(base+'/settings');
    await page.getByRole('heading',{name:'Account email verification',exact:true}).waitFor();
    assert.equal(await page.locator('label').filter({hasText:/^Mobile \/ Phone$/}).locator('..').locator('input').inputValue(),'');
    assert.equal(await page.locator('label').filter({hasText:/^College \/ Institution$/}).locator('..').locator('input').inputValue(),'');
    await page.getByLabel('Send a verification code to my registered account email.',{exact:true}).check();
    await page.getByRole('button',{name:'Send verification code',exact:true}).click();
    await page.getByText(/Open your registered inbox and enter/).waitFor();assert.equal(verificationMail.recipient,'browser-owner@example.org');
    await page.getByLabel('Verification code',{exact:true}).fill(verificationMail.code);await page.getByRole('button',{name:'Verify account email',exact:true}).click();
    await page.getByText('Account email verified. Administrator promotion and company import remain separate controlled actions.',{exact:true}).waitFor();
    assert.equal((await require('../models/User').findById(owner)).emailVerified,true);
    assert.equal(await require('../models/AdminRoleMigration').countDocuments(),0);
    await page.screenshot({path:path.join(screenshots,'account-verification-simulation.png'),fullPage:true});
    console.log('PASS: account email verification Settings UI with synthetic trusted sender, one-use code and no automatic administrator promotion; real verification delivery=0');
    process.env.OUTREACH_SENDING_ENABLED='false';process.env.OUTREACH_WORKER_ENABLED='false';
    await Contact.create({userId:owner,company:'Synthetic Opt Out',email:'optout@fixture.example'});
    await require('../models/RecipientSuppression').create({userId:owner,email:'optout@fixture.example',source:'owner_opt_out',reason:'Fixture opted out'});
    await Contact.create([
      {userId:owner,company:'Synthetic Block Alpha',email:'first@gmail.com'},
      {userId:owner,company:'Synthetic Block Beta',email:'second@gmail.com'},
      {userId:owner,company:'Synthetic Block Alpha',email:'third@gmail.com.example'}
    ]);
    await page.setViewportSize({width:1440,height:1100});await page.goto(base+'/');
    await page.getByLabel('Search contacts',{exact:true}).fill('@gmail.com');
    await page.getByLabel('Select first@gmail.com',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Select third@gmail.com.example',{exact:true}).count(),0);
    await page.getByText('Select All Filtered',{exact:true}).click();
    await page.getByRole('button',{name:'Block Selected Emails (2)',exact:true}).click();
    await page.getByText('2 selected email(s) blocked. History preserved.',{exact:true}).waitFor();
    await page.getByRole('button',{name:/^Blocked/}).click();
    await page.getByRole('heading',{name:'Synthetic Block Alpha',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Synthetic Block Beta',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Unblock first@gmail.com',exact:true}).count(),1);
    await page.reload();await page.getByRole('button',{name:/^Blocked/}).click();
    await page.getByRole('button',{name:'Unblock first@gmail.com',exact:true}).click();
    await page.getByText('1 email(s) unblocked; 0 remain suppressed by other evidence.',{exact:true}).waitFor();
    await page.getByRole('button',{name:/^Unverified/}).click();
    await page.getByRole('button',{name:'Block first@gmail.com',exact:true}).click();
    await page.getByText('1 selected email(s) blocked. History preserved.',{exact:true}).waitFor();
    await page.getByRole('button',{name:/^Blocked/}).click();
    await page.getByLabel('Search contacts',{exact:true}).fill('@gmail.com');await page.getByText('Select All Filtered',{exact:true}).click();
    await page.getByRole('button',{name:'Unblock Selected Emails (2)',exact:true}).click();
    await page.getByText('2 email(s) unblocked; 0 remain suppressed by other evidence.',{exact:true}).waitFor();
    const Suppression=require('../models/RecipientSuppression');assert.equal(await Suppression.countDocuments({userId:owner,source:'owner_block'}),0);
    assert.equal(await Suppression.countDocuments({userId:owner,source:'owner_opt_out'}),1);
    console.log('PASS: actual dashboard domain-suffix selection, bulk block, company grouping, persistent reload, individual unblock/reblock and bulk unblock; opt-out protected; real mail=0');
    await require('../models/User').updateOne({_id:owner},{$set:{blockedCompanies:['ATLASSIAN']}});
    await Contact.create({userId:owner,company:'Atlassian',email:'fixture@atlassian.example'});
    await Contact.create({userId:owner,company:'Gravitontrading',email:'fixture@graviton.example'});
    require('../controllers/contactController').invalidateContactCache(owner);
    await page.goto(base+'/');await page.getByRole('button',{name:/^Blocked/}).click();
    await page.getByRole('heading',{name:'Atlassian',exact:true}).waitFor();await page.getByRole('button',{name:'Unblock company',exact:true}).click();
    await page.getByRole('heading',{name:'Atlassian',exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:/^Unverified/}).click();await page.getByRole('heading',{name:'Atlassian',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Graviton Research Capital',exact:true}).waitFor();
    console.log('PASS: mixed-case Atlassian company unblock through actual browser and canonical Graviton heading; real mail=0');
    const Proof = require('../models/MailboxProof');
    await Contact.create({userId:owner,company:'Verified Employer',email:'recruitment@verified.example',verificationStatus:'vendor_verified',deliverabilityStatus:'valid'});
    await Contact.create({userId:owner,company:'Expired Evidence Employer',email:'jobs@expired.example',verificationStatus:'vendor_verified',deliverabilityStatus:'valid'});
    await Proof.create([
      {userId:owner,email:'recruitment@verified.example',provider:'hunter_verifier',outcome:'valid',expiresAt:new Date(Date.now()+86400000)},
      {userId:owner,email:'jobs@expired.example',provider:'hunter_verifier',outcome:'valid',expiresAt:new Date(Date.now()-86400000)}
    ]);
    require('../controllers/contactController').invalidateContactCache(owner);
    await page.reload();
    await page.getByLabel('Select jobs@expired.example',{exact:true}).waitFor();
    await page.getByRole('button',{name:/^Verified /}).click();
    await page.getByLabel('Select recruitment@verified.example',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Select jobs@expired.example',{exact:true}).count(),0);
    await page.getByRole('button',{name:/^Unverified /}).click();
    await page.getByLabel('Select jobs@expired.example',{exact:true}).check();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Mark personally checked',exact:true}).click();
    await page.getByLabel('Select jobs@expired.example',{exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:/^Verified /}).click();
    await page.getByRole('row').filter({hasText:'jobs@expired.example'}).getByText('Personally checked',{exact:true}).waitFor();
    assert.equal(await Proof.countDocuments({userId:owner,email:'jobs@expired.example',expiresAt:{$gt:new Date()}}),0);

    assert.deepEqual(await page.locator('nav a').evaluateAll(links=>links.map(a=>a.getAttribute('href'))),['/jobs','/']);
    await page.goto(base+'/companies?q=retained');await page.getByRole('heading',{name:'Contacts by Company',exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('q'),'retained');
    assert.equal(await page.getByRole('combobox',{name:'Mail tools'}).count(),0);
    for (const section of ['Verified','Unverified','Blocked'])
      assert.equal(await page.getByRole('button',{name:new RegExp('^'+section+' ')}).count(),1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await require('../models/MailLog').countDocuments(),0);
    console.log('PASS: three mailbox sections and legacy URL redirects; real mail=0');
  } catch(error) {
    if(page){await page.screenshot({path:path.join(screenshots,'browser-failure.png'),fullPage:true}).catch(()=>{});console.error('Synthetic failing page:',await page.locator('body').innerText().catch(()=>''));}
    throw error;
  } finally {
    if(context)await context.close();if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

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
    const canonical={identity:{name:'Reviewed Synthetic Applicant',email:'reviewed@example.org',phone:'+919000000001'},education:[{institute:'Synthetic University',degree:'B.Tech',branch:'Computer Science',cgpa:8.8,end:'2027-07'}],preferences:{work_authorization:'TODO'}};
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
    await popup.evaluate(async({base})=>{const [tab]=await chrome.tabs.query({url:base+'/fixture'});await chrome.tabs.sendMessage(tab.id,{action:'JF_PREVIEW'},{frameId:0});},{base});
    await popup.getByLabel('Candidate profile JSON').fill(JSON.stringify({...canonical,identity:{...canonical.identity,name:'Edited Synthetic Applicant'}},null,2));
    assert.equal((await popup.evaluate(()=>chrome.storage.local.get('candidateProfileReviewed'))).candidateProfileReviewed,false);
    const changed=await popup.evaluate(async({base})=>{const [tab]=await chrome.tabs.query({url:base+'/fixture'});return chrome.tabs.sendMessage(tab.id,{action:'JF_FILL'},{frameId:0});},{base});
    assert.equal(changed.success,false);assert.match(changed.error,/Profile changed/);assert.equal(submissions,0);
    console.log('PASS: actual MV3 JSON file import, mandatory fact review, canonical save and edit invalidation; submissions=0');
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

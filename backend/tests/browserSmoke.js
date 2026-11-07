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
    const app=express();app.use(express.json());app.use('/api/research',require('../routes/research'));
    app.use('/api/campaigns',require('../routes/campaigns'));app.use('/api/company-imports',require('../routes/companyImport'));
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
    page=await context.newPage();const token=jwt.sign({_id:String(owner)},process.env.JWT_SECRET);
    page.on('pageerror',error=>console.error('Browser page error:',error.message));
    page.on('response',response=>{if(response.url().includes('/api/') && response.status()>=400)console.error('API failed:',response.status(),response.url());});
    await page.addInitScript(value=>localStorage.setItem('token',value),token);await page.goto(base+'/research');
    try {await page.getByRole('button',{name:/Synthetic Demo Employer/}).click();}
    catch(error){await page.screenshot({path:path.join(screenshots,'research-browser-failure.png'),fullPage:true});console.error('Dashboard text:',await page.locator('body').innerText());throw error;}
    await page.getByLabel('Relevant fresher opening').selectOption({index:1});
    await page.getByLabel('Sourced contact').selectOption({index:1});
    await page.getByLabel('Your name',{exact:true}).fill('Example Applicant');await page.getByLabel('Selected resume link').fill('https://applicant.example/resume');
    await page.getByLabel('One concrete, resume-supported highlight').fill('I built a documented API project.');
    await page.getByLabel('I confirmed these facts against my selected resume.').check();await page.getByRole('button',{name:'Create draft for review'}).click();
    await page.getByLabel('Draft subject').waitFor();assert.ok((await page.getByLabel('Draft body').inputValue()).includes('documented API project'));
    await page.getByRole('button',{name:'Save reviewed draft'}).click();await page.getByText('Reviewed draft saved. No email sent.').waitFor();
    await page.screenshot({path:path.join(screenshots,'research-browser-smoke.png'),fullPage:true});
    assert.equal(await require('../models/MailLog').countDocuments(),0);
    console.log('PASS: actual dashboard company/evidence/job/contact/draft/review UI; mail logs=0; screenshots use synthetic data only');
    await page.goto(base+'/campaigns');
    await page.getByRole('heading',{name:'Scheduled campaigns',exact:true}).waitFor();
    await page.getByLabel('Campaign name',{exact:true}).fill('Synthetic scheduled browser campaign');
    await page.getByRole('combobox',{name:/Sender account/}).selectOption('browser-smtp');
    await page.getByLabel('Start date and local time',{exact:true}).fill('2026-11-15T09:30');
    await page.getByLabel('Body for newly selected recipients').fill('Hello recruiting team,\n\nSynthetic browser-approved exact message.');
    await page.getByLabel('Select careers@employer.example',{exact:true}).check();
    await page.getByRole('button',{name:'Dry run & preview',exact:true}).click();
    await page.getByRole('heading',{name:'Exact campaign preview'}).waitFor();
    assert.ok((await page.locator('body').innerText()).includes('2026-11-15T04:00:00.000Z'));
    await page.screenshot({path:path.join(screenshots,'campaign-exact-preview.png'),fullPage:true});
    await page.getByRole('button',{name:'Approve & Schedule',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Approve this exact campaign?'});await dialog.waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Confirm approval & schedule'}).isEnabled(),false);
    await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirm approval & schedule'}).click();
    await page.getByRole('heading',{name:'Synthetic scheduled browser campaign — scheduled'}).waitFor();
    const Campaign=require('../models/OutreachCampaign'),Dispatch=require('../models/OutreachDispatch');
    const scheduled=await Campaign.findOne({userId:owner});assert.equal(scheduled.state,'scheduled');
    let simulatedSends=0;const send=async(_sender,row)=>{simulatedSends++;assert.equal(row.body,'Hello recruiting team,\n\nSynthetic browser-approved exact message.');return{providerMessageId:'synthetic-browser-provider-id'};};
    const tick=require('../services/campaignWorkerService').runCampaignWorkerOnce;
    assert.equal((await tick({now:new Date(+scheduled.startAtUtc-1000),enabled:()=>true,send})).status,'idle');
    await page.getByRole('button',{name:'Pause campaign',exact:true}).click();await page.getByRole('heading',{name:'Synthetic scheduled browser campaign — paused'}).waitFor();
    assert.equal((await tick({now:scheduled.startAtUtc,enabled:()=>true,send})).status,'idle');
    await page.getByRole('button',{name:'Confirm resume campaign',exact:true}).click();await page.getByRole('heading',{name:'Synthetic scheduled browser campaign — scheduled'}).waitFor();
    assert.equal((await tick({now:scheduled.startAtUtc,enabled:()=>true,send})).status,'sent');assert.equal(simulatedSends,1);
    assert.equal(await Dispatch.countDocuments({status:'sent'}),1);assert.equal(await require('../models/MailLog').countDocuments(),1);
    await page.reload();await page.getByRole('button',{name:/Synthetic scheduled browser campaign · completed/}).click();
    await page.getByRole('heading',{name:'Synthetic scheduled browser campaign — completed'}).waitFor();
    await page.screenshot({path:path.join(screenshots,'campaign-completed-simulation.png'),fullPage:true});
    // A second queue exercises browser cancellation and outcome reconciliation.
    await require('../models/Contact').create({userId:owner,companyId:company._id,company:company.name,email:'jobs@employer.example',verificationStatus:'publicly_sourced',provenance:[{url:'https://employer.example/careers',provider:'synthetic_fixture',observedAt:date}]});
    const svc=require('../services/campaignService'),secondContact=await require('../models/Contact').findOne({userId:owner,email:'jobs@employer.example'});
    const draft=await svc.saveCampaign(owner,{name:'Synthetic ambiguous campaign',senderId:'browser-smtp',localDateTime:'2026-11-15T09:40',timezone:'Asia/Kolkata',dailyLimit:10,intervalSeconds:180,recipients:[{contactId:String(secondContact._id),subject:'Synthetic second',body:'No real delivery; simulated ambiguous outcome.'}]});
    await svc.approveCampaign(owner,draft._id,draft.digest);
    assert.equal((await tick({now:draft.startAtUtc,enabled:()=>true,send:async()=>{throw new Error('Fixture unknown outcome');}})).status,'unknown_outcome');
    await page.reload();await page.getByRole('button',{name:/Synthetic ambiguous campaign · needs_review/}).click();
    await page.getByRole('combobox',{name:/Confirmed provider outcome/}).selectOption('not_sent');
    await page.getByLabel('Provider-history review notes',{exact:true}).fill('Synthetic provider history confirms no accepted request.');
    await page.getByLabel(/I reviewed the provider history/).check();await page.getByRole('button',{name:'Record reviewed outcome',exact:true}).click();
    await page.getByText(/Outcome recorded|outcome recorded|reviewed outcome recorded/i).waitFor();
    await page.getByRole('button',{name:'Cancel remaining messages',exact:true}).click();await page.getByRole('heading',{name:'Synthetic ambiguous campaign — cancelled'}).waitFor();
    await page.goto(base+'/companies');await page.getByRole('heading',{name:'Company research directory',exact:true}).waitFor();
    await page.getByRole('button',{name:'Preview supplied 733 records',exact:true}).click();await page.getByText('Review every proposed company change',{exact:true}).waitFor();
    assert.ok((await page.locator('body').innerText()).includes('"sourceRows": 733'));assert.equal(await require('../models/CompanyProspect').countDocuments(),0);
    await page.screenshot({path:path.join(screenshots,'company-import-dryrun.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    console.log('PASS: real campaign UI preview/exact approval/timezone, fake-clock dormant→pause→resume→simulated accepted→persistent progress, unknown-outcome reconciliation/cancel, admin733dryrun; real mail/provider requests=0');
  } catch(error) {
    if(page){await page.screenshot({path:path.join(screenshots,'browser-failure.png'),fullPage:true}).catch(()=>{});console.error('Synthetic failing page:',await page.locator('body').innerText().catch(()=>''));}
    throw error;
  } finally {
    if(context)await context.close();if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

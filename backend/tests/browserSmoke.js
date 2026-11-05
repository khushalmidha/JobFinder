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
  let mongo, server, context;
  const screenshots=path.resolve(__dirname,'../../artifacts');fs.mkdirSync(screenshots,{recursive:true});
  let submissions=0;
  try {
    process.env.JWT_SECRET='synthetic-browser-test-only';process.env.OUTREACH_SENDING_ENABLED='false';
    mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());
    const Company=require('../models/Company'), Job=require('../models/JobOpening'), Contact=require('../models/Contact');
    const owner=new mongoose.Types.ObjectId();const date=new Date();
    const company=await Company.create({name:'Synthetic Demo Employer',domain:'employer.example',careersUrl:'https://employer.example/careers',salaryEvidence:[{role:'Software Engineer I',roleFamily:'software_engineering',level:'entry',experienceMin:0,experienceMax:2,location:'India',indiaEligibility:true,indiaEligibilitySourceUrl:'https://employer.example/jobs/1',salaryBaseMinINR:1600000,salaryBaseMaxINR:1800000,currency:'INR',payPeriod:'year',baseVsCTC:'fixed_base',salarySourceUrl:'https://employer.example/jobs/1',salarySourceType:'official_job',reportedOn:date,lastCheckedAt:date,evidenceConfidence:'high',evidenceExcerpt:'Synthetic browser fixture only: annual fixed base 16–18 LPA'}]});
    await Job.create({companyId:company._id,company:company.name,title:'Software Engineer I',url:'https://employer.example/jobs/1'});
    await Contact.create({userId:owner,companyId:company._id,company:company.name,email:'careers@employer.example',verificationStatus:'publicly_sourced',provenance:[{url:'https://employer.example/careers',provider:'synthetic_fixture',observedAt:date}]});
    const app=express();app.use(express.json());app.use('/api/research',require('../routes/research'));
    app.all('/submitted',(_req,res)=>{submissions++;res.send('Unexpected submission');});
    app.get('/fixture',(_req,res)=>res.type('html').send(`<!doctype html><title>Synthetic form QA</title><h1>Local Workday / Google-style fixture</h1><p>No real employer or applicant data.</p><form action="/submitted"><label>First name <input id="first" data-automation-id="legalNameSection_firstName"></label><label>Expected salary <input id="salary"></label><button type="button" role="combobox" aria-label="Country" aria-controls="countries">Select</button><div id="countries" role="listbox" hidden><div role="option">India</div></div><div role="combobox" aria-label="State" aria-controls="states">Canada</div><div id="states" hidden><div role="option">Karnataka</div></div><label><input id="consent" type="checkbox">I consent to use my email</label><button>Submit application</button></form><script>window.blocked=0;const trigger=document.querySelector('button[role=combobox]');trigger.onclick=()=>{document.querySelector('#countries').hidden=false};document.querySelector('[role=option]').onclick=()=>{trigger.setAttribute('data-value','India');trigger.textContent='India';for(const method of ['submit','requestSubmit']){try{document.querySelector('form')[method]()}catch{window.blocked++}}};</script>`));
    const web=path.resolve(__dirname,'../../web/dist');app.use(express.static(web));app.get('/{*splat}',(_req,res)=>res.sendFile(path.join(web,'index.html')));
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
    const page=await context.newPage();const token=jwt.sign({_id:String(owner)},process.env.JWT_SECRET);
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
  } finally {
    if(context)await context.close();if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

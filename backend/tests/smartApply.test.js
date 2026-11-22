const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { normalizeProfile, profileGaps, answerKey, rememberAnswer, recallAnswer } = require('../../extension/src/utils/candidateProfile.js');
const { classifyQuestion } = require('../../extension/src/utils/formFillerCore.js');
const { SmartApplyStore } = require('../smartApply/store');
const { SmartApplyEngine, permitted } = require('../smartApply/engine');
const { rankJob } = require('../smartApply/ranking');
const profile = { identity: { name: 'Example Applicant', email: 'applicant@example.org', phone: '+919000000000', location: { city: 'Pune', country: 'India' } }, links: { github: 'example', linkedin: 'https://example.org/linkedin' }, education: [{ institute: 'Example Institute', degree: 'B.Tech', branch: 'Computer Science', cgpa: 8.5, end: '2027-07', tenth: 'TODO' }], preferences: { work_authorization: 'TODO per country' } };
test('canonical profile safely bridges existing extension schema and leaves unknowns empty', () => {
  const p = normalizeProfile(profile); assert.equal(p.firstName, 'Example'); assert.equal(p.email, 'applicant@example.org');
  assert.equal(p.cgpa, 8.5); assert.equal(p.graduationYear, '2027'); assert.equal(p.education[0].tenth, null);
  assert.equal(p.links.github, 'https://github.com/example'); assert.ok(profileGaps(p).includes('workAuthorization'));
  assert.equal(profile.education[0].tenth, 'TODO');
});
test('30 resume questions map deterministically; sensitive unknowns never become inferred facts', () => {
  const cases = [['First name','Example'],['Given name','Example'],['Last name','Applicant'],['Surname','Applicant'],['Full name','Example Applicant'],['Candidate name','Example Applicant'],['Email','applicant@example.org'],['E-mail address','applicant@example.org'],['Phone','+919000000000'],['Mobile number','+919000000000'],['College','Example Institute'],['University','Example Institute'],['Institution','Example Institute'],['Degree','B.Tech'],['Qualification','B.Tech'],['Branch','Computer Science'],['Major','Computer Science'],['Field of study','Computer Science'],['CGPA','8.5'],['GPA','8.5'],['Grade point','8.5'],['Graduation year','2027'],['Passout year','2027'],['End year','2027'],['City','Pune'],['Town','Pune'],['Country','India'],['GitHub','https://github.com/example'],['LinkedIn','https://example.org/linkedin'],['Contact number','+919000000000']];
  for (const [question, expected] of cases) assert.equal(classifyQuestion({ combined: question.toLowerCase(), labelText: question, inputType: 'text' }, profile).value, expected, question);
  for (const question of ['10th school','12th marks','Salary expected','Work authorization country','Notice period','Employer name','Gender','I agree','One time password']) assert.equal(classifyQuestion({combined:question.toLowerCase(),inputType:'text'},profile).requiresManualReview,true,question);
});
test('answer memory preserves options/type/site scope, requires approval and is editable', () => {
  const entry = {question:'How did you hear about us?',type:'select',options:['Careers','Referral'],scope:'jobs.example.org',answer:'Careers',approved:true};
  let bank = rememberAnswer([],entry); assert.equal(recallAnswer(bank,entry.question,'select',['Referral','Careers'],entry.scope).answer,'Careers');
  assert.equal(recallAnswer(bank,entry.question,'select',['Other'],entry.scope),null);
  assert.equal(recallAnswer(bank,entry.question,'text',[],entry.scope),null);
  assert.equal(recallAnswer(bank,entry.question,'select',entry.options,'other.example.org'),null);
  bank = rememberAnswer(bank,{...entry,answer:'Referral'});assert.equal(bank.length,1);assert.equal(bank[0].answer,'Referral');
  assert.throws(()=>rememberAnswer([],{...entry,approved:false}));assert.throws(()=>rememberAnswer([],{...entry,answer:'Fake'}));
  const legal = rememberAnswer([],{question:'I agree to terms',type:'text',answer:'yes',approved:true});
  assert.equal(classifyQuestion({combined:'i agree to terms',labelText:'I agree to terms',inputType:'text'},{...profile,answers_bank:legal}).requiresManualReview,true);
  assert.notEqual(answerKey('Salary','text',[],'India'),answerKey('Salary','text',[],'USA'));
});
test('local store persists reviewed profile, kill switch, answers and reports across restarts', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jf-smart-'));
  try {let store=new SmartApplyStore(dir);store.set('profile',profile);store.set('reviewed',true);store.set('stopped',true);store.saveAnswer({key:'example',answer:'Reviewed'});store.application('one','https://example.org','NEEDS_REVIEW',{submitted:false});store.close();store=new SmartApplyStore(dir);assert.equal(store.get('reviewed'),true);assert.equal(store.get('stopped'),true);assert.equal(store.answers()[0].answer,'Reviewed');store.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Chromium resolver verifies native, delayed portal combobox, radio, shadow and same-host frame; never submits', async () => {
  let browser,server;
  try {
    const html=`<form onsubmit="window.submitted=true;event.preventDefault()"><label>First name<input id="first"></label><label>Email<input type="email"></label><label>Degree<select><option value="">Choose</option><option>B.Tech</option></select></label><input id="city" role="combobox" aria-label="City" aria-controls="cities"><fieldset><legend>Country</legend><label><input type="radio" name="country" value="India">India</label><label><input type="radio" name="country" value="USA">USA</label></fieldset><label>I agree<input type="checkbox" id="legal"></label><label>Notice period<input id="notice"></label><button>Submit</button></form><div id="shadow"></div><iframe src="/frame"></iframe><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>GitHub<input></label>';document.querySelector('#city').addEventListener('input',()=>{setTimeout(()=>{if(document.getElementById('cities'))return;const list=document.createElement('div');list.id='cities';list.setAttribute('role','listbox');list.innerHTML='<div role="option">Pune</div>';list.firstChild.onclick=()=>{document.querySelector('#city').setAttribute('data-value','Pune');list.remove()};document.body.append(list)},80)});</script>`;
    server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/frame'?'<label>Last name<input></label>':html)});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const engine=new SmartApplyEngine(page,{profile,allowedHosts:['127.0.0.1']});const preview=await engine.preview();
    assert.equal(preview.state,'PLAN');assert.equal(await page.locator('#first').inputValue(),'');
    const report=await engine.fill();
    assert.equal(report.fields.filter(f=>f.outcome==='verified').length,7,JSON.stringify(report));
    assert.equal(await page.locator('#legal').isChecked(),false);assert.equal(await page.locator('#notice').inputValue(),'');assert.equal(await page.evaluate(()=>!!window.submitted),false);
    assert.equal(report.submitted,false);
    await page.locator('#first').fill('');await engine.preview();await page.locator('#first').fill('Manual');await engine.fill();assert.equal(await page.locator('#first').inputValue(),'Manual');
    const blocked=new SmartApplyEngine(page,{profile,allowedHosts:['other.example.org']});await assert.rejects(blocked.preview());
    await page.setContent('<input type="password">');assert.equal((await engine.preview()).state,'NEEDS_INPUT');
  } finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());}
});
test('allowed-host gate rejects LinkedIn, URL lookalikes, non-web protocols',()=>{
  assert.equal(permitted('https://www.linkedin.com/jobs',['www.linkedin.com']),false);
  assert.equal(permitted('https://example.org.attacker.com',['example.org']),false);
  assert.equal(permitted('file:///private',['']),false);
});
test('ranking explains skill overlap without inventing salary, location or eligibility',()=>{
  const p={skills:{languages:['C','C++','Java'],backend:'Spring Boot,Redis'},preferences:{min_base_lpa:12}};
  const ranked=rankJob({title:'SDE-1 new grad 2027',location:'Bengaluru',description:'Java Spring Boot and Redis'},p);
  assert.ok(ranked.matchScore>=3);assert.ok(ranked.matchReasons.some(x=>x.includes('java')));assert.ok(ranked.needsReview.includes('Fixed-base salary evidence unavailable'));
  assert.equal(rankJob({title:'Senior Engineer',description:'5 years experience Java',location:'London'},p).matchScore,1);
  const claimed=rankJob({title:'Software Engineer',description:'15 LPA CTC package',salaryEvidence:{verified:true,amount:1500000,currency:'INR',kind:'ctc'},location:'Remote'},p);
  assert.ok(claimed.needsReview.includes('Fixed-base salary evidence unavailable'));
  assert.ok(!rankJob({title:'Accessibility',description:'javascript'},p).matchReasons.some(x=>x==='Resume skills: c'));
});
test('Chromium guard blocks input-driven native submit; kill switch and stale label fail closed',async()=>{
  let server,browser;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jf-guard-'));
  try{
    server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<form><label>First name<input id="first" onchange="this.form.requestSubmit()"></label><button>Submit</button></form>')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch();const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    let submits=0;await page.exposeFunction('recordSubmit',()=>{submits++});await page.evaluate(()=>document.addEventListener('submit',event=>{event.preventDefault();window.recordSubmit()}));
    let stopped=true;const engine=new SmartApplyEngine(page,{profile,allowedHosts:['127.0.0.1'],shouldStop:()=>stopped,outputDirectory:dir});
    await engine.preview();assert.equal((await engine.fill()).state,'STOPPED');assert.equal(await page.locator('#first').inputValue(),'');
    stopped=false;await engine.preview();const report=await engine.fill();assert.equal(submits,0);assert.equal(report.fields[0].outcome,'verified');assert.ok(fs.existsSync(path.join(dir,report.id+'.png')));assert.equal(JSON.parse(fs.readFileSync(path.join(dir,report.id+'.json'))).submitted,false);
    await page.locator('#first').fill('');await engine.preview();await page.locator('#first').evaluate(el=>el.setAttribute('aria-label','Emergency contact email'));const stale=await engine.fill();assert.equal(stale.fields[0].outcome,'needs_review');assert.equal(await page.locator('#first').inputValue(),'');
  }finally{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());fs.rmSync(dir,{recursive:true,force:true});}
});

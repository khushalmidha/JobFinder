const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { FormFillSession, classifyQuestion, extractQuestionContext, collectFields } = require('../../extension/src/utils/formFillerCore.js');
const profile = { firstName: 'Example', lastName: 'Applicant', fullName: 'Example Applicant', email: 'applicant@example.org', graduationYear: '2027', location: { country: 'India', state: 'Karnataka' } };

test('preview does not mutate Workday; explicit fill verifies native fields and preserves prefilled values', async () => {
  const html = fs.readFileSync(path.join(__dirname,'fixtures/workdayFixture.html'),'utf8');
  const { document } = new JSDOM(html).window;
  const first = document.querySelector('[data-automation-id="legalNameSection_firstName"]');
  const last = document.querySelector('[data-automation-id="legalNameSection_lastName"]');
  first.value = ''; last.value = 'Manual choice';
  let submissions = 0;
  document.addEventListener('submit', e => { submissions++; e.preventDefault(); });
  const session = new FormFillSession(document);
  session.scan(profile);
  assert.equal(first.value, '');
  const report = await session.fill();
  assert.equal(first.value, profile.firstName);
  assert.equal(last.value, 'Manual choice');
  assert.ok(report.filledCount > 0);
  assert.equal(submissions, 0);
  for (const el of document.querySelectorAll('input[type="file"]')) assert.equal(el.value, '');
});
test('Google Forms ARIA question and exact radio selection are verified without submitting', async () => {
  const { document } = new JSDOM('<form><div role="listitem"><h3 role="heading">Country</h3><div role="radiogroup"><div role="radio" aria-checked="false">India</div><div role="radio" aria-checked="false">India (other)</div></div></div><button>Submit</button></form>').window;
  let submits = 0;
  document.addEventListener('submit', e => { submits++; e.preventDefault(); });
  for (const radio of document.querySelectorAll('[role="radio"]')) radio.addEventListener('click', () => radio.setAttribute('aria-checked','true'));
  const session = new FormFillSession(document); session.scan(profile); const result = await session.fill();
  assert.equal(result.filledCount, 1);
  assert.equal(document.querySelector('[role="radio"]').getAttribute('aria-checked'), 'true');
  assert.equal(document.querySelectorAll('[role="radio"]')[1].getAttribute('aria-checked'), 'false');
  assert.equal(submits,0);
});
test('Workday dropdown arrow with associated portaled popup selects one exact option', async () => {
  const { document } = new JSDOM('<form><button type="button" role="combobox" aria-label="Country" aria-controls="countries" data-value="">Select</button></form><div id="countries" role="listbox" hidden><div role="option">India</div><div role="option">Indonesia</div></div>').window;
  const trigger = document.querySelector('button'); const popup = document.querySelector('#countries');
  trigger.addEventListener('click', () => { popup.hidden = false; });
  popup.querySelector('[role="option"]').addEventListener('click', () => { trigger.setAttribute('data-value','India'); trigger.textContent='India'; popup.hidden = true; });
  const session = new FormFillSession(document); session.scan(profile);
  assert.equal(trigger.getAttribute('data-value'),'');
  const result = await session.fill();
  assert.equal(result.filledCount,1); assert.equal(trigger.getAttribute('data-value'),'India');
});
test('implicit-submit dropdown is never clicked; duplicate options require review', async () => {
  for (const html of [
    '<form><button role="combobox" aria-label="Country" aria-controls="p">Select</button><div id="p"><div role="option">India</div></div></form>',
    '<button type="button" role="combobox" aria-label="Country" aria-controls="p">Select</button><div id="p"><div role="option">India</div><div role="option">India</div></div>'
  ]) {
    const { document } = new JSDOM(html).window; let submits=0;
    document.addEventListener('submit', e => { submits++; e.preventDefault(); });
    const session = new FormFillSession(document); session.scan(profile); const result = await session.fill();
    assert.equal(result.filledCount,0); assert.equal(result.fields[0].outcome,'needs_review'); assert.equal(submits,0);
  }
});
test('legal, sensitive and employer questions override personal matching', () => {
  for (const label of ['I consent to use my email', 'Signature full name', 'Salary expected in INR', 'Work authorization country', 'Gender', 'Company name', 'Current employer name', 'Sponsorship', 'Notice period', 'Nationality country', 'Emergency contact email', 'Current employer email']) {
    const { document } = new JSDOM('<input>').window;
    const el = document.querySelector('input'); el.setAttribute('aria-label',label);
    const decision = classifyQuestion(extractQuestionContext(el),profile);
    assert.equal(decision.requiresManualReview,true,label); assert.equal(decision.verified,false,label);
  }
});
test('multi-token ARIA labels and descriptions resolve within their owner document', () => {
  const { document } = new JSDOM('<span id="a">First</span><span id="b">name</span><p id="hint">As on resume</p><input aria-labelledby="a b" aria-describedby="hint">').window;
  const context = extractQuestionContext(document.querySelector('input'));
  assert.equal(context.labelText,'First name'); assert.equal(context.descriptionText,'As on resume');
  assert.equal(classifyQuestion(context,profile).value,'Example');
});
test('manual edits, detached/rerendered fields and empty profile facts never get overwritten', async () => {
  const { document } = new JSDOM('<input aria-label="First name"><input aria-label="Last name"><input aria-label="Email">').window;
  const fields = [...document.querySelectorAll('input')]; const session = new FormFillSession(document);
  session.scan({ firstName:'Example',lastName:'Applicant' }); fields[0].value='User edit'; fields[1].remove();
  const result=await session.fill();
  assert.equal(fields[0].value,'User edit'); assert.equal(fields[1].value,''); assert.equal(fields[2].value,'');
  assert.equal(result.fields[0].outcome,'preserved_manual_change'); assert.equal(result.fields[1].outcome,'needs_review');
});
test('open shadow roots and same-origin frames are scanned; stop prevents filling', async () => {
  const { document } = new JSDOM('<div id="host"></div><iframe></iframe>').window;
  document.querySelector('#host').attachShadow({ mode:'open' }).innerHTML='<input aria-label="Email">';
  document.querySelector('iframe').contentDocument.body.innerHTML='<input aria-label="First name">';
  assert.equal(collectFields(document).length,2);
  const session=new FormFillSession(document); session.scan(profile); session.stop();
  await assert.rejects(session.fill(),/Preview/);
});
test('Google fixture required unknowns and legal choices are reported; written answers have no generic fallback', () => {
  const { document } = new JSDOM(fs.readFileSync(path.join(__dirname,'fixtures/googleFormsFixture.html'),'utf8')).window;
  const session=new FormFillSession(document); const report=session.scan(profile);
  assert.ok(report.needsReviewCount>0);
  assert.equal(classifyQuestion({combined:'why this company',inputType:'textarea'},profile).value,undefined);
});
test('rendered existing dropdown selection is preserved', async () => {
  const {document}=new JSDOM('<div role="combobox" aria-label="Country" aria-controls="options">Canada</div><div id="options"><div role="option">India</div></div>').window;
  const session=new FormFillSession(document);const plan=session.scan(profile);
  assert.equal(plan.fields[0].action,'preserve');await session.fill();
  assert.equal(document.querySelector('[role="combobox"]').textContent,'Canada');
});
test('native radio groups use exact labels, preserve prior selections, and hidden steps stay untouched',async()=>{
  const {document}=new JSDOM('<form><fieldset><legend>Country</legend><label><input type="radio" name="country" value="in">India</label><label><input type="radio" name="country" value="ca">Canada</label></fieldset><div style="display:none"><input aria-label="First name"></div></form>').window;
  const session=new FormFillSession(document);assert.equal(session.scan(profile).fields.length,1);
  const result=await session.fill();assert.equal(result.filledCount,1);assert.equal(document.querySelector('[value="in"]').checked,true);
  assert.equal(document.querySelector('[aria-label="First name"]').value,'');
  document.querySelector('[value="ca"]').checked=true;assert.equal(session.scan(profile).fields[0].action,'preserve');await session.fill();
  assert.equal(document.querySelector('[value="ca"]').checked,true);
});

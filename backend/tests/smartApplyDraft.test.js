const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { formDraftPayload } = require('../../extension/src/utils/formDraftPayload.js');
const { FormFillSession, extractQuestionContext, answerScope } = require('../../extension/src/utils/formFillerCore.js');
const { rememberAnswer } = require('../../extension/src/utils/candidateProfile.js');
test('written draft request includes only explicitly selected facts, never unrelated profile data',()=>{
  const payload=formDraftPayload({question:'Tell us about yourself',company:'Example',role:'SDE',supportingEvidence:[{text:'Built a synthetic project',source:'resume.pdf',privateMetadata:'DO_NOT_SEND'}],identity:{email:'private@example.org'},answers_bank:[{answer:'PRIVATE_VISA_ANSWER'}],companyFacts:[]});
  assert.deepEqual(payload.resumeDetails,{confirmed:true,supportingEvidence:[{text:'Built a synthetic project',source:'resume.pdf'}],companyFacts:[]});
  assert.ok(!JSON.stringify(payload).includes('PRIVATE_VISA'));assert.ok(!JSON.stringify(payload).includes('private@example'));assert.ok(!JSON.stringify(payload).includes('DO_NOT_SEND'));
  assert.throws(()=>formDraftPayload({supportingEvidence:[]}));assert.throws(()=>formDraftPayload({supportingEvidence:[{text:'x'.repeat(501),source:'resume'}]}));
});
test('native radio memory binds question legend and actual options; different questions do not share Yes answers',()=>{
  const {document}=new JSDOM('<form><fieldset><legend>Can you work weekends?</legend><label><input type="radio" name="weekend" value="yes">Yes</label><label><input type="radio" name="weekend" value="no">No</label></fieldset><fieldset><legend>Can you travel?</legend><label><input type="radio" name="travel" value="yes">Yes</label><label><input type="radio" name="travel" value="no">No</label></fieldset></form>',{url:'https://jobs.example.org/form?company=A'}).window;
  const context=extractQuestionContext(document.querySelector('input'));assert.equal(context.labelText,'Can you work weekends?');assert.deepEqual(context.options,['Yes','No']);
  const bank=rememberAnswer([],{question:context.labelText,type:'radio',options:context.options,scope:answerScope(document.querySelector('input')),answer:'Yes',approved:true});
  const session=new FormFillSession(document);const preview=session.scan({answers_bank:bank});assert.equal(preview.fields[0].decision.type,'REMEMBERED_ANSWER');assert.equal(preview.fields[1].decision.requiresManualReview,true);
});
test('approved textareas fill through native events, while ambiguous selects and linked options stay manual',async()=>{
  const {document}=new JSDOM('<label>Relevant experience<textarea></textarea></label><label>Degree<select><option value="">Choose</option><option value="x">B.Sc</option><option value="x">B.Tech</option></select></label><button type="button" role="combobox" aria-label="Country" aria-controls="p">Select</button><a href="/submit"><div id="p" role="listbox"><div role="option">India</div></div></a>',{url:'https://jobs.example.org/form'}).window;
  const context=extractQuestionContext(document.querySelector('textarea'));const bank=rememberAnswer([],{question:context.labelText,type:'textarea',answer:'Built a reviewed project.',scope:answerScope(document.querySelector('textarea')),approved:true});
  const session=new FormFillSession(document);session.scan({degree:'B.Tech',location:{country:'India'},answers_bank:bank});const report=await session.fill();
  assert.equal(document.querySelector('textarea').value,'Built a reviewed project.');assert.equal(document.querySelector('select').value,'');assert.equal(report.fields.find(row=>row.context.inputType==='select').outcome,'needs_review');assert.equal(report.fields.find(row=>row.context.inputType==='combobox').outcome,'needs_review');
});
test('identical salary labels on the same document remain scoped to their own form and instructions',()=>{
  const {document}=new JSDOM('<form><p id="a">Expected INR per year</p><label>Salary<input aria-describedby="a"></label></form><form><p id="b">Current USD per month</p><label>Salary<input aria-describedby="b"></label></form>',{url:'https://jobs.example.org/apply?employer=one#step'}).window;
  const fields=document.querySelectorAll('input');const context=extractQuestionContext(fields[0]);
  const bank=rememberAnswer([],{question:context.labelText,type:'text',scope:answerScope(fields[0]),answer:'1800000',approved:true});
  const preview=new FormFillSession(document).scan({answers_bank:bank});assert.equal(preview.fields[0].decision.type,'REMEMBERED_ANSWER');assert.equal(preview.fields[1].decision.requiresManualReview,true);
  assert.notEqual(answerScope(fields[0]),answerScope(fields[1]));
});

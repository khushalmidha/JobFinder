const test = require('node:test');
const assert = require('node:assert/strict');
const { assessEvidence, qualifyCompany } = require('../services/salaryEvidenceService');
const { validateEmail, testSmtpHandshake } = require('../services/emailDeliverabilityService');
const { generateEmailCandidates, isDomainConsistent } = require('../services/ghostScoutService');
const { fetchCompanyEmails } = require('../services/publicEmailDiscovery');
const { createGroundedDraft, contactBlockReason } = require('../services/outreachResearchService');
const { searchApolloPeople, searchHunterDomain, verifyHunterEmail } = require('../services/leadAgencyService');
const { assertApprovedMessage } = require('../services/outreachApprovalService');
const { validatePolicy } = require('../services/researchBudgetService');
const now = new Date('2026-11-05T12:00:00Z');
const evidence = {role:'Software Engineer I',roleFamily:'software_engineering',level:'entry',experienceMin:0,experienceMax:2,location:'Bengaluru, India',indiaEligibility:true,indiaEligibilitySourceUrl:'https://employer.example/jobs/1',salaryBaseMinINR:1600000,salaryBaseMaxINR:1800000,currency:'INR',payPeriod:'year',baseVsCTC:'fixed_base',salarySourceUrl:'https://employer.example/jobs/1',salarySourceType:'official_job',reportedOn:'2026-11-01',lastCheckedAt:'2026-11-05',evidenceConfidence:'high',evidenceExcerpt:'Synthetic test: annual base INR 16–18 lakh'};
module.exports = { evidence };
test('only strict >15 lakh fixed annual INR base at relevant level/location qualifies', () => {
  assert.equal(assessEvidence(evidence,now).status,'qualified');
  assert.equal(assessEvidence({...evidence,salaryBaseMinINR:1500000},now).status,'not_qualified');
  for (const patch of [{baseVsCTC:'ctc'},{payPeriod:'month'},{currency:'USD'},{indiaEligibility:false},{level:'senior'},{experienceMax:3},{reportedOn:'2027-01-01'},{lastCheckedAt:'2024-01-01'},{salarySourceUrl:''},{salaryBaseMinINR:NaN}]) assert.notEqual(assessEvidence({...evidence,...patch},now).status,'qualified',JSON.stringify(patch));
  assert.equal(assessEvidence({...evidence,salarySourceType:'salary_dataset'},now).status,'supported_estimate');
  assert.equal(qualifyCompany({entryLevelCtcMin:80},now).qualificationStatus,'research_needed');
  assert.equal(qualifyCompany({salaryEvidence:[evidence,{...evidence,salaryBaseMinINR:1400000}]},now).qualificationStatus,'conflicting');
});
test('MX only establishes domain mail capability; transient errors are unknown and no SMTP probe occurs', async () => {
  const result=await validateEmail('jobs@employer.example',{resolver:{resolveMx:async()=>[{priority:10,exchange:'mx.employer.example'}]}});
  assert.equal(result.isValid,null); assert.equal(result.status,'domain_mail_capable');
  assert.equal((await validateEmail('jobs@employer.example',{resolver:{resolveMx:async()=>{throw Object.assign(new Error('timeout'),{code:'ETIMEOUT'});}}})).status,'unknown');
  assert.equal((await validateEmail('jobs@employer.example',{resolver:{resolveMx:async()=>[{priority:0,exchange:'.'}]}})).isValid,false);
  assert.equal((await testSmtpHandshake()).status,'unknown');
});
test('inferred candidates stay unsendable and company-name substring cannot validate a domain', () => {
  const candidates=generateEmailCandidates('Example','Person','employer.example');
  assert.equal(candidates.length,2); assert.ok(candidates.every(c=>c.inferenceFlag && !c.sendable && c.confidence===null));
  assert.equal(isDomainConsistent('jobs@evilgoogle.com','google.com','Google'),false);
});
test('public discovery respects robots, stops at request cap and reports honest not found', async () => {
  let calls=0;
  const fetchPage=async url=>{calls++; return url.endsWith('robots.txt')?{status:200,text:'User-agent: *\nDisallow: /jobs',contentType:'text/plain'}:{status:200,text:'<p>careers@employer.example</p>',contentType:'text/html'};};
  const result=await fetchCompanyEmails('employer.example',{fetchPage,maxRequests:2});
  assert.equal(calls,2); assert.equal(result.emails[0].email,'careers@employer.example');
  assert.equal((await fetchCompanyEmails('employer.example',{fetchPage,shouldStop:()=>true})).requestsUsed,0);
  const denied=await fetchCompanyEmails('employer.example',{fetchPage:async()=>({status:200,text:'Disallow: /'})});
  assert.equal(denied.emails.length,0); assert.equal(denied.requestsUsed,1);
});
test('Apollo search retains discovery-only results; failed budget blocks Hunter before network', async () => {
  let network=0; let payload;
  const result=await searchApolloPeople({userId:'u',apiKey:'not-real',domains:['employer.example'],reserve:async(_u,c)=>assert.equal(c.credits,0),fetchImpl:async(_u,options)=>{network++; payload=JSON.parse(options.body);return {ok:true,json:async()=>({people:[{id:'p1',first_name:'Example',email:'unexpected@employer.example',has_email:true}]})};}});
  assert.equal(result[0].email,undefined); assert.equal(result[0].discoveryOnly,true); assert.deepEqual(payload.q_organization_domains_list,['employer.example']);
  await assert.rejects(searchHunterDomain('employer.example','not-real',2,{userId:'u',reserve:async()=>{throw new Error('budget blocked');},fetchImpl:async()=>{network++;}}),/budget/);
  assert.equal(network,1);
});
test('vendor unknown/catch-all is never promoted to verified', async () => {
  for (const [data,status] of [[{status:'valid',accept_all:true},'catch_all'],[{status:'unknown'},'unknown'],[{status:'valid',accept_all:false},'vendor_verified']]) {
    const result=await verifyHunterEmail({email:'jobs@employer.example',userId:'u',apiKey:'not-real',reserve:async()=>{},fetchImpl:async()=>({ok:true,json:async()=>({data})})});
    assert.equal(result.verificationStatus,status);
  }
});
test('Hunter sourced invalid/catch-all results stay blocked despite provenance', async () => {
  for(const status of ['invalid','accept_all']) {
    const [lead]=await searchHunterDomain('employer.example','not-real',1,{userId:'u',reserve:async()=>{},fetchImpl:async()=>({ok:true,json:async()=>({data:{emails:[{value:'jobs@employer.example',sources:[{uri:'https://employer.example/careers'}],verification:{status}}]}})})});
    assert.ok(contactBlockReason(lead));
    assert.equal(lead.verificationStatus,status==='invalid'?'invalid':'catch_all');
  }
});
test('grounded company→job→contact→draft has source facts and cannot send without exact approval', () => {
  const dated={...evidence,reportedOn:new Date().toISOString(),lastCheckedAt:new Date().toISOString()};
  const company={_id:'c',name:'Synthetic Employer',salaryEvidence:[dated]};
  const job={_id:'j',companyId:'c',title:'Software Engineer I',url:'https://employer.example/jobs/1'};
  const contact={_id:'r',companyId:'c',email:'jobs@employer.example',status:'pending',verificationStatus:'publicly_sourced',provenance:[{url:job.url}]};
  const candidate={name:'Example Applicant',resumeLink:'https://applicant.example/resume',confirmed:true,highlights:[{text:'Built a documented backend project.',source:'Resume page 1'}]};
  const draft=createGroundedDraft({company,job,contact,candidate});
  assert.equal(draft.sent,false); assert.ok(draft.body.includes(candidate.highlights[0].text)); assert.equal(draft.needsReview,true);
  assert.throws(()=>assertApprovedMessage(contact,draft.subject,draft.body,[]),/Approve/);
  const approved=[{contactId:'r',recipient:contact.email,subject:draft.subject,body:draft.body}];
  assert.doesNotThrow(()=>assertApprovedMessage(contact,draft.subject,draft.body,approved));
  assert.throws(()=>assertApprovedMessage(contact,draft.subject,draft.body+'changed',approved),/Approve/);
  assert.ok(contactBlockReason({...contact,optOutAt:new Date()}));
  assert.throws(()=>createGroundedDraft({company,job,contact:{...contact,inferenceFlag:true},candidate}),/evidence/);
  assert.throws(()=>createGroundedDraft({company,job:{...job,companyId:'other'},contact,candidate}),/linked/);
});
test('budget policy rejects coercions/NaN, disallows negative quotas and preserves only allowed fields', () => {
  for(const value of [-1,'10',NaN,Infinity]) assert.throws(()=>validatePolicy({monthlyCredits:value}));
  assert.deepEqual(validatePolicy({stopped:true,userId:'attacker',monthlyCredits:0}),{stopped:true,monthlyCredits:0});
});
test('written-answer drafting uses supplied evidence, no hardcoded candidate or generic fallback',()=>{
  const {draftFormAnswer}=require('../services/answerDraftService');
  assert.equal(draftFormAnswer({question:'Why do you want to join this company?'}).answer,'');
  const resumeDetails={confirmed:true,supportingEvidence:[{text:'I built a documented API project.',source:'Selected resume page 1'}]};
  const response=draftFormAnswer({question:'Describe your relevant experience',resumeDetails});
  assert.equal(response.answer,resumeDetails.supportingEvidence[0].text);assert.equal(response.needsReview,true);
  assert.equal(draftFormAnswer({question:'Describe your relevant experience',resumeDetails,maxCharacters:5}).answer,'');
  assert.equal(draftFormAnswer({question:'What is your expected salary?',resumeDetails}).answer,'');
});
test('Hunter Finder needs a sourced name and never converts an inferred address into a sourced mailbox',async()=>{
  const {findHunterEmail}=require('../services/leadAgencyService');
  let calls=0;
  await assert.rejects(findHunterEmail({domain:'employer.example',firstName:'Example',lastName:'Person',userId:'u',apiKey:'not-real',fetchImpl:async()=>{calls++;}}),/sourced/);
  const lead=await findHunterEmail({domain:'employer.example',firstName:'Example',lastName:'Person',personSourceUrl:'https://employer.example/team',userId:'u',apiKey:'not-real',reserve:async(_u,c)=>assert.equal(c.credits,2),fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({data:{email:'example.person@employer.example',sources:[],verification:{status:'valid'}}})};}});
  assert.equal(calls,1);assert.equal(lead.inferenceFlag,true);assert.equal(lead.verificationStatus,'inferred_unverified');assert.ok(contactBlockReason(lead));
});

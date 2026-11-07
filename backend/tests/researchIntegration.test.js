const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Company = require('../models/Company');
const Contact = require('../models/Contact');
const Job = require('../models/JobOpening');
const Policy = require('../models/ResearchPolicy');
const Usage = require('../models/ResearchUsage');
const Task = require('../models/ResearchTask');
const { reserveResearch } = require('../services/researchBudgetService');
const { scoutRecruiters } = require('../services/ghostScoutService');
let mongo, server, base, owner, other, company, contact, job;
const key='local-test-key-not-a-secret';
const token = userId => jwt.sign({_id:String(userId)},key);
const request = async (path, method='GET', body, userId=owner) => {
  const result=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token(userId)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:result.status,data:await result.json()};
};
before(async()=>{
  process.env.JWT_SECRET=key;
  process.env.OUTREACH_SENDING_ENABLED='false';
  mongo=await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Company.init(),Contact.init(),Job.init(),Policy.init(),Usage.init(),Task.init()]);
  owner=new mongoose.Types.ObjectId();other=new mongoose.Types.ObjectId();
  const date=new Date();
  company=await Company.create({name:'Synthetic Integration Employer',domain:'employer.example',careersUrl:'https://employer.example/careers',salaryEvidence:[{role:'Software Engineer I',roleFamily:'software_engineering',level:'entry',experienceMin:0,experienceMax:2,location:'India',indiaEligibility:true,indiaEligibilitySourceUrl:'https://employer.example/jobs/1',salaryBaseMinINR:1600000,salaryBaseMaxINR:1800000,currency:'INR',payPeriod:'year',baseVsCTC:'fixed_base',salarySourceUrl:'https://employer.example/jobs/1',salarySourceType:'official_job',reportedOn:date,lastCheckedAt:date,evidenceConfidence:'high',evidenceExcerpt:'Synthetic integration fixture only: annual base 16–18 LPA'}]});
  job=await Job.create({companyId:company._id,company:company.name,title:'Software Engineer I',url:'https://employer.example/jobs/1',isFresherEligible:true});
  // Public-source discovery transport is fixture-backed; DB/routes are real.
  const result=await scoutRecruiters({userId:owner,domain:company.domain,discover:async()=>({emails:[{email:'careers@employer.example',sourceUrl:'https://employer.example/careers'}]})});
  assert.equal(result.addedCount,1);contact=result.savedContacts[0];
  const app=express();app.use(express.json());app.use('/research',require('../routes/research'));
  app.use('/mail',require('../routes/mail'));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  base=`http://127.0.0.1:${server.address().port}`;
}, {timeout:300000});
after(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  await mongoose.disconnect(); if(mongo)await mongo.stop();
});
test('authenticated company→salary→job→source contact→editable draft roundtrip never sends',async()=>{
  const list=await request('/research/companies');assert.equal(list.status,200);assert.equal(list.data.counts.qualified,1);
  const detail=await request(`/research/companies/${company._id}`);assert.equal(detail.data.jobs.length,1);assert.equal(detail.data.contacts.length,1);assert.equal(detail.data.company.qualificationStatus,'qualified');
  assert.equal(detail.data.contacts[0].verificationStatus,'publicly_sourced');
  const draft=await request('/research/drafts','POST',{companyId:String(company._id),jobId:String(job._id),contactId:String(contact._id),candidate:{name:'Example Applicant',resumeLink:'https://applicant.example/resume',confirmed:true,highlights:[{text:'Built a documented API project.',source:'Resume page 1'}]}});
  assert.equal(draft.status,200);assert.equal(draft.data.status,'draft');assert.equal(draft.data.recipient,'careers@employer.example');
  const saved=await request(`/research/drafts/${draft.data._id}`,'PATCH',{subject:draft.data.subject,body:draft.data.body,reviewed:true});assert.equal(saved.data.status,'reviewed');
  assert.equal((await request('/research/drafts','GET',undefined,other)).data.length,0);
  assert.equal((await request(`/research/drafts/${draft.data._id}`,'PATCH',{subject:'Attempt',body:'Not mine'},other)).status,404);
  assert.equal((await request('/mail/send','POST',{contactIds:[String(contact._id)]})).status,403);
  assert.equal(await require('../models/MailLog').countDocuments(),0);
});
test('other users cannot retrieve or draft against private contacts',async()=>{
  const detail=await request(`/research/companies/${company._id}`,'GET',undefined,other);assert.equal(detail.data.contacts.length,0);
  const blocked=await request('/research/drafts','POST',{companyId:String(company._id),jobId:String(job._id),contactId:String(contact._id),candidate:{}},other);
  assert.equal(blocked.status,400);
  const noAuth=await fetch(base+'/research/companies');assert.equal(noAuth.status,401);
});
test('shared evidence import requires an administrator even outside production',async()=>{
  const response=await request('/research/evidence/import','POST',{companies:[]});
  assert.equal(response.status,403);
});
test('atomic persistent request and monthly credit reservations prevent concurrent overspend',async()=>{
  await Policy.create({userId:other,dailyRequests:3,paidProvidersEnabled:true,monthlyCredits:2});
  const attempts=await Promise.allSettled(Array.from({length:8},()=>reserveResearch(other,{requests:1,credits:1})));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,2);
  const rows=await Usage.find({userId:other}).lean();
  assert.equal(rows.find(r=>r.key.startsWith('credits:')).reserved,2);
  assert.equal(rows.find(r=>r.key.startsWith('requests:')).reserved,3);
});
test('per-user stop and zero paid default apply in the shared legacy scout service',async()=>{
  await Policy.updateOne({userId:owner},{$set:{stopped:true}},{upsert:true});
  let network=0;
  await assert.rejects(scoutRecruiters({userId:owner,domain:company.domain,discover:async()=>{network++;return{emails:[]};}}),/stopped/);
  assert.equal(network,0);
  await Policy.updateOne({userId:owner},{$set:{stopped:false}});
  await assert.rejects(reserveResearch(owner,{credits:1}),/disabled/);
  const enabled=await request('/research/budget','PUT',{paidProvidersEnabled:true,monthlyCredits:10});assert.equal(enabled.status,400);
});
test('durable queue deduplicates, atomically leases, checkpoints and retries without double work',async()=>{
  const {enqueueCompanies,runResearchOnce}=require('../services/researchQueueService');
  await enqueueCompanies(owner,[String(company._id)]);await enqueueCompanies(owner,[String(company._id)]);
  assert.equal(await Task.countDocuments({userId:owner}),1);
  let calls=0;
  const scout=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return{totalFound:0,addedCount:0,requestsUsed:0,reason:'Fixture transport: not found'};};
  const results=await Promise.all([runResearchOnce({userId:owner,scout}),runResearchOnce({userId:owner,scout})]);
  assert.equal(calls,1);assert.ok(results.some(r=>r.status==='idle'));assert.ok(results.some(r=>r.status==='complete'));
  const task=await Task.findOne({userId:owner});assert.equal(task.status,'complete');assert.equal(task.result.sourcedContacts,0);
  await Task.updateOne({_id:task._id},{$set:{status:'running',attempts:1,leaseUntil:new Date(Date.now()-1000)}});
  const retry=await runResearchOnce({userId:owner,scout:async()=>{throw new Error('temporary fixture failure');}});
  assert.equal(retry.status,'retry_scheduled');
  const retried=await Task.findById(task._id);assert.equal(retried.attempts,2);assert.ok(retried.availableAt>new Date());
});

const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const mongoose=require('mongoose');const {MongoMemoryReplSet}=require('mongodb-memory-server');
const User=require('../models/User'),Contact=require('../models/Contact'),Company=require('../models/Company'),Prospect=require('../models/CompanyProspect'),Lead=require('../models/PublicRecruitmentLead'),Run=require('../models/CompanyImportRun'),MailLog=require('../models/MailLog');
const svc=require('../services/operatorCompanyImportService'),dir=require('../services/companyImportService');
let repl,owner,shared,unrelated;
const authorization='Owner explicitly approved this directory import and configured sharing recipients.';
const fakeFetch=async url=>url.endsWith('/robots.txt')?{status:404}:{status:200,contentType:'text/html',text:dir.suppliedSource().companies.filter(c=>c.recruitmentEmail?.evidenceUrl===url).map(c=>c.recruitmentEmail.email).join(' ')};
const checks={fetchPage:fakeFetch,probeDomain:async()=>({status:'mx_found',hosts:['mx.fixture.example']}),probeHost:async()=>({status:'smtp_reachable',mailboxVerified:false})};
const backup=()=>fs.mkdtempSync(path.join(os.tmpdir(),'jobfinder-operator-fixture-'));
before(async()=>{repl=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(repl.getUri());await Promise.all([User,Contact,Company,Prospect,Lead,Run,MailLog].map(m=>m.init()));},{timeout:300000});
after(async()=>{await mongoose.disconnect();if(repl)await repl.stop();});
beforeEach(async()=>{
  await Promise.all([User,Contact,Company,Prospect,Lead,Run,MailLog].map(m=>m.deleteMany({})));
  shared=await User.create({name:'Shared fixture',email:'shared@fixture.example',passwordHash:'not-a-login'});
  unrelated=await User.create({name:'Other fixture',email:'other@fixture.example',passwordHash:'not-a-login'});
  owner=await User.create({name:'Owner fixture',email:'owner@fixture.example',passwordHash:'not-a-login',syncedAccountEmails:[shared.email]});
});
test('explicit operator preview is scoped/dry-run-first without granting application admin or verification',async()=>{
  await assert.rejects(svc.prepare({ownerEmail:owner.email}),/authorization/);
  const p=await svc.prepare({ownerEmail:owner.email,includeShares:true,authorization});
  assert.equal(p.summary.sourceRows,733);assert.equal(p.scope.length,2);assert.equal(await Prospect.countDocuments(),0);assert.equal(await Company.countDocuments(),0);
  await assert.rejects(dir.previewImport(owner._id),/administrator/);assert.equal((await User.findById(owner._id)).role,'user');assert.equal((await User.findById(owner._id)).emailVerified,false);
  await assert.rejects(svc.apply({ownerEmail:owner.email,runId:p.runId,digest:'wrong',backupDirectory:backup(),...checks}),/Exact owned/);
  await assert.rejects(svc.apply({ownerEmail:unrelated.email,runId:p.runId,digest:p.digest,backupDirectory:backup(),...checks}),/Exact owned/);
});
test('transaction imports all733 once and only sourced contacts to explicitly approved accounts; old history/suppression unchanged',{timeout:300000},async()=>{
  const existingCompany=await Company.create({name:'Razorpay',domain:'razorpay.com',careersUrl:'https://razorpay.com/tech/',salaryEvidence:[{role:'Preserve stronger reviewed evidence'}]});
  const old=await Contact.create({userId:shared._id,company:'Razorpay',email:'JOBS@RAZORPAY.COM',status:'bounced',suppressedAt:new Date(),suppressionReason:'Keep me',verificationStatus:'invalid'});
  const log=await MailLog.create({userId:shared._id,contactId:old._id,subject:'Historical subject',body:'Historical body',recipientEmail:old.email});
  const oldHash=dir.hash(old.toObject()),companyHash=dir.hash(existingCompany.toObject()),logHash=dir.hash(log.toObject());
  const p=await svc.prepare({ownerEmail:owner.email,includeShares:true,authorization}),result=await svc.apply({ownerEmail:owner.email,runId:p.runId,digest:p.digest,backupDirectory:backup(),...checks});
  assert.equal(await Prospect.countDocuments(),733);assert.equal(await Prospect.countDocuments({regionGroup:'India'}),519);assert.equal(await Prospect.countDocuments({regionGroup:'International_Visa_Research'}),214);assert.equal(await Company.countDocuments(),709);assert.equal(await Lead.countDocuments(),7);
  assert.equal(await Contact.countDocuments({userId:owner._id}),7);assert.equal(await Contact.countDocuments({userId:shared._id}),7);assert.equal(await Contact.countDocuments({userId:unrelated._id}),0);
  assert.equal(result.summary.contactsAdded,13);assert.equal(dir.hash(await Contact.findById(old._id).lean()),oldHash);assert.equal(dir.hash(await Company.findById(existingCompany._id).lean()),companyHash);assert.equal(dir.hash(await MailLog.findById(log._id).lean()),logHash);
  assert.equal((await User.findById(owner._id)).role,'user');assert.equal((await User.findById(owner._id)).emailVerified,false);assert.equal(await MailLog.countDocuments(),1);
  assert.equal((await svc.apply({ownerEmail:owner.email,runId:p.runId,digest:p.digest})).alreadyApplied,true);
  const again=await svc.prepare({ownerEmail:owner.email,includeShares:true,authorization});assert.equal(again.summary.unchangedProspects,733);assert.equal(again.summary.newCompanies,0);
  const repeated=await svc.apply({ownerEmail:owner.email,runId:again.runId,digest:again.digest,backupDirectory:backup(),...checks});assert.equal(repeated.summary.contactsAdded,0);assert.equal(await Contact.countDocuments(),14);
});
test('changed sharing scope or company data invalidates the approved operator preview',async()=>{
  const p=await svc.prepare({ownerEmail:owner.email,includeShares:true,authorization});await User.updateOne({_id:owner._id},{$set:{syncedAccountEmails:[unrelated.email]}});
  await assert.rejects(svc.apply({ownerEmail:owner.email,runId:p.runId,digest:p.digest,backupDirectory:backup(),...checks}),/scope changed/);
  const q=await svc.prepare({ownerEmail:owner.email,includeShares:true,authorization});await Company.create({name:'Concurrent new employer',careersUrl:''});
  await assert.rejects(svc.apply({ownerEmail:owner.email,runId:q.runId,digest:q.digest,backupDirectory:backup(),...checks}),/Directory changed/);assert.equal(await Prospect.countDocuments(),0);
});
test('null-MX and unconfirmed source leads never become contacts; prior public observation is dated separately',async()=>{
  const source={source:'Fixture-only',companies:[dir.suppliedSource().companies.find(c=>c.companyName==='Razorpay')]};
  const checkedAt=new Date(Date.now()-86400000).toISOString();
  const evidence=[{companyName:'Razorpay',email:'jobs@razorpay.com',evidenceUrl:'https://razorpay.com/tech/',listingStatus:'official_publicly_listed',sourceObservedDate:checkedAt,proofSnippet:'Email jobs@razorpay.com'}];
  const p=await svc.prepare({ownerEmail:owner.email,authorization,source,reviewedEvidence:evidence});
  await assert.rejects(svc.apply({ownerEmail:owner.email,runId:p.runId,digest:p.digest,backupDirectory:backup(),reviewedEvidence:[]}),/evidence changed/);
  const result=await svc.apply({ownerEmail:owner.email,runId:p.runId,digest:p.digest,backupDirectory:backup(),fetchPage:async()=>{throw new Error('Fixture inconclusive direct fetch');},reviewedEvidence:[{companyName:'Razorpay',email:'jobs@razorpay.com',evidenceUrl:'https://razorpay.com/tech/',listingStatus:'official_publicly_listed',sourceObservedDate:checkedAt,proofSnippet:'Email jobs@razorpay.com'}],probeDomain:async()=>({status:'null_mx',hosts:[]})});
  assert.equal(result.summary.contactsAdded,0);assert.equal(await Contact.countDocuments(),0);const lead=await Lead.findOne();assert.equal(lead.listingStatus,'official_publicly_listed');assert.equal(lead.sourceReview.directFetchStatus,'inconclusive');assert.equal(lead.checkedAt.toISOString(),checkedAt);assert.equal(lead.mailboxVerified,false);
});
test('operator rollback is contact-aware and never removes preexisting contacts or employer IDs',async()=>{
  const existing=await Contact.create({userId:owner._id,company:'Preserved employer',email:'keep@fixture.example',suppressedAt:new Date(),status:'removed'}),before=dir.hash(existing.toObject());
  const source={source:'Rollback fixture',companies:[dir.suppliedSource().companies.find(c=>c.companyName==='Razorpay')]};
  const p=await svc.prepare({ownerEmail:owner.email,includeShares:true,authorization,source});await svc.apply({ownerEmail:owner.email,runId:p.runId,digest:p.digest,backupDirectory:backup(),...checks});
  await User.updateOne({_id:owner._id},{$set:{role:'admin'}});await assert.rejects(dir.rollbackImport(owner._id,p.runId),/contact-aware/);await User.updateOne({_id:owner._id},{$set:{role:'user'}});
  const result=await svc.rollback({ownerEmail:owner.email,runId:p.runId,digest:p.digest});assert.equal(result.report.removedNewContacts,2);assert.equal(await Contact.countDocuments(),1);assert.equal(dir.hash(await Contact.findById(existing._id).lean()),before);
  assert.equal(await Prospect.countDocuments(),0);assert.equal(await Lead.countDocuments(),0);assert.equal(await Company.countDocuments(),1);assert.ok((await Company.findOne()).importRollbackArchivedAt);
  assert.equal((await svc.rollback({ownerEmail:owner.email,runId:p.runId,digest:p.digest})).alreadyRolledBack,true);
});

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Company = require('../models/Company');
const Prospect = require('../models/CompanyProspect');
const Run = require('../models/CompanyImportRun');
const Lead = require('../models/PublicRecruitmentLead');
const Contact = require('../models/Contact');
const User = require('../models/User');
const MailLog = require('../models/MailLog');
const service = require('../services/companyImportService');
let mongo, server, base, admin, other;
const key = 'import-fixture-only-key';
const fixtureFetch = async url => url.endsWith('/robots.txt') ? { status: 404, text: '', contentType: 'text/plain' } : { status: 200, contentType: 'text/html', text: [...service.suppliedSource().companies].filter(c => c.recruitmentEmail?.evidenceUrl === url).map(c => `<a href="mailto:${c.recruitmentEmail.email}">${c.recruitmentEmail.email}</a>`).join('') };
const mini = (overrides = {}) => ({ source: 'fixture-sheet', companies: [{ companyName: 'Fixture Employer', regionGroup: 'India', careersUrl: 'https://directory.example/employers/1', reportedBaseLowLPA: 99, salaryEvidence: [{ evidenceConfidence: 'high' }], qualificationStatus: 'qualified', sendEligible: true, ...overrides }] });
before(async () => {
  process.env.JWT_SECRET = key; process.env.OUTREACH_SENDING_ENABLED = 'false';
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all([Company.init(), Prospect.init(), Run.init(), Lead.init(), Contact.init(), User.init(), MailLog.init()]);
  const app = express(); app.use(express.json({ limit: '5mb' })); app.use('/imports', require('../routes/companyImport'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 300000 });
beforeEach(async () => {
  await Promise.all([Company, Prospect, Run, Lead, Contact, User, MailLog].map(Model => Model.deleteMany({})));
  admin = await User.create({ name: 'Import Admin Fixture', email: 'admin@fixture.example', passwordHash: 'not-real', role: 'admin' });
  other = await User.create({ name: 'Import User Fixture', email: 'user@fixture.example', passwordHash: 'not-real', role: 'user' });
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('733-row supplied source independently counts regions, 13 reported prospects and seven leads', () => {
  assert.deepEqual(service.sourceSummary(), { sourceRows: 733, indiaRows: 519, overseasRows: 214, distinctCompanyNames: 709, reportedIndiaBaseAbove15: 13, suppliedPublicInboxLeads: 7, verifiedFixedBaseOffersFromImport: 0, readyToSendFromImport: 0 });
});
test('full dry-run/apply/reimport preserves all 733 records, stronger evidence and suppressed contact history', { timeout: 300000 }, async () => {
  const employer = await Company.create({ name: 'Rippling', domain: 'existing-employer.example', careersUrl: 'https://existing-employer.example/careers', salaryEvidence: [{ role: 'Preserved stronger evidence', evidenceConfidence: 'high' }] });
  const contact = await Contact.create({ userId: other._id, company: employer.name, companyId: employer._id, email: 'careers@existing-employer.example', suppressedAt: new Date(), suppressionReason: 'Keep historical suppression', status: 'bounced' });
  const log = await MailLog.create({ userId: other._id, contactId: contact._id, subject: 'Existing history', body: 'Keep', recipientEmail: contact.email });
  const employerBefore = service.hash(employer.toObject()); const contactBefore = service.hash(contact.toObject()); const logBefore = service.hash(log.toObject());
  const preview = await service.previewImport(admin._id);
  assert.equal(preview.summary.sourceRows, 733); assert.equal(preview.summary.newCompanies, 708); assert.equal(preview.summary.dedupedCompanyRows, 24);
  assert.equal(await Company.countDocuments(), 1); assert.equal(await Prospect.countDocuments(), 0);
  await assert.rejects(service.applyImport(admin._id, preview.runId, 'wrong'), /digest/);
  const applied = await service.applyImport(admin._id, preview.runId, preview.digest, { fetchPage: fixtureFetch });
  assert.equal(applied.summary.officialPublicListingsRechecked, 7); assert.equal(await Company.countDocuments(), 709); assert.equal(await Prospect.countDocuments(), 733);
  assert.equal(await Prospect.countDocuments({ qualificationStatus: 'research_needed', sendEligible: false }), 733);
  assert.equal(await Lead.countDocuments({ listingStatus: 'official_publicly_listed', mailboxVerified: false, readyToSend: false }), 7);
  assert.equal(service.hash(await Company.findById(employer._id).lean()), employerBefore);
  assert.equal(service.hash(await Contact.findById(contact._id).lean()), contactBefore);
  assert.equal(service.hash(await MailLog.findById(log._id).lean()), logBefore);
  assert.equal(await Company.countDocuments({ domain: '' }), 708); // No speculative website domains promoted.
  assert.equal((await service.applyImport(admin._id, preview.runId, preview.digest)).alreadyApplied, true);
  const repeat = await service.previewImport(admin._id); assert.equal(repeat.summary.unchangedProspects, 733); assert.equal(repeat.summary.newCompanies, 0);
  await service.applyImport(admin._id, repeat.runId, repeat.digest, { fetchPage: () => { throw new Error('Idempotent imports must not refetch'); } });
  assert.equal(await Company.countDocuments(), 709); assert.equal(await Prospect.countDocuments(), 733);
});
test('alias matching reuses company, uncertain shared names conflict, and preview does not weaken evidence', async () => {
  const a = await Company.create({ name: 'Canonical Employer', aliases: ['Fixture Employer'], domain: 'canonical.example', careersUrl: 'https://canonical.example/careers', salaryEvidence: [{ role: 'Verified existing role' }] });
  const p = await service.previewImport(admin._id, mini()); assert.equal(p.summary.newCompanies, 0); assert.equal(p.changes[0].companyId, String(a._id));
  await service.applyImport(admin._id, p.runId, p.digest); assert.equal((await Company.findById(a._id)).salaryEvidence.length, 1);
  await Company.create({ name: 'Another Employer', aliases: ['Fixture Employer'], careersUrl: '' });
  const conflict = await service.previewImport(admin._id, mini({ notes: 'Changed' })); assert.equal(conflict.summary.conflicted, 1); assert.equal(conflict.changes[0].action, 'conflict');
  await service.applyImport(admin._id, conflict.runId, conflict.digest);
  const quarantined = await Prospect.findOne(); assert.equal(quarantined.identityStatus, 'conflict'); assert.equal(quarantined.companyId, null); assert.equal(quarantined.raw.notes, 'Changed');
  assert.equal(await Company.countDocuments(), 2); assert.equal((await Company.findById(a._id)).salaryEvidence.length, 1);
  const repeatedConflict = await service.previewImport(admin._id, mini({ notes: 'Changed' })); assert.equal(repeatedConflict.summary.unchangedProspects, 1);
});
test('domain dedupe uses independently known employer identity rather than arbitrary spreadsheet hosts', async () => {
  const existing = await Company.create({ name: 'Razorpay Payments Existing', domain: 'razorpay.com', careersUrl: 'https://razorpay.com/tech/' });
  const row = service.suppliedSource().companies.find(c => c.companyName === 'Razorpay');
  const plan = service.planImport({ source: 'domain-fixture', companies: [row] }, await service.directoryState());
  assert.equal(plan.summary.newCompanies, 0); assert.equal(plan.changes[0].companyId, String(existing._id));
  const uncertain = service.planImport(mini({ companyName: 'Different Employer', careersUrl: 'https://razorpay.com/tech/' }), await service.directoryState());
  assert.equal(uncertain.summary.newCompanies, 1); assert.equal(uncertain.changes[0].newCompany.domain, '');
});
test('incremental imports update research only and rollback restores prior prospect without company/history deletion', async () => {
  const initial = await service.previewImport(admin._id, mini()); await service.applyImport(admin._id, initial.runId, initial.digest);
  const before = await Prospect.findOne().lean();
  const update = await service.previewImport(admin._id, mini({ notes: 'New source note', reportedBaseLowLPA: 100 })); assert.equal(update.summary.updatedProspects, 1);
  await service.applyImport(admin._id, update.runId, update.digest); assert.equal((await Prospect.findOne()).raw.reportedBaseLowLPA, 100);
  const rolled = await service.rollbackImport(admin._id, update.runId); assert.equal(rolled.report.restoredProspects, 1); assert.equal(service.hash(await Prospect.findOne().lean()), service.hash(before));
  const company = await Company.findById(before.companyId); assert.equal(company.domain, ''); assert.equal(company.salaryEvidence.length, 0);
  await Contact.create({ userId: other._id, company: company.name, companyId: company._id, email: 'hr@fixture.example', status: 'removed', suppressedAt: new Date() });
  const firstRollback = await service.rollbackImport(admin._id, initial.runId); assert.equal(firstRollback.report.removedProspects, 1); assert.equal(firstRollback.report.retainedCompanies, 1); assert.equal(await Contact.countDocuments(), 1); assert.equal(await Company.countDocuments(), 1);
});
test('rollback retains later manual changes and detects stale previews', async () => {
  const preview = await service.previewImport(admin._id, mini()); await service.applyImport(admin._id, preview.runId, preview.digest);
  await Prospect.updateOne({}, { $set: { 'raw.notes': 'Manual research after import' } });
  const rollback = await service.rollbackImport(admin._id, preview.runId); assert.equal(rollback.report.conflicts.length, 1); assert.equal(await Prospect.countDocuments(), 1);
  const next = await service.previewImport(admin._id, mini({ companyName: 'Other Fixture' }));
  await Company.updateOne({}, { $set: { description: 'User edit' } });
  await assert.rejects(service.applyImport(admin._id, next.runId, next.digest), /changed since preview/);
});
test('official inbox checks require visible matching employer evidence, robots, and never assert mailbox validity', async () => {
  const row = service.suppliedSource().companies.find(c => c.recruitmentEmail); const raw = row.recruitmentEmail;
  assert.equal((await service.checkPublicLead(raw, { fetchPage: fixtureFetch, companyName: row.companyName })).listingStatus, 'official_publicly_listed');
  const unavailable = await service.checkPublicLead(raw, { companyName: row.companyName, fetchPage: async () => { throw new Error('timeout'); } }); assert.equal(unavailable.listingStatus, 'inconclusive'); assert.equal(unavailable.mailboxVerified, false);
  const missing = await service.checkPublicLead(raw, { companyName: row.companyName, fetchPage: async url => url.endsWith('/robots.txt') ? { status: 404 } : { status: 200, contentType: 'text/html', text: '<p>No email</p>' } }); assert.equal(missing.listingStatus, 'not_found');
  const unknown = await service.checkPublicLead({ email: 'recruitment@guessed.example', evidenceUrl: 'https://guessed.example/careers' }, { fetchPage: () => assert.fail('Unreviewed source must not fetch') }); assert.equal(unknown.listingStatus, 'source_claim_unchecked'); assert.equal(unknown.readyToSend, false);
});
test('authenticated import APIs require current administrator role; ordinary users read public prospects only', async () => {
  const request = async (route, user, body) => {
    const res = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...(user ? { Authorization: `Bearer ${jwt.sign({ _id: String(user._id) }, key)}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() };
  };
  assert.equal((await request('/imports/preview', null, {})).status, 401);
  assert.equal((await request('/imports/preview', other, { source: mini() })).status, 403);
  const p = await request('/imports/preview', admin, { source: mini() }); assert.equal(p.status, 200);
  assert.equal((await request(`/imports/${p.data.runId}/apply`, other, { digest: p.data.digest })).status, 403);
  assert.equal((await request('/imports/prospects', other)).status, 200);
  await User.updateOne({ _id: admin._id }, { $set: { role: 'user' } });
  assert.equal((await request(`/imports/${p.data.runId}/apply`, admin, { digest: p.data.digest })).status, 403);
});
test('official address evidence cannot be relabelled as belonging to another employer',async()=>{
  const raw=service.suppliedSource().companies.find(c=>c.companyName==='Razorpay').recruitmentEmail;
  let calls=0;const result=await service.checkPublicLead(raw,{companyName:'Unrelated Employer',fetchPage:async()=>{calls++;return {status:200,text:raw.email,contentType:'text/html'};}});
  assert.equal(result.listingStatus,'source_claim_unchecked');assert.equal(calls,0);
  const preview=await service.previewImport(admin._id,mini({companyName:'Unrelated Employer',recruitmentEmail:raw}));
  await service.applyImport(admin._id,preview.runId,preview.digest,{fetchPage:fixtureFetch});
  assert.equal((await Lead.findOne()).listingStatus,'source_claim_unchecked');
});
test('interrupted global import lock has explicit audited administrator recovery, then conservative rollback',async()=>{
  const p=await service.previewImport(admin._id,mini());await service.applyImport(admin._id,p.runId,p.digest);
  await Run.collection.updateOne({_id:new mongoose.Types.ObjectId(p.runId)},{$set:{status:'applying',mutating:true,updatedAt:new Date(Date.now()-3600000)}});
  await assert.rejects(service.recoverImport(other._id,p.runId,{acknowledgeStopped:true,reason:'All import processes stopped; backup and journal inspected'}),/administrator/);
  await assert.rejects(service.recoverImport(admin._id,p.runId,{}),/Stop all/);
  const result=await service.recoverImport(admin._id,p.runId,{acknowledgeStopped:true,reason:'All import processes stopped; backup and journal inspected'});
  assert.equal(result.recovered,true);const run=await Run.findById(p.runId);assert.equal(run.mutating,false);assert.equal(run.recoveryEvents.length,1);
  const rolled=await service.rollbackImport(admin._id,p.runId);assert.equal(rolled.status,'rolled_back');assert.equal(await Prospect.countDocuments(),0);
  assert.equal(await Company.countDocuments(),1);assert.ok((await Company.findOne()).importRollbackArchivedAt);assert.equal(rolled.report.removedCompanies,0);
});
test('rollback uses an atomic version condition to preserve a concurrent manual research edit',async()=>{
  const first=await service.previewImport(admin._id,mini());await service.applyImport(admin._id,first.runId,first.digest);
  const next=await service.previewImport(admin._id,mini({notes:'Second revision'}));await service.applyImport(admin._id,next.runId,next.digest);
  const replace=Prospect.collection.replaceOne;
  Prospect.collection.replaceOne=async function(filter,doc,options){await Prospect.updateOne({_id:filter._id},{$set:{'raw.notes':'Concurrent manual edit',updatedAt:new Date(Date.now()+1000)}});return replace.call(this,filter,doc,options);};
  let result;try{result=await service.rollbackImport(admin._id,next.runId);}finally{Prospect.collection.replaceOne=replace;}
  assert.equal((await Prospect.findOne()).raw.notes,'Concurrent manual edit');assert.ok(result.report.conflicts.some(x=>x.includes('concurrent-edit')));assert.equal(result.report.restoredProspects,0);
});
test('reviewed public leads become owned sourced research contacts without clearing existing suppression',async()=>{
  const row=service.suppliedSource().companies.find(c=>c.companyName==='Razorpay');
  const p=await service.previewImport(admin._id,{source:'public-lead-fixture',companies:[row]});await service.applyImport(admin._id,p.runId,p.digest,{fetchPage:fixtureFetch});
  const lead=await Lead.findOne();const post=async reviewed=>{const response=await fetch(base+`/imports/leads/${lead._id}/contact`,{method:'POST',headers:{Authorization:`Bearer ${jwt.sign({_id:String(other._id)},key)}`,'Content-Type':'application/json'},body:JSON.stringify({reviewed})});return {status:response.status,data:await response.json()};};
  assert.equal((await post(false)).status,400);const first=await post(true);assert.equal(first.status,200);assert.equal(first.data.readyToSend,false);assert.equal(first.data.contact.verificationStatus,'publicly_sourced');
  await Contact.updateOne({_id:first.data.contact._id},{$set:{suppressedAt:new Date(),suppressionReason:'Permanent existing suppression',status:'bounced'}});
  const repeat=await post(true);assert.equal(repeat.data.created,false);assert.equal(repeat.data.contact.suppressionReason,'Permanent existing suppression');assert.equal(await Contact.countDocuments(),1);assert.equal(await MailLog.countDocuments(),0);
});

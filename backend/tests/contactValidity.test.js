const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Contact=require('../models/Contact'),Candidate=require('../models/ContactCandidate'),Proof=require('../models/MailboxProof'),Suppression=require('../models/RecipientSuppression'),Dispatch=require('../models/OutreachDispatch'),MailLog=require('../models/MailLog');
const admission=require('../services/contactAdmissionService'),hygiene=require('../services/contactHygieneService');
let mongo,server,base,owner,other;
const route=async()=>({status:'mx_found',hosts:['mx.fixture.example']});
const record=(email='careers@fixture.example')=>({company:'Fixture',email,source:'extension',provenance:[{url:'https://fixture.example/careers',provider:'fixture'}]});
const proof=async(userId,email,outcome='valid',expiresAt=new Date(Date.now()+86400000))=>Proof.create({userId,email,outcome,provider:'hunter_verifier',expiresAt});
before(async()=>{
  process.env.JWT_SECRET='contact-validity-fixture';process.env.OUTREACH_SENDING_ENABLED='false';process.env.OUTREACH_WORKER_ENABLED='false';
  mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all([User,Contact,Candidate,Proof,Suppression,Dispatch,MailLog].map(M=>M.init()));
  const app=express();app.use(express.json());app.use('/contacts',require('../routes/contact'));app.use('/intake',require('../routes/contactIntake'));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
},{timeout:300000});
beforeEach(async()=>{
  process.env.CONTACT_ADMISSION_ENABLED='false';await Promise.all([User,Contact,Candidate,Proof,Suppression,Dispatch,MailLog].map(M=>M.deleteMany({})));
  owner=await User.create({name:'Owner',email:'owner@example.org',passwordHash:'fixture'});other=await User.create({name:'Other',email:'other@example.org',passwordHash:'fixture'});
  admission.checkedDomain=route;admission.intake=admission.createIntake({domainCheck:route});process.env.CONTACT_ADMISSION_ENABLED='true';
});
after(async()=>{process.env.CONTACT_ADMISSION_ENABLED='false';if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});
const request=(path,method='GET',body,user=owner)=>fetch(base+path,{method,headers:{authorization:`Bearer ${jwt.sign({_id:String(user._id)},process.env.JWT_SECRET)}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function legacy(extra={}){process.env.CONTACT_ADMISSION_ENABLED='false';try{return await Contact.create({...record(),userId:owner._id,...extra});}finally{process.env.CONTACT_ADMISSION_ENABLED='true';}}

test('mail-capable domain and forged valid flags are staged without adding an active contact',async()=>{
  const result=await admission.intake(owner._id,[{...record(),deliverabilityStatus:'valid',verificationStatus:'vendor_verified'}]);
  assert.equal(result.added,0);assert.equal(result.staged,1);assert.equal(await Contact.countDocuments(),0);
  assert.equal((await Candidate.findOne()).state,'pending_verification');
});
test('fresh owner-scoped provider proof permits insertion and duplicate imports preserve one contact',async()=>{
  await proof(owner._id,record().email);
  assert.equal((await admission.intake(owner._id,[record()])).added,1);
  assert.equal((await admission.intake(owner._id,[record()])).duplicates,1);
  const contact=await Contact.findOne();assert.equal(contact.verificationStatus,'vendor_verified');assert.equal(contact.deliverabilityStatus,'valid');assert.equal(await Contact.countDocuments(),1);
});
test('Null MX and malformed syntax are rejected; DNS timeout stays inconclusive',async()=>{
  const intake=admission.createIntake({domainCheck:async domain=>({status:domain.startsWith('null')?'null_mx':'dns_inconclusive'})});
  const result=await intake(owner._id,[record('x@null.example'),record('bad address'),record('x@timeout.example')]);
  assert.equal(result.rejected,2);assert.equal(result.staged,1);assert.equal(await Contact.countDocuments(),0);
  assert.equal((await Candidate.findOne({email:'x@timeout.example'})).state,'domain_inconclusive');
});
test('other-owner, expired, catch-all and inferred client assertions cannot substitute for proof',async()=>{
  await proof(other._id,record().email);assert.equal((await admission.intake(owner._id,[record()])).added,0);
  await proof(owner._id,record().email,'valid',new Date(Date.now()-1000));assert.equal((await admission.intake(owner._id,[record()])).added,0);
  await proof(owner._id,record().email,'catch_all');assert.equal((await admission.intake(owner._id,[record()])).added,0);
});
test('save, insertMany, upsert and bulkWrite cannot bypass admission or fabricate validity',async()=>{
  await assert.rejects(Contact.create({...record(),userId:owner._id}),/MAILBOX_PROOF_REQUIRED/);
  await assert.rejects(Contact.insertMany([{...record('second@fixture.example'),userId:owner._id}]),/MAILBOX_PROOF_REQUIRED/);
  await assert.rejects(Contact.findOneAndUpdate({_id:new mongoose.Types.ObjectId()},{$setOnInsert:{...record('third@fixture.example'),userId:owner._id}},{upsert:true}),/MAILBOX_PROOF_REQUIRED/);
  await assert.rejects(Contact.bulkWrite([{insertOne:{document:{...record('fourth@fixture.example'),userId:owner._id}}}]),/MAILBOX_PROOF_REQUIRED/);
  assert.equal(await Contact.countDocuments(),0);assert.equal(await Candidate.countDocuments(),4);
});
test('email changes and manual validity upgrades fail closed while ordinary notes remain editable',async()=>{
  const contact=await legacy();await assert.rejects(Contact.updateOne({_id:contact._id},{$set:{email:'new@fixture.example'}}),/MAILBOX_PROOF_REQUIRED/);
  await assert.rejects(Contact.updateMany({userId:owner._id},{$set:{deliverabilityStatus:'valid'}}),/verified intake/);
  await Contact.updateOne({_id:contact._id},{$set:{notes:'Reviewed note'}});assert.equal((await Contact.findById(contact._id)).email,record().email);
});
test('persistent suppression rejects reimport even if a fresh valid proof exists',async()=>{
  await proof(owner._id,record().email);await Suppression.create({userId:owner._id,email:record().email,source:'owner_opt_out',reason:'Opted out'});
  assert.equal((await admission.intake(owner._id,[record()])).rejected,1);assert.equal(await Contact.countDocuments(),0);
});
test('confirmed-invalid contact removal preserves mail history, creates blocklist and prevents re-entry',async()=>{
  const contact=await legacy({email:'not an email'});await MailLog.create({userId:owner._id,contactId:contact._id,subject:'History',body:'Keep historical evidence'});
  const report=await hygiene.scan({userId:owner._id,force:true,apply:true,domainCheck:route});
  assert.equal(report.removed,1);assert.equal(await Contact.countDocuments(),0);assert.equal(await MailLog.countDocuments(),1);
  assert.equal(await Suppression.countDocuments(),1);assert.equal((await admission.intake(owner._id,[record('not an email')])).rejected,1);
});
test('legacy invalid labels and DNS outage do not justify deletion',async()=>{
  const contact=await legacy({status:'bounced',deliverabilityStatus:'invalid'});
  const report=await hygiene.scan({userId:owner._id,force:true,apply:true,domainCheck:async()=>({status:'dns_inconclusive'})});
  assert.equal(report.removed,0);assert.equal(report.inconclusive,1);assert.ok(await Contact.findById(contact._id));
});
test('authenticated recipient failure is removed but unresolved delivery keeps its contact for reconciliation',async()=>{
  const contact=await legacy();await Suppression.create({userId:owner._id,email:contact.email,source:'authenticated_provider_5.1.1',reason:'Trusted recipient failure'});
  await Dispatch.create({campaignId:new mongoose.Types.ObjectId(),userId:owner._id,contactId:contact._id,revision:1,recipientEmail:contact.email,status:'unknown_outcome'});
  const report=await hygiene.scan({userId:owner._id,force:true,apply:true,domainCheck:route});assert.equal(report.heldForReconciliation,1);assert.equal(report.removed,0);
  assert.ok(await Contact.findById(contact._id));
});
test('scoped hygiene leaves another owner untouched and dry-run is read-only',async()=>{
  const contact=await legacy({email:'invalid syntax'});process.env.CONTACT_ADMISSION_ENABLED='false';await Contact.create({...record('other invalid'),userId:other._id});process.env.CONTACT_ADMISSION_ENABLED='true';
  const report=await hygiene.scan({userId:owner._id,force:true,apply:false,domainCheck:route});assert.equal(report.confirmedInvalid,1);assert.ok(await Contact.findById(contact._id));assert.equal(await Suppression.countDocuments(),0);
  await hygiene.scan({userId:owner._id,force:true,apply:true,domainCheck:route});assert.equal(await Contact.countDocuments({userId:other._id}),1);
});
test('owned API exposes staged counts and prevents unapproved paid verification',async()=>{
  const response=await request('/contacts/bulk','POST',{contacts:[record()]});assert.equal(response.status,201);const result=await response.json();assert.equal(result.added,0);assert.equal(result.staged,1);
  const candidate=await Candidate.findOne();assert.equal((await request('/intake')).status,200);
  assert.equal((await (await request('/intake', 'GET',null,other)).json()).total,0);
  assert.equal((await request(`/intake/${candidate._id}/verify`,'POST',{})).status,400);
  assert.equal((await request(`/intake/${candidate._id}/verify`,'POST',{approved:true})).status,400);
  assert.equal(await Proof.countDocuments(),0);
});
test('fresh proof upgrades existing contact in place without losing suppression/history metadata',async()=>{
  const contact=await legacy({notes:'Keep notes',status:'sent'});await proof(owner._id,contact.email);
  const result=await admission.intake(owner._id,[record()]);assert.equal(result.updated,1);assert.equal(result.added,0);const updated=await Contact.findById(contact._id);assert.equal(updated.notes,'Keep notes');assert.equal(updated.status,'sent');assert.equal(updated.verificationStatus,'vendor_verified');
});


test('a valid-looking proof cannot bypass a new Null MX route and replacements need explicit identity',async()=>{
  await proof(owner._id,record().email);admission.checkedDomain=async()=>({status:'null_mx',hosts:[]});
  await assert.rejects(Contact.create({...record(),userId:owner._id}),/Mail route/);
  assert.equal(await Contact.countDocuments(),0);
  const contact=await legacy();await assert.rejects(Contact.replaceOne({_id:contact._id},{company:'Changed'}),/Replacement requires/);
});

test('concurrent email correction is preserved when an old invalid verdict reaches deletion',async()=>{
  const contact=await legacy();const report=await hygiene.scan({userId:owner._id,force:true,apply:true,domainCheck:async()=>({status:'null_mx'}),assertLease:async()=>{await Contact.collection.updateOne({_id:contact._id},{$set:{email:'corrected@fixture.example',updatedAt:new Date()}});}});
  assert.equal(report.removed,0);assert.equal(report.conflicts,1);assert.equal((await Contact.findById(contact._id)).email,'corrected@fixture.example');
  assert.equal(await Suppression.countDocuments({email:'corrected@fixture.example'}),0);
});

test('imports defer DNS without admitting unverified addresses; recheck performs the domain check',async()=>{
  let checks=0;const intake=admission.createIntake({deferUnverified:true,domainCheck:async()=>{checks++;return {status:'null_mx'};}});
  assert.equal((await intake(owner._id,[record()])).staged,1);assert.equal(checks,0);assert.equal(await Contact.countDocuments(),0);
  assert.equal((await intake(owner._id,[record()],{checkUnverifiedDomain:true})).rejected,1);assert.equal(checks,1);
  assert.equal((await Candidate.findOne()).state,'confirmed_invalid');
});

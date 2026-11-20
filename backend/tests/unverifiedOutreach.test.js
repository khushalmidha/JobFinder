const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Contact=require('../models/Contact'),Company=require('../models/Company');
const Campaign=require('../models/OutreachCampaign'),Dispatch=require('../models/OutreachDispatch'),Runtime=require('../models/OutreachRuntime');
const Proof=require('../models/MailboxProof'),Suppression=require('../models/RecipientSuppression'),MailLog=require('../models/MailLog'),Ledger=require('../models/DeliveryLedger');
const service=require('../services/campaignService'),{runCampaignWorkerOnce}=require('../services/campaignWorkerService');
let mongo,server,base,user,other,contacts,now;
const models=[require('../models/DeliveryEventReceipt'),User,Contact,Company,Campaign,Dispatch,Runtime,Proof,Suppression,MailLog,Ledger];
const request=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+jwt.sign({_id:String(user._id)},process.env.JWT_SECRET),'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
const input=(indices=[0,4,5,6])=>({immediate:true,senderId:'fixture-smtp',allowUnverifiedContacts:true,recipients:indices.map(i=>({contactId:String(contacts[i]._id),subject:'Exact application',body:'Reviewed synthetic application; no real provider.',overrideSalary:true}))});
before(async()=>{
  process.env.JWT_SECRET='unverified-outreach-test';process.env.OUTREACH_SENDING_ENABLED='false';process.env.OUTREACH_WORKER_ENABLED='false';process.env.OUTREACH_MAX_DAILY='450';process.env.OUTREACH_GLOBAL_MAX_DAILY='450';
  mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all(models.map(M=>M.init()));
  const app=express();app.use(express.json());app.use('/mail',require('../routes/mail'));app.use('/campaigns',require('../routes/campaigns'));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;
},{timeout:300000});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{
  process.env.CONTACT_ADMISSION_ENABLED='true';now=new Date();await Promise.all(models.map(M=>M.deleteMany({})));
  user=await User.create({name:'Owner',email:'owner@example.org',passwordHash:'fixture',blockedCompanies:['Excluded Corp'],smtpConfigs:[{_id:'fixture-smtp',name:'Fixture Sender',host:'smtp.example.org',port:465,user:'sender@example.org',pass:'FAKE_SECRET'}]});
  other=await User.create({name:'Other',email:'other@example.org',passwordHash:'fixture'});
  // Legacy records are inserted directly into a temporary database only; production
  // model/intake proof requirements remain enabled and unchanged.
  contacts=Array.from({length:12},(_,i)=>({_id:new mongoose.Types.ObjectId(),userId:user._id,email:`legacy-${i}@employer.example`,company:'Unqualified Employer',status:'pending',deliverabilityStatus:'unverified',verificationStatus:'domain_mail_capable'}));
  contacts[1].deliverabilityStatus='invalid';contacts[2].optOutAt=now;contacts[3].status='replied';
  contacts[4].verificationStatus='vendor_verified';contacts[4].provenance=[{url:'https://employer.example/careers',provider:'fixture'}];
  contacts[5].verificationStatus='inferred_unverified';contacts[5].inferenceFlag=true;
  contacts[6].verificationStatus='catch_all';contacts[6].vendorStatus='catch_all';
  contacts[8].company='Excluded Corp';contacts[9].vendorStatus='invalid';contacts[10].smtpConnectivity={domainStatus:'null_mx'};
  await Contact.collection.insertMany(contacts);
  await Suppression.create({userId:user._id,email:contacts[7].email,reason:'Blocked by owner',source:'owner_block'});
  await Proof.create({userId:user._id,email:contacts[4].email,outcome:'valid',provider:'hunter_verifier',checkedAt:now,expiresAt:new Date(+now+86400000)});
  await Proof.create({userId:other._id,email:contacts[0].email,outcome:'valid',provider:'hunter_verifier',checkedAt:now,expiresAt:new Date(+now+86400000)});
  await Proof.create({userId:user._id,email:contacts[11].email,outcome:'invalid',provider:'hunter_verifier',checkedAt:new Date(+now-86400000),expiresAt:new Date(+now-1000)});
});

test('campaign opt-in labels unverified/inferred/catch-all contacts and never admits confirmed-invalid, blocked or replied contacts',async()=>{
  const all=input(Array.from({length:12},(_,i)=>i));
  const preview=await service.previewCampaign(user._id,all,now);
  assert.deepEqual(preview.snapshot.recipients.map(r=>r.contactId),[0,4,5,6].map(i=>String(contacts[i]._id)));
  assert.deepEqual(preview.snapshot.recipients.map(r=>r.mailboxStatus),['unverified','verified','unverified','unverified']);
  assert.equal(preview.snapshot.recipients[2].inferred,true);assert.equal(preview.snapshot.recipients[3].contactEvidenceStatus,'catch_all');
  assert.equal(preview.blocked.length,8);assert.equal(preview.snapshot.allowUnverifiedContacts,true);
  assert.equal((await Contact.findById(contacts[0]._id)).verificationStatus,'domain_mail_capable');
  const strict=await service.previewCampaign(user._id,{...input([0]),allowUnverifiedContacts:false},now);
  assert.equal(strict.snapshot.recipients.length,0);assert.match(strict.blocked[0].reason,/Fresh trusted/);
  const forged=await service.previewCampaign(user._id,{...input([0]),allowUnverifiedContacts:false,recipients:[{...input([0]).recipients[0],allowUnverifiedContact:true,mailboxStatus:'verified'}]},now);
  assert.equal(forged.snapshot.recipients.length,0);
  await assert.rejects(service.previewCampaign(user._id,{...input(),allowUnverifiedContacts:'true'},now),/explicitly/);
});

test('both approval APIs require an explicit unverified acknowledgement bound to the reviewed digest',async()=>{
  const draft=await service.saveCampaign(user._id,input(),null,now);
  assert.equal((await request('/mail/send',{campaignId:draft._id,approvedDigest:draft.digest})).status,400);
  assert.equal((await request(`/campaigns/${draft._id}/approve`,{digest:draft.digest})).status,400);
  assert.equal(await Dispatch.countDocuments(),0);
  const approved=await request('/mail/send',{campaignId:draft._id,approvedDigest:draft.digest,approveUnverifiedContacts:true});
  assert.equal(approved.status,200);assert.equal(await Dispatch.countDocuments({campaignId:draft._id,status:'queued'}),4);
  assert.equal((await Campaign.findById(draft._id)).approvedDigest,draft.digest);
  assert.equal(await MailLog.countDocuments(),0);
  const second=await service.saveCampaign(user._id,input([0]),null,now);
  assert.equal((await request(`/campaigns/${second._id}/approve`,{digest:second.digest,approveUnverifiedContacts:true})).status,200);
});

test('late persistent blocks or new trusted-invalid results prevent approval even with unverified acknowledgement',async()=>{
  let draft=await service.saveCampaign(user._id,input([0]),null,now);
  await Suppression.create({userId:user._id,email:contacts[0].email,reason:'New owner block',source:'owner_block'});
  await assert.rejects(service.approveCampaign(user._id,draft._id,draft.digest,now,{approveUnverifiedContacts:true}),/changed/);
  draft=await service.saveCampaign(user._id,input([5]),null,now);
  await Proof.create({userId:user._id,email:contacts[5].email,outcome:'invalid',provider:'hunter_verifier',checkedAt:now,expiresAt:new Date(+now+86400000)});
  await assert.rejects(service.approveCampaign(user._id,draft._id,draft.digest,now,{approveUnverifiedContacts:true}),/changed/);
  assert.equal(await Dispatch.countDocuments(),0);
});

test('worker rechecks trusted invalidity and suppression, then delivers only the approved unverified remainder through a fake provider',async()=>{
  const draft=await service.saveCampaign(user._id,input([0,5]),null,now);
  await service.approveCampaign(user._id,draft._id,draft.digest,now,{approveUnverifiedContacts:true});
  const first=await Dispatch.findOne({campaignId:draft._id}).sort({_id:1});
  await Proof.create({userId:user._id,email:first.recipientEmail,outcome:'invalid',provider:'hunter_verifier',checkedAt:now,expiresAt:new Date(+now+86400000)});
  let calls=0;const send=async(_sender,row)=>{calls++;assert.notEqual(row.recipientEmail,first.recipientEmail);return {providerMessageId:'synthetic-accepted'};};
  const skipped=await runCampaignWorkerOnce({now,enabled:()=>true,send});assert.equal(skipped.status,'suppressed');assert.match(skipped.reason,/invalid/);assert.equal(calls,0);
  assert.equal((await runCampaignWorkerOnce({now:new Date(+now+180000),enabled:()=>true,send})).status,'sent');assert.equal(calls,1);
  assert.equal(await Dispatch.countDocuments({campaignId:draft._id,status:'sent'}),1);
  assert.equal((await Contact.findById(contacts[5]._id)).verificationStatus,'inferred_unverified');
});

test('legacy and already-approved strict campaigns never acquire unverified permission automatically',async()=>{
  const data={...input([4]),allowUnverifiedContacts:false};
  const draft=await service.saveCampaign(user._id,data,null,now);await service.approveCampaign(user._id,draft._id,draft.digest,now);
  assert.equal(draft.snapshot.allowUnverifiedContacts,undefined);
  await Proof.updateOne({userId:user._id,email:contacts[4].email},{$set:{expiresAt:new Date(+now-1000)}});
  let calls=0;assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send:async()=>{calls++;}})).status,'suppressed');assert.equal(calls,0);
});

test('mailbox opt-in does not silently override salary evidence or duplicate history, and owner isolation remains intact',async()=>{
  const noSalary={...input([0]),recipients:input([0]).recipients.map(r=>({...r,overrideSalary:false}))};
  const blocked=await service.previewCampaign(user._id,noSalary,now);assert.equal(blocked.snapshot.recipients.length,0);assert.match(blocked.blocked[0].reason,/fixed-base/);
  await Contact.collection.insertOne({userId:user._id,company:'Same address',email:contacts[0].email.toUpperCase(),status:'replied'});
  assert.match((await service.previewCampaign(user._id,input([0]),now)).blocked[0].reason,/another contact record/);
  await MailLog.collection.insertOne({userId:user._id,recipientEmail:contacts[5].email,status:'sent'});
  assert.match((await service.previewCampaign(user._id,input([5]),now)).blocked[0].reason,/Already sent/);
  const foreignId=new mongoose.Types.ObjectId();
  await Contact.collection.insertOne({_id:foreignId,userId:other._id,email:'private-other-owner@example.org',company:'Other Employer',verificationStatus:'unknown'});
  const foreign={...input([4]),recipients:[{...input([4]).recipients[0],contactId:String(foreignId)}]};
  const missing=await service.previewCampaign(user._id,foreign,now);
  assert.equal(missing.snapshot.recipients.length,0);assert.equal(missing.blocked[0].email,null);assert.match(missing.blocked[0].reason,/Owned contact not found/);
  assert.equal(await Proof.countDocuments({userId:user._id,email:contacts[0].email}),0);
});


test('explicit resend approval bypasses past sends but never creates duplicate current queue entries',async()=>{
  await MailLog.collection.insertOne({userId:user._id,contactId:contacts[0]._id,recipientEmail:contacts[0].email,status:'sent'});
  assert.match((await service.previewCampaign(user._id,input([0]),now)).blocked[0].reason,/Already sent/);
  const data={...input([0]),allowPreviouslyContacted:true};const preview=await service.previewCampaign(user._id,data,now);
  assert.equal(preview.snapshot.recipients[0].previouslyContacted,true);
  const draft=await service.saveCampaign(user._id,data,null,now);
  await assert.rejects(service.approveCampaign(user._id,draft._id,draft.digest,now,{approveUnverifiedContacts:true}),/resend/);
  await service.approveCampaign(user._id,draft._id,draft.digest,now,{approveUnverifiedContacts:true,approvePreviouslyContacted:true});
  assert.match((await service.previewCampaign(user._id,data,now)).blocked[0].reason,/already queued/);
  let calls=0;const send=async()=>{calls++;return {providerMessageId:'synthetic-explicit-resend'};};
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'sent');
  await runCampaignWorkerOnce({now:new Date(+now+3000),enabled:()=>true,send});assert.equal(calls,1);
});

test('resend never bypasses unknown outcomes, persistent blocks or invalid contacts, and row-only opt-ins cannot forge permission',async()=>{
  await MailLog.collection.insertOne({userId:user._id,recipientEmail:contacts[0].email,status:'sent'});
  const forged={...input([0]),recipients:input([0]).recipients.map(r=>({...r,allowPreviouslyContacted:true}))};
  assert.match((await service.previewCampaign(user._id,forged,now)).blocked[0].reason,/Already sent/);
  await Dispatch.collection.insertOne({userId:user._id,recipientEmail:contacts[5].email,status:'unknown_outcome'});
  const blocked=await service.previewCampaign(user._id,{...input([1,5,7]),allowPreviouslyContacted:true},now);
  assert.equal(blocked.snapshot.recipients.length,0);assert.equal(blocked.blocked.length,3);
});

test('authenticated DSN application is owner/message correlated, idempotent and permits targeted invalid cleanup without touching valid contacts',async()=>{
  const {applyProviderDsn}=require('../services/providerDsnService');
  const Receipt=require('../models/DeliveryEventReceipt');await Receipt.deleteMany({});
  const raw=Buffer.from('private synthetic signed source');
  const inspect=async()=>({trusted:true,rawSha256:'fixture-hash',signingDomain:'googlemail.com',signatureId:'fixture-signature',reportedAt:now.toISOString(),evidence:[{recipientEmail:contacts[0].email,messageId:'<owned-dsn@jobfinder.invalid>',action:'failed',enhancedStatus:'5.1.3'},{recipientEmail:contacts[5].email,messageId:'<other-dsn@jobfinder.invalid>',action:'failed',enhancedStatus:'4.2.2'}]});
  await MailLog.collection.insertOne({userId:user._id,contactId:contacts[0]._id,recipientEmail:contacts[0].email,providerMessageId:'<owned-dsn@jobfinder.invalid>',status:'sent'});
  assert.equal((await applyProviderDsn(other._id,raw,{inspect})).confirmed.length,0);
  const result=await applyProviderDsn(user._id,raw,{inspect});assert.deepEqual(result.confirmed,[contacts[0].email]);assert.equal(result.inconclusive,1);
  assert.equal((await applyProviderDsn(user._id,raw,{inspect})).duplicates,1);
  assert.equal((await Contact.findById(contacts[0]._id)).deliverabilityStatus,'invalid');
  assert.equal((await Contact.findById(contacts[5]._id)).deliverabilityStatus,'unverified');
  const cleanup=await require('../services/contactHygieneService').scan({userId:user._id,contactIds:[contacts[0]._id],force:true,apply:true});
  assert.equal(cleanup.removed,1);assert.ok(await Contact.findById(contacts[5]._id));
  assert.equal(await Suppression.countDocuments({userId:user._id,email:contacts[0].email}),1);
  assert.equal((await MailLog.findOne({providerMessageId:'<owned-dsn@jobfinder.invalid>'})).status,'bounced');
});

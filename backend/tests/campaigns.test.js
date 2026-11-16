const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Contact=require('../models/Contact'),Company=require('../models/Company');
const Campaign=require('../models/OutreachCampaign'),Dispatch=require('../models/OutreachDispatch'),Runtime=require('../models/OutreachRuntime'),MailLog=require('../models/MailLog');
const Ledger=require('../models/DeliveryLedger');
const service=require('../services/campaignService');
const {runCampaignWorkerOnce}=require('../services/campaignWorkerService');
const {localTimeToUtc}=require('../services/campaignTimeService');
const now=new Date('2026-11-07T03:00:00Z'),due=new Date('2026-11-15T04:00:00Z');
let mongo,server,base,user,other,company,contacts;
const input=()=>({name:'Synthetic approved outreach',senderId:'fixture-smtp',localDateTime:'2026-11-15T09:30',timezone:'Asia/Kolkata',dailyLimit:10,intervalSeconds:180,recipients:contacts.map(c=>({contactId:String(c._id),subject:`Exact subject for ${c.email}`,body:'Synthetic body reviewed by owner. No actual network sending.'}))});
const request=async(path,method='GET',body,owner=user)=>{
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${jwt.sign({_id:String(owner._id)},process.env.JWT_SECRET)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};
};
async function approved(data=input()) {const row=await service.saveCampaign(user._id,data,null,now);await service.approveCampaign(user._id,row._id,row.digest,now);return Campaign.findById(row._id);}
before(async()=>{
  process.env.JWT_SECRET='campaign-synthetic-only';process.env.OUTREACH_SENDING_ENABLED='false';process.env.OUTREACH_WORKER_ENABLED='false';process.env.OUTREACH_MAX_DAILY='10';process.env.OUTREACH_GLOBAL_MAX_DAILY='10';
  mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());
  await Promise.all([User,Contact,Company,Campaign,Dispatch,Runtime,MailLog,Ledger].map(M=>M.init()));
  const app=express();app.use(express.json());app.use('/campaigns',require('../routes/campaigns'));app.use('/mail',require('../routes/mail'));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
},{timeout:300000});
after(async()=>{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{
  await Promise.all([User,Contact,Company,Campaign,Dispatch,Runtime,MailLog,Ledger].map(M=>M.deleteMany({})));
  user=await User.create({name:'Fixture Owner',email:'owner@example.org',passwordHash:'not-a-real-login',smtpConfigs:[{_id:'fixture-smtp',name:'Synthetic account',host:'smtp.example.org',port:465,user:'sender@example.org',pass:'FAKE_TEST_SECRET'}]});
  other=await User.create({name:'Other Fixture',email:'other@example.org',passwordHash:'not-a-real-login'});
  company=await Company.create({name:'Synthetic Employer',domain:'employer.example',careersUrl:'https://employer.example/careers',salaryEvidence:[{role:'SWE I',roleFamily:'software_engineering',level:'entry',experienceMin:0,experienceMax:2,location:'India',indiaEligibility:true,indiaEligibilitySourceUrl:'https://employer.example/jobs',salaryBaseMinINR:1600000,salaryBaseMaxINR:1600000,currency:'INR',payPeriod:'year',baseVsCTC:'fixed_base',salarySourceUrl:'https://employer.example/jobs',salarySourceType:'official_job',reportedOn:now,lastCheckedAt:now,evidenceConfidence:'high',evidenceExcerpt:'Synthetic salary fixture only'}]});
  contacts=await Contact.create(['careers','jobs'].map(local=>({userId:user._id,companyId:company._id,company:company.name,email:`${local}@employer.example`,verificationStatus:'publicly_sourced',provenance:[{url:'https://employer.example/careers',provider:'fixture',observedAt:now}]})));
});
test('timezone conversion is explicit, quarter-hour aware and rejects DST gaps/folds or invalid dates',()=>{
  assert.equal(localTimeToUtc('2026-11-15T09:30','Asia/Kolkata').toISOString(),'2026-11-15T04:00:00.000Z');
  assert.equal(localTimeToUtc('2026-11-15T09:30','Asia/Kathmandu').toISOString(),'2026-11-15T03:45:00.000Z');
  assert.throws(()=>localTimeToUtc('2026-11-01T01:30','America/New_York'),/Ambiguous/);
  assert.throws(()=>localTimeToUtc('2026-03-08T02:30','America/New_York'),/does not exist/);
  assert.throws(()=>localTimeToUtc('2026-02-30T12:00','UTC'),/Invalid calendar/);
  assert.throws(()=>localTimeToUtc('2026-11-15T09:30','Bad/Zone'),/timezone/);
});
test('future queue stays dormant, exact messages dispatch only when due and restart does not resend',async()=>{
  const data=input();data.recipients=data.recipients.slice(0,1);const c=await approved(data);let calls=0;
  const send=async(sender,row)=>{calls++;assert.equal(sender.email,'sender@example.org');assert.equal(row.body,data.recipients[0].body);return {providerMessageId:'fixture-accepted-1'};};
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'idle');assert.equal(calls,0);
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send})).status,'sent');
  assert.equal((await Campaign.findById(c._id)).state,'completed');assert.equal(await MailLog.countDocuments({dispatchId:{$exists:true}}),1);
  await runCampaignWorkerOnce({now:new Date(+due+180000),enabled:()=>true,send});assert.equal(calls,1);
});
test('multiple workers and campaigns share a persisted cooldown and recipient duplicate guard',async()=>{
  const data=input();data.recipients=data.recipients.slice(0,1);await approved(data);await approved(data);let calls=0;
  const send=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return {providerMessageId:'fixture-one'};};
  const results=await Promise.all(Array.from({length:5},()=>runCampaignWorkerOnce({now:due,enabled:()=>true,send})));
  assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='sent').length,1);
  assert.equal((await runCampaignWorkerOnce({now:new Date(+due+30000),enabled:()=>true,send})).status,'cooldown');
  assert.equal((await runCampaignWorkerOnce({now:new Date(+due+180000),enabled:()=>true,send})).status,'suppressed');assert.equal(calls,1);
});
test('campaign edits invalidate approval and dispatch tampering cannot cross the send boundary',async()=>{
  const c=await approved();const data=input();data.recipients[0].body+=' Edited.';
  const edited=await service.saveCampaign(user._id,data,c._id,now);assert.equal(edited.state,'draft');assert.equal(edited.approvedDigest,undefined);
  assert.equal(await Dispatch.countDocuments({campaignId:c._id,status:'queued'}),0);
  await assert.rejects(service.approveCampaign(user._id,c._id,c.digest,now),/changed/);
  await service.approveCampaign(user._id,c._id,edited.digest,now);
  await Dispatch.updateOne({campaignId:c._id,revision:edited.revision},{$set:{subject:'Tampered'}});
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send:async()=>{throw new Error('Must not call');}})).status,'approval_invalid');
  assert.equal((await Campaign.findById(c._id)).state,'needs_review');
});
test('pause, explicit resume and cancellation persist without browser state',async()=>{
  const c=await approved();await service.controlCampaign(user._id,c._id,'pause',now);let calls=0;const send=async()=>{calls++;return {providerMessageId:'fixture-id'};};
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send})).status,'idle');
  await service.controlCampaign(user._id,c._id,'resume',due);
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send})).status,'sent');
  await service.controlCampaign(user._id,c._id,'cancel',due);await runCampaignWorkerOnce({now:new Date(+due+180000),enabled:()=>true,send});
  assert.equal(calls,1);assert.equal(await Dispatch.countDocuments({campaignId:c._id,status:'cancelled'}),1);
});
test('late startup requires owner confirmation and never surprise-sends an overdue queue',async()=>{
  const c=await approved();let calls=0;const late=new Date(+due+3600000),send=async()=>{calls++;return {providerMessageId:'fixture-id'};};
  assert.equal((await runCampaignWorkerOnce({now:late,enabled:()=>true,send})).status,'missed_schedule');assert.equal(calls,0);
  assert.equal((await Campaign.findById(c._id)).state,'needs_review');await service.controlCampaign(user._id,c._id,'resume',late);
  assert.equal((await runCampaignWorkerOnce({now:late,enabled:()=>true,send})).status,'sent');assert.equal(calls,1);
});
test('daily caps survive restart and reset at UTC midnight without exceeding per-campaign quota',async()=>{
  const data=input();data.dailyLimit=1;const c=await approved(data);let calls=0;const send=async()=>{calls++;return {providerMessageId:`fixture-${calls}`};};
  await runCampaignWorkerOnce({now:due,enabled:()=>true,send});
  assert.equal((await runCampaignWorkerOnce({now:new Date(+due+180000),enabled:()=>true,send})).status,'daily_limit');assert.equal(calls,1);
  assert.equal((await Campaign.findById(c._id)).nextAt.toISOString(),'2026-11-16T00:00:00.000Z');
  await runCampaignWorkerOnce({now:new Date('2026-11-16T00:00:00Z'),enabled:()=>true,send});assert.equal(calls,2);
});
test('post-approval suppression, duplicate-row opt-out, address changes and unsourced patterns stay blocked',async()=>{
  const c=await approved();await Contact.updateOne({_id:contacts[0]._id},{$set:{optOutAt:due}});
  await Contact.create({userId:user._id,company:company.name,email:contacts[1].email.toUpperCase(),optOutAt:due});
  let calls=0;const send=async()=>{calls++;return {providerMessageId:'must-not-send'};};
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send})).status,'suppressed');
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send})).status,'suppressed');assert.equal(calls,0);
  assert.equal((await Campaign.findById(c._id)).state,'completed');
  await Contact.updateOne({_id:contacts[0]._id},{$unset:{optOutAt:1},$set:{inferenceFlag:true}});
  const p=await service.previewCampaign(user._id,{...input(),recipients:[{...input().recipients[0],overrideSalary:true}]},now);assert.equal(p.blocked.length,1);
});
test('salary uncertainty needs a recorded override and sender or recipient changes require fresh review',async()=>{
  await Company.updateOne({_id:company._id},{$set:{salaryEvidence:[]}});
  const p=await service.previewCampaign(user._id,input(),now);assert.equal(p.blocked.length,2);
  const data=input();data.recipients=data.recipients.slice(0,1).map(r=>({...r,overrideSalary:true}));const c=await approved(data);
  await Contact.updateOne({_id:contacts[0]._id},{$set:{email:'new@employer.example'}});
  const result=await runCampaignWorkerOnce({now:due,enabled:()=>true,send:async()=>{throw new Error('Must not call');}});assert.equal(result.status,'suppressed');assert.match(result.reason,/changed/);
  assert.equal((await Campaign.findById(c._id)).snapshot.recipients[0].overrideSalary,true);
});
test('kill switches are checked again at dispatch; provider timeout and expired lease never auto-retry',async()=>{
  let c=await approved(),calls=0;
  assert.equal((await runCampaignWorkerOnce({now:due,send:async()=>{calls++;}})).status,'disabled');assert.equal(calls,0);
  const failure=await runCampaignWorkerOnce({now:due,enabled:()=>true,send:async()=>{calls++;throw new Error('Synthetic provider timeout');}});
  assert.equal(failure.status,'unknown_outcome');await assert.rejects(service.controlCampaign(user._id,c._id,'resume',due),/unknown/);
  await runCampaignWorkerOnce({now:new Date(+due+3600000),enabled:()=>true,send:async()=>{calls++;}});assert.equal(calls,1);
  const row=await Dispatch.findOne({campaignId:c._id,status:'queued'});await Dispatch.updateOne({_id:row._id},{$set:{status:'sending',leaseUntil:new Date(+due-1),startedAt:due,leaseToken:'dead-process'}});
  await runCampaignWorkerOnce({now:due,enabled:()=>false});assert.equal((await Dispatch.findById(row._id)).status,'unknown_outcome');
});
test('API protects ownership, omits credentials, and retires the old process-memory send path',async()=>{
  const c=await approved();const opts=await request('/campaigns/options');assert.equal(opts.status,200);assert.equal(opts.data.senders.length,1);assert.ok(!JSON.stringify(opts.data).includes('FAKE_TEST_SECRET'));assert.ok(!JSON.stringify(opts.data).includes('pass'));
  assert.equal((await request(`/campaigns/${c._id}`,'GET',undefined,other)).status,404);
  assert.equal((await request('/campaigns','GET',undefined,other)).data.campaigns.length,0);
  assert.equal((await request(`/campaigns/${c._id}/cancel`,'POST',{},other)).status,400);
  assert.equal((await fetch(base+'/campaigns')).status,401);
  assert.equal((await request('/mail/send','POST',{})).status,403);
  process.env.OUTREACH_SENDING_ENABLED='true';assert.equal((await request('/mail/send','POST',{})).status,409);process.env.OUTREACH_SENDING_ENABLED='false';
  assert.equal(await MailLog.countDocuments(),0);
});
test('restart repairs a torn unknown-outcome update and blocks the shared dispatch lane',async()=>{
  const c=await approved();const row=await Dispatch.findOne({campaignId:c._id});
  await Dispatch.updateOne({_id:row._id},{$set:{status:'unknown_outcome',startedAt:due}});
  // Simulate process death after the row write, before campaign pause was saved.
  await Campaign.updateOne({_id:c._id},{$set:{state:'running',nextAt:due}});let calls=0;
  assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send:async()=>{calls++;}})).status,'needs_review');
  assert.equal(calls,0);assert.equal((await Campaign.findById(c._id)).state,'needs_review');
});
test('a worker whose lease expires between renewal and final boundary never calls the provider',async()=>{
  await approved();let clocks=0,calls=0;
  const clock=()=>new Date(+due+(++clocks>=3?121000:0));
  assert.equal((await runCampaignWorkerOnce({clock,enabled:()=>true,send:async()=>{calls++;return {providerMessageId:'must-not-call'};}})).status,'lease_lost');
  assert.equal(calls,0);assert.equal(await Dispatch.countDocuments({status:'unknown_outcome'}),1);
});
test('renaming an approved sender invalidates the frozen From identity',async()=>{
  const c=await approved();await User.updateOne({_id:user._id},{$set:{'smtpConfigs.0.name':'Changed display identity'}});
  let calls=0;assert.equal((await runCampaignWorkerOnce({now:due,enabled:()=>true,send:async()=>{calls++;}})).status,'sender_changed');
  assert.equal(calls,0);assert.equal((await Campaign.findById(c._id)).state,'needs_review');
});
test('manual provider-history reconciliation records the outcome without retrying it',async()=>{
  const c=await approved();await runCampaignWorkerOnce({now:due,enabled:()=>true,send:async()=>{throw new Error('Fixture ambiguous acceptance');}});
  const row=await Dispatch.findOne({campaignId:c._id,status:'unknown_outcome'}),path=`/campaigns/${c._id}/dispatches/${row._id}/reconcile`;
  assert.equal((await request(path,'POST',{outcome:'sent',notes:'Provider accepted the exact message',providerMessageId:'fixture-reconciled-id'})).status,400);
  assert.equal((await request(path,'POST',{outcome:'sent',acknowledge:true,notes:'Provider accepted the exact message',providerMessageId:'fixture-reconciled-id'},other)).status,404);
  const result=await request(path,'POST',{outcome:'sent',acknowledge:true,notes:'Provider accepted the exact message',providerMessageId:'fixture-reconciled-id'});
  assert.equal(result.status,200);assert.equal(result.data.automaticallyRetried,false);assert.equal(await MailLog.countDocuments({dispatchId:row._id}),1);
  assert.equal((await Campaign.findById(c._id)).state,'needs_review');assert.equal(await Dispatch.countDocuments({status:'queued'}),1);
});


test('450 quota is consistent across options, preview and worker with no old 10/200 clamp',async()=>{
  const oldMax=process.env.OUTREACH_MAX_DAILY,oldGlobal=process.env.OUTREACH_GLOBAL_MAX_DAILY;
  try {
    process.env.OUTREACH_MAX_DAILY='450';process.env.OUTREACH_GLOBAL_MAX_DAILY='450';
    assert.equal((await request('/campaigns/options')).data.maxDailyLimit,450);
    const queue=await request('/mail/queue-status');assert.equal(queue.data.dailyLimit,450);assert.equal(queue.data.accounts[0].dailyLimit,450);
    const data={...input(),dailyLimit:450};assert.equal((await service.previewCampaign(user._id,data,now)).snapshot.dailyLimit,450);
    const implicit={...data};delete implicit.dailyLimit;assert.equal((await service.previewCampaign(user._id,implicit,now)).snapshot.dailyLimit,450);
    await assert.rejects(service.previewCampaign(user._id,{...data,dailyLimit:451},now),/Daily limit/);
    const c=await approved(data);const quota=require('../services/campaignWorkerService').quotaAvailable;
    await MailLog.insertMany(Array.from({length:449},(_,i)=>({userId:user._id,contactId:contacts[0]._id,recipientEmail:'historical@example.org',senderEmail:c.snapshot.senderEmail,subject:'Synthetic historical quota '+i,body:'Fixture only',status:'sent',sentAt:due})));
    assert.equal(await quota(c,user,due),null);
    await MailLog.create({userId:user._id,contactId:contacts[0]._id,senderEmail:c.snapshot.senderEmail,subject:'450th fixture',body:'Fixture only',status:'sent',sentAt:due});
    assert.match(await quota(c,user,due),/daily cap/);
    process.env.OUTREACH_MAX_DAILY='20';assert.equal((await request('/campaigns/options')).data.maxDailyLimit,20);
  } finally {process.env.OUTREACH_MAX_DAILY=oldMax;process.env.OUTREACH_GLOBAL_MAX_DAILY=oldGlobal;}
});


async function fallbackSetup(){
  process.env.OUTREACH_MAX_DAILY='450';process.env.OUTREACH_GLOBAL_MAX_DAILY='1800';
  await User.updateOne({_id:user._id},{$set:{selectedSmtpId:'fixture-smtp'},$push:{smtpConfigs:{_id:'fallback-smtp',name:'Backup account',host:'smtp.backup.example',port:465,user:'backup@example.org',pass:'FAKE_BACKUP_SECRET'}}});user=await User.findById(user._id);
}
const fallbackInput=()=>({...input(),immediate:true,localDateTime:null,dailyLimit:undefined,autoSwitchSenders:true,fallbackSenderIds:['fallback-smtp']});
async function seedUsage(email,count,owner=user._id,at=now){
  if(count)await MailLog.insertMany(Array.from({length:count},(_,i)=>({userId:owner,contactId:new mongoose.Types.ObjectId(),recipientEmail:`old-${i}@history.example`,senderEmail:email,subject:'Synthetic prior quota '+i,body:'Historical fixture only',status:'sent',sentAt:at})));
}

test('fallback requires explicit owned, distinct sender approval and freezes a secret-free 450-per-account policy',async()=>{
  await fallbackSetup();const data=fallbackInput();const preview=await service.previewCampaign(user._id,data,now);assert.equal(preview.snapshot.dailyLimit,900);assert.equal(preview.snapshot.approvedSenders.length,2);assert.deepEqual(preview.snapshot.approvedSenders.map(s=>s.dailyLimit),[450,450]);assert.ok(!JSON.stringify(preview.snapshot).includes('SECRET'));
  await assert.rejects(service.previewCampaign(user._id,{...data,autoSwitchSenders:false},now),/Enable automatic/);
  await assert.rejects(service.previewCampaign(user._id,{...data,fallbackSenderIds:['foreign-smtp']},now),/owned SMTP/);
  await assert.rejects(service.previewCampaign(user._id,{...data,fallbackSenderIds:['fixture-smtp']},now),/only once/);
  await User.updateOne({_id:user._id},{$push:{smtpConfigs:{_id:'same-mailbox',host:'smtp.example.org',port:465,user:'SENDER@example.org',pass:'FAKE'}}});
  await assert.rejects(service.previewCampaign(user._id,{...data,fallbackSenderIds:['same-mailbox']},now),/same mailbox/);
});

test('full primary automatically routes remaining exact messages to an approved backup without pausing or changing default settings',async()=>{
  await fallbackSetup();const c=await approved(fallbackInput());await seedUsage('sender@example.org',450);const seen=[];const send=async(sender,row)=>{seen.push(sender.email);assert.equal(row.senderEmail,sender.email);assert.equal(row.approvedSenderEmail,'sender@example.org');assert.equal(row.body,c.snapshot.recipients.find(r=>r.recipientEmail===row.recipientEmail).body);return {providerMessageId:'synthetic-'+seen.length};};
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'sent');
  const progress=await Campaign.findById(c._id);assert.equal(progress.state,'running');assert.equal(progress.activeSenderId,'fallback-smtp');assert.equal((await User.findById(user._id)).selectedSmtpId,'fixture-smtp');
  const status=await request('/mail/queue-status');assert.equal(status.data.activeSender,'backup@example.org');assert.equal(status.data.dailyLimit,900);assert.equal(status.data.accounts.find(s=>s._id==='fallback-smtp').dailyLimit,450);assert.equal(status.data.isPaused,false);
  assert.equal((await runCampaignWorkerOnce({now:new Date(+now+180000),enabled:()=>true,send})).status,'sent');assert.deepEqual(seen,['backup@example.org','backup@example.org']);assert.equal((await Campaign.findById(c._id)).state,'completed');
});

test('a sender uses its last slot once, then the next worker cycle switches accounts with the same cooldown and digest',async()=>{
  await fallbackSetup();const c=await approved(fallbackInput());await seedUsage('sender@example.org',449);const seen=[];const send=async sender=>{seen.push(sender.email);return {providerMessageId:'synthetic-slot-'+seen.length};};
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'sent');assert.equal((await runCampaignWorkerOnce({now:new Date(+now+60000),enabled:()=>true,send})).status,'cooldown');
  assert.equal((await runCampaignWorkerOnce({now:new Date(+now+180000),enabled:()=>true,send})).status,'sent');assert.deepEqual(seen,['sender@example.org','backup@example.org']);assert.equal((await Campaign.findById(c._id)).approvedDigest,c.approvedDigest);
  const usage=await require('../services/senderQuotaService').dailyUsage({userId:user._id,emails:seen,now});assert.equal(usage.senders['sender@example.org'],450);assert.equal(usage.senders['backup@example.org'],1);
});

test('all approved accounts exhausted wait for the next UTC reset and continue without manual resume',async()=>{
  await fallbackSetup();const c=await approved(fallbackInput());await seedUsage('sender@example.org',450);await seedUsage('backup@example.org',450);let calls=0;const send=async()=>{calls++;return {providerMessageId:'synthetic-reset'};};
  const held=await runCampaignWorkerOnce({now,enabled:()=>true,send});assert.equal(held.status,'daily_limit');assert.equal(calls,0);const waiting=await Campaign.findById(c._id);assert.equal(waiting.state,'scheduled');assert.equal(waiting.nextAt.toISOString(),'2026-11-08T00:00:00.000Z');assert.match(waiting.reason,/automatic continuation/);
  assert.equal((await runCampaignWorkerOnce({now:waiting.nextAt,enabled:()=>true,send})).status,'sent');assert.equal(calls,1);
});

test('sender budgets are shared across owners and consumer Gmail aliases, while custom-domain dots stay distinct',async()=>{
  await fallbackSetup();await User.updateOne({_id:user._id},{$set:{'smtpConfigs.0.user':'mail.box@gmail.com'}});const c=await approved(fallbackInput());await seedUsage('m.a.i.l.b.o.x+old@googlemail.com',450,other._id);
  const q=require('../services/senderQuotaService'),usage=await q.dailyUsage({userId:user._id,emails:['mail.box@gmail.com'],now});assert.equal(usage.senders['mailbox@gmail.com'],450);assert.notEqual(q.senderQuotaKey('john.smith@business.example'),q.senderQuotaKey('johnsmith@business.example'));
  let actual;assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send:async sender=>{actual=sender.email;return {providerMessageId:'synthetic-alias'};}})).status,'sent');assert.equal(actual,'backup@example.org');
});

test('global and legacy owner caps still stop sending rather than silently switching unapproved identities',async()=>{
  await fallbackSetup();await approved(fallbackInput());await seedUsage('sender@example.org',450);process.env.OUTREACH_GLOBAL_MAX_DAILY='450';let calls=0;const send=async()=>{calls++;return {providerMessageId:'never'};};
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'daily_limit');assert.equal(calls,0);
  await Campaign.deleteMany({});await Dispatch.deleteMany({});process.env.OUTREACH_GLOBAL_MAX_DAILY='1800';await approved({...input(),senderId:'fallback-smtp',immediate:true,localDateTime:null,dailyLimit:450});
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'daily_limit');assert.equal(calls,0);
});

test('fallback never retries an uncertain delivery from a different sender',async()=>{
  await fallbackSetup();await approved(fallbackInput());await seedUsage('sender@example.org',450);let calls=0;const send=async()=>{calls++;throw new Error('Synthetic ambiguous provider result');};
  assert.equal((await runCampaignWorkerOnce({now,enabled:()=>true,send})).status,'unknown_outcome');assert.equal((await runCampaignWorkerOnce({now:new Date(+now+180000),enabled:()=>true,send})).status,'needs_review');assert.equal(calls,1);assert.equal(await Dispatch.countDocuments({status:'unknown_outcome'}),1);assert.equal(await Dispatch.countDocuments({status:'queued'}),1);
});

test('changing any approved fallback identity invalidates preview approval and holds an already approved campaign',async()=>{
  await fallbackSetup();const data=fallbackInput();const draft=await service.saveCampaign(user._id,data,null,now);await User.updateOne({_id:user._id},{$set:{'smtpConfigs.1.name':'Changed account name'}});
  await assert.rejects(service.approveCampaign(user._id,draft._id,draft.digest,now),/changed/);assert.equal(await Dispatch.countDocuments(),0);
  await User.updateOne({_id:user._id},{$set:{'smtpConfigs.1.name':'Backup account'}});await service.approveCampaign(user._id,draft._id,draft.digest,now);await User.updateOne({_id:user._id},{$set:{'smtpConfigs.1.user':'different@example.org'}});
  let calls=0;const result=await runCampaignWorkerOnce({now,enabled:()=>true,send:async()=>{calls++;}});assert.equal(result.status,'sender_missing');assert.equal(calls,0);assert.equal((await Campaign.findById(draft._id)).state,'needs_review');
});

test('retained ledger duplicates do not mint or double-count sender capacity, and UTC-day bounds exclude future records',async()=>{
  await fallbackSetup();await seedUsage('sender@example.org',1);const log=await MailLog.findOne();await Ledger.create({originalMailLogId:log._id,userId:log.userId,contactId:log.contactId,recipientEmail:log.recipientEmail,senderEmail:log.senderEmail,status:'sent',sentAt:log.sentAt});
  const q=require('../services/senderQuotaService');assert.equal((await q.dailyUsage({userId:user._id,emails:['sender@example.org'],now})).senders['sender@example.org'],1);
  await MailLog.deleteOne({_id:log._id});assert.equal((await q.dailyUsage({userId:user._id,emails:['sender@example.org'],now})).senders['sender@example.org'],1);
  await Ledger.updateOne({originalMailLogId:log._id},{$set:{status:'bounced'}});assert.equal((await q.dailyUsage({userId:user._id,emails:['sender@example.org'],now})).senders['sender@example.org'],1);
  await seedUsage('sender@example.org',1,user._id,new Date('2026-11-08T01:00:00Z'));assert.equal((await q.dailyUsage({userId:user._id,emails:['sender@example.org'],now})).senders['sender@example.org'],1);
});

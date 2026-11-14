const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Challenge=require('../models/EmailVerificationChallenge'),Audit=require('../models/AdminRoleMigration');
const Budget=require('../models/EmailVerificationBudget');
const Receipt=require('../models/EmailVerificationReceipt');
const {createEmailVerificationService,verificationConfig}=require('../services/emailVerificationService');
const {promoteVerifiedAdmin}=require('../services/adminRoleMigrationService');
let mongo,owner,other,service,now,deliveries,server,base;
const settings={enabled:true,configured:true,secret:'synthetic-private-token-secret-32-characters',host:'smtp.fixture.example',port:465,username:'trusted-server@fixture.example',password:'synthetic-server-only-pass',from:'trusted-server@fixture.example'};
before(async()=>{process.env.JWT_SECRET='synthetic-verification-auth';process.env.EMAIL_VERIFICATION_ENABLED='false';mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all([User,Challenge,Audit,Budget,Receipt].map(m=>m.init()));},{timeout:300000});
after(async()=>{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{
  if(server){await new Promise(r=>server.close(r));server=null;}
  await Promise.all([User,Challenge,Audit,Budget,Receipt].map(m=>m.deleteMany({})));
  now=new Date('2026-11-07T10:00:00Z');deliveries=[];
  owner=await User.create({name:'Synthetic verification owner',email:'owner@fixture.example',passwordHash:'not-a-real-login',smtpConfigs:[{_id:'untrusted-outreach-smtp',name:'User controlled SMTP',host:'untrusted.example',user:'someone@untrusted.example',pass:'not-trusted'}]});
  other=await User.create({name:'Other owner',email:'other@fixture.example',passwordHash:'not-a-real-login'});
  service=createEmailVerificationService({config:()=>settings,clock:()=>new Date(now),sendCode:async(config,mail)=>{assert.equal(config.from,settings.from);deliveries.push(mail);}});
});
test('verification is disabled by default and status never exposes sender credentials or codes',async()=>{
  assert.equal(verificationConfig().enabled,false);
  const disabled=createEmailVerificationService();await assert.rejects(disabled.requestCode(owner._id,{approved:true}),/unavailable/);
  assert.equal(await Challenge.countDocuments(),0);
  const status=await service.status(owner._id);assert.equal(status.verified,false);assert.equal(status.email,owner.email);assert.ok(!JSON.stringify(status).includes(settings.password));
});
test('a server-delivered code verifies only its account and leaves admin/import approval separate',async()=>{
  await assert.rejects(service.requestCode(owner._id),/Explicitly/);
  const response=await service.requestCode(owner._id,{approved:true});assert.equal(deliveries.length,1);assert.equal(deliveries[0].recipient,owner.email);
  const code=deliveries[0].code;assert.match(code,/^[a-f0-9]{16}$/);assert.ok(!JSON.stringify(response).includes(code));assert.equal(response.requested,true);
  const stored=await Challenge.findById(owner._id).select('+codeHash').lean();assert.notEqual(stored.codeHash,code);assert.equal((await Challenge.findById(owner._id).lean()).codeHash,undefined);
  const result=await service.confirmCode(owner._id,code.toUpperCase());assert.equal(result.verified,true);
  const user=await User.findById(owner._id).lean();assert.equal(user.role,'user');assert.equal(user.emailVerificationProof.subject,owner.email);assert.equal(user.emailVerificationProof.challengeId,stored.generation);assert.equal((await User.findById(other._id)).emailVerified,false);
  const adminPreview=await promoteVerifiedAdmin({email:owner.email,migrationId:'verified-code-owner-001',now});assert.equal(adminPreview.eligible,true);assert.equal(adminPreview.applied,false);assert.equal(await Audit.countDocuments(),0);
  await assert.rejects(service.confirmCode(owner._id,code),/already verified/);
});
test('wrong, cross-account, expired and exhausted codes cannot verify an email',async()=>{
  await service.requestCode(owner._id,{approved:true});const code=deliveries[0].code;
  await assert.rejects(service.confirmCode(other._id,code),/Invalid/);assert.equal(await Challenge.countDocuments({_id:other._id}),0);
  for(let i=0;i<5;i++)await assert.rejects(service.confirmCode(owner._id,'0000000000000000'),/Invalid/);
  await assert.rejects(service.confirmCode(owner._id,code),/Invalid/);assert.equal((await User.findById(owner._id)).emailVerified,false);assert.equal((await Challenge.findById(owner._id)).attempts,5);
  now=new Date(+now+61000);await service.requestCode(owner._id,{approved:true});const second=deliveries[1].code;
  now=new Date(+now+600001);await assert.rejects(service.confirmCode(owner._id,second),/expired/);
});
test('durable atomic request counters enforce cooldown/daily limits across services and reset in UTC',async()=>{
  const results=await Promise.allSettled(Array.from({length:5},()=>service.requestCode(owner._id,{approved:true})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(deliveries.length,1);
  now=new Date(+now+61000);await service.requestCode(owner._id,{approved:true});now=new Date(+now+61000);await service.requestCode(owner._id,{approved:true});now=new Date(+now+61000);
  await assert.rejects(service.requestCode(owner._id,{approved:true}),/limit reached/);assert.equal(deliveries.length,3);
  now=new Date('2026-11-08T00:00:00Z');await service.requestCode(owner._id,{approved:true});assert.equal(deliveries.length,4);assert.equal((await Challenge.findById(owner._id)).requestsToday,1);
});
test('resending invalidates the old code and concurrent confirms consume the new code once',async()=>{
  await service.requestCode(owner._id,{approved:true});const first=deliveries[0].code;now=new Date(+now+61000);await service.requestCode(owner._id,{approved:true});const second=deliveries[1].code;
  await assert.rejects(service.confirmCode(owner._id,first),/Invalid/);
  const results=await Promise.allSettled(Array.from({length:5},()=>service.confirmCode(owner._id,second)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await Challenge.findById(owner._id)).state,'consumed');assert.equal((await Challenge.findById(owner._id).select('+codeHash')).codeHash,undefined);
});
test('interrupted sending/consuming can recover using an operation timestamp unaffected by Mongoose upsert timestamps',async()=>{
  for(const state of ['sending','consuming']){
    await Promise.all([Challenge.deleteMany({}),Budget.deleteMany({})]);await service.requestCode(owner._id,{approved:true});const oldCode=deliveries.at(-1).code;
    await Challenge.updateOne({_id:owner._id},{$set:{state,operationStartedAt:new Date(+now-180000),requestedAt:new Date(+now-180000)}});
    await service.requestCode(owner._id,{approved:true});assert.equal((await Challenge.findById(owner._id)).state,'sent');await assert.rejects(service.confirmCode(owner._id,oldCode),/Invalid/);
  }
});
test('shared normalized mailbox and server caps prevent multiplying sends across accounts',async()=>{
  for(let i=0;i<3;i++){
    const variant=await User.create({name:'Case variant fixture',email:['Owner@fixture.example','oWner@fixture.example','owNer@fixture.example'][i],passwordHash:'not-a-login'});
    await service.requestCode(variant._id,{approved:true});
  }
  await assert.rejects(service.requestCode(owner._id,{approved:true}),/Shared verification delivery budget/);assert.equal(deliveries.length,3);
  const capped=createEmailVerificationService({config:()=>({...settings,dailyLimit:1}),clock:()=>now,sendCode:async(_config,mail)=>deliveries.push(mail)});
  await assert.rejects(capped.requestCode(other._id,{approved:true}),/Shared verification delivery budget/);assert.equal(deliveries.length,3);
});
test('resend paused after account read cannot overwrite a completed challenge or its proof',async()=>{
  await service.requestCode(owner._id,{approved:true});const code=deliveries[0].code;now=new Date(+now+61000);
  const update=Challenge.updateOne;let release,reached;const waiting=new Promise(r=>{release=r;}),entered=new Promise(r=>{reached=r;});
  Challenge.updateOne=async function(filter,change,options){if(change.$setOnInsert&&String(filter._id)===String(owner._id)){reached();await waiting;}return update.call(this,filter,change,options);};
  const pending=service.requestCode(owner._id,{approved:true});await entered;
  try{await service.confirmCode(owner._id,code);release();await assert.rejects(pending,/limit reached/);}finally{release();Challenge.updateOne=update;}
  const user=await User.findById(owner._id);assert.equal((await Challenge.findById(owner._id)).generation,user.emailVerificationProof.challengeId);
  assert.equal((await promoteVerifiedAdmin({email:owner.email,migrationId:'resend-race-proof-001',now})).eligible,true);assert.equal(deliveries.length,1);
});
test('genuine consumption receipt survives stale recovery and an old confirmation completing after resend',async()=>{
  await service.requestCode(owner._id,{approved:true});const code=deliveries[0].code,update=User.updateOne;let release,reached;const waiting=new Promise(r=>{release=r;}),entered=new Promise(r=>{reached=r;});
  User.updateOne=async function(filter,change,options){if(change.$set?.emailVerified===true){reached();await waiting;}return update.call(this,filter,change,options);};
  const confirming=service.confirmCode(owner._id,code);await entered;
  try{now=new Date(+now+121000);await service.requestCode(owner._id,{approved:true});release();await confirming;}finally{release();User.updateOne=update;}
  const user=await User.findById(owner._id);assert.equal(user.emailVerified,true);assert.notEqual((await Challenge.findById(owner._id)).generation,user.emailVerificationProof.challengeId);
  assert.equal((await promoteVerifiedAdmin({email:owner.email,migrationId:'receipt-recovery-proof-001',now})).eligible,true);assert.equal(user.role,'user');
});
test('delivery uncertainty invalidates the code, keeps its daily charge and never leaks SMTP details',async()=>{
  const failed=createEmailVerificationService({config:()=>settings,clock:()=>now,sendCode:async(_config,mail)=>{deliveries.push(mail);throw new Error(settings.password);}});
  await assert.rejects(failed.requestCode(owner._id,{approved:true}),error=>!error.message.includes(settings.password)&&/could not be confirmed/.test(error.message));
  const row=await Challenge.findById(owner._id).select('+codeHash');assert.equal(row.state,'failed');assert.equal(row.codeHash,undefined);assert.equal(row.requestsToday,1);
  await assert.rejects(service.confirmCode(owner._id,deliveries[0].code),/Invalid/);
});
test('changing stored email invalidates the old challenge; fabricated proof or missing challenge cannot enable admin promotion',async()=>{
  await service.requestCode(owner._id,{approved:true});await User.updateOne({_id:owner._id},{$set:{email:'new@fixture.example'}});
  await assert.rejects(service.confirmCode(owner._id,deliveries[0].code),/Invalid/);
  await User.updateOne({_id:other._id},{$set:{emailVerified:true,emailVerifiedAt:now,emailVerificationProof:{method:'self_asserted',issuer:'user',subject:other.email,verifiedAt:now,challengeId:'00000000-0000-4000-8000-000000000001'}}});
  assert.equal((await promoteVerifiedAdmin({email:other.email,migrationId:'fake-trusted-proof-001',apply:true,now})).eligible,false);
  await User.updateOne({_id:other._id},{$set:{'emailVerificationProof.method':'email_code','emailVerificationProof.issuer':'jobfinder_trusted_server_sender'}});
  assert.equal((await promoteVerifiedAdmin({email:other.email,migrationId:'fake-trusted-proof-002',apply:true,now})).eligible,false);assert.equal((await User.findById(other._id)).role,'user');
});
test('authenticated endpoints ignore alternate recipients/configuration and expose no code/hash',async()=>{
  const app=express();app.use(express.json());app.use('/verify',require('../routes/emailVerification').createRouter({config:()=>settings,clock:()=>now,sendCode:async(config,mail)=>{assert.equal(config.host,settings.host);deliveries.push(mail);}}));
  await new Promise(r=>{server=app.listen(0,'127.0.0.1',r);});base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,method,body,user=owner)=>{const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${jwt.sign({_id:String(user._id)},process.env.JWT_SECRET)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  assert.equal((await fetch(base+'/verify')).status,401);
  const sent=await request('/verify/request','POST',{approved:true,email:other.email,recipient:other.email,smtpConfig:{host:'attacker.example'},userId:String(other._id),code:'1234'});assert.equal(sent.status,200);assert.equal(deliveries[0].recipient,owner.email);
  assert.ok(!JSON.stringify(sent.data).includes(deliveries[0].code));const status=await request('/verify','GET');assert.ok(!JSON.stringify(status.data).includes('codeHash'));
  assert.equal((await request('/verify/confirm','POST',{code:deliveries[0].code},other)).status,400);assert.equal((await request('/verify/confirm','POST',{code:deliveries[0].code})).status,200);
});

const crypto=require('node:crypto');
const Campaign=require('../models/OutreachCampaign'),Dispatch=require('../models/OutreachDispatch'),Runtime=require('../models/OutreachRuntime');
const User=require('../models/User'),Contact=require('../models/Contact'),MailLog=require('../models/MailLog');
const {digest,resolveSender,recipientReason,configuredLimit,normalizeEmail}=require('./campaignService');
const LEASE_MS=120000;
const active=['scheduled','running'];
const gates=()=>process.env.OUTREACH_SENDING_ENABLED==='true'&&process.env.OUTREACH_WORKER_ENABLED==='true';
const dayStart=now=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
const tomorrow=now=>new Date(+dayStart(now)+86400000);
async function ensureRuntime(){try{await Runtime.updateOne({_id:'global'},{$setOnInsert:{leaseUntil:new Date(0),nextAllowedAt:new Date(0)}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}}
async function note(campaignId,state,reason,now,extra={}){
  return Campaign.updateOne({_id:campaignId,state:{$in:active}},{$set:{state,reason,...extra},$push:{events:{$each:[{at:now,action:state,reason}],$slice:-200}}});
}
async function recoverExpired(now){
  const stale=await Dispatch.find({status:'sending',leaseUntil:{$lte:now}}).lean();
  for(const row of stale){
    const result=await Dispatch.updateOne({_id:row._id,status:'sending',leaseUntil:{$lte:now}},{$set:{status:'unknown_outcome',reason:'Worker interrupted beyond send boundary; reconcile provider history before any further send'}});
    if(result.modifiedCount)await Campaign.updateOne({_id:row.campaignId,state:{$ne:'cancelled'}},{$set:{state:'needs_review',reason:'Unresolved delivery outcome; automatic retry blocked'},$push:{events:{$each:[{at:now,action:'unknown_outcome'}],$slice:-200}}});
  }
  // Repair a crash between dispatch and campaign updates, independently of
  // whether this process observed the original sending lease expiration.
  const unresolved=await Dispatch.distinct('campaignId',{status:'unknown_outcome'});
  if(unresolved.length)await Campaign.updateMany({_id:{$in:unresolved},state:{$nin:['cancelled','needs_review']}},{$set:{state:'needs_review',reason:'Unresolved delivery outcome; automatic retry blocked'}});
}
async function quotaAvailable(campaign,user,now){
  const start=dayStart(now),legacy={sentAt:{$gte:start},status:{$in:['sent','delivered']},dispatchId:{$exists:false}};
  const [global,legacyGlobal,owner,legacyOwner,account,legacyAccount,perCampaign]=await Promise.all([
    Dispatch.countDocuments({startedAt:{$gte:start}}),MailLog.countDocuments(legacy),
    Dispatch.countDocuments({userId:user._id,startedAt:{$gte:start}}),MailLog.countDocuments({...legacy,userId:user._id}),
    Dispatch.countDocuments({senderEmail:campaign.snapshot.senderEmail,startedAt:{$gte:start}}),MailLog.countDocuments({...legacy,senderEmail:campaign.snapshot.senderEmail}),
    Dispatch.countDocuments({campaignId:campaign._id,startedAt:{$gte:start}})
  ]);
  if(global+legacyGlobal>=configuredLimit('OUTREACH_GLOBAL_MAX_DAILY',10))return 'Global daily cap reached (UTC day)';
  const cap=Math.min(user.dailyEmailLimit||10,configuredLimit('OUTREACH_MAX_DAILY',10));
  if(owner+legacyOwner>=cap||account+legacyAccount>=cap||perCampaign>=campaign.snapshot.dailyLimit)return 'User, sender or campaign daily cap reached (UTC day)';
  return null;
}
async function finishCampaign(campaign,now){
  if(await Dispatch.exists({campaignId:campaign._id,revision:campaign.revision,status:'queued'}))return;
  if(await Dispatch.exists({campaignId:campaign._id,status:{$in:['sending','unknown_outcome']}}))return;
  await note(campaign._id,'completed','All approved recipients processed',now);
}
async function runCampaignWorkerOnce({now:fixedNow,clock=()=>fixedNow?new Date(fixedNow):new Date(),send,enabled=gates}={}){
  let now=clock();await ensureRuntime();await Runtime.updateOne({_id:'global'},{$set:{lastPollAt:now}});
  // Recovery is conservative even when real sending is disabled.
  await recoverExpired(now);
  if(!enabled())return {status:'disabled'};
  const token=crypto.randomUUID();
  const lock=await Runtime.findOneAndUpdate({_id:'global',leaseUntil:{$lte:now}},{$set:{leaseToken:token,leaseUntil:new Date(+now+LEASE_MS)}},{returnDocument:'after'});
  if(!lock)return {status:'busy'};
  const ownership={_id:'global',leaseToken:token};
  try{
    // An expired SMTP attempt cannot be externally fenced. Hold the shared lane
    // until its outcome is reconciled, including across different campaigns.
    if(await Dispatch.exists({status:'unknown_outcome'}))return {status:'needs_review'};
    if(lock.nextAllowedAt>now)return {status:'cooldown',nextAt:lock.nextAllowedAt};
    const campaign=await Campaign.findOne({state:{$in:active},nextAt:{$lte:now}}).sort({nextAt:1}).lean();
    if(!campaign)return {status:'idle'};
    const grace=configuredLimit('OUTREACH_MISSED_GRACE_MINUTES',15,1440)*60000;
    if(+now-+campaign.nextAt>grace){await note(campaign._id,'needs_review','missed_schedule: worker was offline or queue inactive; owner must confirm resumption',now);return {status:'missed_schedule'};}
    if(!campaign.approvedDigest || campaign.approvedDigest!==campaign.digest || digest(campaign.snapshot)!==campaign.approvedDigest){await note(campaign._id,'needs_review','Approval snapshot no longer matches',now);return {status:'approval_invalid'};}
    const user=await User.findById(campaign.userId);
    if(!user){await note(campaign._id,'needs_review','Sender owner missing',now);return {status:'sender_missing'};}
    let sender;
    try{sender=resolveSender(user,campaign.snapshot.senderId);}catch{await note(campaign._id,'needs_review','Approved sender no longer configured',now);return {status:'sender_missing'};}
    if(sender.email!==campaign.snapshot.senderEmail||sender.name!==campaign.snapshot.senderName||sender.host!==campaign.snapshot.senderHost||sender.port!==campaign.snapshot.senderPort){await note(campaign._id,'needs_review','Sender identity changed; fresh approval required',now);return {status:'sender_changed'};}
    const quota=await quotaAvailable(campaign,user,now);
    if(quota){await note(campaign._id,campaign.state,quota,now,{nextAt:tomorrow(now)});return {status:'daily_limit'};}
    const row=await Dispatch.findOne({campaignId:campaign._id,revision:campaign.revision,status:'queued'}).sort({_id:1}).lean();
    if(!row){await finishCampaign(campaign,now);return {status:'complete'};}
    const approved=campaign.snapshot.recipients.find(r=>r.contactId===String(row.contactId));
    if(!approved||row.approvedDigest!==campaign.approvedDigest||approved.recipientEmail!==row.recipientEmail||approved.subject!==row.subject||approved.body!==row.body||row.senderEmail!==sender.email){await note(campaign._id,'needs_review','Dispatch differs from exact approved message',now);return {status:'approval_invalid'};}
    const contact=await Contact.findOne({_id:row.contactId,userId:campaign.userId}).lean();
    let blocked=await recipientReason(user,contact,approved,now,row._id);
    if(contact && normalizeEmail(contact.email)!==row.recipientEmail)blocked='Recipient address changed after approval';
    if(blocked){await Dispatch.updateOne({_id:row._id,status:'queued'},{$set:{status:'suppressed',reason:blocked,finishedAt:now}});await finishCampaign(campaign,now);return {status:'suppressed',reason:blocked};}
    // No arbitrary hooks or network calls between final current-state checks and
    // the persisted boundary. A pause/cancel after this CAS may leave this one
    // in-flight request; it always stops further recipients.
    now=clock();if(!enabled())return {status:'disabled'};
    const renewed=await Runtime.updateOne({...ownership,leaseUntil:{$gt:now}},{$set:{leaseUntil:new Date(+now+LEASE_MS)}});
    if(!renewed.matchedCount)return {status:'lease_lost'};
    const boundary=await Campaign.updateOne({_id:campaign._id,state:{$in:active},revision:campaign.revision,approvedDigest:campaign.approvedDigest},{$set:{state:'running',startedAt:campaign.startedAt||now,activeDispatchId:row._id,sendBoundaryAt:now,nextAt:new Date(+now+campaign.snapshot.intervalSeconds*1000)}});
    if(!boundary.matchedCount)return {status:'stopped'};
    const claimed=await Dispatch.findOneAndUpdate({_id:row._id,status:'queued'},{$set:{status:'sending',leaseToken:token,leaseUntil:new Date(+now+LEASE_MS),startedAt:now},$inc:{attempts:1}},{returnDocument:'after'});
    if(!claimed)return {status:'already_claimed'};
    const finalTime=clock();
    const fenced=await Runtime.updateOne({...ownership,leaseUntil:{$gt:finalTime}},{$set:{nextAllowedAt:new Date(+finalTime+campaign.snapshot.intervalSeconds*1000),lastDispatchAt:finalTime}});
    if(!fenced.matchedCount || !enabled()){
      await Dispatch.updateOne({_id:row._id,status:'sending',leaseToken:token},{$set:{status:'unknown_outcome',reason:'Final lease or sending gate lost; provider call not made by this worker'}});
      await note(campaign._id,'needs_review','Send boundary interrupted; reconcile before further dispatch',finalTime);
      return {status:!enabled()?'disabled':'lease_lost'};
    }
    // All exceptions after the boundary are ambiguous unless acceptance is
    // persisted. Never retry SMTP based on a timeout or a guessed failure.
    try{
      const deliver=send||require('./campaignTransportService').sendScheduledMessage;
      const result=await deliver(sender,claimed.toObject());
      if(!result?.providerMessageId)throw new Error('Missing provider acceptance identifier');
      const accepted=await Dispatch.updateOne({_id:row._id,status:{$in:['sending','unknown_outcome']},leaseToken:token},{$set:{status:'sent',providerMessageId:String(result.providerMessageId).slice(0,500),finishedAt:clock(),reason:''}});
      if(!accepted.matchedCount)throw new Error('Dispatch acceptance could not be durably recorded');
      await MailLog.updateOne({dispatchId:row._id},{$setOnInsert:{campaignId:campaign._id,dispatchId:row._id,userId:campaign.userId,contactId:row.contactId,recipientEmail:row.recipientEmail,senderEmail:sender.email,subject:row.subject,body:row.body,messageHash:digest({recipient:row.recipientEmail,subject:row.subject,body:row.body}),status:'sent',providerMessageId:result.providerMessageId,sentAt:now}},{upsert:true});
      await Contact.updateOne({_id:row.contactId,userId:campaign.userId,status:{$in:['pending','failed','follow_up_later']}},{$set:{status:'sent',lastMailedAt:now}});
      await finishCampaign(campaign,now);
      return {status:'sent',dispatchId:row._id};
    }catch(error){
      await Dispatch.updateOne({_id:row._id,status:'sending',leaseToken:token},{$set:{status:'unknown_outcome',reason:'Provider outcome uncertain; compare provider history before manual reconciliation'}});
      await note(campaign._id,'needs_review','Provider outcome uncertain; no automatic retry',clock());
      await Runtime.updateOne(ownership,{$set:{lastError:'Delivery or persistence error; campaign requires review'}});
      return {status:'unknown_outcome',dispatchId:row._id};
    }
  }finally{await Runtime.updateOne(ownership,{$set:{leaseUntil:new Date(0)},$unset:{leaseToken:1}});}
}
function initCampaignScheduler(){
  if(process.env.OUTREACH_WORKER_ENABLED!=='true')return;
  // Cron is merely a wake-up signal; every schedule, cooldown and claim lives in Mongo.
  const tick=()=>runCampaignWorkerOnce().catch(()=>console.error('Outreach worker failed; inspect durable queue status'));
  tick();return require('node-cron').schedule('*/30 * * * * *',tick,{timezone:'UTC'});
}
module.exports={runCampaignWorkerOnce,initCampaignScheduler,recoverExpired,quotaAvailable};

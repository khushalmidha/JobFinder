const crypto=require('node:crypto');
const mongoose=require('mongoose');
const User=require('../models/User'), Contact=require('../models/Contact'), Company=require('../models/Company');
const Campaign=require('../models/OutreachCampaign'), Dispatch=require('../models/OutreachDispatch'), MailLog=require('../models/MailLog');
const {contactBlockReason}=require('./outreachResearchService');
const {qualifyCompany}=require('./salaryEvidenceService');
const RecipientSuppression=require('../models/RecipientSuppression');
const {localTimeToUtc}=require('./campaignTimeService');
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const validEmail=value=>/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(value) && !value.includes('..');
const stable=value=>Array.isArray(value)?value.map(stable):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const objectId=id=>{if(!mongoose.isValidObjectId(id))throw new Error('Invalid record ID');return id;};
function configuredLimit(name,fallback,max=450){const v=Number(process.env[name]);return Number.isInteger(v)&&v>0?Math.min(v,max):fallback;}
function senderOptions(user) {
  const options=(user.smtpConfigs||[]).filter(s=>s.user && s.host && s.pass).map(s=>({id:String(s._id),email:normalizeEmail(s.user),name:s.name||s.user,host:s.host,port:Number(s.port)||465,provider:'smtp'}));
  if(user.smtpConfig?.user && user.smtpConfig?.pass && !options.some(s=>s.email===normalizeEmail(user.smtpConfig.user))) options.push({id:'legacy-smtp',email:normalizeEmail(user.smtpConfig.user),name:'Saved SMTP account',host:user.smtpConfig.host,port:Number(user.smtpConfig.port)||465,provider:'smtp'});
  return options.filter(s=>validEmail(s.email));
}
function resolveSender(user,id) {
  const option=senderOptions(user).find(s=>s.id===id);
  if(!option)throw new Error('Choose an existing owned SMTP sender with complete credentials');
  return {...option,config:id==='legacy-smtp'?user.smtpConfig:user.smtpConfigs.find(s=>String(s._id)===id)};
}
async function duplicateReason(userId,contactId,email,excludeDispatchId) {
  if(await MailLog.exists({userId,status:{$in:['sent','delivered']},$or:[{contactId},{recipientEmail:email}]}))return 'Already sent: contact or recipient history';
  if(await Dispatch.exists({userId,recipientEmail:email,status:{$in:['sending','sent','unknown_outcome']},...(excludeDispatchId?{_id:{$ne:excludeDispatchId}}:{})}))return 'Previous send or unresolved delivery outcome';
  return null;
}
async function recipientReason(user,contact,row,now=new Date(),dispatchId) {
  if(!contact || String(contact.userId)!==String(user._id))return 'Owned contact not found';
  if(!validEmail(normalizeEmail(contact.email)))return 'Unsupported or invalid recipient syntax';
  if(await RecipientSuppression.exists({userId:user._id,email:normalizeEmail(contact.email)}))return 'Recipient has a persistent suppression record';
  const blocked=contactBlockReason(contact);if(blocked)return blocked;
  if(!['publicly_sourced','vendor_verified'].includes(contact.verificationStatus))return 'Individual recruiting contact requires public or provider evidence';
  if((user.blockedCompanies||[]).some(c=>c.toLowerCase()===contact.company.toLowerCase()))return 'Company is on your do-not-contact list';
  // Duplicate contact rows cannot bypass an existing suppression for this owner.
  const same=await Contact.find({userId:user._id,email:{$regex:`^${normalizeEmail(contact.email).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,$options:'i'}}).lean();
  if(same.some(c=>c.optOutAt||c.suppressedAt||c.deliverabilityStatus==='invalid'||['bounced','removed','replied','reply_received','positive_response','negative_response'].includes(c.status)))return 'Recipient suppressed or replied in another contact record';
  const company=contact.companyId?await Company.findById(contact.companyId).lean():null;
  if(qualifyCompany(company||{},now).qualificationStatus!=='qualified' && row.overrideSalary!==true)return 'Company fixed-base qualification is unverified; explicit research override required';
  return duplicateReason(user._id,contact._id,normalizeEmail(contact.email),dispatchId);
}
async function previewCampaign(userId,input,now=new Date()) {
  const user=await User.findById(userId);if(!user)throw new Error('User not found');
  const sender=resolveSender(user,String(input.senderId||''));
  const timezone=input.timezone||'Asia/Kolkata';
  const isImmediate=input.immediate===true||input.mode==='immediate';
  let start;
  if(isImmediate) {
    start = input.startAtUtc ? new Date(input.startAtUtc) : (input.localDateTime ? localTimeToUtc(input.localDateTime, timezone) : now);
  } else {
    start = localTimeToUtc(input.localDateTime, timezone);
    if(start<=now)throw new Error('Choose a future start time');
    if(start-now>366*86400000)throw new Error('Schedule within the next year');
  }
  const dailyLimit=input.dailyLimit??Math.min(user.dailyEmailLimit||450,configuredLimit('OUTREACH_MAX_DAILY',450)),intervalSeconds=input.intervalSeconds??180;
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>Math.min(user.dailyEmailLimit||450,configuredLimit('OUTREACH_MAX_DAILY',450)))throw new Error('Daily limit exceeds configured sender safety limit');
  if(!Number.isInteger(intervalSeconds)||intervalSeconds<180||intervalSeconds>86400)throw new Error('Use an interval between 180 and 86400 seconds');
  if(!Array.isArray(input.recipients)||input.recipients.length<1||input.recipients.length>1000)throw new Error('Select 1 to 1000 recipients');
  const blocked=[],recipients=[],emails=new Set();
  const contacts=await Contact.find({userId,_id:{$in:input.recipients.map(r=>objectId(r.contactId))}}).lean();
  const map=new Map(contacts.map(c=>[String(c._id),c]));
  for(const row of input.recipients){
    const contact=map.get(String(row.contactId)),email=normalizeEmail(contact?.email);
    let reason=await recipientReason(user,contact,row,now);
    if(!reason && emails.has(email))reason='Duplicate recipient in selection';
    if(typeof row.subject!=='string'||!row.subject.trim()||/[\r\n]/.test(row.subject)||row.subject.length>200||typeof row.body!=='string'||!row.body.trim()||row.body.length>10000)reason='Valid subject (up to 200 characters) and body (up to 10000) required';
    if(reason){blocked.push({contactId:String(row.contactId),email,reason});continue;}
    emails.add(email);
    recipients.push({contactId:String(contact._id),recipientEmail:email,company:contact.company,subject:row.subject,body:row.body,overrideSalary:row.overrideSalary===true});
  }
  const snapshot={name:String(input.name||(isImmediate?'Immediate outreach':'Recruitment outreach')).trim().slice(0,120),senderId:sender.id,senderEmail:sender.email,senderName:sender.name,senderHost:sender.host,senderPort:sender.port,provider:sender.provider,timezone,localDateTime:input.localDateTime||null,startAtUtc:start.toISOString(),immediate:isImmediate,dailyLimit,intervalSeconds,recipients};
  return {snapshot,digest:digest(snapshot),blocked,startAtUtc:start.toISOString(),immediate:isImmediate,estimatedMinutes:Math.max(0,recipients.length-1)*intervalSeconds/60,minimumDays:Math.ceil(recipients.length/dailyLimit),costEstimate:'INR 0 additional infrastructure/API credits; existing SMTP provider terms apply',quotaDay:'UTC'};
}
async function saveCampaign(userId,input,existingId,now=new Date()) {
  const preview=await previewCampaign(userId,input,now);
  if(preview.blocked.length || !preview.snapshot.recipients.length)throw new Error('Remove blocked recipients before saving: '+preview.blocked.map(r=>r.reason).join('; '));
  if(!existingId)return Campaign.create({userId,name:preview.snapshot.name,snapshot:preview.snapshot,digest:preview.digest,startAtUtc:preview.startAtUtc,nextAt:preview.startAtUtc,events:[{at:now,action:'draft_saved'}]});
  const updated=await Campaign.findOneAndUpdate({_id:objectId(existingId),userId,state:{$in:['draft','scheduled','paused','needs_review']},startedAt:{$exists:false}},{$set:{snapshot:preview.snapshot,name:preview.snapshot.name,digest:preview.digest,startAtUtc:preview.startAtUtc,nextAt:preview.startAtUtc,state:'draft',reason:''},$unset:{approvedDigest:1,approvedAt:1,approvedBy:1},$inc:{revision:1},$push:{events:{$each:[{at:now,action:'edited_approval_invalidated'}],$slice:-200}}},{returnDocument:'after'});
  if(!updated)throw new Error('Only an unstarted owned campaign can be edited');
  await Dispatch.updateMany({campaignId:updated._id,revision:{$lt:updated.revision},status:'queued'},{$set:{status:'cancelled',reason:'Campaign edited; approval invalidated'}});
  return updated;
}
async function approveCampaign(userId,id,approvedDigest,now=new Date()) {
  const campaign=await Campaign.findOne({_id:objectId(id),userId});if(!campaign)throw new Error('Campaign not found');
  if(campaign.state!=='draft'||campaign.digest!==approvedDigest||digest(campaign.snapshot)!==approvedDigest)throw new Error('Preview changed; review the exact saved campaign again');
  const check=await previewCampaign(userId,{...campaign.snapshot,recipients:campaign.snapshot.recipients},now);
  if(check.blocked.length||check.digest!==approvedDigest)throw new Error('Sender, recipient or evidence changed; edit and preview again');
  const rows=campaign.snapshot.recipients.map(r=>({campaignId:campaign._id,userId,contactId:r.contactId,revision:campaign.revision,recipientEmail:r.recipientEmail,subject:r.subject,body:r.body,senderEmail:campaign.snapshot.senderEmail,approvedDigest,scheduledAtUtc:campaign.startAtUtc,providerIdempotencyKey:digest({campaignId:String(campaign._id),recipient:r.recipientEmail,revision:campaign.revision})}));
  // Upsert dispatches first. They remain inert until the campaign CAS succeeds.
  await Dispatch.bulkWrite(rows.map(r=>({updateOne:{filter:{campaignId:r.campaignId,recipientEmail:r.recipientEmail,revision:r.revision},update:{$setOnInsert:r},upsert:true}})));
  const nextAt = campaign.snapshot.immediate ? now : campaign.startAtUtc;
  const updated=await Campaign.findOneAndUpdate({_id:campaign._id,userId,state:'draft',digest:approvedDigest,revision:campaign.revision},{$set:{state:'scheduled',approvedDigest,approvedBy:userId,approvedAt:now,nextAt,reason:''},$push:{events:{$each:[{at:now,action:'exact_campaign_approved'}],$slice:-200}}},{returnDocument:'after'});
  if(!updated)throw new Error('Campaign changed during approval; review again');
  return updated;
}
async function controlCampaign(userId,id,action,now=new Date()) {
  const campaign=await Campaign.findOne({_id:objectId(id),userId});if(!campaign)throw new Error('Campaign not found');
  const states={pause:['scheduled','running'],resume:['paused','needs_review'],cancel:['draft','scheduled','running','paused','needs_review','failed']};
  if(!states[action]?.includes(campaign.state))throw new Error('Campaign state does not permit this action');
  if(action==='resume'){
    if(campaign.digest!==campaign.approvedDigest || digest(campaign.snapshot)!==campaign.approvedDigest)throw new Error('Campaign needs a fresh exact approval');
    if(await Dispatch.exists({campaignId:campaign._id,status:'unknown_outcome'}))throw new Error('Resolve unknown outcomes before resuming; no automatic retry');
  }
  const state=action==='pause'?'paused':action==='cancel'?'cancelled':campaign.startedAt?'running':'scheduled';
  const set={state,reason:action==='resume'?'Owner explicitly confirmed resumption':`Owner ${action}`};
  // Explicit resumption acknowledges missed/offline time without changing content.
  if(action==='resume')set.nextAt=new Date(Math.max(+now,+campaign.startAtUtc));
  const updated=await Campaign.findOneAndUpdate({_id:campaign._id,userId,state:campaign.state,revision:campaign.revision},{$set:set,$push:{events:{$each:[{at:now,action}],$slice:-200}}},{returnDocument:'after'});
  if(!updated)throw new Error('Campaign changed; refresh status');
  if(action==='cancel')await Dispatch.updateMany({campaignId:campaign._id,status:'queued'},{$set:{status:'cancelled',reason:'Owner cancelled'}});
  return updated;
}
module.exports={normalizeEmail,validEmail,digest,objectId,configuredLimit,senderOptions,resolveSender,recipientReason,duplicateReason,previewCampaign,saveCampaign,approveCampaign,controlCampaign};

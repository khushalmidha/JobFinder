const crypto=require('node:crypto');
const mongoose=require('mongoose');
const User=require('../models/User'), Contact=require('../models/Contact'), Company=require('../models/Company');
const Campaign=require('../models/OutreachCampaign'), Dispatch=require('../models/OutreachDispatch'), MailLog=require('../models/MailLog'), DeliveryLedger=require('../models/DeliveryLedger');
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
const senderCap=user=>Math.min(user.dailyEmailLimit||450,configuredLimit('OUTREACH_MAX_DAILY',450));
const senderIdentity=sender=>({id:sender.id,email:sender.email,name:sender.name,host:sender.host,port:sender.port,provider:sender.provider});
function senderPolicy(user,input){
  if(input.autoSwitchSenders!==undefined&&typeof input.autoSwitchSenders!=='boolean')throw new Error('Sender fallback needs explicit approval');
  if(input.autoSwitchSenders!==true){if(input.fallbackSenderIds?.length)throw new Error('Enable automatic sender switching before selecting fallback accounts');return null;}
  if(!Array.isArray(input.fallbackSenderIds)||input.fallbackSenderIds.length<1||input.fallbackSenderIds.length>9||input.fallbackSenderIds.some(id=>typeof id!=='string'))throw new Error('Select 1 to 9 additional owned sender accounts');
  const ids=[String(input.senderId),...input.fallbackSenderIds];if(new Set(ids).size!==ids.length)throw new Error('Select each sender only once');
  const pool=ids.map(id=>({...senderIdentity(resolveSender(user,id)),dailyLimit:senderCap(user)}));
  const {senderQuotaKey}=require('./senderQuotaService');if(new Set(pool.map(s=>senderQuotaKey(s.email))).size!==pool.length)throw new Error('Aliases of the same mailbox share one quota; choose distinct sender accounts');
  if(pool.some(s=>!s.host||![465,587].includes(s.port)))throw new Error('Approved sender accounts require SMTP TLS port 465 or 587');
  return {autoSwitchSenders:true,fallbackSenderIds:[...input.fallbackSenderIds],approvedSenders:pool};
}
function resolveApprovedSenders(user,snapshot){
  if(snapshot.autoSwitchSenders!==true)return [resolveSender(user,snapshot.senderId)];
  const current=senderPolicy(user,snapshot);if(!Array.isArray(snapshot.approvedSenders)||current.approvedSenders.length!==snapshot.approvedSenders.length)throw new Error('Approved sender pool changed');
  return current.approvedSenders.map((entry,index)=>{
    const frozen=snapshot.approvedSenders[index];if(!Number.isInteger(frozen.dailyLimit)||frozen.dailyLimit<1||frozen.dailyLimit>450)throw new Error('Invalid approved sender cap');if(digest(senderIdentity(entry))!==digest(senderIdentity(frozen)))throw new Error('Approved sender identity changed');
    const sender=resolveSender(user,entry.id);return {...sender,dailyLimit:Math.min(entry.dailyLimit,frozen.dailyLimit)};
  });
}
async function duplicateReason(userId,contactId,email,excludeDispatchId,allowPreviouslyContacted=false,excludeCampaignId) {
  if(!allowPreviouslyContacted&&await MailLog.exists({userId,status:{$in:['sent','delivered']},$or:[{contactId},{recipientEmail:email}]}))return 'Already sent: contact or recipient history';
  if(!allowPreviouslyContacted&&await DeliveryLedger.exists({userId,status:{$in:['sent','delivered']},$or:[{contactId},{recipientEmail:email}]}))return 'Already sent: contact or recipient history';
  if(await Dispatch.exists({userId,recipientEmail:email,status:{$in:allowPreviouslyContacted?['sending','unknown_outcome']:['sending','sent','unknown_outcome']},...(excludeDispatchId?{_id:{$ne:excludeDispatchId}}:{})}))return 'Previous send or unresolved delivery outcome';
  if(allowPreviouslyContacted&&await Dispatch.exists({userId,recipientEmail:email,status:'queued',...(excludeCampaignId?{campaignId:{$ne:excludeCampaignId}}:{}),...(excludeDispatchId?{_id:{$ne:excludeDispatchId}}:{})}))return 'Recipient already queued in another campaign';
  return null;
}
function permanentContactReason(contact){
  if(!contact)return 'Contact not found';
  if(contact.vendorStatus==='invalid'||contact.verificationStatus==='invalid'||contact.deliverabilityStatus==='invalid'||contact.hygieneDisposition==='confirmed_invalid'||contact.smtpConnectivity?.domainStatus==='null_mx')return 'Confirmed-invalid contact';
  if(contact.optOutAt||contact.suppressedAt||contact.repliedAt||['bounced','removed','replied','reply_received','positive_response','negative_response'].includes(contact.status))return 'Contact suppressed or already replied';
  return null;
}
function trustedMailboxStatus(proof,email){
  return proof?.outcome==='valid'&&new Date(proof.expiresAt)>new Date()&&require('./smtpConnectivityService').syntaxDisposition(email)==='supported'?'verified':'unverified';
}
async function previewEvidence(user,contacts,excludeCampaignId) {
  const ids=contacts.map(c=>c._id),emails=[...new Set(contacts.map(c=>normalizeEmail(c.email)))];
  const historyFilter={userId:user._id,status:{$in:['sent','delivered']},$or:[{contactId:{$in:ids}},{recipientEmail:{$in:emails}}]};
  const [suppressions,same,companies,logs,ledger,dispatches,proofs]=await Promise.all([
    RecipientSuppression.find({userId:user._id,email:{$in:emails}}).select('email').lean(),
    // Include all owned email spellings to retain case-insensitive duplicate suppression.
    Contact.find({userId:user._id}).select('email optOutAt suppressedAt deliverabilityStatus verificationStatus vendorStatus hygieneDisposition smtpConnectivity.domainStatus repliedAt status').lean(),
    Company.find({_id:{$in:contacts.filter(c=>c.companyId).map(c=>c.companyId)}}).lean(),
    MailLog.find(historyFilter).select('contactId recipientEmail').lean(),
    DeliveryLedger.find(historyFilter).select('contactId recipientEmail').lean(),
    Dispatch.find({userId:user._id,recipientEmail:{$in:emails},status:{$in:['queued','sending','sent','unknown_outcome']}}).select('recipientEmail status campaignId').lean(),
    require('../models/MailboxProof').find({userId:user._id,email:{$in:emails}}).sort({checkedAt:-1,_id:-1}).lean()
  ]);
  const latestProofs=new Map();for(const proof of proofs)if(!latestProofs.has(proof.email))latestProofs.set(proof.email,proof);
  return {
    proofs:latestProofs,
    suppressed:new Set(suppressions.map(c=>c.email)),
    blockedDuplicates:new Set(same.filter(c=>permanentContactReason(c)).map(c=>normalizeEmail(c.email))),
    companies:new Map(companies.map(c=>[String(c._id),c])),
    sentIds:new Set([...logs,...ledger].map(c=>String(c.contactId))),
    sentEmails:new Set([...logs,...ledger].map(c=>c.recipientEmail)),
    sentDispatchEmails:new Set(dispatches.filter(c=>c.status==='sent').map(c=>c.recipientEmail)),
    inFlightEmails:new Set(dispatches.filter(c=>['sending','unknown_outcome'].includes(c.status)).map(c=>c.recipientEmail)),
    otherQueuedEmails:new Set(dispatches.filter(c=>c.status==='queued'&&String(c.campaignId)!==String(excludeCampaignId)).map(c=>c.recipientEmail)),
    uncertainEmails:new Set(dispatches.filter(c=>c.status!=='queued').map(c=>c.recipientEmail))
  };
}
async function recipientReason(user,contact,row,now=new Date(),dispatchId,evidence,currentCampaignId) {
  if(!contact || String(contact.userId)!==String(user._id))return 'Owned contact not found';
  if(!validEmail(normalizeEmail(contact.email)))return 'Unsupported or invalid recipient syntax';
  if(evidence?evidence.suppressed.has(normalizeEmail(contact.email)):await RecipientSuppression.exists({userId:user._id,email:normalizeEmail(contact.email)}))return 'Recipient has a persistent suppression record';
  const hardBlock=permanentContactReason(contact);if(hardBlock)return hardBlock;
  const proof=evidence?evidence.proofs.get(normalizeEmail(contact.email)):await require('./contactAdmissionService').latestProof(user._id,contact.email);
  if(proof?.outcome==='invalid')return 'Trusted verifier reports invalid mailbox';
  const allowUnverified=row.allowUnverifiedContact===true;
  if(!allowUnverified&&require('./contactAdmissionService').enabled()&&trustedMailboxStatus(proof,contact.email)!=='verified')return 'Fresh trusted mailbox verification required';
  if(!allowUnverified){
    const blocked=contactBlockReason(contact);if(blocked)return blocked;
    if(!['publicly_sourced','vendor_verified'].includes(contact.verificationStatus))return 'Individual recruiting contact requires public or provider evidence';
  }
  if((user.blockedCompanies||[]).some(c=>require('./companyIdentityService').companyKey(c)===require('./companyIdentityService').companyKey(contact.company)))return 'Company is on your do-not-contact list';
  // Duplicate contact rows cannot bypass an existing suppression for this owner.
  const email=normalizeEmail(contact.email);
  if(evidence){
    if(evidence.blockedDuplicates.has(email))return 'Recipient suppressed or replied in another contact record';
  }else{
    const same=await Contact.find({userId:user._id,email:{$regex:`^${email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,$options:'i'}}).lean();
    if(same.some(c=>permanentContactReason(c)))return 'Recipient suppressed or replied in another contact record';
  }
  const company=evidence?evidence.companies.get(String(contact.companyId)):(contact.companyId?await Company.findById(contact.companyId).lean():null);
  if(qualifyCompany(company||{},now).qualificationStatus!=='qualified' && row.overrideSalary!==true)return 'Company fixed-base qualification is unverified; explicit research override required';
  if(evidence){
    if(row.allowPreviouslyContacted!==true&&(evidence.sentIds.has(String(contact._id))||evidence.sentEmails.has(email)))return 'Already sent: contact or recipient history';
    if(row.allowPreviouslyContacted===true&&evidence.otherQueuedEmails.has(email))return 'Recipient already queued in another campaign';
    if((row.allowPreviouslyContacted===true?evidence.inFlightEmails:evidence.uncertainEmails).has(email))return 'Previous send or unresolved delivery outcome';
    return null;
  }
  return duplicateReason(user._id,contact._id,email,dispatchId,row.allowPreviouslyContacted===true,currentCampaignId);
}
async function previewCampaign(userId,input,now=new Date(),{excludeCampaignId}={}) {
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
  if(input.allowPreviouslyContacted!==undefined&&typeof input.allowPreviouslyContacted!=='boolean')throw new Error('Choose previously-contacted sending explicitly');
  if(input.allowUnverifiedContacts!==undefined&&typeof input.allowUnverifiedContacts!=='boolean')throw new Error('Choose whether to include unverified contacts explicitly');
  if(input.pauseOnDailyLimit!==undefined&&typeof input.pauseOnDailyLimit!=='boolean')throw new Error('Invalid daily-limit pause choice');
  if(input.pauseOnDailyLimit===true&&input.autoSwitchSenders===true)throw new Error('Choose automatic switching or pause at the daily limit');
  const policy=senderPolicy(user,input),maximum=senderCap(user)*(policy?.approvedSenders.length||1);
  const dailyLimit=input.dailyLimit??maximum,intervalSeconds=input.intervalSeconds??3;
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>maximum)throw new Error('Daily limit exceeds configured sender safety limit');
  if(!Number.isInteger(intervalSeconds)||intervalSeconds<3||intervalSeconds>86400)throw new Error('Use an interval between 3 and 86400 seconds');
  // Queue size is independent of daily dispatch budgets; never truncate the approved selection.
  if(!Array.isArray(input.recipients)||input.recipients.length<1)throw new Error('Select at least one recipient');
  const blocked=[],recipients=[],emails=new Set();
  const validIds=input.recipients.map(r=>mongoose.isValidObjectId(r.contactId)?r.contactId:null).filter(Boolean);
  const contacts=validIds.length?await Contact.find({userId,_id:{$in:validIds}}).lean():[];
  const map=new Map(contacts.map(c=>[String(c._id),c]));
  const evidence=await previewEvidence(user,contacts,excludeCampaignId);
  // Bound concurrent evidence reads without imposing a queue-size cap. Keep output
  // ordering deterministic so previews, duplicate exclusions and digests are stable.
  for(let offset=0;offset<input.recipients.length;offset+=25){
    const checked=await Promise.all(input.recipients.slice(offset,offset+25).map(async row=>{
      const contact=map.get(String(row.contactId)),email=contact?.email?normalizeEmail(contact.email):null;
      return {row,contact,email,reason:await recipientReason(user,contact, {...row,allowUnverifiedContact:input.allowUnverifiedContacts===true,allowPreviouslyContacted:input.allowPreviouslyContacted===true},now,undefined,evidence)};
    }));
    for(const {row,contact,email,reason:checkedReason} of checked){
      let reason=checkedReason;
      if(!reason && email && emails.has(email))reason='Duplicate recipient in selection';
      if(typeof row.subject!=='string'||!row.subject.trim()||/[\r\n]/.test(row.subject)||row.subject.length>200||typeof row.body!=='string'||!row.body.trim()||row.body.length>10000)reason='Valid subject (up to 200 characters) and body (up to 10000) required';
      if(reason){blocked.push({contactId:String(row.contactId),email:contact?email:null,reason});continue;}
      if(email)emails.add(email);
      recipients.push({contactId:String(contact._id),recipientEmail:email,company:contact.company,subject:row.subject,body:row.body,overrideSalary:row.overrideSalary===true,...(input.allowUnverifiedContacts===true?{allowUnverifiedContact:true,mailboxStatus:trustedMailboxStatus(evidence.proofs.get(email),email),contactEvidenceStatus:contact.verificationStatus||'unknown',inferred:contact.inferenceFlag===true}:{}),...(input.allowPreviouslyContacted===true?{allowPreviouslyContacted:true,previouslyContacted:evidence.sentIds.has(String(contact._id))||evidence.sentEmails.has(email)||evidence.sentDispatchEmails.has(email)}:{})});
    }
  }
  const snapshot={name:String(input.name||(isImmediate?'Immediate outreach':'Recruitment outreach')).trim().slice(0,120),senderId:sender.id,senderEmail:sender.email,senderName:sender.name,senderHost:sender.host,senderPort:sender.port,provider:sender.provider,timezone,localDateTime:input.localDateTime||null,startAtUtc:start.toISOString(),immediate:isImmediate,dailyLimit,intervalSeconds,recipients,...(policy||{}),...(input.pauseOnDailyLimit===true?{pauseOnDailyLimit:true}:{}),...(input.allowUnverifiedContacts===true?{allowUnverifiedContacts:true}:{}),...(input.allowPreviouslyContacted===true?{allowPreviouslyContacted:true}:{})};
  return {snapshot,digest:digest(snapshot),blocked,startAtUtc:start.toISOString(),immediate:isImmediate,estimatedMinutes:Math.max(0,recipients.length-1)*intervalSeconds/60,minimumDays:Math.ceil(recipients.length/dailyLimit),costEstimate:'INR 0 additional infrastructure/API credits; existing SMTP provider terms apply',quotaDay:'UTC'};
}
async function saveCampaign(userId,input,existingId,now=new Date()) {
  const preview=await previewCampaign(userId,input,now,{excludeCampaignId:existingId});
  if(preview.blocked.length || !preview.snapshot.recipients.length)throw new Error('Remove blocked recipients before saving: '+preview.blocked.map(r=>r.reason).join('; '));
  if(!existingId)return Campaign.create({userId,name:preview.snapshot.name,snapshot:preview.snapshot,digest:preview.digest,startAtUtc:preview.startAtUtc,nextAt:preview.startAtUtc,events:[{at:now,action:'draft_saved'}]});
  const updated=await Campaign.findOneAndUpdate({_id:objectId(existingId),userId,state:{$in:['draft','scheduled','paused','needs_review']},startedAt:{$exists:false}},{$set:{snapshot:preview.snapshot,name:preview.snapshot.name,digest:preview.digest,startAtUtc:preview.startAtUtc,nextAt:preview.startAtUtc,state:'draft',reason:''},$unset:{approvedDigest:1,approvedAt:1,approvedBy:1},$inc:{revision:1},$push:{events:{$each:[{at:now,action:'edited_approval_invalidated'}],$slice:-200}}},{returnDocument:'after'});
  if(!updated)throw new Error('Only an unstarted owned campaign can be edited');
  await Dispatch.updateMany({campaignId:updated._id,revision:{$lt:updated.revision},status:'queued'},{$set:{status:'cancelled',reason:'Campaign edited; approval invalidated'}});
  return updated;
}
async function approveCampaign(userId,id,approvedDigest,now=new Date(),{approveUnverifiedContacts=false,approvePreviouslyContacted=false}={}) {
  const campaign=await Campaign.findOne({_id:objectId(id),userId});if(!campaign)throw new Error('Campaign not found');
  if(campaign.state!=='draft'||campaign.digest!==approvedDigest||digest(campaign.snapshot)!==approvedDigest)throw new Error('Preview changed; review the exact saved campaign again');
  if(campaign.snapshot.allowUnverifiedContacts===true&&approveUnverifiedContacts!==true)throw new Error('Explicit campaign approval of unverified contacts required');
  if(campaign.snapshot.allowPreviouslyContacted===true&&approvePreviouslyContacted!==true)throw new Error('Explicit approval to resend previously contacted recipients required');
  const check=await previewCampaign(userId,{...campaign.snapshot,recipients:campaign.snapshot.recipients},now,{excludeCampaignId:campaign._id});
  if(check.blocked.length||check.digest!==approvedDigest)throw new Error('Sender, recipient or evidence changed; edit and preview again');
  const rows=campaign.snapshot.recipients.map(r=>({campaignId:campaign._id,userId,contactId:r.contactId,revision:campaign.revision,recipientEmail:r.recipientEmail,subject:r.subject,body:r.body,senderEmail:campaign.snapshot.senderEmail,approvedDigest,scheduledAtUtc:campaign.startAtUtc,providerIdempotencyKey:digest({campaignId:String(campaign._id),recipient:r.recipientEmail,revision:campaign.revision})}));
  // Upsert dispatches first. They remain inert until the campaign CAS succeeds.
  await Dispatch.bulkWrite(rows.map(r=>({updateOne:{filter:{campaignId:r.campaignId,recipientEmail:r.recipientEmail,revision:r.revision},update:{$setOnInsert:r},upsert:true}})));
  const nextAt = campaign.snapshot.immediate ? now : campaign.startAtUtc;
  const updated=await Campaign.findOneAndUpdate({_id:campaign._id,userId,state:'draft',digest:approvedDigest,revision:campaign.revision},{$set:{state:'scheduled',approvedDigest,approvedBy:userId,approvedAt:now,nextAt,reason:''},$push:{events:{$each:[{at:now,action:'exact_campaign_approved'}],$slice:-200}}},{returnDocument:'after'});
  if(!updated)throw new Error('Campaign changed during approval; review again');
  return updated;
}
function effectiveInterval(campaign){
  const override=campaign.pacingOverride;
  if(override&&override.approvedDigest===campaign.approvedDigest&&String(override.approvedBy)===String(campaign.userId)&&Number.isInteger(override.intervalSeconds)&&override.intervalSeconds>=3&&override.intervalSeconds<=86400)return override.intervalSeconds;
  return campaign.snapshot?.intervalSeconds||3;
}
async function changeCampaignInterval(userId,id,approvedDigest,intervalSeconds,reason,now=new Date()){
  if(!Number.isInteger(intervalSeconds)||intervalSeconds<3||intervalSeconds>86400)throw new Error('Use an interval between 3 and 86400 seconds');
  if(typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw new Error('Describe the owner-authorized pacing change');
  const Runtime=require('../models/OutreachRuntime');
  try{await Runtime.updateOne({_id:'global'},{$setOnInsert:{leaseUntil:new Date(0),nextAllowedAt:new Date(0)}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
  const token=crypto.randomUUID();
  const lock=await Runtime.findOneAndUpdate({_id:'global',leaseUntil:{$lte:now}},{$set:{leaseToken:token,leaseUntil:new Date(+now+120000)}},{returnDocument:'after'});
  if(!lock)throw new Error('Worker is busy; retry the pacing change after its in-flight send');
  try{
    if(await Dispatch.exists({status:'sending'}))throw new Error('Wait for in-flight delivery before changing pacing');
    const campaign=await Campaign.findOne({_id:objectId(id),userId,state:{$in:['scheduled','running','paused','needs_review']}});
    if(!campaign||!approvedDigest||campaign.approvedDigest!==approvedDigest||campaign.digest!==approvedDigest||digest(campaign.snapshot)!==approvedDigest)throw new Error('Owned approved campaign changed; refresh before changing pacing');
    const previous=effectiveInterval(campaign);
    const set={pacingOverride:{intervalSeconds,approvedDigest,approvedBy:userId,approvedAt:now,previousIntervalSeconds:previous,reason:reason.trim()}};
    if(['scheduled','running'].includes(campaign.state)&&campaign.startAtUtc<=now)set.nextAt=new Date(Math.max(+now,+(campaign.sendBoundaryAt||new Date(0))+intervalSeconds*1000));
    const updated=await Campaign.findOneAndUpdate({_id:campaign._id,userId,state:campaign.state,revision:campaign.revision,approvedDigest},{$set:set,$push:{events:{$each:[{at:now,action:'owner_changed_pacing',reason:`${previous}s to ${intervalSeconds}s: ${reason.trim()}`}],$slice:-200}}},{returnDocument:'after'});
    if(!updated)throw new Error('Campaign changed during pacing update');
    // Only adjust the shared cooldown when its most recent attempt belongs to
    // this campaign. Never shorten another campaign's approved send interval.
    const last=await Dispatch.findOne({startedAt:{$exists:true}}).sort({startedAt:-1,_id:-1}).select('campaignId startedAt').lean();
    if(last&&String(last.campaignId)===String(campaign._id)&&lock.lastDispatchAt&&Math.abs(+last.startedAt-+lock.lastDispatchAt)<5000){
      await Runtime.updateOne({_id:'global',leaseToken:token},{$set:{nextAllowedAt:new Date(Math.max(+now,+lock.lastDispatchAt+intervalSeconds*1000))}});
    }
    return updated;
  }finally{await Runtime.updateOne({_id:'global',leaseToken:token},{$set:{leaseUntil:new Date(0)},$unset:{leaseToken:1}});}
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
module.exports={effectiveInterval,changeCampaignInterval,permanentContactReason,senderCap,senderIdentity,senderPolicy,resolveApprovedSenders,normalizeEmail,validEmail,digest,objectId,configuredLimit,senderOptions,resolveSender,recipientReason,duplicateReason,previewCampaign,saveCampaign,approveCampaign,controlCampaign};

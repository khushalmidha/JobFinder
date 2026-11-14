const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Contact = require('../models/Contact');
const Suppression = require('../models/RecipientSuppression');
const Dispatch = require('../models/OutreachDispatch');
const Runtime = require('../models/OutreachRuntime');
const admission = require('./contactAdmissionService');
const { syntaxDisposition } = require('./smtpConnectivityService');
async function inspect(contact, domainCheck = admission.checkedDomain) {
  const email = admission.normalize(contact.email), syntax = syntaxDisposition(email);
  if (syntax === 'invalid') return { outcome:'confirmed_invalid', reason:'Invalid email syntax' };
  if (syntax !== 'supported') return { outcome:'inconclusive', reason:'Unsupported syntax; no mailbox-invalid assertion' };
  const suppressed = await Suppression.findOne({userId:contact.userId,email}).lean();
  if (suppressed && ['authenticated_provider_5.1.1','confirmed_invalid_pipeline'].includes(suppressed.source)) return { outcome:'confirmed_invalid', reason:suppressed.reason };
  const proof = await admission.latestProof(contact.userId,email);
  if (proof?.outcome === 'invalid' && new Date(proof.expiresAt) > new Date()) return {outcome:'confirmed_invalid',reason:'Trusted Hunter verifier reports invalid'};
  const domain = await domainCheck(email.split('@')[1]);
  if (domain.status === 'null_mx') return {outcome:'confirmed_invalid',reason:'Explicit sole preference-zero Null MX'};
  if (!['mx_found','implicit_mx'].includes(domain.status)) return {outcome:'inconclusive',reason:'DNS/route inconclusive; contact preserved',domainStatus:domain.status};
  return {outcome:await admission.validProof(contact.userId,email)?'mailbox_valid':'route_capable',reason:'DNS route is not mailbox existence proof',domainStatus:domain.status};
}
async function scan({userId,limit=200,afterId,force=false,apply=false,domainCheck=admission.checkedDomain,assertLease} = {}) {
  if (!mongoose.isValidObjectId(userId) || !Number.isInteger(limit) || limit<1 || limit>500 || (afterId && !mongoose.isValidObjectId(afterId))) throw new Error('Valid owner and bounded scan required');
  const now = new Date(), query={userId,...(afterId?{_id:{$gt:afterId}}:{}),...(!force?{$or:[{hygieneCheckedAt:{$exists:false}},{hygieneCheckedAt:{$lt:new Date(+now-86400000)}}]}:{})};
  const rows=await Contact.find(query).sort(force?{_id:1}:{hygieneCheckedAt:1,_id:1}).limit(limit).lean();
  const report={checked:rows.length,confirmedInvalid:0,removed:0,inconclusive:0,routeCapable:0,mailboxValid:0,heldForReconciliation:0,conflicts:0,nextCursor:rows.length?String(rows.at(-1)._id):null};
  for(let offset=0;offset<rows.length;offset+=5) await Promise.all(rows.slice(offset,offset+5).map(async contact=>{
    const result=await inspect(contact,domainCheck), email=admission.normalize(contact.email);
    if(result.outcome==='inconclusive')report.inconclusive++;
    if(result.outcome==='route_capable')report.routeCapable++;
    if(result.outcome==='mailbox_valid')report.mailboxValid++;
    if(result.outcome!=='confirmed_invalid') {
      if(apply && result.outcome!=='mailbox_valid')await admission.stage(userId,contact,result.outcome==='inconclusive'?'domain_inconclusive':'pending_verification',result.reason,result.domainStatus);
      if(apply)await Contact.updateOne({_id:contact._id,userId,email:contact.email},{$set:{hygieneCheckedAt:now,hygieneDisposition:result.outcome}});
      return;
    }
    report.confirmedInvalid++;
    if(!apply)return;
    // Write the durable owner/address block before removing an active record.
    await Suppression.updateOne({userId,email},{$setOnInsert:{userId,email,source:'confirmed_invalid_pipeline',reason:result.reason}},{upsert:true});
    await admission.stage(userId,contact,'confirmed_invalid',result.reason);
    if(await Dispatch.exists({userId,recipientEmail:email,status:{$in:['sending','unknown_outcome']}})){report.heldForReconciliation++;return;}
    const version={_id:contact._id,userId,email:contact.email,updatedAt:contact.updatedAt===undefined?{$exists:false}:contact.updatedAt};
    if(assertLease)await assertLease();
    const removed=await Contact.deleteOne(version);
    if(!removed.deletedCount){report.conflicts++;return;}
    report.removed++;
    await Dispatch.updateMany({userId,contactId:contact._id,status:'queued'},{$set:{status:'suppressed',reason:'Confirmed-invalid recipient removed',finishedAt:now}});
  }));
  try{require('../controllers/contactController').invalidateContactCache(userId);}catch{}
  return report;
}
async function scanCandidates(userId,limit=50) {
  const Candidate=require('../models/ContactCandidate');
  const rows=await Candidate.find({userId,state:{$in:['pending_verification','domain_inconclusive']},$or:[{domainStatus:{$exists:false}},{domainStatus:'awaiting_checks'},{checkedAt:{$lt:new Date(Date.now()-86400000)}}]}).sort({checkedAt:1}).limit(limit).lean();
  for(const row of rows)await admission.intake(userId,[row.payload],{checkUnverifiedDomain:true});
  return {checked:rows.length};
}
let task;
function initHygieneScheduler() {
  if(process.env.CONTACT_HYGIENE_ENABLED!=='true'||task)return task||null;
  const owners=[...new Set(String(process.env.CONTACT_HYGIENE_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean))];
  if(!owners.length||owners.some(id=>!mongoose.isValidObjectId(id))){console.error('Contact hygiene requires explicit valid owner scope');return null;}
  task=require('node-cron').schedule('15 * * * *',async()=>{
    const token=crypto.randomUUID(),now=new Date();
    try{
      try{await Runtime.updateOne({_id:'contact_hygiene'},{$setOnInsert:{leaseUntil:new Date(0)}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
      const lease=await Runtime.findOneAndUpdate({_id:'contact_hygiene',leaseUntil:{$lte:now}},{$set:{leaseToken:token,leaseUntil:new Date(+now+900000)}},{returnDocument:'after'});
      if(!lease)return;
      const assertLease=async()=>{if(!await Runtime.exists({_id:'contact_hygiene',leaseToken:token,leaseUntil:{$gt:new Date()}}))throw new Error('Hygiene lease expired; deletion stopped');};
      for(const userId of owners){await scan({userId,limit:200,apply:true,assertLease});await assertLease();await scanCandidates(userId);}
    }catch(e){console.error('Contact hygiene job failed; retry next scheduled run',e.name);}
    finally{await Runtime.updateOne({_id:'contact_hygiene',leaseToken:token},{$set:{leaseUntil:new Date(0)},$unset:{leaseToken:1}}).catch(()=>{});}
  },{timezone:'UTC',noOverlap:true});
  return task;
}
module.exports={inspect,scan,scanCandidates,initHygieneScheduler};

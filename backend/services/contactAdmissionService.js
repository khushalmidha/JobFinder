const mongoose = require('mongoose');
const Proof = require('../models/MailboxProof');
const Candidate = require('../models/ContactCandidate');
const Suppression = require('../models/RecipientSuppression');
const { syntaxDisposition, resolveAuditDomain } = require('./smtpConnectivityService');
const normalize = value => String(value || '').trim().toLowerCase();
const enabled = () => process.env.CONTACT_ADMISSION_ENABLED === 'true';
const fields = ['company','hrName','email','role','package','linkedinUrl','source','companyId','provenance','inferenceFlag'];
function cleanPayload(input) {
  const out = {};
  for (const key of fields) if (input[key] !== undefined) out[key] = input[key];
  out.email = normalize(input.email); out.company = String(input.company || 'Unknown').slice(0,300);
  return out;
}
async function latestProof(userId,email) {
  return Proof.findOne({userId,email:normalize(email)}).sort({checkedAt:-1,_id:-1}).lean();
}
async function validProof(userId,email) {
  if (syntaxDisposition(email) !== 'supported') return null;
  if (await Suppression.exists({userId,email:normalize(email)})) return null;
  const proof = await latestProof(userId,email);
  return proof?.outcome === 'valid' && new Date(proof.expiresAt) > new Date() ? proof : null;
}
async function stage(userId,input,state,reason,domainStatus) {
  const payload = cleanPayload(input);
  if (!payload.email) return null;
  const query={userId,email:payload.email,...(['pending_verification','domain_inconclusive'].includes(state)?{state:{$nin:['confirmed_invalid','suppressed']}}:{})};
  try{return await Candidate.findOneAndUpdate(query,{$set:{company:payload.company,payload,state,reason,domainStatus,checkedAt:new Date()}},{upsert:true,returnDocument:'after',runValidators:true});}
  catch(e){if(e.code===11000)return Candidate.findOne({userId,email:payload.email});throw e;}
}
async function assertAdmission(doc) {
  if (!enabled()) return;
  const email = normalize(doc.email);
  const proof = await validProof(doc.userId,email);
  if (!proof) {
    const invalid = syntaxDisposition(email) === 'invalid';
    await stage(doc.userId,doc,invalid?'confirmed_invalid':'pending_verification',invalid?'Invalid syntax':'Fresh trusted mailbox verification required');
    const error = new Error('MAILBOX_PROOF_REQUIRED: contact staged for verification; no active contact added');
    error.code = 'MAILBOX_PROOF_REQUIRED'; error.status = 409; throw error;
  }
  const route = await module.exports.checkedDomain(email.split('@')[1]);
  if(!['mx_found','implicit_mx'].includes(route.status)){await stage(doc.userId,doc,route.status==='null_mx'?'confirmed_invalid':'domain_inconclusive','Mail route requires review',route.status);throw Object.assign(new Error('Mail route not confirmed; contact quarantined'),{status:409,code:'MAILBOX_PROOF_REQUIRED'});}
  doc.email = email; doc.verificationStatus = 'vendor_verified'; doc.deliverabilityStatus = 'valid'; doc.validatedAt = proof.checkedAt;
}
const domains = new Map();
async function checkedDomain(domain) {
  const previous = domains.get(domain);
  if (previous?.until > Date.now()) return previous.promise;
  if (domains.size >= 2000) domains.delete(domains.keys().next().value);
  const promise = resolveAuditDomain(domain,{timeoutMs:3000});
  domains.set(domain,{until:Date.now()+3600000,promise});
  return promise;
}
function createIntake({ domainCheck = checkedDomain, deferUnverified = false } = {}) {
  return async function intake(userId,inputs,{checkUnverifiedDomain=false}={}) {
    if (!mongoose.isValidObjectId(userId) || !Array.isArray(inputs) || inputs.length > 1000) throw new Error('Owned intake supports at most1000 contacts');
    const Contact = require('../models/Contact');
    const result = { added:0, updated:0, staged:0, rejected:0, duplicates:0, contacts:[] };
    const seen = new Set();
    for (let offset=0;offset<inputs.length;offset+=5) await Promise.all(inputs.slice(offset,offset+5).map(async raw => {
      const input = cleanPayload(raw), email=input.email;
      if (!email || email.length>254) {result.rejected++;return;}
      if (seen.has(email)) {result.duplicates++;return;} seen.add(email);
      const existing = await Contact.findOne({userId,email:{$regex:'^'+email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',$options:'i'}}).lean();
      const suppression = await Suppression.exists({userId,email});
      if (suppression) {await stage(userId,input,'suppressed','Persistent suppression prevents re-import');result.rejected++;return;}
      const newest=await latestProof(userId,email);
      if(newest?.outcome==='invalid' && new Date(newest.expiresAt)>new Date()){
        await Suppression.updateOne({userId,email},{$setOnInsert:{userId,email,source:'confirmed_invalid_pipeline',reason:'Trusted Hunter verifier reports invalid'}},{upsert:true});
        if(existing)await Contact.updateOne({_id:existing._id,userId},{$set:{deliverabilityStatus:'invalid',verificationStatus:'invalid'},$unset:{hygieneCheckedAt:1}});
        await stage(userId,input,'confirmed_invalid','Trusted verifier reports invalid');result.rejected++;return;
      }
      if (existing) {
        const proof=await validProof(userId,email);
        if(!proof){if(checkUnverifiedDomain){const domain=await domainCheck(email.split('@')[1]);await stage(userId,{...existing,...input},domain.status==='null_mx'?'confirmed_invalid':['mx_found','implicit_mx'].includes(domain.status)?'pending_verification':'domain_inconclusive','Mailbox unverified; domain check completed',domain.status);result.staged++;return;}await stage(userId,{...existing,...input},'pending_verification','Existing contact needs a fresh trusted mailbox proof');result.staged++;return;}
        if(existing.optOutAt||existing.suppressedAt||['bounced','removed'].includes(existing.status)){result.rejected++;return;}
        const route=await domainCheck(email.split('@')[1]);
        if(!['mx_found','implicit_mx'].includes(route.status)){await stage(userId,existing,'domain_inconclusive','Mail route requires review',route.status);result.staged++;return;}
        if(existing.verificationStatus!=='vendor_verified'||existing.deliverabilityStatus!=='valid'){
          await Contact.updateOne({_id:existing._id,userId,email:existing.email},{$set:{verificationStatus:'vendor_verified',deliverabilityStatus:'valid',validatedAt:proof.checkedAt}});result.updated++;
        }else result.duplicates++;
        await stage(userId,existing,'promoted','Existing contact has fresh proof; history preserved',route.status);return;
      }
      const syntax = syntaxDisposition(email);
      if (syntax !== 'supported') {await stage(userId,input,syntax==='invalid'?'confirmed_invalid':'domain_inconclusive',syntax==='invalid'?'Invalid syntax':'Unsupported address format requires review');result.rejected++;return;}
      if(deferUnverified && !checkUnverifiedDomain && !await validProof(userId,email)){await stage(userId,input,'pending_verification','Mailbox proof pending; no valid-mailbox claim','awaiting_checks');result.staged++;return;}
      const domain = await domainCheck(email.split('@')[1]);
      if (domain.status === 'null_mx') {await stage(userId,input,'confirmed_invalid','Domain explicitly declines mail',domain.status);result.rejected++;return;}
      if (!['mx_found','implicit_mx'].includes(domain.status)) {await stage(userId,input,'domain_inconclusive','Domain check inconclusive; no mailbox-invalid assertion',domain.status);result.staged++;return;}
      const proof = await validProof(userId,email);
      if (!proof) {
        const latest=await latestProof(userId,email);
        if(latest?.outcome==='invalid' && new Date(latest.expiresAt)>new Date()){await Suppression.updateOne({userId,email},{$setOnInsert:{userId,email,source:'confirmed_invalid_pipeline',reason:'Trusted Hunter verifier reports invalid'}},{upsert:true});await stage(userId,input,'confirmed_invalid','Trusted verifier reports invalid',domain.status);result.rejected++;return;}
        await stage(userId,input,'pending_verification','Mail route exists; mailbox existence unverified',domain.status);result.staged++;return;}
      const stableId = new mongoose.Types.ObjectId(require('crypto').createHash('sha256').update(`verified-contact:${userId}:${email}`).digest('hex').slice(0,24));
      const contact = await Contact.findOneAndUpdate({_id:stableId,userId},{$setOnInsert:{...input,userId,verificationStatus:'vendor_verified',deliverabilityStatus:'valid',validatedAt:proof.checkedAt}},{upsert:true,returnDocument:'after',runValidators:true});
      await stage(userId,input,'promoted','Fresh trusted mailbox proof and mail route checked',domain.status);
      result.added++; result.contacts.push(contact);
    }));
    return result;
  };
}
module.exports = { enabled, normalize, latestProof, validProof, assertAdmission, stage, cleanPayload, checkedDomain, createIntake, intake:createIntake({deferUnverified:true}) };

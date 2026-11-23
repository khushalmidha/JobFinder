const mongoose=require('mongoose'),crypto=require('node:crypto');
const Lead=require('../models/ProfessionalLead'),Contact=require('../models/Contact'),Suppression=require('../models/RecipientSuppression');
const smtp=require('./smtpConnectivityService');
const {allowedDiscoveryDomain}=require('./publicEmailDiscovery');
async function importLeads({userId,leadIds,domainCheck=smtp.resolveAuditDomain,probe=smtp.probeSmtpServer,reserve=require('./researchBudgetService').reserveResearch}={}){
 if(!mongoose.isValidObjectId(userId)||!Array.isArray(leadIds)||!leadIds.length||leadIds.length>100||leadIds.some(id=>!mongoose.isValidObjectId(id)))throw Error('Select 1 to 100 owned research leads');
 const owner=await require('../models/User').findById(userId).select('blockedCompanies').lean();if(!owner)throw Error('Owner not found');
 const rows=await Lead.find({userId,_id:{$in:leadIds}}).lean(),key=require('./companyIdentityService').companyKey;
 const blockedCompanies=new Set((owner.blockedCompanies||[]).map(key)),routes=new Map(),companies=new Map();
 const report={added:0,duplicates:0,excluded:leadIds.length-rows.length,staged:0,updated:0,mailboxesVerified:0,providerCreditsUsed:0,results:[]};
 async function route(domain){if(!routes.has(domain))routes.set(domain,(async()=>{await reserve(userId,{requests:0,credits:0});const result=await domainCheck(domain);if(!['mx_found','implicit_mx'].includes(result.status))return {domain:result,smtp:{status:'not_attempted',mailboxVerified:false}};return {domain:result,smtp:await probe(result.hosts[0],{timeoutMs:2500})};})());return routes.get(domain);}
 for(let offset=0;offset<rows.length;offset+=5)await Promise.all(rows.slice(offset,offset+5).map(async lead=>{
  const email=String(lead.email).trim().toLowerCase(),domain=email.split('@')[1];
  const reject=reason=>{report.excluded++;report.results.push({email,status:'excluded',reason});};
  if(smtp.syntaxDisposition(email)!=='supported'||!allowedDiscoveryDomain(domain))return reject('Unsupported professional address');
  if(blockedCompanies.has(key(lead.company)))return reject('Company blocked');
  if(!lead.sourceUrl||Date.now()-new Date(lead.observedAt)>30*86400000)return reject('Fresh source evidence required');
  if(lead.inferenceFlag)return reject('Published address evidence required');
  const existing=await Contact.find({userId,email:{$regex:'^'+email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',$options:'i'}}).lean();
  const permanent=require('./campaignService').permanentContactReason;
  if(await Suppression.exists({userId,email})||existing.some(row=>permanent(row)))return reject('Existing suppression or invalid evidence preserved');
  const proof=await require('./contactAdmissionService').latestProof(userId,email);
  if(proof?.outcome==='invalid')return reject('Trusted verifier reports invalid');
  let checked;try{checked=await route(domain);}catch(error){report.staged++;report.results.push({email,status:'deferred',reason:error.message});return;}
  if(checked.domain.status==='null_mx')return reject('Domain explicitly declines mail');
  const connectivity={checkedAt:new Date(),domainStatus:checked.domain.status,smtpStatus:checked.smtp.status,smtpHost:checked.domain.hosts?.[0],mailboxVerified:false};
  if(!['mx_found','implicit_mx'].includes(checked.domain.status)){await require('./contactAdmissionService').stage(userId,{company:lead.company,email},'domain_inconclusive','DNS/mail route inconclusive; not invalid',checked.domain.status);report.staged++;return;}
  // Recheck permanent blocks after the network wait. Never revive an address.
  const [lateSuppression,lateProof,lateOwner]=await Promise.all([Suppression.exists({userId,email}),require('./contactAdmissionService').latestProof(userId,email),require('../models/User').findById(userId).select('blockedCompanies').lean()]);
  if(lateSuppression||lateProof?.outcome==='invalid'||(lateOwner?.blockedCompanies||[]).some(company=>key(company)===key(lead.company)))return reject('Recipient or company blocked during checks');
  if(existing.length){
   const target=existing[0];const set={smtpConnectivity:connectivity};if(!target.contactKind||target.contactKind==='unknown')set.contactKind=lead.kind;
   await Contact.updateOne({_id:target._id,userId,suppressedAt:{$eq:null},optOutAt:{$eq:null},deliverabilityStatus:{$ne:'invalid'},verificationStatus:{$ne:'invalid'},status:{$nin:['bounced','removed','replied','reply_received','positive_response','negative_response']}},{$set:set});await Lead.updateOne({_id:lead._id,userId},{$set:{importedToContactAt:new Date()}});report.duplicates++;return;
  }
  if(!companies.has(lead.company))companies.set(lead.company,require('../models/Company').findOne({name:require('./companyIdentityService').canonicalCompany(lead.company)}).select('_id').lean().exec());
  const company=await companies.get(lead.company);
  const payload={companyId:company?._id,company:lead.company,hrName:lead.name||lead.title||'Recruiting inbox',email,role:lead.title,contactKind:lead.kind,source:'career_crawler',inferenceFlag:lead.inferenceFlag===true,provenance:[{url:lead.sourceUrl,provider:lead.inferenceFlag?'observed_pattern':lead.sourceType||'official_public_page',observedAt:lead.observedAt},...(lead.patternEvidence||[]).map(p=>({url:p.url,provider:'pattern_example',observedAt:lead.observedAt}))]};
  if(require('./contactAdmissionService').enabled()){const intake=await require('./contactAdmissionService').intake(userId,[payload]);report.staged+=intake.staged;report.added+=intake.added;report.excluded+=intake.rejected;return;}
  const stableId=new mongoose.Types.ObjectId(crypto.createHash('sha256').update('professional-sheet:'+userId+':'+email).digest('hex').slice(0,24));
  const result=await Contact.updateOne({_id:stableId,userId},{$setOnInsert:{...payload,userId,smtpConnectivity:connectivity,verificationStatus:lead.inferenceFlag?'inferred_unverified':'publicly_sourced',deliverabilityStatus:'unverified',notes:`${lead.inferenceFlag?'Inferred work address; pattern '+lead.pattern+'. ':'Published professional address. '}Mailbox existence unverified. SMTP server: ${checked.smtp.status}. Role/employer as published, not independently employment-verified.`}},{upsert:true,runValidators:true});
  await Lead.updateOne({_id:lead._id,userId},{$set:{importedToContactAt:new Date()}});
  if(result.upsertedCount)report.added++;else report.duplicates++;
  report.results.push({email,status:result.upsertedCount?'added_unverified':'duplicate',smtpStatus:checked.smtp.status,mailboxVerified:false});
 }));
 require('../controllers/contactController').invalidateContactCache(userId);return report;
}
module.exports={importLeads};

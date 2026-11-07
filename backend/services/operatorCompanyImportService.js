// Local database-maintenance entry point only; never mounted as an HTTP route.
// This uses operator DB credentials and an explicit owner/scope/digest approval.
// It does not promote users, attest email ownership, or loosen admin API guards.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const Company=require('../models/Company'),Prospect=require('../models/CompanyProspect'),Lead=require('../models/PublicRecruitmentLead');
const Contact=require('../models/Contact'),User=require('../models/User'),Run=require('../models/CompanyImportRun');
const directory=require('./companyImportService');
const {isValidEmailSyntax}=require('./emailDeliverabilityService');
const {resolveAuditDomain,probeSmtpServer}=require('./smtpConnectivityService');
const normalize=value=>String(value||'').trim().toLowerCase();
const plain=value=>JSON.parse(JSON.stringify(value));
async function scopeFor(ownerEmail,includeShares,session){
  const users=await User.find().select('_id email syncedAccountEmails role emailVerified emailVerifiedAt').session(session||null).lean();
  const matches=users.filter(u=>normalize(u.email)===normalize(ownerEmail));
  if(matches.length!==1)throw new Error('Exactly one existing owner account must match');
  const owner=matches[0],emails=[normalize(owner.email),...(includeShares?(owner.syncedAccountEmails||[]).map(normalize):[])];
  const unique=[...new Set(emails)],accounts=[];
  for(const email of unique){const found=users.filter(u=>normalize(u.email)===email);if(found.length!==1)throw new Error('Configured sharing recipient missing or ambiguous');accounts.push({_id:found[0]._id,email:found[0].email});}
  return {ownerId:owner._id,ownerEmail:owner.email,includeShares:!!includeShares,accounts,scopeHash:directory.hash({ownerId:String(owner._id),accounts:accounts.map(a=>[String(a._id),normalize(a.email)]).sort()})};
}
async function prepare({ownerEmail,includeShares=false,authorization,source=directory.suppliedSource(),reviewedEvidence=[]}){
  if(typeof authorization!=='string'||authorization.trim().length<20)throw new Error('Record the explicit owner authorization for this local maintenance operation');
  const scope=await scopeFor(ownerEmail,includeShares),plan=directory.planImport(source,await directory.directoryState());
  const execution={kind:'local_operator_maintenance',ownerEmail:scope.ownerEmail,includeShares,accounts:plain(scope.accounts),scopeHash:scope.scopeHash,authorization:authorization.trim(),reviewedEvidence:plain(reviewedEvidence),reviewedEvidenceHash:directory.hash(reviewedEvidence),sourceHash:directory.hash(directory.sanitizeSource(source)),preparedAt:new Date()};
  const digest=directory.hash({planDigest:plan.digest,execution});
  const run=await Run.create({...plan,digest,userId:scope.ownerId,execution});
  return {runId:String(run._id),digest,summary:plan.summary,scope:plain(scope.accounts)};
}
async function backup(run,destination){
  const target=path.resolve(destination);fs.mkdirSync(target,{recursive:true});
  const files={companies:Company,prospects:Prospect,public_leads:Lead,contacts:Contact,mail_history:require('../models/MailLog')};
  for(const [name,Model]of Object.entries(files)){
    const handle=fs.openSync(path.join(target,`${name}-before.jsonl`),'wx');
    try{for await(const row of Model.find().lean().cursor())fs.writeSync(handle,JSON.stringify(row)+'\n');}finally{fs.closeSync(handle);}
  }
  fs.writeFileSync(path.join(target,'approved-preview.json'),JSON.stringify(run,null,2),{flag:'wx'});
  return target;
}
async function documentFor(Model,values,now){const doc=new Model({...values,createdAt:now,updatedAt:now,__v:0});await doc.validate();return doc.toObject({getters:false});}
async function checkLeads(run,{fetchPage,reviewedEvidence=[],probeDomain=resolveAuditDomain,probeHost=probeSmtpServer}={}){
  const results=[];
  for(const change of run.changes){
    if(!change.raw.recruitmentEmail?.email||change.action==='conflict')continue;
    const raw=change.raw.recruitmentEmail;
    let checked=await directory.checkPublicLead(raw,{companyName:change.companyName,...(fetchPage?{fetchPage}:{})});
    const reviewed=reviewedEvidence.find(e=>e.companyName===change.companyName&&normalize(e.email)===normalize(raw.email)&&e.evidenceUrl===raw.evidenceUrl&&e.listingStatus==='official_publicly_listed'&&e.proofSnippet?.toLowerCase().includes(normalize(raw.email)));
    const observed=reviewed?new Date(reviewed.sourceObservedDate||reviewed.checkedAt):null;
    const fresh=observed&&Number.isFinite(+observed)&&+observed<=Date.now()&&Date.now()-observed<=30*86400000;
    const directStatus=checked.listingStatus;
    // Independent public-page observations remain dated separately from an
    // inconclusive direct fetch; no synthetic fetch response is manufactured.
    if(['inconclusive','not_found'].includes(directStatus)&&fresh){checked={...checked,listingStatus:'official_publicly_listed',checkedAt:observed,evidenceExcerpt:reviewed.proofSnippet,checkReason:'Previously observed official publication; current direct fetch is separately recorded as '+directStatus};}
    const domain=isValidEmailSyntax(checked.email)?await probeDomain(checked.email.split('@')[1]):{status:'invalid_syntax',hosts:[]};
    const smtp=domain.hosts?.length?await probeHost(domain.hosts[0]):{status:'not_attempted',mailboxVerified:false};
    results.push({change,checked,domain,smtp,directStatus,reviewedProof:fresh?{observedAt:observed,url:reviewed.evidenceUrl,snippet:reviewed.proofSnippet}:null});
  }
  return results;
}
async function apply({ownerEmail,runId,digest,backupDirectory,reviewedEvidence,...checks}){
  let run=await Run.findById(runId).lean();
  if(!run||run.execution?.kind!=='local_operator_maintenance'||normalize(run.execution.ownerEmail)!==normalize(ownerEmail)||run.digest!==digest)throw new Error('Exact owned operator preview and approved digest required');
  if(run.status==='applied')return {runId:String(run._id),alreadyApplied:true,summary:run.summary};
  if(run.status!=='preview'||Date.now()-run.createdAt>86400000)throw new Error('Fresh unapplied operator preview required');
  if(reviewedEvidence && directory.hash(reviewedEvidence)!==run.execution.reviewedEvidenceHash)throw new Error('Reviewed evidence changed since preview');
  reviewedEvidence=run.execution.reviewedEvidence||[];
  const scope=await scopeFor(ownerEmail,run.execution.includeShares);
  if(scope.scopeHash!==run.execution.scopeHash)throw new Error('Owner/sharing scope changed since preview');
  if(directory.hash(await directory.directoryState())!==run.databaseFingerprint)throw new Error('Directory changed since preview');
  if(!backupDirectory)throw new Error('Private backup directory is required');
  const backupPath=await backup(run,backupDirectory),leadChecks=await checkLeads(run,{reviewedEvidence,...checks});
  const session=await mongoose.startSession();let result;
  try{await session.withTransaction(async()=>{
    const current=await Run.findOne({_id:run._id,status:'preview',digest}).session(session).lean();if(!current)throw new Error('Preview already claimed');
    await Run.updateOne({_id:run._id,status:'preview',digest},{$set:{status:'applying',mutating:true}},{session});
    // Re-read the snapshot inside the transaction; concurrent changes cause a
    // conflict/abort rather than a partial user-visible import.
    const companies=await Company.find().sort({_id:1}).session(session).lean();
    const prospects=await Prospect.find().sort({_id:1}).session(session).lean();
    const leads=await Lead.find().sort({_id:1}).session(session).lean();
    if(directory.hash({companies,prospects,leads})!==run.databaseFingerprint)throw new Error('Directory changed before transaction');
    const currentScope=await scopeFor(ownerEmail,run.execution.includeShares,session);if(currentScope.scopeHash!==run.execution.scopeHash)throw new Error('Sharing scope changed before commit');
    // Guard each approved account row in this transaction so concurrent sharing
    // or account deletion creates a write conflict. Identity/roles stay intact.
    for(const account of currentScope.accounts)await User.collection.updateOne({_id:account._id},{$set:{lastCompanyImportRunId:run._id}},{session});
    const now=new Date(),journal=[],contactJournal=[],newCompanies=[],prospectOps=[],leadOps=[],contactDocs=[];
    for(const change of run.changes){
      if(change.action==='unchanged'||change.quarantineUnchanged)continue;
      let afterCompany;
      if(change.newCompany){afterCompany=await documentFor(Company,{...change.newCompany,importRunId:run._id},now);newCompanies.push(afterCompany);}
      const before=prospects.find(p=>p.sourceRecordKey===change.sourceRecordKey)||null;
      if(directory.hash(before)!==directory.hash(change.before))throw new Error('Source row changed');
      const after=await documentFor(Prospect,{_id:before?._id||new mongoose.Types.ObjectId(),sourceRecordKey:change.sourceRecordKey,source:run.source,companyName:change.companyName,regionGroup:change.regionGroup,companyId:change.companyId,identityStatus:change.action==='conflict'?'conflict':'matched',identityReason:change.action==='conflict'?change.reason:'',raw:change.raw,contentHash:change.contentHash,qualificationStatus:'research_needed',sendEligible:false,importRunId:run._id,...(before?{createdAt:before.createdAt}:{})},now);
      if(before)after.createdAt=before.createdAt;
      prospectOps.push({replaceOne:{filter:{sourceRecordKey:change.sourceRecordKey},replacement:after,upsert:true}});
      const proof=leadChecks.find(p=>p.change.sourceRecordKey===change.sourceRecordKey),beforeLead=leads.find(l=>l.sourceRecordKey===change.sourceRecordKey)||null;let afterLead;
      if(proof){afterLead=await documentFor(Lead,{...proof.checked,_id:beforeLead?._id||new mongoose.Types.ObjectId(),sourceRecordKey:change.sourceRecordKey,companyId:change.companyId,companyName:change.companyName,importRunId:run._id,sourceReview:{directFetchStatus:proof.directStatus,reviewedProof:proof.reviewedProof,domain:proof.domain,smtp:proof.smtp}},now);if(beforeLead)afterLead.createdAt=beforeLead.createdAt;leadOps.push({replaceOne:{filter:{sourceRecordKey:change.sourceRecordKey},replacement:afterLead,upsert:true}});}
      journal.push({sourceRecordKey:change.sourceRecordKey,beforeProspect:plain(before),beforeLead:plain(beforeLead),newCompanyId:change.newCompany?._id||null,companyId:change.companyId,state:'applied',afterCompanyHash:afterCompany?directory.hash(afterCompany):null,afterProspectHash:directory.hash(after),afterLeadHash:afterLead?directory.hash(afterLead):null});
    }
    const existing=await Contact.find({userId:{$in:scope.accounts.map(a=>a._id)}}).session(session).lean();
    const seen=new Set(existing.map(c=>`${c.userId}:${normalize(c.email)}`));
    const accountsSummary=scope.accounts.map(a=>({userId:a._id,email:a.email,contactsAdded:0,existingKept:0,notEligible:0}));
    for(const proof of leadChecks)for(const account of scope.accounts){
      const summary=accountsSummary.find(a=>String(a.userId)===String(account._id)),email=normalize(proof.checked.email),key=`${account._id}:${email}`;
      if(seen.has(key)){summary.existingKept++;continue;}
      if(proof.checked.listingStatus!=='official_publicly_listed'||['null_mx','invalid_syntax'].includes(proof.domain.status)){summary.notEligible++;continue;}
      seen.add(key);
      const _id=new mongoose.Types.ObjectId(crypto.createHash('sha256').update(`public-lead:${account._id}:${email}`).digest('hex').slice(0,24));
      const doc=await documentFor(Contact,{_id,userId:account._id,companyId:proof.change.companyId,company:proof.change.companyName,email,role:'Public recruiting inbox',source:'career_crawler',verificationStatus:'publicly_sourced',deliverabilityStatus:'unverified',inferenceFlag:false,provenance:[{url:proof.checked.evidenceUrl,provider:'operator_reviewed_official_publication',observedAt:proof.checked.checkedAt}],smtpConnectivity:{runId:String(run._id),checkedAt:now,domainStatus:proof.domain.status,smtpStatus:proof.smtp.status,smtpHost:proof.domain.hosts?.[0]||'',mailboxVerified:false},notes:'Public recruitment source; individual mailbox unverified. Added by explicitly approved local import; no campaign approval.'},now);
      contactDocs.push(doc);contactJournal.push({_id:doc._id,userId:account._id,afterHash:directory.hash(doc)});summary.contactsAdded++;
    }
    if(newCompanies.length)await Company.collection.insertMany(newCompanies,{session});
    if(prospectOps.length)await Prospect.collection.bulkWrite(prospectOps,{session});
    if(leadOps.length)await Lead.collection.bulkWrite(leadOps,{session});
    if(contactDocs.length)await Contact.collection.insertMany(contactDocs,{session});
    const summary={...run.summary,appliedRows:journal.length,newCompaniesAdded:newCompanies.length,publicLeadsStored:leadOps.length,contactsAdded:contactDocs.length,accounts:accountsSummary,mailboxVerified:0,emailsSent:0};
    const committed=await Run.updateOne({_id:run._id,status:'applying',digest},{$set:{status:'applied',mutating:false,journal,summary,appliedAt:now,'execution.backupDirectory':backupPath,'execution.approvedAt':now,'execution.contactJournal':contactJournal}},{session});
    if(!committed.matchedCount)throw new Error('Operator import lost its transaction claim');
    result={runId:String(run._id),summary};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},maxCommitTimeMS:60000});return result;
  }finally{await session.endSession();}
}
async function rollback({ownerEmail,runId,digest}){
  const run=await Run.findById(runId).lean();
  if(!run||run.execution?.kind!=='local_operator_maintenance'||normalize(run.execution.ownerEmail)!==normalize(ownerEmail)||run.digest!==digest)throw new Error('Exact owned operator run and digest required');
  if(run.status==='rolled_back')return {runId:String(run._id),alreadyRolledBack:true,report:run.rollbackReport};
  if(run.status!=='applied')throw new Error('Only a completed operator import can be rolled back');
  const session=await mongoose.startSession();let report;
  try{await session.withTransaction(async()=>{
    report={removedNewContacts:0,removedProspects:0,removedLeads:0,restoredProspects:0,restoredLeads:0,archivedNewCompanies:0,retainedCompanyIds:0,conflicts:[]};
    const claimed=await Run.updateOne({_id:run._id,status:'applied',digest},{$set:{status:'rolling_back',mutating:true}},{session});if(!claimed.matchedCount)throw new Error('Operator rollback already claimed');
    for(const entry of run.execution.contactJournal||[]){
      const contact=await Contact.findOne({_id:entry._id,userId:entry.userId}).session(session).lean();if(!contact)continue;
      const used=await require('../models/MailLog').exists({contactId:contact._id}).session(session)||await require('../models/OutreachDispatch').exists({contactId:contact._id}).session(session)||await require('../models/OutreachDraft').exists({contactId:contact._id}).session(session);
      if(used||directory.hash(contact)!==entry.afterHash){report.conflicts.push(`contact:${contact._id}:changed-or-used`);continue;}
      await Contact.deleteOne({_id:contact._id,userId:entry.userId,updatedAt:contact.updatedAt},{session});report.removedNewContacts++;
    }
    for(const entry of [...run.journal].reverse()){
      for(const [Model,beforeKey,afterKey,removedKey,restoredKey]of [[Prospect,'beforeProspect','afterProspectHash','removedProspects','restoredProspects'],[Lead,'beforeLead','afterLeadHash','removedLeads','restoredLeads']]){
        const current=await Model.findOne({sourceRecordKey:entry.sourceRecordKey}).session(session).lean();if(!current||String(current.importRunId)!==String(run._id))continue;
        if(directory.hash(current)!==entry[afterKey]){report.conflicts.push(`${Model.modelName}:${current._id}:changed`);continue;}
        if(entry[beforeKey]){const previous=new Model(entry[beforeKey]).toObject({getters:false});await Model.collection.replaceOne({_id:current._id,updatedAt:current.updatedAt},previous,{session});report[restoredKey]++;}
        else{await Model.deleteOne({_id:current._id,importRunId:run._id,updatedAt:current.updatedAt},{session});report[removedKey]++;}
      }
      if(entry.newCompanyId){const company=await Company.findById(entry.newCompanyId).session(session).lean();if(!company)continue;
        const referenced=await Prospect.exists({companyId:company._id}).session(session)||await Contact.exists({companyId:company._id}).session(session)||await Lead.exists({companyId:company._id}).session(session);
        if(!referenced&&directory.hash(company)===entry.afterCompanyHash){await Company.updateOne({_id:company._id,updatedAt:company.updatedAt},{$set:{importRollbackArchivedAt:new Date()}},{session});report.archivedNewCompanies++;}else report.retainedCompanyIds++;
      }
    }
    await Run.updateOne({_id:run._id,status:'rolling_back'},{$set:{status:'rolled_back',mutating:false,rolledBackAt:new Date(),rollbackReport:report}},{session});
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return {runId:String(run._id),report};}finally{await session.endSession();}
}
module.exports={scopeFor,prepare,apply,rollback};

// Requires explicit --apply to change contacts. Never sends/VRFYs/RCPTs/deletes.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const dotenv=require('dotenv');
const {isValidEmailSyntax}=require('../services/emailDeliverabilityService');
const {resolveAuditDomain,probeSmtpServer,confirmedInvalidReason}=require('../services/smtpConnectivityService');

function argsFor(argv){
  const out={apply:false,allUsers:false,timeoutMs:2500,concurrency:3};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--apply')out.apply=true;
    else if(key==='--all-users')out.allUsers=true;
    else if(key==='--env-file')out.envFile=argv[++i];
    else if(key==='--user-id')out.userId=argv[++i];
    else if(key==='--output')out.output=argv[++i];
    else if(key==='--timeout-ms')out.timeoutMs=Number(argv[++i]);
    else if(key==='--concurrency')out.concurrency=Number(argv[++i]);
    else throw new Error('Unknown audit argument');
  }
  if(!out.allUsers && !mongoose.isValidObjectId(out.userId))throw new Error('Specify --user-id or explicitly --all-users');
  if(!Number.isInteger(out.timeoutMs)||out.timeoutMs<500||out.timeoutMs>10000||!Number.isInteger(out.concurrency)||out.concurrency<1||out.concurrency>4)throw new Error('Invalid timeout/concurrency');
  return out;
}
async function main(){
  const options=argsFor(process.argv.slice(2));
  const cfg=options.envFile?dotenv.parse(fs.readFileSync(path.resolve(options.envFile))):process.env;
  const uri=cfg.MONGODB_URI;if(!uri)throw new Error('Database URI is not configured');
  const runId=crypto.randomUUID();
  const output=path.resolve(options.output||path.join(__dirname,'../../artifacts/mail-audit',runId));
  // Reports contain private contact data. Only write to ignored local artifacts.
  if(!output.toLowerCase().includes(`${path.sep}artifacts${path.sep}`))throw new Error('Use a private artifacts directory for audit output');
  if(fs.existsSync(path.join(output,'contacts-before.jsonl')))throw new Error('Use a fresh private artifacts directory; an earlier audit backup already exists');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const connection=await mongoose.createConnection(uri,{serverSelectionTimeoutMS:15000,autoIndex:false,autoCreate:false}).asPromise();
  try{
    const collection=connection.db.collection('contacts');
    const scope=options.allUsers?{}:{userId:new mongoose.Types.ObjectId(options.userId)};
    const contacts=await collection.find(scope,{projection:{email:1,userId:1,status:1,deliverabilityStatus:1,verificationStatus:1,validationReason:1,validatedAt:1,suppressedAt:1,suppressionReason:1,smtpConnectivity:1}}).toArray();
    const logs=await connection.db.collection('maillogs').find({...scope,recipientEmail:{$exists:true,$ne:''},status:{$in:['sent','delivered','bounced','failed']}},{projection:{userId:1,recipientEmail:1,status:1,deliveryEvidence:1,sentAt:1}}).toArray();
    const domainNames=[...new Set(contacts.map(c=>String(c.email||'').trim().toLowerCase()).filter(isValidEmailSyntax).map(e=>e.split('@')[1]))];
    const domainResults=new Map(),hostCache=new Map();let cursor=0,completed=0;
    const counters={runId,mode:options.apply?'apply':'dry_run',records:contacts.length,uniqueEmails:new Set(contacts.map(c=>String(c.email||'').trim().toLowerCase())).size,domains:domainNames.length,domainsCompleted:0,smtpConnectionsAttempted:0,hostChecks:0,domainStatuses:{},smtpStatuses:{},confirmedInvalid:0,invalidReasons:{},matched:0,modified:0,suppressionCandidates:0,suppressed:0,physicalDeletes:0,emailsSent:0,startedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(output,'contacts-before.jsonl'),contacts.map(c=>JSON.stringify(c)).join('\n')+'\n',{mode:0o600});
    function checkpoint(){counters.domainsCompleted=completed;fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(counters,null,2),{mode:0o600});}
    checkpoint();console.log(JSON.stringify({phase:'start',runId,mode:counters.mode,records:counters.records,domains:counters.domains}));
    async function sharedProbe(host){
      if(!hostCache.has(host))hostCache.set(host,(async()=>{counters.hostChecks++;const r=await probeSmtpServer(host,{timeoutMs:options.timeoutMs});if(r.attempted)counters.smtpConnectionsAttempted++;return r;})());
      return hostCache.get(host);
    }
    async function worker(){
      while(cursor<domainNames.length){
        const domain=domainNames[cursor++];
        const result=await resolveAuditDomain(domain,{timeoutMs:options.timeoutMs});
        let smtp={status:'not_attempted',attempted:false,mailboxVerified:false};
        if(result.hosts.length){
          const host=result.hosts[0];smtp={host,...await sharedProbe(host)};
          // Connectivity only; alternate servers and recipient commands aren't enumerated.
        }
        const record={domain,...result,smtp,checkedAt:new Date().toISOString()};domainResults.set(domain,record);
        fs.appendFileSync(path.join(output,'domains.jsonl'),JSON.stringify(record)+'\n',{mode:0o600});
        counters.domainStatuses[result.status]=(counters.domainStatuses[result.status]||0)+1;
        counters.smtpStatuses[smtp.status]=(counters.smtpStatuses[smtp.status]||0)+1;
        completed++;if(completed%25===0 || completed===domainNames.length){checkpoint();console.log(JSON.stringify({phase:'domains',completed,total:domainNames.length,smtpConnectionsAttempted:counters.smtpConnectionsAttempted}));}
        await new Promise(r=>setTimeout(r,200));
      }
    }
    await Promise.all(Array.from({length:options.concurrency},worker));
    const logMap=new Map();for(const log of logs){const key=`${log.userId}:${String(log.recipientEmail).trim().toLowerCase()}`;if(!logMap.has(key))logMap.set(key,[]);logMap.get(key).push(log);}
    let operations=[];
    async function flush(){if(!operations.length)return;if(options.apply){const r=await collection.bulkWrite(operations,{ordered:false});counters.matched+=r.matchedCount;counters.modified+=r.modifiedCount;}operations=[];checkpoint();}
    for(const contact of contacts){
      const email=String(contact.email||'').trim().toLowerCase();const domain=domainResults.get(email.split('@')[1]);
      const invalidReason=confirmedInvalidReason(contact,domain,logMap.get(`${contact.userId}:${email}`)||[]);
      if(invalidReason){counters.confirmedInvalid++;counters.invalidReasons[invalidReason]=(counters.invalidReasons[invalidReason]||0)+1;}
      const audit={runId,checkedAt:new Date(),domainStatus:domain?.status||'not_checked',smtpStatus:domain?.smtp.status||'not_attempted',smtpHost:domain?.smtp.host||'',mailboxVerified:false};
      const update={smtpConnectivity:audit};
      if(invalidReason && !contact.suppressedAt){Object.assign(update,{deliverabilityStatus:'invalid',verificationStatus:'invalid',validationReason:`Confirmed: ${invalidReason}; SMTP connectivity alone is not mailbox verification`,validatedAt:new Date(),suppressedAt:new Date(),suppressionReason:invalidReason,suppressionAuditRunId:runId});counters.suppressionCandidates++;}
      fs.appendFileSync(path.join(output,'contacts-results.jsonl'),JSON.stringify({contactId:contact._id,userId:contact.userId,email,invalidReason,action:invalidReason?(contact.suppressedAt?'already_suppressed':'suppress'):'preserve',...audit})+'\n',{mode:0o600});
      const filter={_id:contact._id,userId:contact.userId,email:contact.email};
      // Do not race another cleanup or overwrite concurrent verification changes.
      if(invalidReason){for(const key of ['suppressedAt','verificationStatus','deliverabilityStatus'])filter[key]=Object.hasOwn(contact,key)?contact[key]:{$exists:false};}
      operations.push({updateOne:{filter,update:{$set:update}}});if(operations.length>=200)await flush();
    }
    await flush();counters.completedAt=new Date().toISOString();counters.recordsAfter=await collection.countDocuments(scope);if(options.apply)counters.suppressed=await collection.countDocuments({...scope,suppressionAuditRunId:runId});checkpoint();
    console.log(JSON.stringify({phase:'complete',...counters,output}));
  }finally{await connection.close();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({phase:'failed',errorType:error.name,code:error.code||null,message:'Audit failed; no connection credentials printed. Inspect configuration and private checkpoints.'}));process.exitCode=1;});
module.exports={argsFor};

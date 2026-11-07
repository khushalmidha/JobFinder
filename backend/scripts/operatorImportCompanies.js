// Privileged local maintenance CLI, not a web-admin shortcut or startup hook.
const fs=require('node:fs'),path=require('node:path'),mongoose=require('mongoose');
async function main(args=process.argv.slice(2)){
  const flags={},booleans=new Set(['--apply','--rollback','--include-shared']);
  const allowed=new Set(['--apply','--rollback','--include-shared','--env-file','--owner-email','--authorization','--source','--run-id','--digest','--backup-dir','--reviewed-inboxes','--output']);
  for(let i=0;i<args.length;i++){
    const flag=args[i];if(!allowed.has(flag))throw new Error('Unknown operator-import argument');
    flags[flag]=booleans.has(flag)?true:args[++i];if(!flags[flag]||String(flags[flag]).startsWith('--'))throw new Error('Missing argument value');
  }
  if(!flags['--owner-email']||!flags['--env-file'])throw new Error('Explicit owner email and private operator environment file required');
  const environment=require('dotenv').parse(fs.readFileSync(path.resolve(flags['--env-file'])));
  if(!environment.MONGODB_URI)throw new Error('Operator database credentials are not configured');
  if(flags['--apply']&&flags['--rollback'])throw new Error('Choose apply or rollback');
  if(flags['--apply']&&(!mongoose.isValidObjectId(flags['--run-id'])||!/^[a-f0-9]{64}$/.test(flags['--digest']||'')||!flags['--backup-dir']))throw new Error('Apply requires the reviewed run ID, digest and private backup directory');
  await mongoose.connect(environment.MONGODB_URI,{autoIndex:false,autoCreate:false});
  try{
    for(const name of ['CompanyImportRun','CompanyProspect','PublicRecruitmentLead'])await require(`../models/${name}`).createIndexes();
    const service=require('../services/operatorCompanyImportService');
    const json=file=>JSON.parse(fs.readFileSync(path.resolve(file),'utf8').replace(/^\uFEFF/,''));
    const result=flags['--rollback']?await service.rollback({ownerEmail:flags['--owner-email'],runId:flags['--run-id'],digest:flags['--digest']}):flags['--apply']?await service.apply({ownerEmail:flags['--owner-email'],runId:flags['--run-id'],digest:flags['--digest'],backupDirectory:flags['--backup-dir'],reviewedEvidence:flags['--reviewed-inboxes']?json(flags['--reviewed-inboxes']).public_recruiting_contacts:[]}):await service.prepare({ownerEmail:flags['--owner-email'],includeShares:flags['--include-shared']===true,authorization:flags['--authorization'],reviewedEvidence:flags['--reviewed-inboxes']?json(flags['--reviewed-inboxes']).public_recruiting_contacts:[],...(flags['--source']?{source:json(flags['--source'])}:{})});
    if(flags['--output'])fs.writeFileSync(path.resolve(flags['--output']),JSON.stringify(result,null,2),{flag:'wx'});
    console.log(JSON.stringify({runId:result.runId,digest:result.digest,alreadyApplied:result.alreadyApplied,summary:result.summary,accountCount:result.scope?.length},null,2));
    return result;
  }finally{await mongoose.disconnect();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};

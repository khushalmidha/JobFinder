// Operator-only CLI. No HTTP endpoint, paid provider call or email dispatch.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const {EJSON}=require('bson');
require('dotenv').config({quiet:true});
const Contact=require('../models/Contact');
const hygiene=require('../services/contactHygieneService');
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...value]=arg.replace(/^--/,'').split('=');return [key,value.join('=')||true];}));
async function main(){
  const owners=[...new Set(String(args.owners||'').split(',').filter(Boolean))];
  if(!owners.length||owners.some(id=>!mongoose.isValidObjectId(id))||typeof args.out!=='string'||!path.isAbsolute(args.out))throw new Error('Explicit --owners=ID,ID and absolute private --out=PATH required');
  if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI required');
  await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
  const directory=path.join(args.out,new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const backup=path.join(directory,'contacts.ejsonl'),fd=fs.openSync(backup,'wx',0o600),hash=crypto.createHash('sha256');let count=0;
  try{for await(const contact of Contact.find({userId:{$in:owners}}).lean().cursor()){const line=EJSON.stringify(contact)+'\n';fs.writeSync(fd,line);hash.update(line);count++;}}finally{fs.closeSync(fd);}
  const manifest={owners,count,sha256:hash.digest('hex'),backup,apply:args.apply===true,startedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  const reports=[];
  for(const userId of owners){let cursor;const totals={userId,checked:0,confirmedInvalid:0,removed:0,inconclusive:0,routeCapable:0,mailboxValid:0,heldForReconciliation:0,conflicts:0};
    do{const result=await hygiene.scan({userId,afterId:cursor,force:true,apply:args.apply===true,limit:200});for(const key of Object.keys(totals))if(key!=='userId')totals[key]+=result[key];cursor=result.nextCursor;
      fs.writeFileSync(path.join(directory,'progress.json'),JSON.stringify({completed:reports,current:totals,cursor},null,2),{mode:0o600});
      console.log(JSON.stringify({owner:userId,batch:result.checked,checked:totals.checked,confirmedInvalid:totals.confirmedInvalid,removed:totals.removed}));
      if(!result.checked)break;
    }while(cursor);reports.push(totals);
  }
  const report={...manifest,finishedAt:new Date().toISOString(),reports};fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({report:path.join(directory,'report.json'),reports}));
}
main().catch(error=>{console.error('Contact audit stopped:',error.name);process.exitCode=1;}).finally(()=>mongoose.disconnect());

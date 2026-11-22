const express=require('express'),ExcelJS=require('exceljs');
const router=express.Router();router.use(require('../middleware/auth'));
const Lead=require('../models/ProfessionalLead'),Suppression=require('../models/RecipientSuppression');
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(400).json({error:error.message});}};
async function rows(req){
  const kind=req.query.kind;if(kind&&!['recruiter','hiring_manager','role_inbox','engineer'].includes(kind))throw Error('Unknown contact section');
  const blocked=await Suppression.distinct('email',{userId:req.user._id});
  const unsafe=await require('../models/Contact').find({userId:req.user._id,$or:[{suppressedAt:{$ne:null}},{optOutAt:{$ne:null}},{deliverabilityStatus:'invalid'},{verificationStatus:'invalid'},{status:{$in:['bounced','removed','replied','reply_received','positive_response','negative_response']}}]}).select('email').lean();
  blocked.push(...unsafe.map(row=>row.email.trim().toLowerCase()));
  const owner=await require('../models/User').findById(req.user._id).select('blockedCompanies').lean();
  const companyKey=require('../services/companyIdentityService').companyKey,blockedCompanies=new Set((owner?.blockedCompanies||[]).map(companyKey));
  const found=await Lead.find({userId:req.user._id,email:{$nin:blocked},...(kind?{kind}:{}),...(req.query.notImported==='true'?{importedToContactAt:{$exists:false}}:{})}).sort({regionPriority:-1,observedAt:-1}).limit(10000).lean();
  return found.filter(row=>!blockedCompanies.has(companyKey(row.company)));
}
router.get('/leads',wrap(async(req,res)=>res.json({leads:await rows(req)})));
router.get('/status',wrap(async(req,res)=>{const found=await rows(req);res.json({counts:found.reduce((out,r)=>{out[r.kind]=(out[r.kind]||0)+1;return out;},{}),total:found.length,paidProvidersEnabled:false,defaultDryRun:true});}));
router.post('/scan',wrap(async(req,res)=>res.json(await require('../services/professionalDiscoveryService').runDiscovery({userId:req.user._id,domains:req.body.domains,dryRun:req.body.dryRun===undefined?true:req.body.dryRun,maxRequests:req.body.maxRequests===undefined?25:req.body.maxRequests,saveToContacts:req.body.saveToContacts===true}))));
router.post('/import',wrap(async(req,res)=>res.json(await require('../services/professionalSheetService').importLeads({userId:req.user._id,leadIds:req.body.leadIds}))));
router.get('/export',wrap(async(req,res)=>{
  const found=await rows(req),format=req.query.format||'csv';if(!['csv','xlsx'].includes(format))throw Error('Use CSV or XLSX');
  const columns=['company','companyRegion','domain','name','title','kind','email','sourceUrl','observedAt','verificationStatus','confidence'];
  // Keep cells literal in spreadsheet consumers; never export executable formulas.
  const literal=value=>{const s=String(value??'');return /^[=+@-]/.test(s)?"'"+s:s;};
  if(format==='csv'){res.set('Content-Type','text/csv; charset=utf-8');res.attachment('professional-contacts.csv');return res.send([columns.join(','),...found.map(r=>columns.map(k=>'"'+literal(r[k]).replaceAll('"','""')+'"').join(','))].join('\r\n'));}
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Professional contacts');sheet.columns=columns.map(key=>({header:key,key,width:24}));for(const row of found)sheet.addRow(Object.fromEntries(columns.map(k=>[k,literal(row[k])])));
  res.attachment('professional-contacts.xlsx');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');await book.xlsx.write(res);res.end();
}));
module.exports=router;

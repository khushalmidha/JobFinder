const router = require('express').Router();
const mongoose = require('mongoose');
const admission = require('../services/contactAdmissionService');
const Candidate = require('../models/ContactCandidate');
const Proof = require('../models/MailboxProof');
const User = require('../models/User');
router.use(require('../middleware/auth'));
const wrap=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status||400).json({error:e.message});}};
router.get('/',wrap(async req=>{
  const query={userId:req.user._id,...(req.query.state?{state:String(req.query.state)}:{})};
  const page=Math.max(1,Math.min(1000,Number.parseInt(req.query.page,10)||1));
  const [rows,total]=await Promise.all([Candidate.find(query).sort({updatedAt:-1}).skip((page-1)*50).limit(50).select('email company state reason domainStatus checkedAt').lean(),Candidate.countDocuments(query)]);
  return {rows,total,page,pageSize:50,paidVerificationAutomatic:false};
}));
router.post('/:id/recheck',wrap(async req=>{
  if(!mongoose.isValidObjectId(req.params.id))throw new Error('Invalid candidate ID');
  const candidate=await Candidate.findOne({_id:req.params.id,userId:req.user._id}).lean();
  if(!candidate)throw new Error('Owned candidate not found');
  return admission.intake(req.user._id,[candidate.payload],{checkUnverifiedDomain:true});
}));
const Lead=require('../models/ProfessionalLead');
const patternFilter = userId => ({
 userId,inferenceFlag:true,'patternEvidence.1':{$exists:true},
 observedAt:{$gte:new Date(Date.now()-30*86400000)}
});
router.get('/pattern-leads',wrap(async req=>{
 const userId=req.user._id;
 const rows=await Lead.find(patternFilter(userId)).sort({regionPriority:-1,observedAt:-1}).limit(50)
  .select('company name title email kind sourceUrl').lean();
 const emails=rows.map(row=>row.email);
 const [blocks, existing]=await Promise.all([
  require('../models/RecipientSuppression').distinct('email',{userId,email:{$in:emails}}),
  require('../models/Contact').distinct('email',{userId,email:{$in:emails}})
 ]);
 const excluded=new Set([...blocks,...existing].map(admission.normalize));
 const owner=await User.findById(userId).select('blockedCompanies').lean();
 const {companyKey}=require('../services/companyIdentityService');
 const companies=new Set((owner?.blockedCompanies||[]).map(companyKey));
 return {rows:rows.filter(row=>!excluded.has(row.email)&&!companies.has(companyKey(row.company)))};
}));
router.post('/pattern-leads/:id/verify',wrap(async req=>{
 if(req.body.approved!==true || !mongoose.isValidObjectId(req.params.id))throw Error('Approve one Hunter verification check for an owned lead');
 const userId=req.user._id;
 const lead=await Lead.findOne({...patternFilter(userId),_id:req.params.id}).lean();
 if(!lead)throw Error('Current pattern evidence unavailable');
 const owner=await User.findById(userId).select('hunterApiKey blockedCompanies').lean();
 if(!owner?.hunterApiKey)throw Error('Connect a Hunter key in Settings first');
 const {companyKey}=require('../services/companyIdentityService');
 if((owner.blockedCompanies||[]).map(companyKey).includes(companyKey(lead.company)) ||
   await require('../models/RecipientSuppression').exists({userId,email:lead.email}))throw Error('Contact is blocked');
 const candidate=await admission.stage(userId,{
  email:lead.email,company:lead.company,hrName:lead.name,role:lead.title,contactKind:lead.kind,
  source:'career_crawler',inferenceFlag:true,
  provenance:[{url:lead.sourceUrl,provider:'observed_pattern',observedAt:lead.observedAt}]
 },'pending_verification','Pattern candidate awaiting mailbox verification');
 if(!candidate||candidate.state!=='pending_verification')throw Error('Candidate is not eligible for verification');
 return verifyCandidate(userId,candidate);
}));
router.post('/contact/:id/verify',wrap(async req=>{
  if(req.body.approved!==true)throw new Error('Explicit approval of one Hunter verification credit required');
  if(!mongoose.isValidObjectId(req.params.id))throw new Error('Invalid contact ID');
  const userId=req.user._id;
  const contact=await require('../models/Contact').findOne({_id:req.params.id,userId}).lean();
  if(!contact || contact.optOutAt || contact.suppressedAt || contact.deliverabilityStatus==='invalid' ||
    ['removed','bounced'].includes(contact.status))throw new Error('Contact unavailable for verification');
  if(await require('../models/RecipientSuppression').exists({userId,email:admission.normalize(contact.email)}))
    throw new Error('Recipient is suppressed; no verification started');
  if(!(await User.exists({_id:userId,hunterApiKey:{$type:'string',$ne:''}})))throw new Error('Connect a Hunter key in Settings first');
  const candidate=await admission.stage(userId,contact,'pending_verification','Owner requested a mailbox check');
  if(!candidate || !['pending_verification','domain_inconclusive'].includes(candidate.state))throw new Error('Contact is not eligible for verification');
  return verifyCandidate(userId,candidate);
}));
router.post('/:id/verify',wrap(async req=>{
  if(req.body.approved!==true)throw new Error('Explicit approval of one Hunter verification credit required');
  if(!mongoose.isValidObjectId(req.params.id))throw new Error('Invalid candidate ID');
  const candidate=await Candidate.findOne({_id:req.params.id,userId:req.user._id}).lean();
  if(!candidate)throw new Error('Owned candidate not found');
  return verifyCandidate(req.user._id,candidate);
}));
async function verifyCandidate(userId,candidate) {
  if(await require('../models/RecipientSuppression').exists({userId,email:candidate.email}))throw new Error('Recipient is suppressed; no paid verification started');
  const user=await User.findById(userId);
  if(!user?.hunterApiKey)throw new Error('Configure Hunter key and explicitly approved Research credit budget first');
  if(await admission.validProof(user._id,candidate.email))return {...await admission.intake(user._id,[candidate.payload]),creditsUsed:0};
  const crypto=require('crypto'), token=crypto.randomUUID(), requestedAt=new Date();
  const lease=await Candidate.findOneAndUpdate({_id:candidate._id,userId:user._id,$and:[{$or:[{verificationLeaseUntil:{$exists:false}},{verificationLeaseUntil:{$lte:requestedAt}}]},{$or:[{verificationRequestedAt:{$exists:false}},{verificationRequestedAt:{$lt:new Date(+requestedAt-60000)}}]}]},{$set:{verificationToken:token,verificationLeaseUntil:new Date(+requestedAt+120000),verificationRequestedAt:requestedAt}},{returnDocument:'after'});
  if(!lease)throw new Error('Verification already running or cooldown active; no extra credit reserved');
  try {
  const result=await require('../services/leadAgencyService').verifyHunterEmail({email:candidate.email,userId:user._id,apiKey:user.hunterApiKey});
  const outcome=result.verificationStatus==='vendor_verified'?'valid':result.verificationStatus==='invalid'?'invalid':result.verificationStatus==='catch_all'?'catch_all':'unknown';
  const now=new Date();
  await Proof.create({userId:user._id,email:candidate.email,provider:'hunter_verifier',outcome,checkedAt:now,expiresAt:new Date(+now+30*86400000)});
  return {...await admission.intake(user._id,[candidate.payload]),providerOutcome:outcome,creditsReserved:1};
  } finally {await Candidate.updateOne({_id:candidate._id,verificationToken:token},{$set:{verificationLeaseUntil:new Date(0)},$unset:{verificationToken:1}});
    require('../controllers/contactController').invalidateContactCache(userId);
  }

}
module.exports=router;

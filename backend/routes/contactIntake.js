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
router.post('/:id/verify',wrap(async req=>{
  if(req.body.approved!==true)throw new Error('Explicit approval of one Hunter verification credit required');
  if(!mongoose.isValidObjectId(req.params.id))throw new Error('Invalid candidate ID');
  const candidate=await Candidate.findOne({_id:req.params.id,userId:req.user._id}).lean();
  if(!candidate)throw new Error('Owned candidate not found');
  if(await require('../models/RecipientSuppression').exists({userId:req.user._id,email:candidate.email}))throw new Error('Recipient is suppressed; no paid verification started');
  const user=await User.findById(req.user._id);
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
  } finally {await Candidate.updateOne({_id:candidate._id,verificationToken:token},{$set:{verificationLeaseUntil:new Date(0)},$unset:{verificationToken:1}});}

}));
module.exports=router;

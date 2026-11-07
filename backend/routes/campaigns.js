const express=require('express');
const router=express.Router();router.use(require('../middleware/auth'));
const Campaign=require('../models/OutreachCampaign'),Dispatch=require('../models/OutreachDispatch'),Runtime=require('../models/OutreachRuntime');
const User=require('../models/User'),Contact=require('../models/Contact'),Company=require('../models/Company'),MailLog=require('../models/MailLog');
const service=require('../services/campaignService');
const {contactBlockReason}=require('../services/outreachResearchService');
const {qualifyCompany}=require('../services/salaryEvidenceService');
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(400).json({error:e.message});}};
router.get('/options',wrap(async(req,res)=>{
  const user=await User.findById(req.user._id);if(!user)return res.status(404).json({error:'User not found'});
  const search=String(req.query.q||'').trim().slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rows=await Contact.find({userId:user._id,...(search?{$or:[{email:{$regex:search,$options:'i'}},{company:{$regex:search,$options:'i'}}]}:{})}).sort({createdAt:-1}).limit(1000).lean();
  const companies=await Company.find({_id:{$in:rows.filter(r=>r.companyId).map(r=>r.companyId)}}).lean();
  const map=new Map(companies.map(c=>[String(c._id),c]));
  const contacts=rows.map(c=>({_id:c._id,email:c.email,company:c.company,hrName:c.hrName,verificationStatus:c.verificationStatus,provenance:c.provenance,
    blockReason:contactBlockReason(c)||(!['publicly_sourced','vendor_verified'].includes(c.verificationStatus)?'Requires publicly sourced or provider-verified contact':null),
    salaryQualified:qualifyCompany(map.get(String(c.companyId))||{}).qualificationStatus==='qualified'}));
  const runtime=await Runtime.findById('global').select('lastPollAt lastDispatchAt lastError nextAllowedAt').lean();
  res.json({senders:service.senderOptions(user).map(({id,email,name,provider})=>({id,email,name,provider})),contacts,sendingEnabled:process.env.OUTREACH_SENDING_ENABLED==='true',workerEnabled:process.env.OUTREACH_WORKER_ENABLED==='true',maxDailyLimit:Math.min(user.dailyEmailLimit||10,service.configuredLimit('OUTREACH_MAX_DAILY',10)),quotaDay:'UTC',runtime,admin:user.role==='admin',contactsTruncated:rows.length===1000});
}));
router.get('/',wrap(async(req,res)=>{
  const campaigns=await Campaign.find({userId:req.user._id}).sort({createdAt:-1}).limit(100).lean();
  res.json({campaigns});
}));
router.post('/preview',wrap(async(req,res)=>res.json(await service.previewCampaign(req.user._id,req.body))));
router.post('/',wrap(async(req,res)=>res.json(await service.saveCampaign(req.user._id,req.body))));
router.get('/:id',wrap(async(req,res)=>{
  const campaign=await Campaign.findOne({_id:service.objectId(req.params.id),userId:req.user._id}).lean();
  if(!campaign)return res.status(404).json({error:'Campaign not found'});
  const dispatches=await Dispatch.find({campaignId:campaign._id,userId:req.user._id}).sort({_id:1}).lean();
  res.json({campaign,dispatches});
}));
router.patch('/:id',wrap(async(req,res)=>res.json(await service.saveCampaign(req.user._id,req.body,req.params.id))));
router.post('/:id/approve',wrap(async(req,res)=>res.json(await service.approveCampaign(req.user._id,req.params.id,req.body.digest))));
for(const action of ['pause','resume','cancel'])router.post(`/:id/${action}`,wrap(async(req,res)=>res.json(await service.controlCampaign(req.user._id,req.params.id,action))));
router.post('/:id/dispatches/:dispatchId/reconcile',wrap(async(req,res)=>{
  const campaign=await Campaign.findOne({_id:service.objectId(req.params.id),userId:req.user._id});
  if(!campaign)return res.status(404).json({error:'Campaign not found'});
  const {outcome,providerMessageId,notes,acknowledge}=req.body;
  if(acknowledge!==true||!['sent','not_sent'].includes(outcome)||typeof notes!=='string'||notes.trim().length<10||notes.length>1000)throw new Error('Explicit provider-history reconciliation and detailed notes required');
  if(outcome==='sent'&&(typeof providerMessageId!=='string'||!providerMessageId.trim()||providerMessageId.length>500))throw new Error('Provider message identifier required');
  const row=await Dispatch.findOneAndUpdate({_id:service.objectId(req.params.dispatchId),campaignId:campaign._id,userId:req.user._id,status:'unknown_outcome'},{$set:{status:outcome==='sent'?'sent':'failed',providerMessageId:outcome==='sent'?providerMessageId:'',reason:`Owner reconciled ${outcome}: ${notes}`,finishedAt:new Date()}},{returnDocument:'after'});
  if(!row)throw new Error('Unknown outcome not found; refresh status');
  if(outcome==='sent')await MailLog.updateOne({dispatchId:row._id},{$setOnInsert:{dispatchId:row._id,campaignId:campaign._id,userId:req.user._id,contactId:row.contactId,recipientEmail:row.recipientEmail,senderEmail:row.senderEmail,subject:row.subject,body:row.body,status:'sent',providerMessageId,sentAt:row.startedAt}},{upsert:true});
  await Campaign.updateOne({_id:campaign._id,userId:req.user._id},{$push:{events:{$each:[{at:new Date(),action:'owner_reconciled',reason:`${row._id}: ${notes}`}],$slice:-200}}});
  res.json({dispatch:row,automaticallyRetried:false});
}));
module.exports=router;

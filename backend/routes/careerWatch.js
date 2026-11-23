const express=require('express'),mongoose=require('mongoose');
const router=express.Router();router.use(require('../middleware/auth'));
const Config=require('../models/CareerWatchConfig'),Task=require('../models/CareerWatchTask'),Job=require('../models/CareerWatchJob'),Notification=require('../models/CareerWatchNotification');
const service=require('../services/careerWatchService');
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(400).json({error:error.message});}};
router.get('/status',wrap(async(req,res)=>{
 const userId=req.user._id;const [config,total,due,running,failed,unmapped,jobs,notifications,unread,next]=await Promise.all([Config.findOne({userId}).lean(),Task.countDocuments({userId}),Task.countDocuments({userId,nextScanAt:{$lte:new Date()},portalStatus:{$ne:'needs_portal_mapping'}}),Task.countDocuments({userId,state:'running'}),Task.countDocuments({userId,state:'failed'}),Task.countDocuments({userId,portalStatus:'needs_portal_mapping'}),Job.countDocuments({userId}),Notification.countDocuments({userId}),Notification.countDocuments({userId,readAt:{$exists:false}}),Task.findOne({userId,portalStatus:{$ne:'needs_portal_mapping'}}).sort({nextScanAt:1}).select('nextScanAt').lean()]);
 res.json({config:{...(config||{enabled:false,intervalHours:5,discoverContacts:true,dailyRequestLimit:20000}),indiaFocus:true},workerEnabled:process.env.CAREER_WATCH_ENABLED==='true',professionalDiscoveryEnabled:process.env.PROFESSIONAL_DISCOVERY_BACKGROUND_ENABLED==='true',stopped:process.env.RESEARCH_STOP==='true',nextScanAt:next?.nextScanAt||null,tasks:{total,due,running,failed,needsPortalMapping:unmapped},counts:{jobs,notifications,unread}});
}));
router.put('/config',wrap(async(req,res)=>{
 if(typeof req.body.enabled!=='boolean')throw Error('Choose enabled true or false');
 const set={enabled:req.body.enabled,intervalHours:5,indiaFocus:true};
 if(req.body.indiaFocus!==undefined&&typeof req.body.indiaFocus!=='boolean')throw Error('India focus must be boolean');
 if(req.body.autoImportContacts!==undefined){if(typeof req.body.autoImportContacts!=='boolean')throw Error('Choose auto-import true or false');set.autoImportContacts=req.body.autoImportContacts;}
 if(req.body.discoverContacts!==undefined){if(typeof req.body.discoverContacts!=='boolean')throw Error('Choose contact discovery explicitly');set.discoverContacts=req.body.discoverContacts;}
 if(req.body.dailyRequestLimit!==undefined){if(!Number.isInteger(req.body.dailyRequestLimit)||req.body.dailyRequestLimit<0||req.body.dailyRequestLimit>50000)throw Error('Use a free HTTP daily request budget between 0 and 50000');set.dailyRequestLimit=req.body.dailyRequestLimit;}
 res.json({config:await Config.findOneAndUpdate({userId:req.user._id},{$set:set},{upsert:true,returnDocument:'after',runValidators:true})});
}));
router.post('/enqueue',wrap(async(req,res)=>res.json(await service.enqueueWatchCompanies(req.user._id,{companyIds:req.body.companyIds}))));
router.post('/run',wrap(async(req,res)=>{
 if(req.body.dryRun!==undefined&&typeof req.body.dryRun!=='boolean')throw Error('dryRun must be boolean');
 res.json(await service.runCareerWatchOnce({userId:req.user._id,dryRun:req.body.dryRun!==false,maxCompanies:req.body.maxCompanies??1,maxRequests:req.body.maxRequests??12,maxRuntimeSeconds:30}));
}));
router.get('/tasks',wrap(async(req,res)=>{
 const filter={userId:req.user._id};if(req.query.portalStatus==='needs_portal_mapping')filter.portalStatus='needs_portal_mapping';
 const page=Math.max(1,Math.min(10000,parseInt(req.query.page)||1)),limit=50;
 const [tasks,total]=await Promise.all([Task.find(filter).sort({regionPriority:-1,company:1}).skip((page-1)*limit).limit(limit).select('company region employerDomain careersUrl portalStatus state nextScanAt lastScannedAt lastError contactLastError').lean(),Task.countDocuments(filter)]);
 res.json({tasks,total,page,limit});
}));
const activeIndiaJobs = now => ({
 closedAt:null,
 $and:[
  {$or:[{locationRegion:'India'},{remoteEligibility:'india'}]},
  {$or:[{validThrough:null},{validThrough:{$gt:now}}]}
 ]
});
router.get('/jobs',wrap(async(req,res)=>{
 const userId=req.user._id,filter={userId,...activeIndiaJobs(new Date())};if(req.query.eligibility){if(!['eligible','needs_review','excluded'].includes(req.query.eligibility))throw Error('Unknown eligibility filter');filter.eligibility=req.query.eligibility;}
 const choices={employmentType:['internship','full_time','other'],graduationFit:['fits','outside'],remoteEligibility:['india'],sponsorship:['explicit','case_by_case','unavailable'],roleFamily:['software','ai_ml','quant','product']};
 for(const [field,values] of Object.entries(choices)){
  const value=req.query[field];
  if(value===undefined)continue;
  if(value==='unknown')filter[field]={$nin:values};
  else if(values.includes(value))filter[field]=value;
  else throw Error('Unknown job filter');
 }
 const page=Math.max(1,Math.min(10000,parseInt(req.query.page)||1)),limit=50;
 const [jobs,total]=await Promise.all([Job.find(filter).sort({locationPriority:-1,firstSeenAt:-1}).skip((page-1)*limit).limit(limit).lean(),Job.countDocuments(filter)]);
 res.json({jobs:jobs.map(j=>({...j,eligibilityStatus:j.eligibility,reason:j.eligibilityReason,discoveredAt:j.firstSeenAt,postingStatus:j.validThrough ? (j.validThrough <= new Date() ? 'expired' : 'published_deadline_active') : 'last_observed'})),total,page,limit});
}));
router.get('/notifications',wrap(async(req,res)=>{
 const userId=new mongoose.Types.ObjectId(req.user._id);
 const [result]=await Notification.aggregate([
  {$match:{userId}},
  {$lookup:{from:Job.collection.name,localField:'jobId',foreignField:'_id',pipeline:[{$match:{userId,...activeIndiaJobs(new Date())}},{$project:{url:1}}],as:'current'}},
  {$unwind:'$current'},
  {$set:{url:'$current.url'}},
  {$unset:'current'},
  {$facet:{notifications:[{$sort:{createdAt:-1}},{$limit:100}],unread:[{$match:{readAt:{$exists:false}}},{$count:'count'}]}}
 ]);
 res.json({notifications:result.notifications,unread:result.unread[0]?.count||0});
}));
router.post('/notifications/:id/read',wrap(async(req,res)=>{
 if(!mongoose.isValidObjectId(req.params.id))throw Error('Invalid notification ID');
 const notification=await Notification.findOneAndUpdate({_id:req.params.id,userId:req.user._id},{$set:{readAt:new Date()}},{returnDocument:'after'});
 if(!notification)return res.status(404).json({error:'Notification not found'});res.json({notification});
}));
module.exports=router;

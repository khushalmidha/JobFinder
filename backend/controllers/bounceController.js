const Contact = require('../models/Contact');
exports.scanBounces = async (req,res) => {
  try{
    const report=await require('../services/providerDsnService').scanProviderBounces(req.user._id,{apply:true,maxMessages:200,cursors:req.body?.cursors||{}});
    res.json({...report,message:'Verified provider 5.1.1 failures suppressed; uncertain or unmatched notices preserved for review.'});
  }catch{res.status(502).json({error:'Mailbox scan incomplete. Check TLS mailbox settings; no unverified failure was treated as invalid.'});}
};
exports.deleteBounced = async (req, res) => {
  try {
    // Legacy bounce labels can be untrusted. Quarantine without asserting that
    // a mailbox is invalid, and retain stronger existing suppression reasons.
    const rows=await Contact.find({userId:req.user._id,status:'bounced',deliverabilityStatus:'invalid'}).lean();let deletedCount=0;
    const Suppression=require('../models/RecipientSuppression'),Dispatch=require('../models/OutreachDispatch');
    for(const row of rows){
      const trusted=await Suppression.exists({userId:req.user._id,email:row.email.trim().toLowerCase(),source:{$in:['authenticated_provider_5.1.1','authenticated_provider_recipient_failure','confirmed_invalid_pipeline']}});
      if(!trusted||await Dispatch.exists({userId:req.user._id,recipientEmail:row.email,status:{$in:['sending','unknown_outcome']}}))continue;
      const removed=await Contact.deleteOne({_id:row._id,userId:req.user._id,updatedAt:row.updatedAt});deletedCount+=removed.deletedCount;
    }
    const result=await Contact.updateMany({userId:req.user._id,status:'bounced',suppressedAt:null},{$set:{suppressedAt:new Date(),suppressionReason:'Legacy bounce quarantine; mailbox existence inconclusive'}});
    res.json({message:'Confirmed-invalid contacts removed; other bounce labels quarantined; history and suppression preserved.',deletedCount,suppressedCount:result.modifiedCount});
  }catch{res.status(500).json({error:'Bounce cleanup failed'});}
};

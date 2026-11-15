const mongoose=require('mongoose');
const Contact=require('../models/Contact');
const Suppression=require('../models/RecipientSuppression');
const Dispatch=require('../models/OutreachDispatch');
const normalize=value=>String(value||'').trim().toLowerCase();
function handler(block){return async(req,res)=>{
  try{
    const ids=req.body.contactIds;
    if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'||!mongoose.isValidObjectId(id)))return res.status(400).json({error:'Select between 1 and 10000 valid contact IDs'});
    const rows=await Contact.find({_id:{$in:[...new Set(ids)]},userId:req.user._id}).select('email').lean();
    const emails=[...new Set(rows.map(row=>normalize(row.email)).filter(Boolean))];
    if(block && emails.length){
      // Keep opt-out and confirmed-invalid evidence if it already exists.
      await Suppression.bulkWrite(emails.map(email=>({updateOne:{filter:{userId:req.user._id,email},update:{$setOnInsert:{userId:req.user._id,email,source:'owner_block',reason:'Owner manually blocked this email'}},upsert:true}})));
      await Dispatch.updateMany({userId:req.user._id,recipientEmail:{$in:emails},status:'queued'},{$set:{status:'suppressed',reason:'Owner blocked recipient email',finishedAt:new Date()}});
    }
    if(!block && emails.length)await Suppression.deleteMany({userId:req.user._id,email:{$in:emails},source:'owner_block'});
    require('../controllers/contactController').invalidateContactCache(req.user._id);
    const remaining=emails.length?await Suppression.find({userId:req.user._id,email:{$in:emails}}).select('email source').lean():[];
    return res.json({matchedContacts:rows.length,uniqueEmails:emails.length,blocked:remaining.length,unblocked:emails.length-remaining.length,remainingSuppression:remaining.map(row=>({email:row.email,source:row.source})),message:block?'Selected emails blocked; history preserved.':'Manual blocks removed. Opt-outs and confirmed-invalid suppression remain enforced. Cancelled or suppressed messages are not automatically requeued.'});
  }catch(error){return res.status(500).json({error:'Email block update failed; retry safely'});}
};}
module.exports={block:handler(true),unblock:handler(false)};

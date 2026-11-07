const mongoose=require('mongoose');
// Immutable consumption evidence survives later challenge retries/recovery.
module.exports=mongoose.model('EmailVerificationReceipt',new mongoose.Schema({
  _id:String,userId:{type:mongoose.Schema.Types.ObjectId,required:true},
  email:{type:String,required:true},consumedAt:{type:Date,required:true}
},{timestamps:true}));

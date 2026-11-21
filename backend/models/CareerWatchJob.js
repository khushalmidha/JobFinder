const mongoose=require('mongoose');
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,required:true},company:String,domain:String,url:{type:String,required:true},title:String,location:String,locationRegion:{type:String,default:'unknown'},locationPriority:{type:Number,default:0},companyRegion:String,description:String,sourceType:String,eligibility:{type:String,enum:['eligible','needs_review','excluded']},eligibilityReason:String,track:String,experienceEvidence:String,salaryStatus:{type:String,default:'unverified'},firstSeenAt:{type:Date,default:Date.now},lastSeenAt:Date},{timestamps:true});
schema.index({userId:1,url:1},{unique:true});schema.index({userId:1,eligibility:1,firstSeenAt:-1});
module.exports=mongoose.model('CareerWatchJob',schema);

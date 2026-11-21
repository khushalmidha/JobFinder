const mongoose=require('mongoose');
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,required:true},jobId:{type:mongoose.Schema.Types.ObjectId,required:true},title:String,company:String,url:String,readAt:Date},{timestamps:true});
schema.index({userId:1,jobId:1},{unique:true});schema.index({userId:1,createdAt:-1});
module.exports=mongoose.model('CareerWatchNotification',schema);

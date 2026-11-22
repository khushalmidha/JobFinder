const mongoose=require('mongoose');
const schema=new mongoose.Schema({userId:{type:mongoose.Schema.Types.ObjectId,required:true,unique:true},enabled:{type:Boolean,default:false},indiaFocus:{type:Boolean,default:true},autoImportContacts:{type:Boolean,default:false},discoverContacts:{type:Boolean,default:true},intervalHours:{type:Number,default:5,enum:[5]},dailyRequestLimit:{type:Number,default:20000,min:0,max:50000},requestsDay:String,requestsUsed:{type:Number,default:0},lastRunAt:Date,lastError:String},{timestamps:true});
module.exports=mongoose.model('CareerWatchConfig',schema);

const mongoose = require('mongoose');
module.exports = mongoose.model('EmailVerificationBudget',new mongoose.Schema({
  _id:String, used:{type:Number,default:0}
},{timestamps:true}));

const mongoose = require('mongoose');
// A deliberately conservative single global dispatch lane. No Redis/cloud cost.
module.exports = mongoose.model('OutreachRuntime', new mongoose.Schema({
  _id: String, leaseToken: String, leaseUntil: Date, nextAllowedAt: Date,
  lastPollAt: Date, lastDispatchAt: Date, lastError: String
}, { timestamps: true }));

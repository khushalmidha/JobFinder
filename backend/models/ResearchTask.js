const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  companyId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Company' },
  status: { type: String, enum: ['queued','running','complete','failed'], default: 'queued' },
  availableAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseToken: String,
  attempts: { type: Number, default: 0 },
  lastError: String,
  result: { sourcedContacts: Number, addedContacts: Number, requestsUsed: Number, reason: String },
  completedAt: Date
}, { timestamps: true });
schema.index({ userId: 1, companyId: 1 }, { unique: true });
schema.index({ status: 1, availableAt: 1 });
module.exports = mongoose.model('ResearchTask',schema);

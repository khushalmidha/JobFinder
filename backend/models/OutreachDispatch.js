const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, required: true },
  revision: { type: Number, required: true },
  recipientEmail: { type: String, required: true }, subject: String, body: String,
  senderEmail: String, approvedDigest: String,
  scheduledAtUtc: Date,
  status: { type: String, enum: ['queued','sending','sent','failed','unknown_outcome','suppressed','cancelled'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  leaseToken: String, leaseUntil: Date,
  providerIdempotencyKey: String, providerMessageId: String,
  startedAt: Date, finishedAt: Date, reason: String
}, { timestamps: true });
schema.index({ campaignId: 1, recipientEmail: 1, revision: 1 }, { unique: true });
schema.index({ status: 1, leaseUntil: 1 });
schema.index({ userId: 1, recipientEmail: 1, status: 1 });
schema.index({ userId: 1, senderEmail: 1, startedAt: 1 });
module.exports = mongoose.model('OutreachDispatch', schema);

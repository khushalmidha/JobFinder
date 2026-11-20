const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  digest: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  mailLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'MailLog' },
  recipientEmail: String,
  providerMessageId: String,
  eventType: String,
  enhancedStatus: String,
  state: { type: String, enum: ['processing', 'completed'], default: 'processing' },
  authentication: { source:String, signingDomain:String, signatureId:String, rawSha256:String, reportedAt:Date },
  outcome: String
}, { timestamps: true });
// No TTL: old event identifiers must not become reusable.
module.exports = mongoose.model('DeliveryEventReceipt', schema);

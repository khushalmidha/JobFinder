const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  email: { type: String, required: true, maxlength: 254 },
  company: { type: String, maxlength: 300, default: 'Unknown' },
  payload: { type: mongoose.Schema.Types.Mixed },
  state: { type: String, enum: ['pending_verification', 'domain_inconclusive', 'confirmed_invalid', 'suppressed', 'promoted'], required: true },
  reason: { type: String, maxlength: 500 },
  domainStatus: String,
  checkedAt: Date,
  verificationLeaseUntil: Date,
  verificationToken: String,
  verificationRequestedAt: Date
}, { timestamps: true });
schema.index({ userId: 1, email: 1 }, { unique: true });
schema.index({ userId: 1, state: 1, updatedAt: -1 });
module.exports = mongoose.model('ContactCandidate', schema);

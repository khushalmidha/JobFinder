const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  provider: { type: String, enum: ['hunter_verifier'], required: true },
  outcome: { type: String, enum: ['valid', 'invalid', 'unknown', 'catch_all'], required: true },
  checkedAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
schema.index({ userId: 1, email: 1, checkedAt: -1 });
module.exports = mongoose.model('MailboxProof', schema);

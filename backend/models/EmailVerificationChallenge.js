const mongoose = require('mongoose');
// One durable challenge/rate-limit document per authenticated account.
module.exports = mongoose.model('EmailVerificationChallenge', new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  email: { type: String, required: true }, generation: String,
  codeHash: { type: String, select: false },
  state: { type: String, enum: ['idle','sending','sent','failed','consuming','consumed'], default: 'idle' },
  expiresAt: Date, requestedAt: Date, operationStartedAt: Date, consumedAt: Date,
  day: String, requestsToday: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 },
  outcome: String
}, { timestamps: true }));

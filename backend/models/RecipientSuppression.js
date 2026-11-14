const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true },
  reason: { type: String, required: true },
  source: { type: String, enum: ['owner_opt_out', 'authenticated_provider_5.1.1', 'confirmed_invalid_pipeline'], required: true },
  evidenceEventId: String,
  observedAt: { type: Date, default: Date.now }
}, { timestamps: true });
schema.index({ userId: 1, email: 1 }, { unique: true });
module.exports = mongoose.model('RecipientSuppression', schema);

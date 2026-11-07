const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  digest: { type: String, required: true },
  approvedDigest: String, approvedAt: Date, approvedBy: mongoose.Schema.Types.ObjectId,
  revision: { type: Number, default: 1 },
  state: { type: String, enum: ['draft','scheduled','running','paused','completed','cancelled','needs_review','failed'], default: 'draft' },
  startAtUtc: { type: Date, required: true }, nextAt: Date, startedAt: Date,
  reason: { type: String, default: '' },
  activeDispatchId: mongoose.Schema.Types.ObjectId, sendBoundaryAt: Date,
  events: [{ at: Date, action: String, reason: String }]
}, { timestamps: true });
schema.index({ state: 1, nextAt: 1 });
module.exports = mongoose.model('OutreachCampaign', schema);

const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  source: String, digest: String, databaseFingerprint: String,
  status: { type: String, enum: ['preview', 'applying', 'applied', 'failed', 'rolling_back', 'rolled_back'], default: 'preview' },
  lockKey: { type: String, default: 'company_import' },
  mutating: { type: Boolean, default: false },
  summary: mongoose.Schema.Types.Mixed,
  changes: [mongoose.Schema.Types.Mixed],
  journal: [mongoose.Schema.Types.Mixed],
  error: String, appliedAt: Date, rolledBackAt: Date,
  rollbackReport: mongoose.Schema.Types.Mixed,
  recoveryEvents: [{ at: Date, actor: mongoose.Schema.Types.ObjectId, previousStatus: String, reason: String }]
}, { timestamps: true });
// One shared-directory import mutates at a time across processes.
schema.index({ lockKey: 1 }, { unique: true, partialFilterExpression: { mutating: true } });
schema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.model('CompanyImportRun', schema);

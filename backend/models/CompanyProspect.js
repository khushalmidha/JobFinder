const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sourceRecordKey: { type: String, required: true, unique: true },
  source: { type: String, required: true },
  companyName: { type: String, required: true },
  regionGroup: { type: String, required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  identityStatus: { type: String, enum: ['matched', 'conflict'], default: 'matched' },
  identityReason: { type: String, default: '' },
  raw: { type: mongoose.Schema.Types.Mixed, required: true },
  contentHash: { type: String, required: true },
  qualificationStatus: { type: String, default: 'research_needed', enum: ['research_needed'] },
  sendEligible: { type: Boolean, default: false, enum: [false] },
  importRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyImportRun', required: true }
}, { timestamps: true });
schema.index({ regionGroup: 1, companyName: 1 });
schema.index({ companyId: 1 });
module.exports = mongoose.model('CompanyProspect', schema);

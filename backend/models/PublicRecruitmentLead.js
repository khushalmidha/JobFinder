const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sourceRecordKey: { type: String, required: true, unique: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  companyName: String, email: String, evidenceUrl: String,
  listingStatus: { type: String, enum: ['official_publicly_listed', 'source_claim_unchecked', 'not_found', 'inconclusive'], default: 'source_claim_unchecked' },
  checkedAt: Date, evidenceExcerpt: String, checkReason: String,
  mailboxVerified: { type: Boolean, default: false, enum: [false] },
  readyToSend: { type: Boolean, default: false, enum: [false] },
  importRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyImportRun' }
}, { timestamps: true });
module.exports = mongoose.model('PublicRecruitmentLead', schema);

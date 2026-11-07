const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOpening', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  recipient: { type: String, required: true },
  subject: String, body: String,
  supportingEvidence: [{ text: String, source: String }],
  status: { type: String, enum: ['draft', 'reviewed'], default: 'draft' }
}, { timestamps: true });
schema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.model('OutreachDraft', schema);

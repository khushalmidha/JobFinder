const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: String, required: true },
  hrName: { type: String, default: '' },
  email: { type: String, required: true },
  package: { type: String, default: '' },
  role: { type: String, default: '' },
  source: { type: String, enum: ['extension', 'excel_upload', 'recruiter_sheet', 'linkedin_scout', 'career_crawler', 'hunter.io', 'apollo.io'], default: 'extension' },
  linkedinUrl: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['pending', 'sent', 'failed', 'bounced', 'removed', 'replied', 'reply_received', 'positive_response', 'negative_response', 'auto_reply', 'follow_up_later'], 
    default: 'pending' 
  },
  isShared: { type: Boolean, default: false }, // Only manually marked shared contacts
  deliverabilityStatus: { 
    type: String, 
    enum: ['valid', 'invalid', 'unverified'], 
    default: 'unverified'
  },
  validationReason: { type: String, default: '' },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  provenance: [{ url: String, provider: String, observedAt: Date }],
  inferenceFlag: { type: Boolean, default: false },
  verificationStatus: { type: String, enum: ['unknown', 'domain_mail_capable', 'publicly_sourced', 'vendor_verified', 'inferred_unverified', 'catch_all', 'invalid'], default: 'unknown' },
  vendorStatus: String,
  suppressedAt: Date,
  suppressionReason: String,
  optOutAt: Date,
  validatedAt: { type: Date },
  repliedAt: { type: Date },
  replySnippet: { type: String, default: '' },
  notes: { type: String, default: '' },
  lastMailedAt: { type: Date },
}, {
  timestamps: true
});

contactSchema.index({ userId: 1, createdAt: -1 });
contactSchema.index({ userId: 1, status: 1 });
contactSchema.index({ userId: 1, deliverabilityStatus: 1 });
contactSchema.index({ userId: 1, company: 1 });
contactSchema.index({ email: 1 });

module.exports = mongoose.model('Contact', contactSchema);


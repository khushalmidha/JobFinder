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
  suppressionAuditRunId: String,
  smtpConnectivity: {
    runId: String,
    checkedAt: Date,
    domainStatus: String,
    smtpStatus: String,
    smtpHost: String,
    mailboxVerified: { type: Boolean, default: false }
  },
  validatedAt: { type: Date },
  hygieneCheckedAt: Date,
  hygieneDisposition: String,
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

// A server-controlled guard covers every Mongoose writer, including older
// import/scout paths. A client-supplied "valid" flag is never mailbox proof.
async function enforceDocument() {
  if (this.isNew || this.isModified('email') || (this.isModified('deliverabilityStatus') && this.deliverabilityStatus === 'valid') || (this.isModified('verificationStatus') && this.verificationStatus === 'vendor_verified')) {
    await require('../services/contactAdmissionService').assertAdmission(this);
  }
}
contactSchema.pre('validate', enforceDocument);
contactSchema.pre('save', enforceDocument);
contactSchema.pre('insertMany', async function(docs) {
  if (docs.length > 1000 && require('../services/contactAdmissionService').enabled()) throw new Error('Contact insertion batch exceeds1000');
  const results = await Promise.allSettled(docs.map(doc => require('../services/contactAdmissionService').assertAdmission(doc)));
  const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
});
async function guardUpdate(model, filter, update, options = {}) {
  const admission = require('../services/contactAdmissionService'); if (!admission.enabled()) return;
  if (Array.isArray(update)) throw new Error('Use verified contact intake for pipeline updates');
  const changes = {...update,...update?.$set,...update?.$setOnInsert};
  if(options.replacement && (!changes.email || !changes.userId))throw new Error('Replacement requires verified owner and email');
  const sensitive = ['email','userId'];
  if (Object.keys(update?.$rename || {}).some(k => sensitive.includes(k) || sensitive.includes(update.$rename[k])) || sensitive.some(k => k in (update?.$unset || {}))) throw new Error('Contact identity must use verified intake');
  if (!options.upsert && !('email' in changes) && !('userId' in changes) && changes.deliverabilityStatus !== 'valid' && changes.verificationStatus !== 'vendor_verified') return;
  if (options.multi) throw new Error('Bulk identity/validity changes require individual verified intake');
  const existing = options.upsert ? null : await model.findOne(filter).lean();
  await admission.assertAdmission({...existing,...filter,...changes});
}
for (const operation of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace']) contactSchema.pre(operation, async function() {
  await guardUpdate(this.model,this.getFilter(),this.getUpdate(),{...this.getOptions(),multi:operation==='updateMany',replacement:['replaceOne','findOneAndReplace'].includes(operation)});
});
contactSchema.pre('bulkWrite', async function(ops) {
  for (const op of ops) {
    if (op.insertOne) await require('../services/contactAdmissionService').assertAdmission(op.insertOne.document);
    for (const name of ['updateOne','updateMany','replaceOne']) if (op[name]) await guardUpdate(this,op[name].filter,op[name].update || op[name].replacement,{upsert:op[name].upsert,multi:name==='updateMany',replacement:name==='replaceOne'});
  }
});

module.exports = mongoose.model('Contact', contactSchema);


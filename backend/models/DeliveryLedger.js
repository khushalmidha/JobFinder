const mongoose = require('mongoose');

const deliveryLedgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true },
  senderEmail: { type: String, default: '', lowercase: true, trim: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutreachCampaign' },
  dispatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutreachDispatch' },
  providerMessageId: { type: String, default: '', trim: true },
  status: { type: String, enum: ['sent', 'delivered', 'bounced', 'failed'], default: 'sent' },
  bounceReason: { type: String, default: '' },
  sentAt: { type: Date, required: true },
  originalMailLogId: { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true },
  messageHash: { type: String, default: '' },
  archivedAt: { type: Date, default: Date.now }
});

// Indexes for duplicate checks, bounce correlation, and audit queries
deliveryLedgerSchema.index({ userId: 1, recipientEmail: 1, status: 1 });
deliveryLedgerSchema.index({ userId: 1, contactId: 1, status: 1 });
deliveryLedgerSchema.index({ userId: 1, providerMessageId: 1, recipientEmail: 1 });
deliveryLedgerSchema.index({ userId: 1, sentAt: -1 });
deliveryLedgerSchema.index({ providerMessageId: 1, recipientEmail: 1 });
deliveryLedgerSchema.index({ dispatchId: 1 }, { sparse: true });

module.exports = mongoose.model('DeliveryLedger', deliveryLedgerSchema);

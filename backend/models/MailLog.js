const mongoose = require('mongoose');

const mailLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  status: { type: String, enum: ['sent', 'delivered', 'bounced', 'failed'], default: 'sent' },
  providerMessageId: { type: String, default: '' },
  bounceReason: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MailLog', mailLogSchema);

const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: String, required: true },
  hrName: { type: String, default: '' },
  email: { type: String, required: true },
  package: { type: String, default: '' },
  role: { type: String, default: '' },
  source: { type: String, enum: ['extension', 'excel_upload'], default: 'extension' },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'bounced', 'removed', 'positive_response', 'negative_response', 'auto_reply', 'follow_up_later'], default: 'pending' },
  notes: { type: String, default: '' },
  lastMailedAt: { type: Date },
}, {
  timestamps: true
});

module.exports = mongoose.model('Contact', contactSchema);

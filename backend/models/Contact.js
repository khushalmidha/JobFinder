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
  repliedAt: { type: Date },
  replySnippet: { type: String, default: '' },
  notes: { type: String, default: '' },
  lastMailedAt: { type: Date },
}, {
  timestamps: true
});

module.exports = mongoose.model('Contact', contactSchema);


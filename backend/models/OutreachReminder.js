const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open' },
  revision: { type: Number, default: 1 },
  note: { type: String, maxlength: 2000, default: '' },
  subject: { type: String, maxlength: 300, required: true },
  body: { type: String, maxlength: 20000, required: true },
  closedAt: Date,
  closeReason: String
}, { timestamps: true });
schema.index({ userId: 1, status: 1, dueAt: 1 });
module.exports = mongoose.model('OutreachReminder', schema);

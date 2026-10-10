const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema({
  requesterName: { type: String, required: true },
  requesterEmail: { type: String, required: true, lowercase: true, trim: true },
  requesterReason: { type: String, default: '' },
  requesterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvalToken: { type: String, required: true, unique: true },
  approvedAt: { type: Date },
  rejectedAt: { type: Date },
  reviewedBy: { type: String, default: 'khushalmidha24@gmail.com' },
}, {
  timestamps: true
});

module.exports = mongoose.model('AccessRequest', accessRequestSchema);

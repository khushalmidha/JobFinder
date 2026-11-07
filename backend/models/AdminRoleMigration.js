const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, email: String, role: String,
  emailVerified: Boolean, emailVerifiedAt: Date, verificationProofHash: String
}, { _id: false });

const schema = new mongoose.Schema({
  // The MongoDB _id index guarantees uniqueness without an optional background index.
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  email: { type: String, required: true },
  actor: { type: String, required: true },
  status: { type: String, enum: ['pending', 'applied', 'failed'], required: true },
  before: { type: snapshotSchema, required: true },
  after: { type: snapshotSchema },
  leaseOwner: String, leaseUntil: Date, finishedAt: Date,
  recovered: { type: Boolean, default: false },
  error: String
}, { timestamps: true });

module.exports = mongoose.model('AdminRoleMigration', schema);

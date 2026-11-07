const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  reserved: { type: Number, default: 0 }
}, { timestamps: true });
schema.index({ userId: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('ResearchUsage', schema);

const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  stopped: { type: Boolean, default: false },
  paidProvidersEnabled: { type: Boolean, default: false },
  monthlyCredits: { type: Number, default: 0, min: 0, max: 1000 },
  dailyRequests: { type: Number, default: 25, min: 0, max: 500 },
  maxRuntimeSeconds: { type: Number, default: 30, min: 5, max: 120 }
}, { timestamps: true });
module.exports = mongoose.model('ResearchPolicy', schema);

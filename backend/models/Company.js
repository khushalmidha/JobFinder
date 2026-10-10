const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  domain: { type: String, default: '' },
  tier: { 
    type: String, 
    enum: [
      'Tier 0: Top-Tier Quant / HFT',
      'Tier 1: Global Tech Titan',
      'Tier 1.5: High-Growth Unicorn',
      'Tier 2: Global Product / FinTech',
      'Funded Tech Startup',
      'Remote-First Global Tech'
    ],
    default: 'Funded Tech Startup'
  },
  locations: [{ type: String }],
  isIndia: { type: Boolean, default: true },
  isRemoteFriendly: { type: Boolean, default: true },
  careersUrl: { type: String, required: true },
  atsType: { 
    type: String, 
    enum: ['greenhouse', 'lever', 'ashby', 'workday', 'custom'],
    default: 'custom'
  },
  atsToken: { type: String, default: '' }, // e.g. greenhouse board token, lever site name, ashby job board ID
  activeJobsCount: { type: Number, default: 0 },
  lastScannedAt: { type: Date },
  logo: { type: String, default: '' },
  description: { type: String, default: '' },
  recruiterContactsCount: { type: Number, default: 0 }
}, {
  timestamps: true
});

module.exports = mongoose.model('Company', companySchema);

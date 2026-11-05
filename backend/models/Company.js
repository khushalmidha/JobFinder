const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  domain: { type: String, default: '' },
  tier: { 
    type: String, 
    default: 'Funded Tech Startup'
  },
  locations: [{ type: String }],
  isIndia: { type: Boolean, default: true },
  isRemoteFriendly: { type: Boolean, default: true },
  entryLevelCtc: { type: String, default: '' }, // Legacy estimate; never qualification evidence.
  entryLevelCtcMin: { type: Number, default: null },
  entryLevelCtcMax: { type: Number, default: null },
  aliases: [String],
  salaryEvidence: [{
    role: String, roleFamily: String, level: String,
    experienceMin: Number, experienceMax: Number, location: String,
    indiaEligibility: Boolean, indiaEligibilitySourceUrl: String,
    salaryBaseMinINR: Number, salaryBaseMaxINR: Number,
    currency: String, payPeriod: String, baseVsCTC: String,
    salarySourceUrl: String, salarySourceType: String,
    reportedOn: Date, lastCheckedAt: Date, evidenceConfidence: String, evidenceExcerpt: String
  }],
  fresherCtcTier: { 
    type: String, 
    default: '20_to_30' 
  },
  careersUrl: { type: String, required: true },
  atsType: { 
    type: String, 
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

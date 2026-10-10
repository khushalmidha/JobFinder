const mongoose = require('mongoose');

const jobOpeningSchema = new mongoose.Schema({
  title: { type: String, required: true },
  company: { type: String, required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  location: { type: String, default: 'India / Remote' },
  isIndia: { type: Boolean, default: true },
  isRemote: { type: Boolean, default: false },
  url: { type: String, required: true, unique: true },
  applyUrl: { type: String, default: '' },
  atsType: { type: String, default: 'custom' },
  roleCategory: { 
    type: String, 
    enum: [
      'SDE / Backend',
      'Frontend / UI',
      'Full Stack',
      'Machine Learning & AI',
      'Quant & C++ Systems',
      'Internship / Fresher',
      'Security & DevOps'
    ],
    default: 'SDE / Backend'
  },
  matchedResumeId: { 
    type: String, 
    enum: [
      'variant_sde_fullstack',
      'variant_ml_ai',
      'variant_quant_cpp',
      'variant_hackathon_growth',
      'variant_security_fintech'
    ],
    default: 'variant_sde_fullstack'
  },
  fitScore: { type: Number, default: 85 },
  matchRationale: { type: String, default: '' },
  expectedBase: { type: String, default: '₹18 - ₹25 LPA' },
  expectedCtc: { type: String, default: '₹24 - ₹40 LPA' },
  ctcMin: { type: Number, default: 14 }, // numeric in LPA for filtering (e.g. >= 12 LPA)
  stipendMonthly: { type: String, default: '₹50,000 - ₹1,00,000 / month' },
  jobType: { 
    type: String, 
    enum: ['6_months_internship', 'internship', 'full_time'], 
    default: 'full_time' 
  },
  is6MonthIntern: { type: Boolean, default: false },
  isInternationalRemote: { type: Boolean, default: false },
  isFresherEligible: { type: Boolean, default: true },
  priority: { 
    type: String, 
    enum: ['critical', 'high', 'normal'], 
    default: 'normal' 
  },
  tier: { type: String, default: 'Standard Tech' },
  status: { 
    type: String, 
    enum: ['discovered', 'ready_to_apply', 'applied', 'auto_applied', 'ignored'], 
    default: 'discovered' 
  },
  appliedAt: { type: Date },
  detectedAt: { type: Date, default: Date.now },
  tags: [{ type: String }],
  descriptionSnippet: { type: String, default: '' },
  source: { type: String, default: 'career_site' } // 'career_site', 'linkedin'
}, {
  timestamps: true
});

jobOpeningSchema.index({ company: 1, title: 1 });
jobOpeningSchema.index({ detectedAt: -1 });
jobOpeningSchema.index({ jobType: 1 });
jobOpeningSchema.index({ is6MonthIntern: 1 });
jobOpeningSchema.index({ isInternationalRemote: 1 });
jobOpeningSchema.index({ priority: 1 });
jobOpeningSchema.index({ ctcMin: 1 });
jobOpeningSchema.index({ isFresherEligible: 1 });

module.exports = mongoose.model('JobOpening', jobOpeningSchema);

const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const emailTemplateSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.Mixed, default: () => new mongoose.Types.ObjectId().toString() },
  name: { type: String, required: true, default: 'Default Template' },
  subject: { type: String, default: 'Application for Software Engineering Intern (6-Month Internship)' },
  body: { type: String, default: `Greetings,\n\nI hope you're doing well.\n\nI am {{userName}}, a final-year B.Tech student in Computer Science & AI at {{college}} with a CGPA of {{cgpa}}. I am writing to express my interest in the Software Engineering Intern (6-Month Internship) opportunity at {{companyName}}.\n\nBest regards,\n{{userName}}\n{{college}}\n{{userEmail}} | {{userPhone}}\n\nResume: {{resumeLink}}` },
  isDefault: { type: Boolean, default: false }
}, { _id: false });

const smtpAccountSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.Mixed, default: () => new mongoose.Types.ObjectId().toString() },
  name: { type: String, required: true, default: 'Gmail Account' },
  host: { type: String, default: 'smtp.gmail.com' },
  port: { type: Number, default: 465 },
  user: { type: String, default: '' },
  pass: { 
    type: String, 
    default: '',
    set: encrypt,
    get: decrypt
  },
  isDefault: { type: Boolean, default: false }
}, { 
  _id: false,
  toJSON: { getters: true },
  toObject: { getters: true }
});

const candidateProfileSchema = new mongoose.Schema({
  fullName: { type: String, default: '' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  phoneRaw: { type: String, default: '' },
  college: { type: String, default: '' },
  collegeShort: { type: String, default: '' },
  degree: { type: String, default: '' },
  degreeShort: { type: String, default: '' },
  major: { type: String, default: '' },
  cgpa: { type: String, default: '' },
  cgpaScale: { type: String, default: '' },
  graduationDate: { type: String, default: '' },
  graduationYear: { type: String, default: '' },
  startYear: { type: String, default: '' },
  expectedAnnualSalaryINR: { type: String, default: '' },
  expectedAnnualSalaryINRNumber: { type: Number, default: null },
  expectedAnnualCtcLpa: { type: String, default: '' },
  expectedAnnualCtcLpaNumber: { type: Number, default: null },
  currentCompany: { type: String, default: '' },
  currentRole: { type: String, default: '' },
  internshipDuration: { type: String, default: '' },
  internshipHighlights: {
    type: [String],
    default: []
  },
  skills: {
    languages: { type: String, default: '' },
    frontend: { type: String, default: '' },
    backend: { type: String, default: '' },
    databases: { type: String, default: '' },
    mlAi: { type: String, default: '' },
    tools: { type: String, default: '' }
  },
  links: {
    github: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    leetcode: { type: String, default: '' },
    codeforces: { type: String, default: '' },
    codechef: { type: String, default: '' },
    portfolio: { type: String, default: '' }
  },
  achievements: {
    type: [String],
    default: []
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  // Written only after a trusted server-delivered challenge, never settings/signup.
  emailVerified: { type: Boolean, default: false },
  emailVerifiedAt: { type: Date },
  emailVerificationProof: {
    type: new mongoose.Schema({ method: String, issuer: String, subject: String, verifiedAt: Date, challengeId: String }, { _id: false }),
    default: undefined
  },
  adminRoleMigrationId: { type: String },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isSharedContactApproved: { type: Boolean, default: false },
  resumeLink: { type: String, default: '' },
  defaultJobLink: { type: String, default: '' },
  dailyEmailLimit: { type: Number, default: 450 },

  // Multiple Email Templates support
  emailTemplates: [emailTemplateSchema],
  selectedTemplateId: { type: String, default: '' },

  // Legacy single template (kept synced for backward compatibility)
  mailTemplate: { 
    subject: { type: String, default: 'Application for Software Engineering Intern (6-Month Internship)' },
    body: { type: String, default: `Greetings,\n\nI hope you're doing well.\n\nI am {{userName}}, a final-year B.Tech student in Computer Science & AI at {{college}} with a CGPA of {{cgpa}}. I am writing to express my interest in the Software Engineering Intern (6-Month Internship) opportunity at {{companyName}}.\n\nBest regards,\n{{userName}}\n{{college}}\n{{userEmail}} | {{userPhone}}\n\nResume: {{resumeLink}}` }
  },

  blockedCompanies: { type: [String], default: [] },
  syncedAccountEmails: { type: [String], default: [] },
  lastCompanyImportRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyImportRun' },

  // Multiple SMTP Accounts support
  smtpConfigs: [smtpAccountSchema],
  selectedSmtpId: { type: String, default: '' },

  // Legacy single SMTP configuration (kept synced for backward compatibility)
  smtpConfig: {
    host: { type: String, default: 'smtp.gmail.com' },
    port: { type: Number, default: 465 },
    user: { type: String, default: '' },
    pass: { 
      type: String, 
      default: '',
      set: encrypt,
      get: decrypt
    }
  },

  geminiApiKey: {
    type: String,
    default: '',
    set: encrypt,
    get: decrypt
  },
  brevoApiKey: {
    type: String,
    default: '',
    set: encrypt,
    get: decrypt
  },
  hunterApiKey: {
    type: String,
    default: '',
    set: encrypt,
    get: decrypt
  },
  apolloApiKey: {
    type: String,
    default: '',
    set: encrypt,
    get: decrypt
  },
  candidateProfile: {
    type: candidateProfileSchema,
    default: () => ({})
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

module.exports = mongoose.model('User', userSchema);

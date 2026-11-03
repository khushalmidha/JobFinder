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
  fullName: { type: String, default: 'Khushal Midha' },
  firstName: { type: String, default: 'Khushal' },
  lastName: { type: String, default: 'Midha' },
  email: { type: String, default: 'midhakhushal5@gmail.com' },
  phone: { type: String, default: '+91 90507 40836' },
  phoneRaw: { type: String, default: '9050740836' },
  college: { type: String, default: 'Indian Institute of Information Technology, Lucknow' },
  collegeShort: { type: String, default: 'IIIT Lucknow' },
  degree: { type: String, default: 'B.Tech in Computer Science and Artificial Intelligence' },
  degreeShort: { type: String, default: 'B.Tech' },
  major: { type: String, default: 'Computer Science and Artificial Intelligence' },
  cgpa: { type: String, default: '8.72' },
  cgpaScale: { type: String, default: '10' },
  graduationDate: { type: String, default: 'July 2027' },
  graduationYear: { type: String, default: '2027' },
  startYear: { type: String, default: '2023' },
  expectedAnnualSalaryINR: { type: String, default: '₹30,00,000' },
  expectedAnnualSalaryINRNumber: { type: Number, default: 3000000 },
  expectedAnnualCtcLpa: { type: String, default: '30 LPA' },
  expectedAnnualCtcLpaNumber: { type: Number, default: 30 },
  currentCompany: { type: String, default: 'Coffeee.io' },
  currentRole: { type: String, default: 'Software Development Engineer Intern' },
  internshipDuration: { type: String, default: 'June 2025 – August 2025' },
  internshipHighlights: {
    type: [String],
    default: [
      'Built a project-based assessment module (Java, Spring Boot, React, PostgreSQL) where candidates debug live codebases via error logs, graded automatically against hidden test cases.',
      'Developed a read-only AI assistant (LLMs, Redis, Docker) to provide contextual hints without edit access, preserving evaluation integrity; validated in staging.'
    ]
  },
  skills: {
    languages: { type: String, default: 'C, C++, Python, JavaScript, Java, SQL, TypeScript, Go' },
    frontend: { type: String, default: 'React.js, TypeScript, HTML, CSS, Tailwind CSS, Bootstrap' },
    backend: { type: String, default: 'Node.js, Express.js, Spring Boot, Redis, Kafka, FastAPI' },
    databases: { type: String, default: 'MongoDB, MySQL, PostgreSQL' },
    mlAi: { type: String, default: 'PyTorch, XGBoost, Scikit-learn, Transformers, MLOps (MLflow), LLMs, Agentic AI, Prompt Engineering' },
    tools: { type: String, default: 'Docker, Git, Postman, Linux, AWS' }
  },
  links: {
    github: { type: String, default: 'https://github.com/khushalmidha' },
    linkedin: { type: String, default: 'https://www.linkedin.com/in/khushalmidha' },
    leetcode: { type: String, default: 'https://leetcode.com/u/khushalmidha' },
    codeforces: { type: String, default: 'https://codeforces.com/profile/khushalmidha' },
    codechef: { type: String, default: 'https://www.codechef.com/users/khushalmidha' },
    portfolio: { type: String, default: 'https://github.com/khushalmidha' }
  },
  achievements: {
    type: [String],
    default: [
      'Rated as Expert on Codeforces (max rating: 1809), 5-star on CodeChef (2137), Guardian on LeetCode (2137)',
      'Solved 3000+ DSA problems across Codeforces and LeetCode',
      'Selected for Amazon ML School 2025 (top 3,000 from 85,000 applicants)',
      'Achieved rank under 50 in Amazon ML Challenge 2026 among 11,000+ teams',
      'Secured rank 186 in Meta Hacker Cup Round-3 among 14,000+ participants',
      'Qualified Adobe Gensolve Hackathon, ranked top 5% among 54,000+ participants',
      'ICPC Regionalist at Amritapuri Regionals 2024-25 with team Overshadowed',
      'Rank 1 among 250+ peers in Freshers Cup 2024 by CP Wing, Axios, IIIT Lucknow',
      'All India Rank 15,503 in JEE Advanced 2023 and Rank 9,932 in JEE Mains 2023'
    ]
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
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

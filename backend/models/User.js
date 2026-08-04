const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  resumeLink: { type: String, default: '' },
  defaultJobLink: { type: String, default: '' },
  mailTemplate: { 
    subject: { type: String, default: 'Application for Software Engineering Intern (6-Month Internship)' },
    body: { type: String, default: `Greetings,\n\nI hope you're doing well.\n\nI am {{userName}}, a final-year B.Tech student in Computer Science & AI at {{college}} with a CGPA of {{cgpa}}. I am writing to express my interest in the Software Engineering Intern (6-Month Internship) opportunity at {{companyName}}.\n\nBest regards,\n{{userName}}\n{{college}}\n{{userEmail}} | {{userPhone}}\n\nResume: {{resumeLink}}` }
  },
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
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

module.exports = mongoose.model('User', userSchema);

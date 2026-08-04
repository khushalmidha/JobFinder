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
    body: { type: String, default: `Greetings,

I hope you're doing well.

I am {{userName}}, a final-year B.Tech student in Computer Science & Artificial Intelligence at IIIT Lucknow with a CGPA of 8.72/10. I am writing to express my interest in the Software Engineering Intern (6-Month Internship) opportunity at {{companyName}}.

I have hands-on experience building scalable full-stack applications using the MERN stack, Spring Boot, Redis, Kafka, Socket.IO, WebRTC, and LLM-powered systems. Through projects like MediPulse, I have worked on distributed systems, real-time communication, scalable backend services, AI-powered workflows, and concurrency-safe application design. During my internship at Merlin AI, I evaluated AI-generated code, improved model reasoning, and contributed to high-quality LLM evaluation datasets.

Alongside development, I have a strong foundation in Data Structures & Algorithms, with 2500+ solved coding problems, a Codeforces Expert (1809) rating, and selection for Amazon ML School 2025. I enjoy solving challenging engineering problems and building reliable, scalable software.

I would be truly grateful if you could consider my application or refer me for the Software Engineering Intern (6-Month Internship) opportunity at {{companyName}}. I have attached my updated resume for your review.

Thank you for your time and consideration. I look forward to hearing from you.

Best regards,
{{userName}}
B.Tech, Computer Science & Artificial Intelligence
IIIT Lucknow
{{userEmail}}
+91 9050740836

Resume:
{{resumeLink}}` }
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

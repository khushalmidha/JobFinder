const mongoose = require('mongoose');

const jobSchedulerConfigSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  enabled: { type: Boolean, default: true },
  autoApplyEnabled: { type: Boolean, default: false }, // if true, marks discovered jobs as auto_applied/ready
  morningTime: { type: String, default: '09:00' }, // 9:00 AM IST
  afternoonTime: { type: String, default: '14:00' }, // 2:00 PM IST
  nightTime: { type: String, default: '20:30' }, // 8:30 PM IST
  preferredLocations: { 
    type: [String], 
    default: ['India', 'Bengaluru', 'Hyderabad', 'Gurgaon', 'Pune', 'Noida', 'Mumbai', 'Remote'] 
  },
  preferredRoles: { 
    type: [String], 
    default: ['Software Engineer', 'SDE', 'Backend', 'Full Stack', 'Machine Learning', 'AI', 'Quant', 'Intern'] 
  },
  lastRunAt: { type: Date },
  lastRunStatus: { type: String, default: 'Idle' },
  lastRunJobsFound: { type: Number, default: 0 },
  scanHistory: [{
    runAt: { type: Date, default: Date.now },
    jobsFound: { type: Number, default: 0 },
    newJobsAdded: { type: Number, default: 0 },
    status: { type: String, default: 'Completed' },
    slot: { type: String, default: 'Manual' } // Morning, Afternoon, Night, Manual
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('JobSchedulerConfig', jobSchedulerConfigSchema);

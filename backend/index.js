require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contact');
const mailRoutes = require('./routes/mail');
const uploadRoutes = require('./routes/upload');
const webhookRoutes = require('./routes/webhook');
const jobRoutes = require('./routes/job');
const recruiterRoutes = require('./routes/recruiter');

const { seedCompaniesIfEmpty } = require('./services/companyDirectory');
const { initJobScheduler } = require('./services/jobSchedulerService');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/recruiters', recruiterRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jobfinder')
  .then(async () => {
    console.log('Connected to MongoDB');
    // Ensure company directory is seeded
    await seedCompaniesIfEmpty();
    // Start automated 3-slot scheduler (Morning, Afternoon, Night)
    initJobScheduler();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB', err);
  });


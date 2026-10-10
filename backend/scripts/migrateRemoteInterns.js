const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not found in .env');
  
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const JobOpening = require('../models/JobOpening');

  // Query 1: isRemote true and internship
  const query1 = {
    isRemote: true,
    jobType: { $in: ['internship', '6_months_internship'] }
  };
  const count1 = await JobOpening.countDocuments(query1);
  console.log('Found remote internships (query1):', count1);

  const res1 = await JobOpening.updateMany(query1, {
    $set: {
      isInternationalRemote: true,
      priority: 'critical',
      stipendMonthly: '$1,500 - $4,500 / month (₹1.25L - ₹3.75L)'
    },
    $addToSet: {
      tags: '🌍 International Remote'
    }
  });
  console.log('Updated query1:', res1.modifiedCount);

  // Query 2: internship with remote/worldwide/global in location or !isIndia
  const query2 = {
    jobType: { $in: ['internship', '6_months_internship'] },
    isInternationalRemote: false,
    $or: [
      { location: { $regex: /remote|worldwide|anywhere|global|us|united states|emea|apac/i } },
      { isIndia: false }
    ]
  };
  const count2 = await JobOpening.countDocuments(query2);
  console.log('Found additional international candidates (query2):', count2);

  if (count2 > 0) {
    const res2 = await JobOpening.updateMany(query2, {
      $set: {
        isInternationalRemote: true,
        priority: 'critical',
        stipendMonthly: '$1,500 - $4,500 / month (₹1.25L - ₹3.75L)'
      },
      $addToSet: {
        tags: '🌍 International Remote'
      }
    });
    console.log('Updated query2:', res2.modifiedCount);
  }

  const total = await JobOpening.countDocuments({ isInternationalRemote: true });
  console.log('Total isInternationalRemote in DB:', total);

  // Sample check
  const samples = await JobOpening.find({ isInternationalRemote: true }).limit(5).select('title company location isRemote isInternationalRemote stipendMonthly');
  console.log('Sample International Remote Internships:', samples);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

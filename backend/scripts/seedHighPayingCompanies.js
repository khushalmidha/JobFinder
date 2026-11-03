const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Company = require('../models/Company');
const Contact = require('../models/Contact');
const User = require('../models/User');
const { HIGH_PAYING_COMPANIES, HIGH_PAYING_RECRUITERS } = require('../services/highPayingCompaniesData');
const { syncContactsToTargetAccounts } = require('../services/contactSyncService');

async function seed() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/jobfinder';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB successfully.');

  console.log(`\n--- 1. UPSERTING HIGH-PAYING COMPANIES (${HIGH_PAYING_COMPANIES.length} Total) ---`);
  let companiesUpserted = 0;
  let companiesCreated = 0;

  for (const compData of HIGH_PAYING_COMPANIES) {
    const escapedName = compData.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const existing = await Company.findOne({ 
      name: { $regex: new RegExp(`^${escapedName}$`, 'i') } 
    });

    if (existing) {
      existing.fresherCtcTier = compData.fresherCtcTier;
      existing.tier = compData.tier;
      existing.description = compData.description || existing.description;
      existing.tags = Array.from(new Set([...(existing.tags || []), ...(compData.tags || [])]));
      existing.recruiterEmail = compData.recruiterEmail || existing.recruiterEmail;
      existing.careersUrl = compData.careersUrl || existing.careersUrl;
      existing.glassdoorRating = compData.glassdoorRating || existing.glassdoorRating;
      existing.headquarters = compData.headquarters || existing.headquarters;
      existing.locations = Array.from(new Set([...(existing.locations || []), ...(compData.locations || [])]));
      existing.workType = compData.workType || existing.workType;
      existing.hiringMode = compData.hiringMode || existing.hiringMode;
      existing.hiringSeason = compData.hiringSeason || existing.hiringSeason;
      existing.verifiedEmailDomain = compData.verifiedEmailDomain || existing.verifiedEmailDomain;
      existing.verifiedRecruiters = compData.verifiedRecruiters || existing.verifiedRecruiters;
      existing.isActive = true;
      await existing.save();
      companiesUpserted++;
    } else {
      await Company.create({
        ...compData,
        isActive: true
      });
      companiesCreated++;
    }
  }

  console.log(`Companies process complete: ${companiesCreated} new created, ${companiesUpserted} existing updated.`);

  console.log(`\n--- 2. ADDING RECRUITERS TO USER CONTACTS (${HIGH_PAYING_RECRUITERS.length} Total) ---`);
  // Find primary user (khushal) or all users if needed
  const users = await User.find({ email: /midhakhushal5@gmail\.com/i });
  if (users.length === 0) {
    console.log('User midhakhushal5@gmail.com not found. Fetching first user...');
    const firstUser = await User.findOne();
    if (firstUser) users.push(firstUser);
  }

  for (const user of users) {
    console.log(`Processing user: ${user.email} (ID: ${user._id})`);
    
    // Get existing emails for this user to prevent duplicates
    const existingContacts = await Contact.find({ userId: user._id }).select('email').lean();
    const existingSet = new Set(existingContacts.map(c => (c.email || '').toLowerCase().trim()));

    const newContactsToInsert = [];

    for (const r of HIGH_PAYING_RECRUITERS) {
      const emailLower = (r.email || '').toLowerCase().trim();
      if (!emailLower || existingSet.has(emailLower)) {
        continue;
      }
      existingSet.add(emailLower);

      newContactsToInsert.push({
        userId: user._id,
        company: r.company,
        hrName: r.hrName,
        email: r.email,
        package: r.package || '30-50 LPA',
        role: r.role || 'Fresher / SDE Tech Recruiter',
        source: 'recruiter_sheet',
        status: 'pending',
        deliverabilityStatus: 'valid',
        validationReason: 'Verified 2026-27 High Paying Company Contact',
        notes: `Compensation: ${r.package} | Focus: ${r.role} | Verified outreach inbox`
      });
    }

    if (newContactsToInsert.length > 0) {
      const inserted = await Contact.insertMany(newContactsToInsert);
      console.log(`Inserted ${inserted.length} high-paying recruiters for ${user.email}`);

      // Sync to linked accounts if user has any
      try {
        const syncRes = await syncContactsToTargetAccounts(user._id, inserted);
        console.log(`Synced to ${syncRes.syncedAccounts} linked accounts (${syncRes.totalSynced} contacts total)`);
      } catch (syncErr) {
        console.warn('Sync warning:', syncErr.message);
      }
    } else {
      console.log(`All high-paying recruiters already exist in ${user.email}'s contacts.`);
    }
  }

  console.log('\n--- SEEDING COMPLETED SUCCESSFULLY ---');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

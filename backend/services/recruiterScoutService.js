const Contact = require('../models/Contact');
const ExcelJS = require('exceljs');
const { HIGH_PAYING_RECRUITERS } = require('./highPayingCompaniesData');
const { REMOTE_GLOBAL_RECRUITERS } = require('./remoteAndGlobalCompaniesData');

/**
 * Curated directory of 130+ Tech Recruiters, University Talent Partners, and HR Leads
 * across top Indian tech companies, high-growth unicorns, remote global companies, and quant/HFT firms.
 */
const recruiterMap = new Map();
(HIGH_PAYING_RECRUITERS || []).forEach(r => recruiterMap.set((r.email || '').toLowerCase().trim(), r));
(REMOTE_GLOBAL_RECRUITERS || []).forEach(r => {
  const key = (r.email || '').toLowerCase().trim();
  if (key && !recruiterMap.has(key)) {
    recruiterMap.set(key, r);
  }
});

// Legacy registries lack per-contact source evidence; do not expose/import them.
const CURATED_RECRUITERS = [];


/**
 * Imports curated recruiters into user's Contact database
 */
async function importCuratedRecruiters(userId) {
  let addedCount = 0;
  let skippedCount = 0;

  for (const r of CURATED_RECRUITERS) {
    const existing = await Contact.findOne({ userId, email: r.email });
    if (!existing) {
      await Contact.create({
        userId,
        hrName: r.hrName,
        email: r.email,
        company: r.company,
        role: r.role,
        package: r.package,
        source: 'recruiter_sheet',
        linkedinUrl: r.linkedinUrl,
        notes: `Verified Indian Tech Talent Lead at ${r.company} (${r.location}).`,
        status: 'pending'
      });
      addedCount++;
    } else {
      skippedCount++;
    }
  }

  return { addedCount, skippedCount, totalAvailable: CURATED_RECRUITERS.length };
}

/**
 * Ingests an uploaded Excel/CSV buffer and imports recruiters to the user's contacts
 */
async function ingestRecruiterSheet(userId, buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  let addedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    // Find email column dynamically
    const emailKey = Object.keys(row).find(k => k.toLowerCase().includes('email') || k.toLowerCase().includes('mail'));
    const companyKey = Object.keys(row).find(k => k.toLowerCase().includes('company') || k.toLowerCase().includes('organization'));
    const nameKey = Object.keys(row).find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('hr') || k.toLowerCase().includes('recruiter'));
    const roleKey = Object.keys(row).find(k => k.toLowerCase().includes('role') || k.toLowerCase().includes('designation') || k.toLowerCase().includes('title'));

    const email = row[emailKey]?.trim()?.toLowerCase();
    const company = row[companyKey]?.trim() || 'Tech Company';
    const hrName = row[nameKey]?.trim() || '';
    const role = row[roleKey]?.trim() || 'Technical Recruiter';

    if (email && email.includes('@')) {
      const existing = await Contact.findOne({ userId, email });
      if (!existing) {
        await Contact.create({
          userId,
          email,
          company,
          hrName,
          role,
          source: 'recruiter_sheet',
          status: 'pending'
        });
        addedCount++;
      } else {
        skippedCount++;
      }
    }
  }

  return { addedCount, skippedCount, rowsParsed: rows.length };
}

/**
 * Generates an Excel spreadsheet (.xlsx buffer) containing Indian Tech Recruiters
 */
async function generateRecruiterSpreadsheet(userId) {
  // Pull from contacts where source is recruiter_sheet or from curated
  const contacts = await Contact.find({ userId, source: 'recruiter_sheet' }).lean();
  const data = contacts.length > 0 ? contacts : CURATED_RECRUITERS;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Indian Tech Recruiters');

  worksheet.columns = [
    { header: '#', key: 'idx', width: 6 },
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Recruiter / HR Name', key: 'hrName', width: 24 },
    { header: 'Email Address', key: 'email', width: 30 },
    { header: 'Role / Designation', key: 'role', width: 26 },
    { header: 'Package Range', key: 'package', width: 22 },
    { header: 'LinkedIn Profile', key: 'linkedinUrl', width: 35 },
    { header: 'Status in ColdMail Queue', key: 'status', width: 22 },
    { header: 'Added On', key: 'addedOn', width: 16 }
  ];

  data.forEach((r, idx) => {
    worksheet.addRow({
      idx: idx + 1,
      company: r.company,
      hrName: r.hrName || 'Hiring Lead',
      email: r.email,
      role: r.role || 'Talent Acquisition',
      package: r.package || 'Competitive Tech Standard',
      linkedinUrl: r.linkedinUrl || '',
      status: r.status || 'Verified Recruiter',
      addedOn: r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : 'Curated Directory'
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  CURATED_RECRUITERS,
  importCuratedRecruiters,
  ingestRecruiterSheet,
  generateRecruiterSpreadsheet
};

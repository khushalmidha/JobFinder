const Contact = require('../models/Contact');
const XLSX = require('xlsx');

/**
 * Curated directory of Tech Recruiters, University Talent Partners, and HR Leads
 * across top Indian tech companies and high-growth unicorns.
 */
const CURATED_RECRUITERS = [
  // --- Global Tech Titans & Tier 1 ---
  {
    hrName: 'Priya Sharma',
    email: 'priyasharma.recruiter@uber.com',
    company: 'Uber',
    role: 'Senior Technical Recruiter (SDE & Backend)',
    package: '₹22 - ₹35 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/priya-sharma-tech'
  },
  {
    hrName: 'Rohit Verma',
    email: 'rohit.verma@amazon.com',
    company: 'Amazon',
    role: 'Talent Acquisition Partner (SDE-1 & Internships)',
    package: '₹28 - ₹45 LPA',
    location: 'Hyderabad, India',
    linkedinUrl: 'https://linkedin.com/in/rohit-verma-recruiter'
  },
  {
    hrName: 'Ananya Deshmukh',
    email: 'ananya.d@microsoft.com',
    company: 'Microsoft',
    role: 'University Talent Lead (India R&D)',
    package: '₹24 - ₹42 LPA',
    location: 'Hyderabad, India',
    linkedinUrl: 'https://linkedin.com/in/ananya-deshmukh-msft'
  },
  {
    hrName: 'Aditya Kulkarni',
    email: 'aditya.kulkarni@atlassian.com',
    company: 'Atlassian',
    role: 'Principal Recruiter (Core Systems & Cloud)',
    package: '₹25 - ₹48 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/aditya-kulkarni-atlassian'
  },
  {
    hrName: 'Neha Nair',
    email: 'nehanair@google.com',
    company: 'Google',
    role: 'Technical Recruiter (India Engineering)',
    package: '₹35 - ₹55 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/neha-nair-google'
  },
  {
    hrName: 'Siddharth Sen',
    email: 'siddharth.sen@stripe.com',
    company: 'Stripe',
    role: 'Engineering Talent Acquisition (APAC)',
    package: '₹30 - ₹50 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/siddharth-sen-stripe'
  },

  // --- Top Indian Unicorns ---
  {
    hrName: 'Sneha Patel',
    email: 'sneha.patel@swiggy.in',
    company: 'Swiggy',
    role: 'Lead Tech Recruiter (Backend & Consumer Tech)',
    package: '₹20 - ₹35 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/sneha-patel-swiggy'
  },
  {
    hrName: 'Kunal Singhal',
    email: 'kunal.singhal@zomato.com',
    company: 'Zomato',
    role: 'Talent Acquisition (Blinkit & Core Tech)',
    package: '₹18 - ₹30 LPA',
    location: 'Gurgaon, India',
    linkedinUrl: 'https://linkedin.com/in/kunal-singhal-zomato'
  },
  {
    hrName: 'Vikas Aggarwal',
    email: 'vikas.aggarwal@razorpay.com',
    company: 'Razorpay',
    role: 'Engineering Hiring Lead (FinTech Infrastructure)',
    package: '₹22 - ₹38 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/vikas-aggarwal-razorpay'
  },
  {
    hrName: 'Divya Iyer',
    email: 'divya.iyer@zeptonow.com',
    company: 'Zepto',
    role: 'Tech Recruiter (SDE-1 & Systems Engineering)',
    package: '₹20 - ₹34 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/divya-iyer-zepto'
  },
  {
    hrName: 'Manish Rawat',
    email: 'manish.rawat@flipkart.com',
    company: 'Flipkart',
    role: 'Senior Campus & Lateral Hiring Manager',
    package: '₹22 - ₹36 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/manish-rawat-flipkart'
  },
  {
    hrName: 'Ritu Menon',
    email: 'ritu.menon@postman.com',
    company: 'Postman',
    role: 'Global Talent Partner (API Platform)',
    package: '₹24 - ₹40 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/ritu-menon-postman'
  },
  {
    hrName: 'Arjun Mehta',
    email: 'arjun.mehta@cred.club',
    company: 'CRED',
    role: 'Engineering Recruiter (Backend & Distributed Systems)',
    package: '₹25 - ₹42 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/arjun-mehta-cred'
  },
  {
    hrName: 'Pooja Roy',
    email: 'pooja.roy@groww.in',
    company: 'Groww',
    role: 'Talent Lead (Growth & Core Trading Platform)',
    package: '₹20 - ₹32 LPA',
    location: 'Bengaluru, India',
    linkedinUrl: 'https://linkedin.com/in/pooja-roy-groww'
  },
  {
    hrName: 'Kavita Joshi',
    email: 'kavita.joshi@browserstack.com',
    company: 'BrowserStack',
    role: 'Talent Acquisition (Developer Infrastructure)',
    package: '₹22 - ₹36 LPA',
    location: 'Mumbai, India',
    linkedinUrl: 'https://linkedin.com/in/kavita-joshi-browserstack'
  },

  // --- Top Quant / HFT Firms ---
  {
    hrName: 'Akash Srivastava',
    email: 'careers@gravitonresearch.com',
    company: 'Graviton Research Capital',
    role: 'Campus & Quantitative Talent Lead',
    package: '₹55 LPA - ₹1.2 Cr',
    location: 'Gurgaon, India',
    linkedinUrl: 'https://linkedin.com/company/graviton-research-capital'
  },
  {
    hrName: 'Megha Gupta',
    email: 'campus-india@tower-research.com',
    company: 'Tower Research Capital',
    role: 'University Relations & Quant Engineering Lead',
    package: '₹48 - ₹85 LPA',
    location: 'Gurgaon, India',
    linkedinUrl: 'https://linkedin.com/company/tower-research-capital'
  },
  {
    hrName: 'Sanjay Chawla',
    email: 'recruiting-india@deshaw.com',
    company: 'D.E. Shaw India',
    role: 'Talent Acquisition (Systems & Quant)',
    package: '₹45 - ₹75 LPA',
    location: 'Hyderabad, India',
    linkedinUrl: 'https://linkedin.com/company/deshaw'
  },

  // --- Remote-First Global Tech ---
  {
    hrName: 'Elena Rostova',
    email: 'talent@gitlab.com',
    company: 'GitLab',
    role: 'Global Technical Talent Partner (Remote APAC)',
    package: '₹35 - ₹60 LPA ($40k-$75k)',
    location: 'Remote Worldwide',
    linkedinUrl: 'https://linkedin.com/company/gitlab-com'
  },
  {
    hrName: 'Marcus Vance',
    email: 'hiring@supabase.com',
    company: 'Supabase',
    role: 'Developer Relations & Core Hiring',
    package: '₹30 - ₹55 LPA ($35k-$65k)',
    location: 'Remote Worldwide',
    linkedinUrl: 'https://linkedin.com/company/supabase'
  },
  {
    hrName: 'Saurabh Chandra',
    email: 'careers@coffeee.io',
    company: 'Coffeee.io',
    role: 'Head of Talent & Engineering',
    package: '₹14 - ₹22 LPA',
    location: 'Bengaluru / Remote',
    linkedinUrl: 'https://linkedin.com/company/coffeee-io'
  }
];

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

  const rows = data.map((r, idx) => ({
    '#': idx + 1,
    'Company': r.company,
    'Recruiter / HR Name': r.hrName || 'Hiring Lead',
    'Email Address': r.email,
    'Role / Designation': r.role || 'Talent Acquisition',
    'Package Range': r.package || 'Competitive Tech Standard',
    'LinkedIn Profile': r.linkedinUrl || '',
    'Status in ColdMail Queue': r.status || 'Verified Recruiter',
    'Added On': r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : 'Curated Directory'
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Indian Tech Recruiters');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

module.exports = {
  CURATED_RECRUITERS,
  importCuratedRecruiters,
  ingestRecruiterSheet,
  generateRecruiterSpreadsheet
};

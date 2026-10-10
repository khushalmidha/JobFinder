const Company = require('../models/Company');
const JobOpening = require('../models/JobOpening');
const XLSX = require('xlsx');

// Salary estimator logic on the backend (Strictly Freshers CTC > 12 LPA)
const SALARY_RANGES = {
  'Tier 0: Top-Tier Quant / HFT': { base: '₹48 - ₹65 LPA', ctc: '₹80 LPA - ₹1.5 Cr', ctcMin: 80, stipend: '₹1,50,000 - ₹3,00,000 / month', tier: 'Elite Quant' },
  'Tier 1: Global Tech Titan': { base: '₹20 - ₹28 LPA', ctc: '₹38 - ₹56 LPA', ctcMin: 28, stipend: '₹80,000 - ₹1,50,000 / month', tier: 'Tier-1 FAANG/MNC' },
  'Tier 1.5: High-Growth Unicorn': { base: '₹18 - ₹25 LPA', ctc: '₹26 - ₹42 LPA', ctcMin: 20, stipend: '₹60,000 - ₹1,00,000 / month', tier: 'Top Unicorn' },
  'Tier 2: Global Product / FinTech': { base: '₹14 - ₹20 LPA', ctc: '₹18 - ₹30 LPA', ctcMin: 16, stipend: '₹45,000 - ₹75,000 / month', tier: 'Established Product' },
  'Remote-First Global Tech': { base: '₹25 - ₹45 LPA ($30k-$55k)', ctc: '₹35 - ₹65 LPA', ctcMin: 25, stipend: '₹70,000 - ₹1,50,000 / month', tier: 'Global Remote USD/INR' },
  'Funded Tech Startup': { base: '₹12 - ₹18 LPA', ctc: '₹14 - ₹24 LPA', ctcMin: 14, stipend: '₹40,000 - ₹65,000 / month', tier: 'Funded Startup' }
};

/**
 * Segregates job openings into:
 * 1. 6 Months Internship (CRITICAL PRIORITY)
 * 2. International Remote Internship (GLOBAL PRIORITY)
 * 3. Standard Internship (HIGH PRIORITY)
 * 4. Full-Time SDE / Fresher (CTC > 12 LPA)
 */
function classifyJobTypeAndPriority(title = '', description = '', isRemote = false, isIndia = false) {
  const text = `${title} ${description}`.toLowerCase();

  // 1. Detect 6 Months Internship explicitly
  const is6Month = /6[\s-]*month|six[\s-]*month|6m\b|jan[\s-]*june|january[\s-]*june|semester[\s-]*intern|off[\s-]*campus[\s-]*intern|winter[\s-]*intern|spring[\s-]*intern|6[\s-]*mo\b/.test(text);

  // 2. Detect general Internship / Trainee
  const isIntern = is6Month || /intern|internship|trainee|apprentice|co-op|coop|summer intern|fall intern|student/.test(text);

  // 3. Detect International Remote Internship
  const isInternationalRemote = isIntern && (isRemote || !isIndia || /worldwide|anywhere|global|apac|remote/.test(text));

  let jobType = 'full_time';
  let priority = 'normal';
  let is6MonthIntern = false;
  let isFresherEligible = true;

  if (is6Month) {
    jobType = '6_months_internship';
    is6MonthIntern = true;
    priority = 'critical'; // Top priority for Khushal!
    isFresherEligible = true;
  } else if (isIntern) {
    jobType = 'internship';
    priority = isInternationalRemote ? 'critical' : 'high';
    isFresherEligible = true;
  } else {
    jobType = 'full_time';
    // Fresher eligibility check for full time
    const seniorRegex = /\b(senior|sr\b|lead|principal|staff|director|vp|head|architect|manager|5\+|7\+|8\+|10\+)\b/;
    if (seniorRegex.test(title.toLowerCase())) {
      isFresherEligible = false;
      priority = 'normal';
    } else {
      const fresherKeywords = /\b(fresher|graduate|new grad|entry[\s-]*level|associate|sde[\s-]*1|sde[\s-]*i\b|engineer[\s-]*1|engineer[\s-]*i\b|junior|jr\b|2024|2025|2026|campus)\b/;
      if (fresherKeywords.test(text)) {
        priority = 'high';
        isFresherEligible = true;
      } else {
        isFresherEligible = true;
        priority = 'normal';
      }
    }
  }

  return {
    jobType,
    is6MonthIntern,
    isInternationalRemote,
    priority,
    isFresherEligible
  };
}

/**
 * Categorizes a job title and determines the best fitting resume variant for Khushal Midha
 */
function matchJobToResume(title = '', description = '', classification = null) {
  const text = `${title} ${description}`.toLowerCase();

  // If it's a 6-month internship or general internship, highlight hackathon/internship profile
  if (classification && (classification.is6MonthIntern || classification.jobType === '6_months_internship')) {
    return {
      category: 'Internship / Fresher',
      resumeId: 'variant_hackathon_growth',
      score: 99,
      rationale: '⭐ TOP PRIORITY 6-Month Internship matching Khushal Midha (Coffeee.io SDE intern, IIIT-L, LeetCode Guardian 2137).'
    };
  }

  if (classification && classification.jobType === 'internship') {
    return {
      category: 'Internship / Fresher',
      resumeId: 'variant_hackathon_growth',
      score: 97,
      rationale: 'High Priority Internship matching SDE profile (Coffeee.io SDE intern, IIIT-L).'
    };
  }

  // Quant & C++
  if (text.includes('quant') || text.includes('c++') || text.includes('hft') || text.includes('low latency') || text.includes('trading system')) {
    return {
      category: 'Quant & C++ Systems',
      resumeId: 'variant_quant_cpp',
      score: 95,
      rationale: 'Perfect alignment with QuantDesk C++ deterministic order book & matching engine.'
    };
  }

  // Machine Learning & AI
  if (text.includes('machine learning') || text.includes('ai ') || text.includes('pytorch') || text.includes('nlp') || text.includes('deep learning') || text.includes('genai') || text.includes('rag')) {
    return {
      category: 'Machine Learning & AI',
      resumeId: 'variant_ml_ai',
      score: 96,
      rationale: 'Strong match for ThreatGraph (GNNs + Transformers) & Jagrit (XGBoost/NRMS ranking).'
    };
  }

  // Internships
  if (text.includes('intern') || text.includes('trainee') || text.includes('apprentice')) {
    return {
      category: 'Internship / Fresher',
      resumeId: 'variant_hackathon_growth',
      score: 98,
      rationale: 'Highlights Coffeee.io SDE internship, LeetCode Guardian (2137), and Top 50 Amazon ML Challenge.'
    };
  }

  // Frontend / UI
  if (text.includes('frontend') || text.includes('react') || text.includes('ui engineer')) {
    return {
      category: 'Frontend / UI',
      resumeId: 'variant_sde_fullstack',
      score: 92,
      rationale: 'Highlights MediPulse (34 React pages, WebRTC) & IIITLBachat MERN dashboards.'
    };
  }

  // Security & DevOps
  if (text.includes('security') || text.includes('devops') || text.includes('infrastructure') || text.includes('cloud')) {
    return {
      category: 'Security & DevOps',
      resumeId: 'variant_security_fintech',
      score: 93,
      rationale: 'Highlights ThreatGraph automated incident response and Goldman Sachs Hackathon rank.'
    };
  }

  // Default Full Stack / Backend SDE
  return {
    category: 'SDE / Backend',
    resumeId: 'variant_sde_fullstack',
    score: 94,
    rationale: 'Highlights MediPulse 125 REST APIs, Redis distributed locks, and Kafka microservices.'
  };
}

/**
 * Checks if a location string is in India or remote-friendly for India
 */
function isLocationRelevant(loc = '') {
  const l = (loc || '').toLowerCase();
  const indiaKeywords = ['india', 'bengaluru', 'bangalore', 'hyderabad', 'gurgaon', 'gurugram', 'noida', 'pune', 'mumbai', 'delhi', 'chennai'];
  const remoteKeywords = ['remote', 'anywhere', 'worldwide', 'apac', 'flexible', 'distributed'];

  const isIndia = indiaKeywords.some(k => l.includes(k));
  const isRemote = remoteKeywords.some(k => l.includes(k));

  return { isIndia, isRemote, relevant: isIndia || isRemote };
}

/**
 * Scrapes job openings for a Greenhouse-hosted company
 */
async function scrapeGreenhouse(company) {
  if (!company.atsToken) return [];
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${company.atsToken}/jobs?content=false`;
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'JobFinderBot/1.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = data.jobs || [];

    const parsed = [];
    for (const j of jobs) {
      const locStr = j.location?.name || '';
      const locCheck = isLocationRelevant(locStr);
      if (!locCheck.relevant && !company.isRemoteFriendly) continue;

      const title = j.title || '';
      // Filter for engineering/tech
      const lowerTitle = title.toLowerCase();
      if (!lowerTitle.match(/software|engineer|developer|sde|backend|frontend|fullstack|data|ml|ai|quant|intern|security|systems|tech/)) {
        continue;
      }

      const classification = classifyJobTypeAndPriority(title, '', locCheck.isRemote || company.isRemoteFriendly, locCheck.isIndia);
      const match = matchJobToResume(title, '', classification);
      const sal = SALARY_RANGES[company.tier] || SALARY_RANGES['Funded Tech Startup'];

      parsed.push({
        title,
        company: company.name,
        companyId: company._id,
        location: locStr || (locCheck.isRemote ? 'Remote (India / Global)' : 'India'),
        isIndia: locCheck.isIndia,
        isRemote: locCheck.isRemote || company.isRemoteFriendly,
        url: j.absolute_url,
        applyUrl: j.absolute_url + '#app',
        atsType: 'greenhouse',
        roleCategory: (classification.is6MonthIntern || classification.isInternationalRemote) ? 'Internship / Fresher' : match.category,
        matchedResumeId: match.resumeId,
        fitScore: match.score,
        matchRationale: match.rationale,
        expectedBase: sal.base,
        expectedCtc: sal.ctc,
        ctcMin: sal.ctcMin || 14,
        stipendMonthly: classification.isInternationalRemote ? '$1,500 - $4,500 / month (₹1.25L - ₹3.75L)' : (sal.stipend || '₹50,000 - ₹1,00,000 / month'),
        jobType: classification.jobType,
        is6MonthIntern: classification.is6MonthIntern,
        isInternationalRemote: classification.isInternationalRemote,
        isFresherEligible: classification.isFresherEligible,
        priority: classification.priority,
        tier: company.tier,
        status: 'discovered',
        tags: [
          company.tier, 
          classification.isInternationalRemote ? '🌍 International Remote' : (classification.is6MonthIntern ? '⭐ 6-Month Intern' : (classification.jobType === 'internship' ? 'Internship' : 'Full-Time')),
          locCheck.isRemote ? 'Remote' : 'India', 
          match.category
        ],
        detectedAt: new Date(j.updated_at || Date.now())
      });
    }
    return parsed;
  } catch (err) {
    console.warn(`Greenhouse [${company.name}] skip: ${err.message}`);
    return [];
  }
}

/**
 * Scrapes job openings for a Lever-hosted company
 */
async function scrapeLever(company) {
  if (!company.atsToken) return [];
  try {
    const url = `https://api.lever.co/v0/postings/${company.atsToken}?mode=json`;
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'JobFinderBot/1.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return [];
    const jobs = await res.json();
    if (!Array.isArray(jobs)) return [];

    const parsed = [];
    for (const j of jobs) {
      const locStr = [j.categories?.location, j.categories?.commitment, j.workplaceType].filter(Boolean).join(', ');
      const locCheck = isLocationRelevant(locStr);
      if (!locCheck.relevant && !company.isRemoteFriendly) continue;

      const title = j.text || '';
      const lowerTitle = title.toLowerCase();
      if (!lowerTitle.match(/software|engineer|developer|sde|backend|frontend|fullstack|data|ml|ai|quant|intern|security|systems|tech/)) {
        continue;
      }

      const description = j.descriptionPlain || '';
      const classification = classifyJobTypeAndPriority(title, description, locCheck.isRemote || j.workplaceType === 'remote', locCheck.isIndia);
      const match = matchJobToResume(title, description, classification);
      const sal = SALARY_RANGES[company.tier] || SALARY_RANGES['Funded Tech Startup'];

      parsed.push({
        title,
        company: company.name,
        companyId: company._id,
        location: locStr || 'India',
        isIndia: locCheck.isIndia,
        isRemote: locCheck.isRemote || j.workplaceType === 'remote',
        url: j.hostedUrl,
        applyUrl: j.applyUrl || (j.hostedUrl + '/apply'),
        atsType: 'lever',
        roleCategory: (classification.is6MonthIntern || classification.isInternationalRemote) ? 'Internship / Fresher' : match.category,
        matchedResumeId: match.resumeId,
        fitScore: match.score,
        matchRationale: match.rationale,
        expectedBase: sal.base,
        expectedCtc: sal.ctc,
        ctcMin: sal.ctcMin || 14,
        stipendMonthly: classification.isInternationalRemote ? '$1,500 - $4,500 / month (₹1.25L - ₹3.75L)' : (sal.stipend || '₹50,000 - ₹1,00,000 / month'),
        jobType: classification.jobType,
        is6MonthIntern: classification.is6MonthIntern,
        isInternationalRemote: classification.isInternationalRemote,
        isFresherEligible: classification.isFresherEligible,
        priority: classification.priority,
        tier: company.tier,
        status: 'discovered',
        tags: [
          company.tier, 
          classification.isInternationalRemote ? '🌍 International Remote' : (classification.is6MonthIntern ? '⭐ 6-Month Intern' : (classification.jobType === 'internship' ? 'Internship' : 'Full-Time')),
          j.workplaceType || 'India', 
          match.category
        ],
        detectedAt: new Date(j.createdAt || Date.now())
      });
    }
    return parsed;
  } catch (err) {
    console.warn(`Lever [${company.name}] skip: ${err.message}`);
    return [];
  }
}

/**
 * Scrapes job openings for an Ashby-hosted company
 */
async function scrapeAshby(company) {
  if (!company.atsToken) return [];
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${company.atsToken}`;
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'JobFinderBot/1.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = data.jobs || [];

    const parsed = [];
    for (const j of jobs) {
      const locStr = j.location || j.address?.postalAddress?.addressLocality || '';
      const locCheck = isLocationRelevant(locStr);
      if (!locCheck.relevant && !company.isRemoteFriendly && !j.isRemote) continue;

      const title = j.title || '';
      const lowerTitle = title.toLowerCase();
      if (!lowerTitle.match(/software|engineer|developer|sde|backend|frontend|fullstack|data|ml|ai|quant|intern|security|systems|tech/)) {
        continue;
      }

      const classification = classifyJobTypeAndPriority(title, '', j.isRemote || locCheck.isRemote, locCheck.isIndia);
      const match = matchJobToResume(title, '', classification);
      const sal = SALARY_RANGES[company.tier] || SALARY_RANGES['Funded Tech Startup'];

      parsed.push({
        title,
        company: company.name,
        companyId: company._id,
        location: locStr || (j.isRemote ? 'Remote' : 'India'),
        isIndia: locCheck.isIndia,
        isRemote: j.isRemote || locCheck.isRemote,
        url: j.jobUrl || `https://jobs.ashbyhq.com/${company.atsToken}/${j.id}`,
        applyUrl: j.jobUrl || `https://jobs.ashbyhq.com/${company.atsToken}/${j.id}/application`,
        atsType: 'ashby',
        roleCategory: (classification.is6MonthIntern || classification.isInternationalRemote) ? 'Internship / Fresher' : match.category,
        matchedResumeId: match.resumeId,
        fitScore: match.score,
        matchRationale: match.rationale,
        expectedBase: sal.base,
        expectedCtc: sal.ctc,
        ctcMin: sal.ctcMin || 14,
        stipendMonthly: classification.isInternationalRemote ? '$1,500 - $4,500 / month (₹1.25L - ₹3.75L)' : (sal.stipend || '₹50,000 - ₹1,00,000 / month'),
        jobType: classification.jobType,
        is6MonthIntern: classification.is6MonthIntern,
        isInternationalRemote: classification.isInternationalRemote,
        isFresherEligible: classification.isFresherEligible,
        priority: classification.priority,
        tier: company.tier,
        status: 'discovered',
        tags: [
          company.tier, 
          classification.isInternationalRemote ? '🌍 International Remote' : (classification.is6MonthIntern ? '⭐ 6-Month Intern' : (classification.jobType === 'internship' ? 'Internship' : 'Full-Time')),
          j.isRemote ? 'Remote' : 'India', 
          match.category
        ],
        detectedAt: new Date(j.publishedDate || Date.now())
      });
    }
    return parsed;
  } catch (err) {
    console.warn(`Ashby [${company.name}] skip: ${err.message}`);
    return [];
  }
}

/**
 * Runs a complete crawl across all registered companies in the database
 */
async function crawlAllCompanies() {
  const companies = await Company.find();
  let totalDiscovered = 0;
  let newJobsAdded = 0;
  const startTime = Date.now();

  console.log(`Starting Concurrent Career Site Crawl across ${companies.length} companies...`);

  // Process companies in concurrent batches of 6 for high speed
  const BATCH_SIZE = 6;
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (comp) => {
        let companyJobs = [];
        try {
          if (comp.atsType === 'greenhouse') {
            companyJobs = await scrapeGreenhouse(comp);
          } else if (comp.atsType === 'lever') {
            companyJobs = await scrapeLever(comp);
          } else if (comp.atsType === 'ashby') {
            companyJobs = await scrapeAshby(comp);
          }
        } catch (e) {
          console.warn(`Scrape error for ${comp.name}: ${e.message}`);
          return { comp, companyJobs: [] };
        }
        return { comp, companyJobs };
      })
    );

    for (const r of batchResults) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { comp, companyJobs } = r.value;
      if (companyJobs && companyJobs.length > 0) {
        totalDiscovered += companyJobs.length;
        try {
          await Company.updateOne(
            { _id: comp._id },
            { $set: { activeJobsCount: companyJobs.length, lastScannedAt: new Date() } }
          );

          const ops = companyJobs.map(job => ({
            updateOne: {
              filter: { url: job.url },
              update: { $setOnInsert: job },
              upsert: true
            }
          }));

          const bulkRes = await JobOpening.bulkWrite(ops, { ordered: false });
          if (bulkRes.upsertedCount) {
            newJobsAdded += bulkRes.upsertedCount;
          }
        } catch (saveErr) {
          console.warn(`Job save error for ${comp.name}:`, saveErr.message);
        }
      }
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`Crawl completed in ${durationSec}s. Found ${totalDiscovered} total jobs, added ${newJobsAdded} new jobs.`);

  return {
    totalDiscovered,
    newJobsAdded,
    companiesScanned: companies.length,
    durationSec
  };
}

/**
 * Generates an Excel spreadsheet (.xlsx buffer) containing all job openings
 */
async function generateJobSpreadsheet() {
  const jobs = await JobOpening.find().sort({ detectedAt: -1 }).lean();

  const rows = jobs.map((j, idx) => ({
    '#': idx + 1,
    'Priority': j.priority ? j.priority.toUpperCase() : 'NORMAL',
    'Opening Type': j.isInternationalRemote ? '🌍 International Remote Intern' : (j.jobType === '6_months_internship' ? '⭐ 6-Month Internship' : (j.jobType === 'internship' ? 'Internship' : 'Full-Time')),
    'Company': j.company,
    'Job Title': j.title,
    'Location': j.location,
    'Remote?': j.isRemote ? 'Yes' : 'No',
    'International Remote?': j.isInternationalRemote ? 'Yes' : 'No',
    'India?': j.isIndia ? 'Yes' : 'No',
    'Fresher Eligible?': j.isFresherEligible ? 'Yes' : 'No',
    'Category': j.roleCategory,
    'Expected CTC': j.expectedCtc,
    'Expected Base Salary': j.expectedBase,
    'Monthly Stipend': j.stipendMonthly || 'N/A',
    'Company Tier': j.tier,
    'Best Resume Variant': j.matchedResumeId,
    'Fit Score (%)': j.fitScore,
    'Status': j.status,
    'Careers URL': j.url,
    'Apply URL': j.applyUrl,
    'Detected Date': new Date(j.detectedAt).toLocaleDateString('en-IN')
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Live Job Openings');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

module.exports = {
  crawlAllCompanies,
  generateJobSpreadsheet,
  matchJobToResume
};

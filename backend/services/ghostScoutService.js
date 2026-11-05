const Contact = require('../models/Contact');
const Company = require('../models/Company');
const { normalizeDomain, fetchCompanyEmails } = require('./publicEmailDiscovery');
const { isValidEmailSyntax } = require('./emailDeliverabilityService');
const { qualifyCompany } = require('./salaryEvidenceService');

function isDomainConsistent(email, expectedDomain) {
  const expected = normalizeDomain(expectedDomain);
  const actual = String(email).split('@')[1]?.toLowerCase();
  return !!expected && isValidEmailSyntax(email) && (actual === expected || actual.endsWith('.' + expected));
}
// Explicit candidates are never sourced contacts and never enter the send queue.
function generateEmailCandidates(first, last, domain) {
  domain = normalizeDomain(domain);
  if (!domain || !/^[a-z-]+$/i.test(first || '') || !/^[a-z-]+$/i.test(last || '')) return [];
  return [...new Set([`${first}.${last}`, `${first[0]}${last}`].map(s => `${s.toLowerCase()}@${domain}`))]
    .map(email => ({ email, inferenceFlag: true, verificationStatus: 'inferred_unverified', confidence: null, confidenceLevel: 'speculative_pattern', sendable: false }));
}
function formatRecruiterOutput(r) { return `${r.company} | ${r.hrName || 'Recruiting inbox'} | ${r.role || ''} | ${r.email} | ${r.sourceUrl || r.source || ''} | ${r.verificationStatus || 'unknown'}`; }
async function scoutRecruiters({ companyQuery = '', domain = '', limit = 10, userId, discover = fetchCompanyEmails, reserve } = {}) {
  const normalized = normalizeDomain(domain);
  const company = await Company.findOne(normalized ? { domain: normalized } : { name: String(companyQuery).trim() }).lean();
  if (!company || qualifyCompany(company).qualificationStatus !== 'qualified')
    return { addedCount: 0, skippedCount: 0, totalFound: 0, recruiters: [], savedContacts: [], reason: 'Company needs qualifying fixed-base evidence before recruiter discovery.' };
  let policy;
  if (userId) policy = await (reserve || require('./researchBudgetService').reserveResearch)(userId, { requests: 5 });
  const result = await discover(company.domain, { maxRuntimeSeconds: policy?.maxRuntimeSeconds,
    shouldStop: async () => process.env.RESEARCH_STOP === 'true' || (userId && (await require('./researchBudgetService').policyFor(userId)).stopped) });
  const seen = new Set();
  const recruiters = (result.emails || []).filter(r => {
    if (!isDomainConsistent(r.email, company.domain) || !r.sourceUrl || seen.has(r.email.toLowerCase())) return false;
    seen.add(r.email.toLowerCase()); return true;
  }).slice(0, Math.max(1, Math.min(30, Number(limit) || 10))).map(r => ({
    email: r.email.toLowerCase(), hrName: '', company: company.name, companyId: company._id,
    role: 'Public recruiting inbox', source: 'career_crawler', sourceUrl: r.sourceUrl,
    provenance: [{ url: r.sourceUrl, provider: 'public_company_page', observedAt: new Date() }],
    inferenceFlag: false, verificationStatus: 'publicly_sourced', deliverabilityStatus: 'unverified',
    notes: 'Public professional address. Mailbox existence not verified.'
  }));
  const savedContacts = []; let addedCount = 0, skippedCount = 0;
  for (const r of recruiters) {
    r.formattedOutput = formatRecruiterOutput(r);
    if (!userId) continue;
    const existing = await Contact.findOne({ userId, email: r.email });
    if (existing) { skippedCount++; continue; }
    savedContacts.push(await Contact.create({ ...r, userId, status: 'pending' })); addedCount++;
  }
  return { addedCount, skippedCount, totalFound: recruiters.length, recruiters, savedContacts, reason: result.reason || (recruiters.length ? null : 'No public recruiting inbox found in checked pages.'), requestsUsed: result.requestsUsed || 0 };
}
module.exports = { scoutRecruiters, generateEmailCandidates, isValidEmailSyntax, isDomainConsistent, formatRecruiterOutput };

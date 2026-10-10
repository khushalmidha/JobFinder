const dns = require('dns').promises;
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const User = require('../models/User');

/**
 * Lead Agency Integration Service for Apollo.io and Hunter.io
 */

const TARGET_RECRUITER_TITLES = [
  'Technical Recruiter',
  'Senior Technical Recruiter',
  'Lead Recruiter',
  'Talent Acquisition Specialist',
  'Talent Acquisition Lead',
  'Talent Acquisition Partner',
  'University Recruiter',
  'Campus Recruiter',
  'Early Careers Recruiter',
  'HR Business Partner',
  'Head of Talent'
];

/**
 * Searches Hunter.io for HR & Recruiter email addresses associated with a domain
 * Docs: https://hunter.io/api-documentation/v2#domain-search
 */
async function searchHunterDomain(domain, apiKey, limit = 15) {
  if (!apiKey) throw new Error('Hunter.io API key is missing. Please save it in Settings.');
  const cleanDomain = domain.replace(/https?:\/\//, '').replace(/\/.*$/, '').trim();

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(cleanDomain)}&department=human_resources&limit=${limit}&api_key=${encodeURIComponent(apiKey)}`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'JobFinderLeadScout/1.0' }
  });

  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data.errors?.[0]?.details || data.errors?.[0]?.message || 'Hunter.io API request failed';
    throw new Error(errorMsg);
  }

  const emails = data.data?.emails || [];
  const results = [];

  for (const item of emails) {
    const email = item.value?.toLowerCase()?.trim();
    if (!email) continue;

    const hrName = [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Talent Acquisition';
    const role = item.position || 'Recruiter / Talent Partner';
    const linkedinUrl = item.linkedin || '';
    const confidence = item.confidence || 85;

    results.push({
      email,
      hrName,
      company: cleanDomain.split('.')[0].toUpperCase(),
      domain: cleanDomain,
      role,
      linkedinUrl,
      confidence,
      source: 'hunter.io',
      notes: `Discovered via Hunter.io Domain Search (Confidence: ${confidence}%).`
    });
  }

  return results;
}

/**
 * Searches Apollo.io for Talent Acquisition & Recruiter leads across domains
 * Docs: https://apolloio.github.io/apollo-api-docs/#mixed-people-search
 */
async function searchApolloPeople({ domains = [], titles = TARGET_RECRUITER_TITLES, locations = ['India', 'Bengaluru', 'Hyderabad', 'Gurgaon', 'Remote'], apiKey, page = 1, perPage = 25 }) {
  if (!apiKey) throw new Error('Apollo.io API key is missing. Please save it in Settings.');

  const cleanDomains = domains.map(d => d.replace(/https?:\/\//, '').replace(/\/.*$/, '').trim());

  const payload = {
    api_key: apiKey,
    q_organization_domains: cleanDomains.join('\n'),
    person_titles: titles,
    person_locations: locations,
    page,
    per_page: perPage
  };

  const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Apollo.io API request failed');
  }

  const people = data.people || [];
  const results = [];

  for (const p of people) {
    const email = p.email?.toLowerCase()?.trim();
    if (!email) continue; // Skip if no email unlocked

    const hrName = p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Recruiter';
    const company = p.organization?.name || (cleanDomains[0] ? cleanDomains[0].split('.')[0].toUpperCase() : 'Company');
    const role = p.title || 'Technical Recruiter';
    const linkedinUrl = p.linkedin_url || '';

    results.push({
      email,
      hrName,
      company,
      domain: p.organization?.primary_domain || cleanDomains[0],
      role,
      linkedinUrl,
      confidence: 90,
      source: 'apollo.io',
      notes: `Discovered via Apollo.io People Search (${p.city || 'India'}, ${p.country || ''}).`
    });
  }

  return results;
}

/**
 * Verifies domain MX records to ensure the mail domain is live
 */
async function verifyDomainMx(domain) {
  try {
    const clean = domain.replace(/https?:\/\//, '').replace(/\/.*$/, '').trim();
    const mxRecords = await dns.resolveMx(clean);
    return mxRecords && mxRecords.length > 0;
  } catch (err) {
    return false;
  }
}

/**
 * Master Lead Harvester: Scrapes Apollo.io and/or Hunter.io for targeted companies,
 * deduplicates against user's Contact list, and saves them directly to MongoDB.
 */
async function harvestRecruiterLeads({ userId, domains = [], targetAgency = 'both', customTitles = null, limit = 20 }) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const hunterKey = user.hunterApiKey;
  const apolloKey = user.apolloApiKey;

  if (targetAgency === 'hunter' && !hunterKey) {
    throw new Error('Hunter.io API key is not configured in your Settings.');
  }
  if (targetAgency === 'apollo' && !apolloKey) {
    throw new Error('Apollo.io API key is not configured in your Settings.');
  }
  if (targetAgency === 'both' && !hunterKey && !apolloKey) {
    throw new Error('Neither Apollo.io nor Hunter.io API keys are configured. Please add at least one key in Settings.');
  }

  // If no domains provided, pull top target domains from Company directory
  let targetDomains = domains;
  if (!targetDomains || targetDomains.length === 0) {
    const companies = await Company.find({ domain: { $ne: '' } }).limit(10).lean();
    targetDomains = companies.map(c => c.domain).filter(Boolean);
  }

  let aggregatedLeads = [];
  const errors = [];

  // 1. Harvest from Hunter.io
  if ((targetAgency === 'hunter' || targetAgency === 'both') && hunterKey) {
    for (const dom of targetDomains.slice(0, 10)) {
      try {
        const hunterLeads = await searchHunterDomain(dom, hunterKey, Math.min(limit, 10));
        aggregatedLeads.push(...hunterLeads);
      } catch (err) {
        errors.push(`Hunter.io [${dom}]: ${err.message}`);
      }
    }
  }

  // 2. Harvest from Apollo.io
  if ((targetAgency === 'apollo' || targetAgency === 'both') && apolloKey) {
    try {
      const apolloLeads = await searchApolloPeople({
        domains: targetDomains.slice(0, 15),
        titles: customTitles || TARGET_RECRUITER_TITLES,
        apiKey: apolloKey,
        perPage: limit
      });
      aggregatedLeads.push(...apolloLeads);
    } catch (err) {
      errors.push(`Apollo.io: ${err.message}`);
    }
  }

  // 3. Deduplicate and insert into MongoDB
  let addedCount = 0;
  let skippedCount = 0;
  const savedContacts = [];

  for (const lead of aggregatedLeads) {
    const exists = await Contact.findOne({ userId, email: lead.email });
    if (!exists) {
      const created = await Contact.create({
        userId,
        email: lead.email,
        hrName: lead.hrName,
        company: lead.company,
        role: lead.role,
        source: lead.source,
        linkedinUrl: lead.linkedinUrl,
        notes: lead.notes,
        status: 'pending'
      });
      savedContacts.push(created);
      addedCount++;
    } else {
      skippedCount++;
    }
  }

  return {
    addedCount,
    skippedCount,
    totalDiscovered: aggregatedLeads.length,
    contacts: savedContacts,
    domainsTargeted: targetDomains,
    errors: errors.length > 0 ? errors : null
  };
}

module.exports = {
  searchHunterDomain,
  searchApolloPeople,
  verifyDomainMx,
  harvestRecruiterLeads,
  TARGET_RECRUITER_TITLES
};

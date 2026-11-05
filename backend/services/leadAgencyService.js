const Contact = require('../models/Contact');
const Company = require('../models/Company');
const User = require('../models/User');
const { normalizeDomain } = require('./publicEmailDiscovery');
const { qualifyCompany } = require('./salaryEvidenceService');
const { reserveResearch } = require('./researchBudgetService');
const { isDomainConsistent } = require('./ghostScoutService');
const TARGET_RECRUITER_TITLES = ['Technical Recruiter', 'Talent Acquisition', 'University Recruiter', 'Campus Recruiter', 'Early Careers Recruiter'];

async function providerCall({ userId, credits, url, apiKey, payload, provider, reserve = reserveResearch, fetchImpl = fetch }) {
  if (!userId || !apiKey) throw new Error('Authenticated owner and provider key required');
  await reserve(userId, { requests: 1, credits });
  const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...(provider === 'apollo' ? { 'x-api-key': apiKey } : {}) }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Provider request failed (${response.status}); reservation retained, no automatic retry`);
  return response.json();
}
async function searchHunterDomain(domain, apiKey, limit = 5, { userId, reserve = reserveResearch, fetchImpl = fetch } = {}) {
  domain = normalizeDomain(domain);
  if (!domain || !userId || !apiKey) throw new Error('Valid domain, owner and Hunter key required');
  limit = Math.max(1, Math.min(10, Number(limit) || 5));
  // Conservatively reserve one search credit per requested result across plans.
  await reserve(userId, { requests: 1, credits: limit });
  const url = new URL('https://api.hunter.io/v2/domain-search');
  for (const [k,v] of Object.entries({ domain, api_key: apiKey, department: 'human_resources', limit })) url.searchParams.set(k,v);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Hunter request failed (${response.status}); reservation retained`);
  const data = await response.json();
  return (data.data?.emails || []).slice(0, limit).filter(item => isDomainConsistent(item.value, domain)).map(item => ({
    email: item.value.toLowerCase(), hrName: [item.first_name, item.last_name].filter(Boolean).join(' '),
    domain, role: item.position || 'Recruiting contact', source: 'hunter.io',
    provenance: (item.sources || []).map(s => ({ url: s.uri, provider: 'hunter.io', observedAt: new Date() })),
    inferenceFlag: !(item.sources || []).length, vendorStatus: item.verification?.status || 'unknown',
    verificationStatus: item.verification?.status === 'invalid' ? 'invalid' : ['accept_all', 'catch_all'].includes(item.verification?.status) ? 'catch_all' : !(item.sources || []).length ? 'inferred_unverified' : 'publicly_sourced',
    deliverabilityStatus: 'unverified', notes: 'Vendor-found address; source evidence is separate from mailbox verification.'
  }));
}
async function searchApolloPeople({ domains = [], titles = TARGET_RECRUITER_TITLES, apiKey, userId, perPage = 10, reserve, fetchImpl } = {}) {
  const cleanDomains = domains.map(normalizeDomain).filter(Boolean).slice(0, 10);
  if (!cleanDomains.length) throw new Error('At least one company domain is required');
  const data = await providerCall({ userId, apiKey, credits: 0, provider: 'apollo', reserve, fetchImpl,
    url: 'https://api.apollo.io/api/v1/mixed_people/api_search',
    payload: { q_organization_domains_list: cleanDomains, person_titles: titles, page: 1, per_page: Math.max(1, Math.min(25, Number(perPage) || 10)) } });
  // Discovery is not email retrieval; do not turn redacted names into identities.
  return (data.people || []).map(p => ({ providerPersonId: p.id, firstName: p.first_name || '', lastNamePreview: p.last_name_obfuscated || '', title: p.title || '', hasEmail: !!p.has_email, organization: p.organization?.name || '', source: 'apollo.io', discoveryOnly: true }));
}
async function enrichApolloPerson({ personId, domain, userId, apiKey, reserve, fetchImpl } = {}) {
  if (typeof personId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(personId)) throw new Error('Valid person ID required');
  const data = await providerCall({ userId, apiKey, credits: 9, provider: 'apollo', reserve, fetchImpl,
    url: 'https://api.apollo.io/api/v1/people/match', payload: { id: personId, reveal_personal_emails: false, reveal_phone_number: false, run_waterfall_email: false, run_waterfall_phone: false } });
  const p = data.person;
  if (!p?.email || !isDomainConsistent(p.email, domain)) return null;
  return { email: p.email.toLowerCase(), hrName: p.name || '', role: p.title || '', source: 'apollo.io',
    provenance: [{ url: p.linkedin_url || 'https://app.apollo.io/', provider: 'apollo.io', observedAt: new Date() }],
    inferenceFlag: false, vendorStatus: p.email_status || 'unknown',
    verificationStatus: p.email_status === 'verified' ? 'vendor_verified' : 'unknown', deliverabilityStatus: 'unverified' };
}
async function verifyHunterEmail({ email, userId, apiKey, reserve = reserveResearch, fetchImpl = fetch } = {}) {
  if (!userId || !apiKey) throw new Error('Owner and Hunter key required');
  await reserve(userId, { requests: 1, credits: 1 });
  const url = new URL('https://api.hunter.io/v2/email-verifier');
  url.searchParams.set('email', email); url.searchParams.set('api_key', apiKey);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Hunter verifier failed (${response.status})`);
  const { data } = await response.json();
  const status = data?.status;
  return { vendorStatus: status || 'unknown', verificationStatus: status === 'valid' && !data?.accept_all ? 'vendor_verified' : status === 'invalid' ? 'invalid' : data?.accept_all || status === 'accept_all' ? 'catch_all' : 'unknown' };
}
async function findHunterEmail({ domain, firstName, lastName, personSourceUrl, userId, apiKey, reserve = reserveResearch, fetchImpl = fetch } = {}) {
  domain=normalizeDomain(domain);
  const {sourceUrl}=require('./salaryEvidenceService');
  if(!domain || !userId || !apiKey || !firstName?.trim() || !lastName?.trim() || firstName.length>100 || lastName.length>100 || !sourceUrl(personSourceUrl)) throw new Error('Finder needs an independently sourced professional name, domain and source URL');
  await reserve(userId,{requests:1,credits:2});
  const url=new URL('https://api.hunter.io/v2/email-finder');
  for(const [key,value] of Object.entries({domain,first_name:firstName,last_name:lastName,api_key:apiKey}))url.searchParams.set(key,value);
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Hunter Finder failed (${response.status}); reservation retained`);
  const {data}=await response.json();
  if(!data?.email || !isDomainConsistent(data.email,domain))return null;
  const sources=(data.sources || []).filter(s=>sourceUrl(s.uri));
  const status=data.verification?.status || 'unknown';
  return {email:data.email.toLowerCase(),hrName:[firstName,lastName].join(' '),source:'hunter.io',
    inferenceFlag:!sources.length,vendorStatus:status,
    verificationStatus:status==='invalid'?'invalid':['accept_all','catch_all'].includes(status)?'catch_all':sources.length?'publicly_sourced':'inferred_unverified',
    provenance:[{url:personSourceUrl,provider:'user_sourced_professional_identity',observedAt:new Date()},...sources.map(s=>({url:s.uri,provider:'hunter.io',observedAt:new Date()}))],
    deliverabilityStatus:'unverified'};
}
async function harvestRecruiterLeads({ userId, domains = [], targetAgency = 'both', limit = 5 } = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!Array.isArray(domains) || !domains.length || domains.length > 3) throw new Error('Shortlist one to three qualified company domains first');
  const clean = domains.map(normalizeDomain);
  if (clean.some(d => !d)) throw new Error('Invalid domain');
  const companies = await Company.find({ domain: { $in: clean } }).lean();
  if (companies.length !== new Set(clean).size || companies.some(c => qualifyCompany(c).qualificationStatus !== 'qualified')) throw new Error('Every target requires current qualifying fixed-base evidence');
  let addedCount = 0, skippedCount = 0; const discovery = [], contacts = [];
  for (const company of companies) {
    if (['hunter', 'both'].includes(targetAgency) && user.hunterApiKey) {
      for (const lead of await searchHunterDomain(company.domain, user.hunterApiKey, limit, { userId })) {
        if (await Contact.exists({ userId, email: lead.email })) { skippedCount++; continue; }
        contacts.push(await Contact.create({ ...lead, userId, companyId: company._id, company: company.name })); addedCount++;
      }
    }
    if (['apollo', 'both'].includes(targetAgency) && user.apolloApiKey) discovery.push(...await searchApolloPeople({ domains: [company.domain], apiKey: user.apolloApiKey, userId, perPage: limit }));
  }
  return { addedCount, skippedCount, contacts, discovery, totalDiscovered: contacts.length, domainsTargeted: clean, credits: 'Worst-case reservations stored in ResearchUsage; Apollo discovery returns no email' };
}
module.exports = { searchHunterDomain, findHunterEmail, searchApolloPeople, enrichApolloPerson, verifyHunterEmail, harvestRecruiterLeads, TARGET_RECRUITER_TITLES };

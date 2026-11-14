const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Company = require('../models/Company');
const Prospect = require('../models/CompanyProspect');
const Run = require('../models/CompanyImportRun');
const Lead = require('../models/PublicRecruitmentLead');
const User = require('../models/User');
const { fetchPublicPage, robotsAllows } = require('./safePublicFetch');
const { extractEmails, normalizeDomain } = require('./publicEmailDiscovery');

const sourcePath = path.resolve(__dirname, '../../docs/handoff/20261107/company_research_staging_733.json');
const suppliedSource = () => JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
const canonicalName = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
function canonical(value) {
  const raw = JSON.parse(JSON.stringify(value));
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(raw));
}
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const recordKey = (source, row) => hash([source, canonicalName(row.companyName), row.regionGroup]);
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
async function requireAdmin(userId) {
  if (!mongoose.isValidObjectId(userId) || (await User.findById(userId).select('role').lean())?.role !== 'admin') {
    const error = new Error('Only an administrator can import the shared company directory'); error.status = 403; throw error;
  }
}
function sanitizeSource(input) {
  if (!input || typeof input.source !== 'string' || !input.source.trim() || input.source.length > 240 || !Array.isArray(input.companies) || !input.companies.length || input.companies.length > 2000) throw new Error('Provide a named source with 1–2000 company rows');
  const seen = new Set();
  const companies = input.companies.map(row => {
    if (!row || typeof row.companyName !== 'string' || !row.companyName.trim() || row.companyName.length > 240 || !['India', 'International_Visa_Research'].includes(row.regionGroup) || canonical(row).length > 16000) throw new Error('Invalid company name, region or oversized source record');
    const normalized = plain(row);
    normalized.companyName = row.companyName.trim();
    normalized.qualificationStatus = 'research_needed'; normalized.sendEligible = false;
    // Preserve pay claims verbatim as research, never copy them to salaryEvidence.
    const key = recordKey(input.source, normalized);
    if (seen.has(key)) throw new Error(`Duplicate source record: ${row.companyName} / ${row.regionGroup}`);
    seen.add(key); return normalized;
  });
  return { source: input.source.trim(), companies };
}
function sourceSummary(input = suppliedSource()) {
  const { companies } = sanitizeSource(input);
  return {
    sourceRows: companies.length, indiaRows: companies.filter(c => c.regionGroup === 'India').length,
    overseasRows: companies.filter(c => c.regionGroup !== 'India').length,
    distinctCompanyNames: new Set(companies.map(c => canonicalName(c.companyName))).size,
    reportedIndiaBaseAbove15: companies.filter(c => c.regionGroup === 'India' && Number(c.reportedBaseLowLPA) > 15).length,
    suppliedPublicInboxLeads: companies.filter(c => c.recruitmentEmail?.email).length,
    verifiedFixedBaseOffersFromImport: 0, readyToSendFromImport: 0
  };
}
async function directoryState() {
  const [companies, prospects, leads] = await Promise.all([Company.find().sort({ _id: 1 }).lean(), Prospect.find().sort({ _id: 1 }).lean(), Lead.find().sort({ _id: 1 }).lean()]);
  return { companies, prospects, leads };
}
function planImport(input = suppliedSource(), state = { companies: [], prospects: [], leads: [] }) {
  const source = sanitizeSource(input);
  const aliases = new Map(); const domains = new Map();
  for (const company of state.companies) {
    const domain = normalizeDomain(company.domain);
    if (domain) domains.set(domain, [...(domains.get(domain) || []), company]);
  }
  for (const company of state.companies) for (const name of [company.name, ...(company.aliases || [])]) {
    const key = canonicalName(name); aliases.set(key, [...(aliases.get(key) || []), company]);
  }
  const existing = new Map(state.prospects.map(p => [p.sourceRecordKey, p]));
  const planned = new Map(); const changes = [];
  const summary = { ...sourceSummary(source), newProspects: 0, updatedProspects: 0, unchangedProspects: 0, newCompanies: 0, linkedExisting: 0, dedupedCompanyRows: 0, conflicted: 0, failed: 0 };
  for (const raw of source.companies) {
    const key = recordKey(source.source, raw); const before = existing.get(key);
    const name = canonicalName(raw.companyName);
    const trustedDomain = trustedEmployerDomain(raw);
    const matches = [...(aliases.get(name) || []), ...(trustedDomain ? domains.get(trustedDomain) || [] : [])];
    const ids = new Set(matches.map(c => String(c._id)));
    const change = { sourceRecordKey: key, companyName: raw.companyName, regionGroup: raw.regionGroup, raw, contentHash: hash(raw), before: plain(before || null) };
    if (ids.size > 1) {
      change.action = 'conflict'; change.reason = 'Name/alias matches several existing employers; manual review required';
      change.companyId = null;
      change.quarantineUnchanged = before?.contentHash === change.contentHash && before.identityStatus === 'conflict' && !before.companyId && before.identityReason === change.reason;
      summary.conflicted++;
      summary[!before ? 'newProspects' : change.quarantineUnchanged ? 'unchangedProspects' : 'updatedProspects']++;
      changes.push(change); continue;
    }
    let company = before?.companyId ? state.companies.find(c => String(c._id) === String(before.companyId)) : matches[0];
    if (!company && planned.has(name)) { company = planned.get(name); summary.dedupedCompanyRows++; }
    if (!company) {
      company = { _id: new mongoose.Types.ObjectId(), name: raw.companyName, domain: '', careersUrl: '', tier: 'Research prospect', fresherCtcTier: 'unknown', isIndia: raw.regionGroup === 'India', isRemoteFriendly: false, regionGroups: [raw.regionGroup] };
      // A spreadsheet URL may be a directory or generic ATS. Keep it on the prospect,
      // rather than asserting the host is this employer's verified domain/careers URL.
      planned.set(name, company); change.newCompany = plain(company); summary.newCompanies++;
    } else if (!planned.has(name)) summary.linkedExisting++;
    change.companyId = String(company._id);
    change.action = !before ? 'insert' : before.contentHash === change.contentHash && String(before.companyId) === String(company._id) ? 'unchanged' : 'update';
    summary[change.action === 'insert' ? 'newProspects' : change.action === 'update' ? 'updatedProspects' : 'unchangedProspects']++;
    changes.push(change);
  }
  for (const change of changes.filter(c => c.newCompany)) {
    const groups = [...new Set(changes.filter(c => c.companyId === change.companyId).map(c => c.regionGroup))];
    change.newCompany.regionGroups = groups;
    change.newCompany.isIndia = groups.includes('India');
  }
  const databaseFingerprint = hash(state);
  const digest = hash({ source: source.source, changes, databaseFingerprint });
  return { source: source.source, digest, databaseFingerprint, summary, changes };
}
async function previewImport(userId, input = suppliedSource()) {
  await requireAdmin(userId);
  const plan = planImport(input, await directoryState());
  const { digest, summary, changes } = plan;
  const run = await Run.create({ userId, ...plan, journal: [] });
  return { runId: String(run._id), digest, status: run.status, summary, changes };
}

// Known employer-owned proof pages from the supplied seven-inbox handoff. Merely
// editing the uploaded JSON cannot grant a URL official-source trust.
const officialPages = new Map([
  ['jobs@razorpay.com', 'https://razorpay.com/tech/'],
  ['careers@browserstack.com', 'https://www.browserstack.com/careers'],
  ['careers@apnadatasystems.com', 'https://apnadatasystems.com/careers'],
  ['careers@intellicar.in', 'https://www.intellicar.in/company-pages/careers'],
  ['careers@getlexi.io', 'https://www.getlexi.io/careers/software-engineer-chennai'],
  ['careers@live2.ai', 'https://live2.ai/careers'],
  ['hr@screl.com', 'https://screl.com/careers'],
  ['careers@zeta.tech', 'https://www.zeta.tech/in/careers/work-with-us']
]);
const officialEmployerNames = new Map([
  ['jobs@razorpay.com', 'Razorpay'], ['careers@browserstack.com', 'BrowserStack'],
  ['careers@apnadatasystems.com', 'Apna Data Systems'], ['careers@intellicar.in', 'Intellicar'],
  ['careers@getlexi.io', 'Lexi'], ['careers@live2.ai', 'Live2.ai'], ['hr@screl.com', 'SCREL'], ['careers@zeta.tech', 'Zeta']
]);
function trustedEmployerDomain(row) {
  const email = String(row.recruitmentEmail?.email || '').toLowerCase().trim();
  return officialPages.get(email) === row.recruitmentEmail?.evidenceUrl && canonicalName(officialEmployerNames.get(email)) === canonicalName(row.companyName) ? email.split('@')[1] : null;
}
async function checkPublicLead(raw, { fetchPage = fetchPublicPage, now = new Date(), companyName, identityConflict = false } = {}) {
  const email = String(raw?.email || '').toLowerCase().trim();
  const evidenceUrl = String(raw?.evidenceUrl || '');
  const base = { email, evidenceUrl, listingStatus: 'source_claim_unchecked', mailboxVerified: false, readyToSend: false, checkedAt: now };
  if (!officialPages.has(email) || officialPages.get(email) !== evidenceUrl || identityConflict || canonicalName(companyName) !== canonicalName(officialEmployerNames.get(email))) return { ...base, checkReason: 'Official employer identity and page ownership require independent review' };
  try {
    const url = new URL(evidenceUrl); const robots = await fetchPage(`${url.origin}/robots.txt`);
    if (robots.status !== 404 && (robots.status !== 200 || !robotsAllows(robots.text, url.pathname))) throw new Error('Robots permission unavailable or blocked');
    const page = await fetchPage(evidenceUrl);
    if (page.status !== 200 || !page.contentType?.includes('text/html')) throw new Error(`Public page unavailable (${page.status})`);
    const found = extractEmails(page.text, evidenceUrl, email.split('@')[1]).some(item => item.email === email);
    return { ...base, listingStatus: found ? 'official_publicly_listed' : 'not_found', evidenceExcerpt: found ? `Official page publicly lists ${email}. Individual mailbox existence and salary eligibility are not established.` : '', checkReason: found ? 'Address extracted from employer-owned public page at import time' : 'Address not present in fetched page' };
  } catch (error) { return { ...base, listingStatus: 'inconclusive', checkReason: String(error.message).slice(0, 300) }; }
}
async function applyImport(userId, runId, digest, options = {}) {
  await requireAdmin(userId);
  const run = await Run.findOne({ _id: runId, userId });
  if (!run || run.digest !== digest) throw new Error('Exact administrator preview digest required');
  if (run.status === 'applied') return { runId: String(run._id), status: 'applied', alreadyApplied: true, summary: run.summary };
  if (run.status !== 'preview') throw new Error('Run is not an applicable preview; inspect journal/recovery instructions');
  if (Date.now() - run.createdAt.getTime() > 86400000) throw new Error('Preview expired; create a fresh dry run');
  if (hash(await directoryState()) !== run.databaseFingerprint) throw new Error('Directory changed since preview; create a fresh dry run');
  const claimed = await Run.findOneAndUpdate({ _id: runId, status: 'preview', digest }, { $set: { status: 'applying', mutating: true } }, { returnDocument: 'after' });
  if (!claimed) throw new Error('Import already claimed');
  try {
    if (hash(await directoryState()) !== run.databaseFingerprint) throw new Error('Directory changed before import lock; create a fresh dry run');
    let completedRows = 0; let listed = 0;
    for (const change of run.changes) {
      if (!await Run.exists({ _id: runId, status: 'applying', mutating: true })) throw new Error('Import stopped or recovered; no further rows will be written');
      if (change.action === 'unchanged' || change.quarantineUnchanged) continue;
      const current = await Prospect.findOne({ sourceRecordKey: change.sourceRecordKey }).lean();
      if (hash(current || null) !== hash(change.before)) throw new Error(`Source record changed after preview: ${change.companyName}`);
      const beforeLead = await Lead.findOne({ sourceRecordKey: change.sourceRecordKey }).lean();
      const entry = { sourceRecordKey: change.sourceRecordKey, beforeProspect: plain(current), beforeLead: plain(beforeLead), newCompanyId: change.newCompany?._id || null, companyId: change.companyId, state: 'pending' };
      const journalIndex = completedRows++;
      await Run.updateOne({ _id: runId }, { $push: { journal: entry } });
      if (change.newCompany) {
        const document = await Company.create({ ...change.newCompany, _id: change.newCompany._id, importRunId: runId });
        entry.afterCompanyHash = hash(document.toObject());
        await Run.updateOne({ _id: runId }, { $set: { [`journal.${journalIndex}.afterCompanyHash`]: entry.afterCompanyHash } });
      }
      if (change.action !== 'conflict' && !await Company.exists({ _id: change.companyId })) throw new Error(`Employer disappeared: ${change.companyName}`);
      const next = { sourceRecordKey: change.sourceRecordKey, source: run.source, companyName: change.companyName, regionGroup: change.regionGroup, companyId: change.companyId, identityStatus: change.action === 'conflict' ? 'conflict' : 'matched', identityReason: change.action === 'conflict' ? change.reason : '', raw: change.raw, contentHash: change.contentHash, qualificationStatus: 'research_needed', sendEligible: false, importRunId: runId };
      const prospect = await Prospect.findOneAndUpdate({ sourceRecordKey: change.sourceRecordKey }, { $set: next }, { upsert: true, returnDocument: 'after', runValidators: true });
      entry.afterProspectHash = hash(prospect.toObject());
      await Run.updateOne({ _id: runId }, { $set: { [`journal.${journalIndex}.afterProspectHash`]: entry.afterProspectHash } });
      if (change.raw.recruitmentEmail?.email) {
        const verified = await checkPublicLead(change.raw.recruitmentEmail, { ...options, companyName: change.companyName, identityConflict: change.action === 'conflict' });
        if (verified.listingStatus === 'official_publicly_listed') listed++;
        const lead = await Lead.findOneAndUpdate({ sourceRecordKey: change.sourceRecordKey }, { $set: { ...verified, companyId: change.companyId, companyName: change.companyName, importRunId: runId } }, { upsert: true, returnDocument: 'after', runValidators: true });
        entry.afterLeadHash = hash(lead.toObject());
      }
      await Run.updateOne({ _id: runId }, { $set: { [`journal.${journalIndex}.state`]: 'applied', [`journal.${journalIndex}.afterLeadHash`]: entry.afterLeadHash || null } });
    }
    const summary = { ...run.summary, appliedRows: completedRows, officialPublicListingsRechecked: listed, mailboxVerified: 0, readyToSendFromImport: 0 };
    await Run.updateOne({ _id: runId, status: 'applying' }, { $set: { status: 'applied', mutating: false, appliedAt: new Date(), summary } });
    return { runId: String(runId), status: 'applied', summary };
  } catch (error) {
    await Run.updateOne({ _id: runId }, { $set: { status: 'failed', mutating: false, error: String(error.message).slice(0, 500) } }); throw error;
  }
}

async function rollbackImport(userId, runId) {
  await requireAdmin(userId);
  const operatorRun=await Run.findOne({_id:runId,userId}).select('execution').lean();
  if(operatorRun?.execution?.kind==='local_operator_maintenance')throw new Error('Operator imports require contact-aware local maintenance rollback');
  const run = await Run.findOneAndUpdate({ _id: runId, userId, status: { $in: ['applied', 'failed'] } }, { $set: { status: 'rolling_back', mutating: true } }, { returnDocument: 'after' });
  if (!run) throw new Error('Only an applied/failed owned run can be rolled back');
  const report = { restoredProspects: 0, removedProspects: 0, restoredLeads: 0, removedLeads: 0, removedCompanies: 0, archivedCompanies: 0, retainedCompanies: 0, conflicts: [] };
  try {
  for (const entry of [...run.journal].reverse()) {
    if (!await Run.exists({ _id: runId, status: 'rolling_back', mutating: true })) throw new Error('Rollback stopped or recovered');
    for (const [Model, beforeKey, hashKey, restoredKey, removedKey] of [[Prospect, 'beforeProspect', 'afterProspectHash', 'restoredProspects', 'removedProspects'], [Lead, 'beforeLead', 'afterLeadHash', 'restoredLeads', 'removedLeads']]) {
      const current = await Model.findOne({ sourceRecordKey: entry.sourceRecordKey }).lean();
      if (!current || String(current.importRunId) !== String(runId)) continue;
      if (!entry[hashKey] || hash(current) !== entry[hashKey]) { report.conflicts.push(`${Model.modelName}:${entry.sourceRecordKey}:changed-or-incomplete`); continue; }
      if (entry[beforeKey]) {
        const result = await Model.collection.replaceOne({ _id: current._id, importRunId: new mongoose.Types.ObjectId(runId), updatedAt: current.updatedAt, contentHash: current.contentHash }, revive(entry[beforeKey]));
        if (result.matchedCount) report[restoredKey]++; else report.conflicts.push(`${Model.modelName}:${entry.sourceRecordKey}:concurrent-edit`);
      } else {
        const result = await Model.deleteOne({ _id: current._id, importRunId: runId, updatedAt: current.updatedAt });
        if (result.deletedCount) report[removedKey]++; else report.conflicts.push(`${Model.modelName}:${entry.sourceRecordKey}:concurrent-edit`);
      }
    }
    if (entry.newCompanyId) {
      const company = await Company.findById(entry.newCompanyId).lean();
      if (!company) continue;
      let referenced = await Prospect.exists({ companyId: company._id });
      // Check every application collection, including future models, for a
      // companyId reference. Never delete company history to satisfy rollback.
      for (const collection of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) {
        if (['companies', 'companyimportruns', 'companyprospects'].includes(collection.name)) continue;
        if (await mongoose.connection.db.collection(collection.name).findOne({ companyId: company._id }, { projection: { _id: 1 } })) { referenced = true; break; }
      }
      if (!referenced && entry.afterCompanyHash && hash(company) === entry.afterCompanyHash && String(company.importRunId) === String(runId)) {
        // Mongo has no foreign keys. Preserve the employer ID even if a user
        // creates a reference between our reference check and this write.
        const result = await Company.updateOne({ _id: company._id, importRunId: runId, updatedAt: company.updatedAt }, { $set: { importRollbackArchivedAt: new Date() } });
        if(result.modifiedCount) report.archivedCompanies++; else report.retainedCompanies++;
      }
      else report.retainedCompanies++;
    }
  }
  await Run.updateOne({ _id: runId, status: 'rolling_back' }, { $set: { status: 'rolled_back', mutating: false, rolledBackAt: new Date(), rollbackReport: report } });
  return { runId: String(runId), status: 'rolled_back', report };
  } catch (error) {
    await Run.updateOne({ _id: runId, status: 'rolling_back' }, { $set: { status: 'failed', mutating: false, rollbackReport: report, error: String(error.message).slice(0,500) } });
    throw error;
  }
}
async function recoverImport(userId, runId, { acknowledgeStopped = false, reason = '', now = new Date() } = {}) {
  await requireAdmin(userId);
  if (acknowledgeStopped !== true || typeof reason !== 'string' || reason.trim().length < 20 || reason.length > 1000) throw new Error('Stop all import processes, inspect the backup/journal, and explicitly acknowledge recovery with detailed reason');
  const run = await Run.findOne({ _id: runId, userId, status: { $in: ['applying','rolling_back'] }, mutating: true }).lean();
  if (!run || +now - +run.updatedAt < 1800000) throw new Error('Only an owned interrupted import with no writes for 30 minutes can be recovered');
  const recovered = await Run.findOneAndUpdate({ _id: runId, userId, status: run.status, mutating: true, updatedAt: run.updatedAt }, { $set: { status: 'failed', mutating: false, error: 'Explicit operator recovery; inspect rollback journal' }, $push: { recoveryEvents: { at: now, actor: userId, previousStatus: run.status, reason: reason.trim() } } }, { returnDocument: 'after' });
  if (!recovered) throw new Error('Import became active during recovery; inspect before retrying');
  return { runId: String(runId), status: 'failed', recovered: true, nextAction: 'Run conservative rollback; no rows are deleted by recovery' };
}
function revive(value) {
  const result = { ...value };
  for (const key of ['_id', 'companyId', 'importRunId']) if (result[key]) result[key] = new mongoose.Types.ObjectId(result[key]);
  for (const key of ['createdAt', 'updatedAt', 'checkedAt']) if (result[key]) result[key] = new Date(result[key]);
  return result;
}
module.exports = { suppliedSource, sourceSummary, sanitizeSource, canonicalName, recordKey, hash, requireAdmin, directoryState, planImport, previewImport, applyImport, rollbackImport, recoverImport, checkPublicLead };

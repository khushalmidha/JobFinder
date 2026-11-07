const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Company = require('../models/Company');
const Job = require('../models/JobOpening');
const Contact = require('../models/Contact');
const User = require('../models/User');
const Draft = require('../models/OutreachDraft');
const Policy = require('../models/ResearchPolicy');
const Usage = require('../models/ResearchUsage');
const { qualifyCompany, assessEvidence } = require('../services/salaryEvidenceService');
const { scoutRecruiters } = require('../services/ghostScoutService');
const { policyFor, validatePolicy } = require('../services/researchBudgetService');
const { createGroundedDraft, contactBlockReason, opportunityScore } = require('../services/outreachResearchService');
const router = express.Router();
router.use(auth);
const wrap = fn => async (req,res) => { try { await fn(req,res); } catch (error) { res.status(400).json({ error: error.message }); } };
const id = value => { if (!mongoose.isValidObjectId(value)) throw new Error('Invalid record ID'); return value; };

router.get('/companies', wrap(async (req,res) => {
  const rows = await Company.find().sort({ name: 1 }).lean();
  const companies = rows.map(c => ({ _id: c._id, name: c.name, domain: c.domain, careersUrl: c.careersUrl, ...qualifyCompany(c) }));
  const counts = companies.reduce((out,c) => { out[c.qualificationStatus] = (out[c.qualificationStatus] || 0) + 1; return out; }, {});
  const status = req.query.status || 'qualified';
  res.json({ companies: status === 'all' ? companies : companies.filter(c => c.qualificationStatus === status), counts });
}));
router.post('/evidence/validate', wrap(async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : (req.body.companies || [req.body]);
  const fields = ['role','roleFamily','level','experienceMin','experienceMax','location','indiaEligibility','indiaEligibilitySourceUrl','salaryBaseMinINR','salaryBaseMaxINR','currency','payPeriod','baseVsCTC','salarySourceUrl','salarySourceType','reportedOn','lastCheckedAt','evidenceConfidence','evidenceExcerpt'];

  const results = payload.map(item => {
    const domain = (item.rootDomain || item.domain || '').toLowerCase().trim();
    const evaluatedEvidence = (item.salaryEvidence || []).map(raw => {
      const ev = Object.fromEntries(fields.filter(k => k in raw).map(k => [k, raw[k]]));
      return { ...ev, assessment: assessEvidence(ev) };
    });
    const states = new Set(evaluatedEvidence.map(e => e.assessment.status));
    let qualificationStatus = 'research_needed';
    if (states.has('qualified') && states.has('not_qualified')) qualificationStatus = 'conflicting';
    else if (states.has('qualified')) qualificationStatus = 'qualified';
    else if (states.has('not_qualified')) qualificationStatus = 'not_qualified';
    else if (states.has('supported_estimate')) qualificationStatus = 'supported_estimate';

    return {
      legalName: item.legalName || item.name || domain,
      rootDomain: domain,
      careersUrl: item.careersUrl || `https://${domain}/careers`,
      salaryEvidence: evaluatedEvidence,
      qualificationStatus,
      proposedQualification: item.proposedQualification || qualificationStatus,
      valid: evaluatedEvidence.length > 0 && evaluatedEvidence.every(e => e.assessment.status !== 'research_needed')
    };
  });

  res.json({ validatedCount: results.length, results });
}));

router.post('/evidence/import', wrap(async (req, res) => {
  const user = await User.findById(req.user._id).select('role').lean();
  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only an administrator can import shared evidence' });
  }

  const payload = Array.isArray(req.body) ? req.body : (req.body.companies || [req.body]);
  const fields = ['role','roleFamily','level','experienceMin','experienceMax','location','indiaEligibility','indiaEligibilitySourceUrl','salaryBaseMinINR','salaryBaseMaxINR','currency','payPeriod','baseVsCTC','salarySourceUrl','salarySourceType','reportedOn','lastCheckedAt','evidenceConfidence','evidenceExcerpt'];
  let importedTotal = 0;
  const importedCompanies = [];

  for (const item of payload) {
    const domain = (item.rootDomain || item.domain || '').toLowerCase().trim();
    if (!domain) continue;

    let company = await Company.findOne({ domain });
    if (!company) {
      company = new Company({
        name: item.legalName || item.name || domain,
        domain,
        careersUrl: item.careersUrl || `https://${domain}/careers`,
        salaryEvidence: []
      });
    }

    let addedToCompany = 0;
    for (const raw of (item.salaryEvidence || [])) {
      const ev = Object.fromEntries(fields.filter(k => k in raw).map(k => [k, raw[k]]));
      const assessment = assessEvidence(ev);
      const isDuplicate = (company.salaryEvidence || []).some(existing => 
        existing.salarySourceUrl === ev.salarySourceUrl && existing.role === ev.role
      );
      if (!isDuplicate && assessment.status !== 'research_needed') {
        company.salaryEvidence.push(ev);
        addedToCompany++;
      }
    }

    if (addedToCompany > 0 || !company._id) {
      await company.save();
      importedTotal += addedToCompany;
      importedCompanies.push({
        domain,
        name: company.name,
        addedCount: addedToCompany,
        status: qualifyCompany(company.toObject()).qualificationStatus
      });
    }
  }

  res.json({ success: true, importedTotal, importedCompanies });
}));

router.post('/companies/:id/evidence', wrap(async (req,res) => {
  const user = await User.findById(req.user._id).select('role').lean();
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can add evidence to the shared company directory' });
  const company = await Company.findById(id(req.params.id));
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const fields = ['role','roleFamily','level','experienceMin','experienceMax','location','indiaEligibility','indiaEligibilitySourceUrl','salaryBaseMinINR','salaryBaseMaxINR','currency','payPeriod','baseVsCTC','salarySourceUrl','salarySourceType','reportedOn','lastCheckedAt','evidenceConfidence','evidenceExcerpt'];
  const evidence = Object.fromEntries(fields.filter(k => k in req.body).map(k => [k,req.body[k]]));
  const assessment = assessEvidence(evidence);
  if (assessment.status === 'research_needed') return res.status(400).json({ error: 'Incomplete or ineligible evidence', assessment });
  if (JSON.stringify(evidence).length > 12000) throw new Error('Evidence too large');
  company.salaryEvidence.push(evidence); await company.save();
  res.json(qualifyCompany(company.toObject()));
}));
router.get('/companies/:id', wrap(async (req,res) => {
  const company = await Company.findById(id(req.params.id)).lean();
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const [jobs, contacts] = await Promise.all([
    Job.find({ companyId: company._id, isFresherEligible: true, status: { $ne: 'ignored' } }).limit(100).lean(),
    Contact.find({ userId: req.user._id, companyId: company._id }).lean()
  ]);
  res.json({ company: { ...company, ...qualifyCompany(company) }, jobs, contacts: contacts.map(c => ({ ...c, blockReason: contactBlockReason(c), opportunity: opportunityScore({ company, job: jobs[0], contact: c }) })) });
}));
router.post('/companies/:id/discover', wrap(async (req,res) => {
  const company = await Company.findById(id(req.params.id)).lean();
  if (!company || qualifyCompany(company).qualificationStatus !== 'qualified') throw new Error('Select a company with current qualifying fixed-base evidence');
  const result = await scoutRecruiters({ companyQuery: company.name, domain: company.domain, userId: req.user._id });
  res.json(result);
}));
router.get('/budget', wrap(async (req,res) => {
  const usage = await Usage.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(62).lean();
  res.json({ policy: await policyFor(req.user._id), usage, globalStop: process.env.RESEARCH_STOP === 'true' });
}));
router.put('/budget', wrap(async (req,res) => {
  const policy = validatePolicy(req.body);
  if ((policy.paidProvidersEnabled || policy.monthlyCredits > 0) && req.body.approved !== true) throw new Error('Explicit paid-credit budget approval required');
  const updated = await Policy.findOneAndUpdate({ userId: req.user._id }, { $set: policy }, { new: true, upsert: true, runValidators: true });
  res.json(updated);
}));
router.post('/drafts', wrap(async (req,res) => {
  const { companyId, jobId, contactId, candidate } = req.body;
  const [company, job, contact] = await Promise.all([
    Company.findById(id(companyId)).lean(), Job.findById(id(jobId)).lean(), Contact.findOne({ _id: id(contactId), userId: req.user._id }).lean()
  ]);
  if (!company || !job || !contact) throw new Error('Selected company, job or owned contact not found');
  const draft = createGroundedDraft({ company, job, contact, candidate });
  res.json(await Draft.create({ ...draft, userId: req.user._id, companyId, jobId, contactId }));
}));
router.get('/drafts', wrap(async (req,res) => res.json(await Draft.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean())));
router.patch('/drafts/:id', wrap(async (req,res) => {
  const { subject, body } = req.body;
  if (typeof subject !== 'string' || typeof body !== 'string' || !subject.trim() || /[\r\n]/.test(subject) || subject.length > 200 || body.length > 10000 || !body.trim()) throw new Error('Valid concise subject and body required');
  const draft = await Draft.findOneAndUpdate({ _id: id(req.params.id), userId: req.user._id }, { $set: { subject, body, status: req.body.reviewed === true ? 'reviewed' : 'draft' } }, { new: true });
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json(draft);
}));
// Intentionally no send route: saving/reviewing a draft is never consent to send.
router.get('/queue', wrap(async (req,res) => res.json(await require('../models/ResearchTask').find({userId:req.user._id}).sort({updatedAt:-1}).limit(100).lean())));
router.post('/queue', wrap(async (req,res) => res.json(await require('../services/researchQueueService').enqueueCompanies(req.user._id,req.body.companyIds))));
router.post('/queue/run', wrap(async (req,res) => res.json(await require('../services/researchQueueService').runResearchOnce({userId:req.user._id}))));
module.exports = router;

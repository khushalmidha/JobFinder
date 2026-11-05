const { qualifyCompany, sourceUrl } = require('./salaryEvidenceService');
function contactBlockReason(contact) {
  if (!contact) return 'Contact not found';
  if (['invalid', 'accept_all', 'catch_all'].includes(contact.vendorStatus)) return 'Provider reports invalid or catch-all mailbox';
  if (contact.optOutAt || contact.suppressedAt || ['bounced', 'removed', 'replied', 'reply_received', 'positive_response', 'negative_response'].includes(contact.status) || contact.deliverabilityStatus === 'invalid') return 'Contact suppressed or already replied';
  if (contact.inferenceFlag || ['inferred_unverified', 'catch_all', 'invalid', 'unknown'].includes(contact.verificationStatus || 'unknown')) return 'Contact requires sourced evidence and review';
  if (!contact.provenance?.some(p => sourceUrl(p.url))) return 'Missing professional source provenance';
  return null;
}
function createGroundedDraft({ company, job, contact, candidate }) {
  if (qualifyCompany(company).qualificationStatus !== 'qualified') throw new Error('Company lacks current qualifying fixed-base evidence');
  if (String(job.companyId) !== String(company._id) || String(contact.companyId) !== String(company._id)) throw new Error('Company, job and contact must be linked');
  const blocked = contactBlockReason(contact);
  if (blocked) throw new Error(blocked);
  if (!candidate?.confirmed || !candidate.name?.trim() || !sourceUrl(candidate.resumeLink) || !Array.isArray(candidate.highlights) || !candidate.highlights.length || candidate.highlights.length > 2) throw new Error('Confirm candidate name, resume link and one or two sourced resume highlights');
  for (const h of candidate.highlights) if (!h.text?.trim() || !h.source?.trim() || h.text.length > 500) throw new Error('Each highlight needs resume source and concise text');
  if (!job.title || !sourceUrl(job.url)) throw new Error('Select a job with a public source URL');
  const subject = `Interest in ${job.title} at ${company.name}`;
  const body = `Hello recruiting team,\n\nI am ${candidate.name.trim()}. I am interested in the ${job.title} opening at ${company.name}: ${job.url}\n\n${candidate.highlights.map(h => h.text.trim()).join('\n')}\n\nWould you be the right person to discuss this opportunity, or could you point me to the relevant team?\n\nResume: ${candidate.resumeLink}\n\nBest regards,\n${candidate.name.trim()}\n\nIf this outreach is not relevant, please let me know and I will not follow up.`;
  return { recipient: contact.email, subject, body, status: 'draft', supportingEvidence: [...candidate.highlights, { text: job.title, source: job.url }], needsReview: true, sent: false };
}
function opportunityScore({ company, job, contact }) {
  const components = [
    { reason: 'Current qualifying fixed-base evidence', points: qualifyCompany(company).qualificationStatus === 'qualified' ? 40 : 0 },
    { reason: 'Linked fresher opening', points: job?.isFresherEligible && String(job.companyId) === String(company._id) ? 25 : 0 },
    { reason: 'Sourced unsuppressed recruiting contact', points: !contactBlockReason(contact) ? 20 : 0 },
    { reason: 'Provider-verified mailbox (provider assertion)', points: contact?.verificationStatus === 'vendor_verified' ? 15 : 0 }
  ];
  return { score: components.reduce((s,c) => s+c.points,0), components };
}
module.exports = { contactBlockReason, createGroundedDraft, opportunityScore };

const { sourceUrl } = require('./salaryEvidenceService');
function draftFormAnswer({ question, company, role, resumeDetails = {}, maxCharacters = 2000, maxWords = 160 }) {
  if (typeof question !== 'string' || !question.trim() || question.length > 3000) throw new Error('Valid application question required');
  const result = { question, answer: '', supportingEvidence: [], uncertainty: [], needsReview: true };
  if (/salary|compensation|visa|sponsor|authoriz|consent|agree|gender|notice|availability/i.test(question)) {
    result.uncertainty.push('Application-specific or sensitive answer requires explicit applicant confirmation.'); return result;
  }
  const facts = Array.isArray(resumeDetails.supportingEvidence) ? resumeDetails.supportingEvidence : [];
  if (!resumeDetails.confirmed || !facts.length || facts.length > 5 || facts.some(f => typeof f.text !== 'string' || !f.text.trim() || f.text.length > 500 || typeof f.source !== 'string' || !f.source.trim())) {
    result.uncertainty.push('Supply applicant-confirmed resume evidence with sources.'); return result;
  }
  let parts;
  if (/why.*(company|join|role|apply)|interest.*(company|role)/i.test(question)) {
    const companyFact = resumeDetails.companyFacts?.find(f => f.text?.trim() && sourceUrl(f.source));
    if (!companyFact || !company || !role) { result.uncertainty.push('A cited company/role reason is needed; no generic company claims generated.'); return result; }
    parts = [`I am interested in the ${role} role at ${company}.`, companyFact.text, facts[0].text];
    result.supportingEvidence.push(companyFact, facts[0]);
  } else if (/about yourself|introduce|summary|relevant experience|technical experience|skills|projects/i.test(question)) {
    parts = facts.slice(0, 2).map(f => f.text); result.supportingEvidence.push(...facts.slice(0, 2));
  } else {
    result.uncertainty.push('Question requires a tailored draft beyond the supplied evidence.'); return result;
  }
  const answer = parts.join(' ');
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 10000 || !Number.isInteger(maxWords) || maxWords < 1 || maxWords > 1000) throw new Error('Invalid answer limits');
  if (answer.length > maxCharacters || answer.split(/\s+/).length > maxWords) result.uncertainty.push('Evidence-based draft exceeds the field limit; shorten it manually.');
  else result.answer = answer;
  return result;
}
module.exports = { draftFormAnswer };

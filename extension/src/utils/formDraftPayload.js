// Explicit data boundary: never spread a profile or answer bank into a remote request.
export function formDraftPayload({ question, company, role, supportingEvidence, companyFacts = [] }) {
  if (!Array.isArray(supportingEvidence) || !supportingEvidence.length || supportingEvidence.length > 5) throw new Error('Select 1–5 reviewed resume facts.');
  const fact = item => {
    if (typeof item?.text !== 'string' || !item.text.trim() || item.text.length > 500 || typeof item.source !== 'string' || !item.source.trim()) throw new Error('Review each fact and source (maximum 500 characters).');
    return { text: item.text, source: item.source };
  };
  if (!Array.isArray(companyFacts) || companyFacts.length > 1) throw new Error('Select at most one cited company fact.');
  return { question, company, role, resumeDetails: { confirmed: true, supportingEvidence: supportingEvidence.map(fact), companyFacts: companyFacts.map(fact) } };
}

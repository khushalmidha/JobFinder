const THRESHOLD_INR = 1500000;
const FRESHNESS_DAYS = 365;
const strongSources = new Set(['official_job', 'official_compensation', 'placement_report']);
function sourceUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password; } catch { return false; }
}
function assessEvidence(e, now = new Date()) {
  const reasons = [];
  const reported = new Date(e.reportedOn), checked = new Date(e.lastCheckedAt);
  if (!sourceUrl(e.salarySourceUrl) || !sourceUrl(e.indiaEligibilitySourceUrl) || !String(e.evidenceExcerpt || '').trim()) reasons.push('Missing cited pay/India evidence');
  if (![reported, checked].every(d => Number.isFinite(d.getTime()) && d <= now && now - d <= FRESHNESS_DAYS * 86400000)) reasons.push('Undated, stale or future evidence');
  if (checked < reported) reasons.push('Observation precedes reported date');
  if (e.currency !== 'INR' || e.payPeriod !== 'year' || e.baseVsCTC !== 'fixed_base') reasons.push('Requires annual INR fixed base, excluding CTC/equity/bonus');
  if (e.indiaEligibility !== true || !e.location) reasons.push('India eligibility/location unestablished');
  if (e.roleFamily !== 'software_engineering' || !['entry', 'SWE-1', 'SDE-1'].includes(e.level) || !e.role ||
      !Number.isFinite(e.experienceMin) || !Number.isFinite(e.experienceMax) || e.experienceMin < 0 || e.experienceMax > 2 || e.experienceMax < e.experienceMin) reasons.push('Not evidenced for entry software engineering / 0–2 YOE');
  if (!Number.isFinite(e.salaryBaseMinINR) || !Number.isFinite(e.salaryBaseMaxINR) || e.salaryBaseMinINR < 0 || e.salaryBaseMaxINR < e.salaryBaseMinINR) reasons.push('Invalid base range');
  if (reasons.length) return { status: 'research_needed', reasons };
  if (!strongSources.has(e.salarySourceType) || e.evidenceConfidence !== 'high') return { status: 'supported_estimate', reasons: ['Reported estimate requires independent corroboration'] };
  return e.salaryBaseMinINR > THRESHOLD_INR
    ? { status: 'qualified', reasons: ['Cited lower annual fixed-base bound strictly exceeds INR 1,500,000'] }
    : { status: 'not_qualified', reasons: ['Lower bound does not strictly exceed INR 1,500,000'] };
}
function qualifyCompany(company, now = new Date()) {
  const evidence = (company.salaryEvidence || []).map(e => ({ ...e, assessment: assessEvidence(e, now) }));
  const states = new Set(evidence.map(e => e.assessment.status));
  let status = 'research_needed';
  if (states.has('qualified') && states.has('not_qualified')) status = 'conflicting';
  else if (states.has('qualified')) status = 'qualified';
  else if (states.has('not_qualified')) status = 'not_qualified';
  else if (states.has('supported_estimate')) status = 'supported_estimate';
  return { qualificationStatus: status, thresholdINR: THRESHOLD_INR, salaryEvidence: evidence };
}
module.exports = { THRESHOLD_INR, FRESHNESS_DAYS, assessEvidence, qualifyCompany, sourceUrl };

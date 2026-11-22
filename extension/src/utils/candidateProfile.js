// Shared by the extension and local CLI. No applicant defaults or network calls.
const clean = value => typeof value === 'string' && /^(TODO\b|FROM_RESUME$)/i.test(value.trim()) ? null : value;
export function normalizeProfile(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Profile must be an object.');
  const p = JSON.parse(JSON.stringify(input), (_key, value) => clean(value));
  const education = p.education?.[0] || {};
  const fullName = p.identity?.name || p.fullName || '';
  const parts = fullName.trim().split(/\s+/);
  const links = { ...p.links };
  if (links.github && !links.github.includes('://')) links.github = `https://github.com/${links.github}`;
  return { ...p, fullName, firstName: p.firstName || parts[0] || '',
    lastName: p.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : ''),
    email: p.identity?.email || p.email || '', phoneRaw: p.identity?.phone || p.phoneRaw || '',
    location: typeof p.identity?.location === 'object' && p.identity.location ? p.identity.location : p.location || {},
    college: education.institute || p.college || '', degree: education.degree || p.degree || '',
    major: education.branch || p.major || '', cgpa: education.cgpa ?? p.cgpa ?? '',
    graduationYear: education.end?.slice(0, 4) || p.graduationYear || '', links,
    answers_bank: Array.isArray(p.answers_bank) ? p.answers_bank : [],
    supportingEvidence: p.supportingEvidence || [
      ...(p.experience || []).flatMap(e => (e.bullets || []).map(text => ({ text, source: 'selected_resume' }))),
      ...(p.projects || []).flatMap(e => (e.bullets || [e.one_line]).filter(Boolean).map(text => ({ text, source: 'selected_resume' })))
    ] };
}
const norm = value => String(value ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function answerKey(question, type, options = [], scope = '') {
  return JSON.stringify([norm(question), norm(type), [...new Set(options.map(norm))].sort(), norm(scope)]);
}
export function rememberAnswer(bank, { question, type, options = [], scope = '', answer, approved = false, provenance = 'applicant' }) {
  if (!approved || !question?.trim() || !type || !String(answer ?? '').trim()) throw new Error('An explicit reviewed question and answer are required.');
  if (!['applicant', 'profile', 'draft_approved'].includes(provenance)) throw new Error('Unsupported answer provenance.');
  if (options.length && !options.some(option => norm(option) === norm(answer))) throw new Error('Answer must match an actual option.');
  const key = answerKey(question, type, options, scope);
  const entry = { key, question, type, options, scope, answer: String(answer), approved: true, provenance, updatedAt: new Date().toISOString() };
  return [...bank.filter(e => e.key !== key), entry];
}
export function recallAnswer(bank, question, type, options = [], scope = '') {
  const key = answerKey(question, type, options, scope);
  const matches = bank.filter(e => e.approved === true && e.key === key && ['applicant', 'profile', 'draft_approved'].includes(e.provenance));
  return matches.length === 1 ? matches[0] : null;
}
export function profileGaps(profile) {
  const p = normalizeProfile(profile);
  const facts = { name: p.fullName, email: p.email, phone: p.phoneRaw, city: p.location.city,
    tenth: p.education?.[0]?.tenth, twelfth: p.education?.[0]?.twelfth,
    locations: p.preferences?.locations, availability: p.preferences?.notice_or_start_date,
    workAuthorization: p.preferences?.work_authorization, salaryExpectation: p.preferences?.salary_expectation };
  return Object.keys(facts).filter(key => !facts[key]);
}

// Shared by the extension and local CLI. No applicant defaults or network calls.
const clean = value => typeof value === 'string' && /^(TODO\b|FROM_RESUME$)/i.test(value.trim()) ? null : value;
export function normalizeProfile(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Profile must be an object.');
  const p = JSON.parse(JSON.stringify(input), (_key, value) => clean(value));
  const hasIdentity = Object.hasOwn(p, 'identity');
  const hasEducation = Object.hasOwn(p, 'education');
  const hasResume = hasIdentity || Object.hasOwn(p, 'experience') || Object.hasOwn(p, 'projects');
  const education = p.education?.[0] || {};
  const fullName = (hasIdentity ? p.identity?.name : p.fullName) || '';
  const parts = fullName.trim().split(/\s+/);
  const links = { ...p.links };
  if (links.github && !links.github.includes('://')) links.github = `https://github.com/${links.github}`;
  const location = hasIdentity ? p.identity?.location : p.location;
  // Legacy resolvers may still read phone when phoneRaw is empty.
  if (hasIdentity && Object.hasOwn(p, 'phone')) p.phone = p.identity?.phone || '';
  return { ...p, fullName,
    firstName: (!hasIdentity && p.firstName) || parts[0] || '',
    lastName: (!hasIdentity && p.lastName) || parts.slice(1).join(' '),
    email: (hasIdentity ? p.identity?.email : p.email) || '',
    phoneRaw: (hasIdentity ? p.identity?.phone : p.phoneRaw) || '',
    location: location && typeof location === 'object' && !Array.isArray(location) ? location : {},
    college: (hasEducation ? education.institute : p.college) || '',
    degree: (hasEducation ? education.degree : p.degree) || '',
    major: (hasEducation ? education.branch : p.major) || '',
    cgpa: (hasEducation ? education.cgpa : p.cgpa) ?? '',
    graduationYear: (hasEducation ? education.end?.slice(0, 4) : p.graduationYear) || '', links,
    answers_bank: Array.isArray(p.answers_bank) ? p.answers_bank : [],
    supportingEvidence: hasResume ? [
      ...(p.experience || []).flatMap(e => (e.bullets || []).filter(Boolean).map(text => ({ text, source: 'selected_resume' }))),
      ...(p.projects || []).flatMap(e => (e.bullets || [e.one_line]).filter(Boolean).map(text => ({ text, source: 'selected_resume' })))
    ] : p.supportingEvidence || [] };
}
const choiceTypes = new Set(['select', 'combobox', 'listbox', 'radio', 'radiogroup']);
const answerSources = new Set(['applicant', 'profile', 'draft_approved']);
const validOptions = options => Array.isArray(options) && options.every(option => typeof option === 'string');

export function answerKey(question, type, options = [], scope = '') {
  return JSON.stringify([question, type, [...options].sort(), scope]);
}

function validAnswer(type, options, answer) {
  if (typeof answer !== 'string' || !answer.trim() || !validOptions(options)) return false;
  if (!options.length) return !choiceTypes.has(type);
  // Widget matchers can ignore case and surrounding whitespace. Ambiguous display
  // labels cannot establish which option the applicant approved.
  const comparable = options.map(option => option.trim().toLowerCase());
  return new Set(comparable).size === options.length && options.includes(answer);
}

export function rememberAnswer(bank, { question, type, options = [], scope = '', answer, approved = false, provenance = 'applicant' }) {
  if (approved !== true || typeof question !== 'string' || !question.trim() || typeof type !== 'string' || !type.trim() || typeof scope !== 'string')
    throw new Error('An explicit reviewed question and answer are required.');
  if (!answerSources.has(provenance)) throw new Error('Unsupported answer provenance.');
  if (typeof answer === 'number' || typeof answer === 'boolean') answer = String(answer);
  if (!validAnswer(type, options, answer)) throw new Error('A nonempty answer and a unique, exact match for choice fields are required.');
  const key = answerKey(question, type, options, scope);
  const entry = { key, question, type, options, scope, answer: String(answer), approved: true, provenance, updatedAt: new Date().toISOString() };
  return [...bank.filter(e => e?.key !== key), entry];
}
export function recallAnswer(bank, question, type, options = [], scope = '') {
  if (!validOptions(options) || !Array.isArray(bank)) return null;
  const key = answerKey(question, type, options, scope);
  const matches = bank.filter(e => e?.approved === true && e.key === key);
  if (matches.length !== 1) return null;
  const entry = matches[0];
  if (!answerSources.has(entry.provenance) || !validAnswer(entry.type, entry.options, entry.answer)) return null;
  return answerKey(entry.question, entry.type, entry.options, entry.scope) === key ? entry : null;
}
export function profileGaps(profile) {
  const p = normalizeProfile(profile);
  const facts = { name: p.fullName, email: p.email, phone: p.phoneRaw, city: p.location.city,
    tenth: p.education?.[0]?.tenth, twelfth: p.education?.[0]?.twelfth,
    locations: p.preferences?.locations, availability: p.preferences?.notice_or_start_date,
    workAuthorization: p.preferences?.work_authorization, salaryExpectation: p.preferences?.salary_expectation };
  return Object.keys(facts).filter(key => !facts[key]);
}

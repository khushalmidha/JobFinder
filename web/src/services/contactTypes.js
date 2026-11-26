export const contactTypes = [
  ['recruiter', 'HR / Recruiter'],
  ['hiring_manager', 'Hiring Manager'],
  ['engineer', 'SDE / Engineer'],
  ['role_inbox', 'Common inbox'],
  ['unknown', 'Unclassified']
];

export function explicitContactType(value) {
  const key = String(value || '').toLowerCase().trim().replace(/[ _-]+/g, ' ');
  if (['recruiter', 'hr', 'hr / recruiter'].includes(key)) return 'recruiter';
  if (key === 'hiring manager') return 'hiring_manager';
  if (['engineer', 'sde', 'sde / engineer'].includes(key)) return 'engineer';
  if (['role inbox', 'common', 'common mail', 'common inbox', 'generic inbox'].includes(key)) return 'role_inbox';
  return '';
}

export function contactRole(contact) {
  const explicit = explicitContactType(contact.contactKind);
  if (explicit) return explicit;
  const inbox = /^(?:careers?|jobs?|recruit(?:ing|ment)?|talent(?:acquisition)?|hiring|hr(?:connect)?|humancapital|campus|people|info|contact|hello)(?:[._-](?:india|in|careers?|jobs?))?@/i;
  if (inbox.test(contact.email || '')) return 'role_inbox';
  const title = contact.role || '';
  if (/talent acquisition|recruit|human resources|\bhr\b/i.test(title)) return 'recruiter';
  if (/(?:engineering|software|hiring) manager|head of engineering|engineering director/i.test(title)) return 'hiring_manager';
  if (/software engineer|software developer|\bsde\b|backend engineer|frontend engineer|full[ -]?stack engineer|machine learning engineer/i.test(title)) return 'engineer';
  return 'unknown';
}

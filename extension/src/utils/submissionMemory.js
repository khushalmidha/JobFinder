import { collectFields, extractQuestionContext, classifyQuestion } from './formFillerCore.js';

export const submissionPreference = 'smartApplyLearnSubmitted';
export const submissionPrefix = 'smartApplySubmitted:';

export async function submissionKey(owner, href = '') {
  if (!href) return hashedKey([owner, 'reusable']);
  const url = new URL(href);
  return hashedKey([owner, url.origin, url.pathname, url.search, url.hash]);
}
async function hashedKey(parts) {
  const value = JSON.stringify(parts);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return submissionPrefix + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const excluded = /password|passcode|captcha|\botp\b|token|secret|salary|compensation|\bctc\b|visa|sponsor|authoriz|gender|disabil|veteran|ethnic|\brac[e]\b|citizen|nationality|date of birth|\bdob\b|passport|aadhaar|references?|referee|terms|consent|agreem|declar|certif|attest|signature|bank account|credit card|security code/i;
const types = new Set(['text', 'textarea', 'email', 'tel', 'url', 'number', 'search', 'date', 'date-picker', 'checkbox', 'select', 'radio', 'radiogroup', 'combobox', 'listbox']);

export function memoryIdentity(context) {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const label = normalize(context.labelText).replace(/[\s*]+$/, '');
  if (!label || !types.has(context.inputType) || excluded.test(context.combined || label)) return '';
  return JSON.stringify([label, normalize(context.descriptionText), context.inputType]);
}

export function reusableAnswer(key) {
  const [label, description, type] = JSON.parse(key);
  return !description && ['text', 'textarea'].includes(type) &&
    /^(?:tell us about yourself|introduce yourself|professional summary|what programming languages do you (?:know|use)\??|which programming languages (?:do you know|are you proficient in)\??)$/.test(label);
}

export function captureSubmittedAnswers(form, profile, readValue) {
  const captured = new Map();
  const duplicates = new Set();
  for (const control of collectFields(form.ownerDocument, new Set(), { frames: false })) {
    if (control.form !== form && !form.contains(control)) continue;
    const context = extractQuestionContext(control);
    const key = memoryIdentity(context);
    if (!key) continue;
    if (captured.has(key)) { duplicates.add(key); continue; }
    const decision = classifyQuestion(context, profile);
    if (['LEGAL_CONSENT_OR_TERMS', 'VERIFICATION', 'MANUAL_UPLOAD', 'OTHER_PERSON_OR_EMPLOYER'].includes(decision.type)) continue;
    const value = readValue(control);
    captured.set(key, typeof value === 'string' && value.length <= 1600 ? value.trim() : '');
  }
  let budget = 16000;
  return [...captured].filter(([key, value]) => {
    if (duplicates.has(key) || !value || key.length > 600 || key.length + value.length > budget) return false;
    budget -= key.length + value.length;
    return true;
  }).slice(0, 80);
}

import { normalizeProfile, recallAnswer } from './candidateProfile.js';
// Imported by both the packaged content script and DOM tests. No private defaults.
export const CANDIDATE_PROFILE = Object.freeze({});
export const FORM_STATES = Object.freeze(['IDLE', 'SCAN', 'PLAN', 'FILL', 'VERIFY', 'NEEDS_REVIEW', 'STOPPED']);
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const text = el => el?.textContent?.replace(/\s+/g, ' ').trim() || '';
// Labels often wrap controls. Their options/answers are not part of the question.
function questionText(element) {
  if (!element) return '';
  // Walk the original tree read-only: cloning can run custom-element constructors.
  const filter = element.ownerDocument.defaultView.NodeFilter;
  const walker = element.ownerDocument.createTreeWalker(element, filter.SHOW_ELEMENT | filter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) return node.matches('input, select, textarea, button, [role="combobox"], [role="listbox"], [role="option"], [aria-hidden="true"]') ? filter.FILTER_REJECT : filter.FILTER_SKIP;
      return filter.FILTER_ACCEPT;
    }
  });
  const parts = []; let node;
  while ((node = walker.nextNode())) parts.push(node.nodeValue);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
const review = (type, reason) => ({ type, verified: false, requiresManualReview: true, confidence: 0, reason });

export function isFinalSubmitButton(label, automationId = '', buttonType = '') {
  return norm(buttonType) === 'submit' || /submit|finaliz|finish|complete|\bapply\b|\bsend\b|\bconfirm\b/i.test(`${label} ${automationId}`);
}
export function isSafeNavigationButton(label, automationId = '', buttonType = '') {
  return !isFinalSubmitButton(label, automationId, buttonType) && /^(next( step)?|continue|save (and|&) continue)$/i.test(norm(label));
}
// Some portals render a heading-like label beside a single input without linking it.
function nearbyUnboundLabel(element) {
  for (let wrapper = element.parentElement, depth = 0;
    wrapper && depth < 3 && !wrapper.matches('form, body, fieldset');
    wrapper = wrapper.parentElement, depth++) {
    const controls = [...wrapper.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]')];
    if (controls.some(control => control !== element && !element.contains(control))) return '';
    const labels = [...wrapper.querySelectorAll('label:not([for])')].filter(label => !label.querySelector('input, textarea, select, button'));
    if (labels.length === 1) return questionText(labels[0]);
    if (labels.length > 1) return '';
  }
  return '';
}
const popupOptions = '[role="option"], [role="menuitem"], [role="menuitemradio"]';
function popupKind(element) {
  const kind = element.getAttribute('aria-haspopup');
  return kind === 'listbox' || kind === 'menu' ? kind : '';
}
function controlledPopup(element) {
  const id = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
  if (id && !/\s/.test(id)) return element.getRootNode().getElementById?.(id) || element.ownerDocument.getElementById(id);
  if (popupKind(element) !== 'menu' || !element.id || element.getAttribute('aria-expanded') !== 'true') return null;
  const menus = [...element.getRootNode().querySelectorAll('[role="menu"][aria-labelledby]')]
    .filter(menu => menu.getAttribute('aria-labelledby') === element.id && rendered(menu));
  return menus.length === 1 ? menus[0] : null;
}
function choiceLabel(option) {
  if (option.tagName === 'OPTION') return option.label;
  return option.getAttribute('aria-label') || [...(option.labels || [])].map(text).join(' ') ||
    text(option) || option.getAttribute('data-value') || option.value || '';
}
export function extractQuestionContext(element) {
  if (!element) return { combined: '', labelText: '', isRequired: false, inputType: 'text' };
  const root = element.getRootNode();
  const doc = element.ownerDocument;
  const get = id => root.getElementById?.(id) || doc.getElementById(id);
  const refs = attr => (element.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map(id => questionText(get(id))).join(' ');
  const container = element.closest('[role="listitem"], .Qr7Oae, [data-automation-id^="formField"], .field, .form-group');
  const legend = element.closest('fieldset')?.querySelector('legend');
  const group = element.closest('[role="radiogroup"], [role="group"]');
  const groupLabel = group?.getAttribute('aria-label') || (group?.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => questionText(get(id))).join(' ');
  let labelText = refs('aria-labelledby') || element.getAttribute('aria-label') ||
    [...(element.labels || [])].map(questionText).join(' ') || questionText(element.closest('label')) ||
    questionText(container?.querySelector('[role="heading"], .M7eMe, label')) || questionText(legend) || groupLabel || nearbyUnboundLabel(element);
  const descriptionText = refs('aria-describedby') || text(container?.querySelector('.zHQkBf, [data-automation-id="helpText"]'));
  let inputType = norm(element.getAttribute('type') || 'text');
  const role = element.getAttribute('role') || (popupKind(element) ? 'combobox' : null);
  if (element.matches('button[aria-haspopup="dialog"]') && /date/i.test(labelText)) inputType = 'date-picker';
  if (element.tagName === 'TEXTAREA') inputType = 'textarea';
  if (element.tagName === 'SELECT') inputType = 'select';
  if (['combobox', 'listbox', 'radio', 'radiogroup', 'checkbox'].includes(role)) inputType = role;
  const fallback = ['name', 'id', 'placeholder', 'autocomplete', 'data-automation-id'].map(a => element.getAttribute(a) || '').join(' ');
  if (inputType === 'radio') labelText = questionText(legend) || groupLabel || refs('aria-labelledby') || '';
  if (inputType === 'checkbox') {
    const topic = groupLabel || questionText(legend);
    if (topic && labelText && topic !== labelText) labelText = `${topic} — ${labelText}`;
  }
  const options = inputType === 'checkbox' ? ['Yes', 'No'] : element.tagName === 'SELECT' ? [...element.options].map(option => option.label) : inputType === 'radio' ? radioGroup(element).map(choiceLabel) :
    ['combobox', 'listbox'].includes(inputType) ? availableChoices(element).map(choiceLabel).filter(Boolean) :
    [...(group || element).querySelectorAll('[role="radio"]')].map(choiceLabel).filter(Boolean);
  return { labelText: labelText || fallback.trim(), descriptionText, inputType, options,
    combined: norm(`${labelText} ${descriptionText} ${text(legend)} ${groupLabel} ${fallback}`),
    isRequired: element.required || element.getAttribute('aria-required') === 'true' || labelText.includes('*') };
}
export function applicationScope(doc) {
  const urls = []; let win = doc.defaultView;
  while (win) {
    try { urls.push({ url: win.location.href, embedding: win === win.parent ? null : answerIdentity(win.frameElement) }); if (win === win.parent) break; win = win.parent; }
    catch { return ''; }
  }
  return JSON.stringify(urls);
}
export function answerIdentity(element) {
  const path = [];
  for (let node = element; node?.nodeType === 1; node = node.parentElement || node.getRootNode()?.host) {
    path.push([node.tagName, node.id || '', node.getAttribute('name') || '', node.parentElement ? [...node.parentElement.children].indexOf(node) : 0,
      node.tagName === 'FIELDSET' ? text(node.querySelector('legend')) : '']);
  }
  const context = extractQuestionContext(element);
  return { path, question: context.labelText, description: context.descriptionText };
}
export function answerScope(element) {
  return JSON.stringify({ documents: JSON.parse(applicationScope(element.ownerDocument) || '[]'), field: answerIdentity(element) });
}

function experienceYearsQuestion(context) {
  const label = norm(context.labelText || context.combined);
  return /^(?:(?:how many|total|number of)\s+)?(?:years? of (?:[a-z-]+ ){0,3}experience|experience in years)\b/.test(label) &&
    !/\b(?:minimum|required|expected)\b/.test(label);
}
function profileChoice(type, value) {
  return { type, value, verified: true, confidence: null, source: 'applicant_confirmed_preference' };
}
export function classifyQuestion(context, profile = CANDIDATE_PROFILE) {
  profile = normalizeProfile(profile);
  const q = context.combined || '';
  // Safety/ambiguity precedes personal-data matching.
  if (/terms|privacy|agree|consent|declar|certif|attest|signature|sign here|background check|acknowledge/i.test(q))
    return review('LEGAL_CONSENT_OR_TERMS', 'Requires explicit applicant action.');
  if (/captcha|verification code|\botp\b|password|security code/i.test(q)) return review('VERIFICATION', 'Complete verification manually.');
  const remembered = recallAnswer(profile.answers_bank, context.labelText || q, context.inputType, context.options || [], context.scope || '') ||
    (context.inputType === 'checkbox' && context.scope ? recallAnswer(profile.answers_bank, context.labelText || q, 'checkbox', [], context.scope) : null);
  // Sensitive/application-specific answers must be explicitly scoped to this form.
  if (remembered && (context.scope || (!['date-picker', 'date', 'checkbox'].includes(context.inputType) && !/salary|ctc|compensation|notice|availab|relocat|sponsor|visa|authoriz|citizen|nationality/i.test(q))))
    return { type: 'REMEMBERED_ANSWER', value: remembered.answer, verified: true, confidence: null, source: `answer_bank:${remembered.provenance}` };
  if (context.inputType === 'date-picker' || context.inputType === 'date') return review('DATE_REVIEW', 'Choose and approve the exact date.');
  if (context.inputType === 'checkbox') return review('CHECKBOX_REVIEW', 'Confirm whether this option applies to you.');
  if (/gender|disabil|veteran|ethnic|race\b/i.test(q) && norm(profile.preferences?.eeo_default) === 'prefer not to say' && context.options?.some(option => norm(option) === 'prefer not to say'))
    return { type: 'EEO_PREFERENCE', value: context.options.find(option => norm(option) === 'prefer not to say'), verified: true, source: 'applicant_profile_eeo_preference', confidence: null };
  const years = profile.preferences?.default_experience_years;
  if (experienceYearsQuestion(context) && Number.isInteger(years) && years >= 0) {
    if (['text', 'number', 'tel'].includes(context.inputType)) return profileChoice('EXPERIENCE_YEARS', String(years));
    if (['select', 'combobox', 'listbox', 'radio', 'radiogroup'].includes(context.inputType)) {
      const options = (context.options || []).filter(option =>
        [String(years), `${years} year`, `${years} years`].includes(norm(option)) || (years === 0 && norm(option) === 'no experience'));
      if (options.length === 1) return profileChoice('EXPERIENCE_YEARS', options[0]);
    }
  }
  const months = profile.preferences?.internship_duration_months;
  if (Number.isInteger(months) && months > 0 && /^(?:availability|internship duration)\s*\*?$/.test(norm(context.labelText))) {
    const options = (context.options || []).filter(option => !/^(?:please )?(?:choose|select)(?: an option)?[.\s]*$/.test(norm(option)));
    if (options.length > 1 && options.every(option => /^\d+ months?$/.test(norm(option)))) {
      const match = options.filter(option => [`${months} month`, `${months} months`].includes(norm(option)));
      if (match.length === 1) return profileChoice('INTERNSHIP_DURATION', match[0]);
    }
  }
  if (/years? of (?:hands-on |relevant |professional )?experience|can you work on.site|salary|\bctc\b|compensation|remuneration|expected pay|notice|availab|start date|relocat|sponsor|visa|authoriz|eligible to work|gender|pronoun|disabil|veteran|ethnic|race\b|citizen|nationality|passport|aadhaar|pan number|date of birth|\bdob\b/i.test(q))
    return review('SENSITIVE_OR_APPLICATION_SPECIFIC', 'Confirm this answer for this application.');
  if (context.inputType === 'file') return review('MANUAL_UPLOAD', 'Select the real resume PDF manually.');
  if (/^links? to (?:your )?(?:strongest|best) work\b/i.test(context.labelText || '') && context.inputType === 'textarea') {
    const links = [profile.links?.github, profile.links?.portfolio].filter(link => /^https?:\/\//i.test(link || ''));
    if (links.length) return { type: 'WORK_LINKS', value: [...new Set(links)].join('\n'), verified: true, source: 'applicant_reviewed_profile' };
  }
  if (/why|describe|explain|challenge|tell us|about yourself|summary|motivation/i.test(q) || context.inputType === 'textarea')
    return review('WRITTEN_ANSWER', 'Draft and review using selected resume facts and the actual question.');
  if (/company name|employer|emergency contact|next of kin|recruiter|reference|referee|manager|parent|guardian|spouse/i.test(q)) return review('OTHER_PERSON_OR_EMPLOYER', 'Not an applicant profile field.');
  if (/10th|tenth|12th|twelfth|high school|secondary|country code|dial.*code/i.test(q)) return review('EDUCATION_OR_PHONE_DETAIL', 'This specific fact requires an explicit answer.');
  const mappings = [
    [/first.?name|given.?name|fname/i, 'FIRST_NAME', profile.firstName],
    [/last.?name|family.?name|surname|lname/i, 'LAST_NAME', profile.lastName],
    [/full.?name|your name|candidate name|^name(?:\s*\*)?$/i, 'FULL_NAME', profile.fullName],
    [/e.?mail/i, 'EMAIL', profile.email],
    [/phone|mobile|contact number/i, 'PHONE', profile.phoneRaw || profile.phone],
    [/linkedin/i, 'LINK_LINKEDIN', profile.links?.linkedin],
    [/github/i, 'LINK_GITHUB', profile.links?.github],
    [/portfolio|personal website/i, 'LINK_PORTFOLIO', profile.links?.portfolio],
    [/cgpa|\bgpa\b|grade point/i, 'CGPA', profile.cgpa],
    [/graduat|passout|end year/i, 'GRADUATION_YEAR', profile.graduationYear],
    [/degree|qualification/i, 'DEGREE', profile.degree],
    [/major|discipline|field of study|branch/i, 'MAJOR', profile.major],
    [/university|college|institution|school/i, 'COLLEGE', profile.college],
    [/country(?!.*code)/i, 'COUNTRY', profile.location?.country],
    [/state|province/i, 'STATE', profile.location?.state],
    [/city|town/i, 'CITY', profile.location?.city]
  ];
  for (const [pattern, type, value] of mappings) {
    if (!pattern.test(q) && !(type === 'FULL_NAME' && /^name\s*\*?$/.test(norm(context.labelText)))) continue;
    if (value === undefined || value === null || String(value).trim() === '') return review(type, 'Missing applicant-reviewed profile fact.');
    return { type, value: String(value), verified: true, confidence: null, source: profile.provenance?.[type] || 'applicant_reviewed_profile' };
  }
  return review(context.isRequired ? 'UNKNOWN_REQUIRED' : 'UNMATCHED_OPTIONAL', 'No supported profile evidence for this question.');
}

const selector = 'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], button[aria-haspopup="menu"], button[aria-haspopup="dialog"], [role="listbox"], [role="radiogroup"], [role="checkbox"]';
function rendered(el) {
  for (let node=el;node?.nodeType===1;node=node.parentElement || node.getRootNode()?.host) {
    const style=node.ownerDocument.defaultView.getComputedStyle(node);
    if(node.hidden || style.display==='none' || style.visibility==='hidden')return false;
  }
  return true;
}
function radioGroup(el) {
  return !el.name ? [el] : [...(el.form || el.getRootNode()).querySelectorAll('input[type="radio"]')].filter(r=>r.name===el.name && r.form===el.form);
}
export function collectFields(root, visited = new Set(), { frames = true } = {}) {
  if (visited.has(root)) return [];
  visited.add(root);
  const fields = [...root.querySelectorAll(selector)].filter(el => {
    const type = norm(el.getAttribute('type'));
    const popup = popupKind(el);
    if (popup === 'menu' && !nearbyUnboundLabel(el) && !el.getAttribute('aria-labelledby') && !el.labels?.length) return false;
    const datePicker = el.matches('button[aria-haspopup="dialog"]') && extractQuestionContext(el).inputType === 'date-picker';
    const widget = ['combobox', 'listbox', 'checkbox'].includes(el.getAttribute('role')) || popup || datePicker;
    return (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || widget) && !el.disabled && !el.readOnly && rendered(el) &&
      !(el.type==='radio' && radioGroup(el)[0]!==el) &&
      !el.closest('[hidden], [aria-hidden="true"], [data-jobfinder-ui]') &&
      !(el.getAttribute('role') !== 'radiogroup' && el.closest('[role="radiogroup"]')) &&
      !el.parentElement?.closest('[role="combobox"], [role="listbox"]');
  });
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) fields.push(...collectFields(el.shadowRoot, visited, { frames }));
    if (frames && el.tagName === 'IFRAME' && rendered(el)) {
      try { if (el.contentDocument) fields.push(...collectFields(el.contentDocument, visited, { frames })); } catch { /* Cross-origin needs manual help. */ }
    }
  }
  return fields;
}
function emptyDropdownPrompt(el, displayed) {
  const value = norm(displayed).replace(/[.\s\u2026]+$/g, '');
  const popup = controlledPopup(el);
  // An actual enabled choice wins over wording that resembles a prompt.
  if (popup && [...popup.querySelectorAll(popupOptions + ', option')].some(option => !option.disabled && option.getAttribute('aria-disabled') !== 'true' && norm(option.getAttribute('aria-label') || option.label || text(option)) === norm(displayed))) return false;
  const placeholder = el.getAttribute('data-placeholder') || el.getAttribute('placeholder');
  if (placeholder && norm(placeholder) === norm(displayed)) return true;
  const label = norm(extractQuestionContext(el).labelText).replace(/[.*:\s]+$/g, '');
  const nouns = ['option', 'country', 'state', ...(label ? [label] : [])];
  const endings = ['', 'one', 'a value', ...nouns.flatMap(noun => [noun, `a ${noun}`, `an ${noun}`, `your ${noun}`])];
  return ['select', 'choose', 'please select', 'please choose'].some(prefix => endings.some(ending => value === `${prefix}${ending ? ' ' + ending : ''}`));
}
function currentValue(el) {
  const role = el.getAttribute('role') || (popupKind(el) ? 'combobox' : null);
  if (el.matches('button[aria-haspopup="dialog"]') && extractQuestionContext(el).inputType === 'date-picker') {
    const label = text(el);
    return /^(?:pick|select|choose)(?: a)? date$/i.test(label) ? '' : label;
  }
  if (el.tagName === 'SELECT' && !el.multiple) {
    const option = el.selectedOptions[0];
    return !option || option.matches(':disabled') ? '' : el.value;
  }
  if(el.type==='radio')return radioGroup(el).some(r=>r.checked)?'selected':'';
  if (role === 'radiogroup') {
    const checked = el.querySelector('[role="radio"][aria-checked="true"]');
    return checked ? choiceLabel(checked) || 'selected' : '';
  }
  if (['checkbox', 'radio'].includes(el.type) || role === 'checkbox') return (el.checked || el.getAttribute('aria-checked') === 'true') ? 'checked' : '';
  if (role === 'combobox' || role === 'listbox') {
    const explicit = el.getAttribute('aria-valuetext') || el.value || el.getAttribute('data-value');
    if (explicit) return explicit;
    const displayed = questionText(el);
    // Match a known prompt or this field's label, never arbitrary Select-prefixed text.
    return emptyDropdownPrompt(el, displayed) ? '' : displayed;
  }
  return el.value || '';
}
function setValue(el, value) {
  const win = el.ownerDocument.defaultView;
  const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
}
function safeClick(el, event) {
  if (el.closest('a, [formaction], button:not([type="button"]), input[type="submit"], input[type="image"]'))
    throw new Error('Control can submit or navigate; use it manually.');
  if (event) el.dispatchEvent(event);
  else el.click();
}
const exactOption = (items, value) => {
  const matches = [...items].filter(el => {
    return !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true' && norm(choiceLabel(el)) === norm(value);
  });
  if (matches.length !== 1) throw new Error('No unique exact option; choose manually.');
  return matches[0];
};
function openChoice(el) {
  if (el.getAttribute('aria-expanded') === 'true') return;
  if (popupKind(el) === 'menu' && el.id.startsWith('radix-')) {
    const win = el.ownerDocument.defaultView;
    safeClick(el, new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
  } else {
    safeClick(el);
  }
}
function availableChoices(el) {
  const popup = controlledPopup(el) || (popupKind(el) === 'menu' ? null : el);
  if (!popup || !rendered(popup)) return [];
  return [...popup.querySelectorAll(popupOptions)].filter(option =>
    rendered(option) && !option.closest('[hidden], [aria-hidden="true"], [aria-disabled="true"]') && !option.matches(':disabled'));
}
async function waitForChoices(el, stopped) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !stopped() && el.isConnected) {
    const options = availableChoices(el);
    if (options.length) return options;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The dropdown did not expose its options. Choose on the page.');
}
function dateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) && !/[a-z]{3,}/i.test(value)) return '';
  const plain = value.replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  if (!/\b\d{4}\b/.test(plain)) return '';
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(plain) ? plain : plain + ' UTC');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}
async function chooseCalendarDate(el, value, stopped) {
  if (dateKey(value) !== value) throw new Error('Choose a valid calendar date.');
  openChoice(el);
  for (let step = 0; step <= 12 && !stopped(); step++) {
    await new Promise(resolve => setTimeout(resolve, 70));
    const popup = controlledPopup(el);
    if (!popup?.matches('[role="dialog"]') || !rendered(popup)) continue;
    const days = [...popup.querySelectorAll('[data-day]')].filter(day =>
      !day.matches('[data-outside="true"], [data-hidden="true"]') && rendered(day));
    const matching = days.filter(day => day.getAttribute('data-day') === value);
    if (matching.length === 1) {
      const day = matching[0].matches('button') ? matching[0] : matching[0].querySelector('button');
      if (!day || day.disabled || day.getAttribute('aria-disabled') === 'true') throw new Error('The selected date is unavailable.');
      safeClick(day);
      await new Promise(resolve => setTimeout(resolve, 70));
      if (dateKey(el.getAttribute('data-date') || currentValue(el)) !== value) throw new Error('The calendar selection could not be verified.');
      return;
    }
    const currentMonth = days[Math.floor(days.length / 2)]?.getAttribute('data-day')?.slice(0, 7);
    if (!currentMonth || currentMonth === value.slice(0, 7) || matching.length > 1 || step === 12) break;
    const direction = currentMonth < value.slice(0, 7) ? 'next' : 'previous';
    const nav = [...popup.querySelectorAll('button[aria-label]')].filter(button =>
      !button.disabled && new RegExp(`\\b${direction}\\b.*\\bmonth\\b`, 'i').test(button.getAttribute('aria-label')));
    if (nav.length !== 1) break;
    safeClick(nav[0]);
  }
  throw new Error('Choose the date on the page. This calendar did not expose a verifiable date.');
}

export class FormFillSession {
  constructor(root) { this.root = root; this.state = 'IDLE'; this.rows = []; this.stopped = false; this.choiceSnapshots = new WeakMap(); }
  contextFor(element) {
    const context = { ...extractQuestionContext(element), scope: answerScope(element) };
    const snapshot = this.choiceSnapshots.get(element);
    if (snapshot?.scope === context.scope) context.options = snapshot.options;
    return context;
  }
  async readChoices(scope, profile) {
    const controls = collectFields(this.root).filter(el => answerScope(el) === scope);
    const element = controls.length === 1 ? controls[0] : null;
    if (!element || element.ownerDocument !== this.root || !['combobox', 'listbox'].includes(extractQuestionContext(element).inputType))
      throw new Error('The dropdown changed. Preview this form again.');
    this.stopped = false;
    openChoice(element);
    try {
      const options = (await waitForChoices(element, () => this.stopped)).map(choiceLabel).filter(Boolean);
      if (!options.length || new Set(options.map(norm)).size !== options.length) throw new Error('The page has ambiguous choices. Select directly on the form.');
      this.choiceSnapshots.set(element, { scope, options });
    } finally {
      const win = element.ownerDocument.defaultView;
      const popup = controlledPopup(element);
      (popup?.contains(element.ownerDocument.activeElement) ? element.ownerDocument.activeElement : popup || element)
        .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    return this.scan(profile);
  }
  scan(profile) {
    if (this.state === 'FILL') throw new Error('Fill already running.');
    this.stopped = false; this.state = 'SCAN'; this.rescanRequired = false;
    this.rows = collectFields(this.root).map((element, index) => {
      const context = this.contextFor(element);
      const decision = classifyQuestion(context, profile);
      const before = currentValue(element);
      return { id: index, element, context, before, decision,
        action: before ? 'preserve' : decision.requiresManualReview ? 'needs_review' : 'fill' };
    });
    this.state = 'PLAN';
    return this.report();
  }
  stop() { this.stopped = true; this.state = 'STOPPED'; }
  report() {
    return { state: this.state, rescanRequired: !!this.rescanRequired, fields: this.rows.map(({ element: _element, committedValue: _committedValue, ...row }) => row),
      filledCount: this.rows.filter(r => r.outcome === 'filled').length,
      needsReviewCount: this.rows.filter(r => r.action === 'needs_review' || r.outcome === 'needs_review').length };
  }
  async fillStep(profile, onProgress) {
    this.scan(profile);
    const guardedDocuments = new Set(this.rows.map(row => row.element.ownerDocument));
    const attempted = new Map();
    for (let pass = 0; pass < 3; pass++) {
      if (pass) {
        this.scan(profile);
        for (const row of this.rows) {
          const previous = attempted.get(row.context.scope);
          if (previous?.outcome === 'filled' && row.before === previous.committedValue) {
            row.outcome = 'filled';
            row.committedValue = previous.committedValue;
          }
          if (previous?.element === row.element && previous.outcome === 'needs_review' &&
              JSON.stringify(previous.context) === JSON.stringify(row.context)) {
            row.action = 'needs_review';
            row.outcome = previous.outcome;
            row.reason = previous.reason;
          }
          if (!guardedDocuments.has(row.element.ownerDocument)) {
            row.action = 'needs_review';
            row.reason = 'New application frame. Start fill again to review it.';
          }
        }
      }
      const report = await this.fill(onProgress && (progress => onProgress({ ...progress, pass: pass + 1 })));
      for (const row of this.rows) attempted.set(row.context.scope, row);
      if (this.stopped || !report.rescanRequired) return report;
    }
    return this.report();
  }
  async fill(onProgress) {
    if (this.state !== 'PLAN') throw new Error('Preview this step before filling.');
    this.state = 'FILL';
    const docs = new Set(this.rows.map(r => r.element.ownerDocument));
    const prevent = event => event.preventDefault();
    const restores = [];
    for (const doc of docs) {
      doc.addEventListener('submit', prevent, true);
      for (const name of ['submit', 'requestSubmit']) {
        const proto = doc.defaultView.HTMLFormElement.prototype;
        const original = Object.getOwnPropertyDescriptor(proto, name);
        Object.defineProperty(proto, name, { configurable: true, writable: true, value() { throw new Error('Automatic submission blocked'); } });
        restores.push(() => Object.defineProperty(proto, name, original));
      }
    }
    try {
      for (const [index, row] of this.rows.entries()) {
        if (this.stopped) break;
        onProgress?.({ checked: index, total: this.rows.length, label: row.context.labelText });
        // Give the notice a chance to render on larger forms without delaying each field.
        if (onProgress && index > 0 && index % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        if (this.stopped) break;
        if (row.action !== 'fill') continue;
        const el = row.element;
        try {
          if (!el.isConnected || !rendered(el) || JSON.stringify(this.contextFor(el)) !== JSON.stringify(row.context)) throw new Error('Field changed; preview again.');
          if (currentValue(el) !== row.before) { row.outcome = 'preserved_manual_change'; continue; }
          const { value } = row.decision;
          const type = row.context.inputType;
          if (row.decision.type === 'EXPERIENCE_YEARS' && type === 'number' && el.min !== '' && Number(value) < Number(el.min))
            throw new Error('The form does not accept your default experience value.');
          if (el.maxLength >= 0 && value.length > el.maxLength) throw new Error('Answer exceeds character limit.');
          if (el.type === 'checkbox' || type === 'checkbox') {
            if (row.decision.type !== 'REMEMBERED_ANSWER' || !/^(yes|no)$/i.test(value)) throw new Error('Review checkbox manually.');
            const checked = () => el.checked || el.getAttribute('aria-checked') === 'true';
            const desired = norm(value) === 'yes';
            if (checked() !== desired) safeClick(el);
            if (checked() !== desired) throw new Error('Checkbox selection was not retained.');
          } else if (el.type === 'radio') {
            const option=exactOption(radioGroup(el),value);safeClick(option);
            if(!option.checked)throw new Error('Radio selection was not retained.');
          } else if (type === 'select') {
            if (el.multiple) throw new Error('Review multiple selections manually.');
            const choice = exactOption(el.options, value);
            if ([...el.options].filter(option => option.value === choice.value).length !== 1) throw new Error('Duplicate option values require manual selection.');
            setValue(el, choice.value);
          } else if (type === 'radiogroup') {
            const option = exactOption(el.querySelectorAll('[role="radio"]'), value);
            safeClick(option);
            if (option.getAttribute('aria-checked') !== 'true') throw new Error('Radio selection was not retained.');
          } else if (type === 'combobox' || type === 'listbox') {
            openChoice(el);
            const choices = await waitForChoices(el, () => this.stopped);
            const snapshot = this.choiceSnapshots.get(el);
            if (snapshot && JSON.stringify(choices.map(choiceLabel).sort()) !== JSON.stringify([...snapshot.options].sort()))
              throw new Error('Dropdown options changed. Read the options again.');
            const option = exactOption(choices, value);
            if (this.stopped) break;
            const identity = answerScope(el);
            safeClick(option);
            el.blur();
            await new Promise(resolve => setTimeout(resolve, 40));
            const controls = collectFields(this.root).filter(candidate => answerScope(candidate) === identity);
            const committed = controls.length === 1 ? controls[0] : null;
            if (!committed || norm(currentValue(committed)) !== norm(value) ||
              (committed.tagName === 'INPUT' && !committed.getAttribute('aria-valuetext') && !committed.getAttribute('data-value') &&
                option.getAttribute('aria-selected') !== 'true')) throw new Error('Dropdown selection was not retained.');
            row.element = committed;
          } else if (type === 'date-picker' && row.decision.type === 'REMEMBERED_ANSWER') {
            await chooseCalendarDate(el, value, () => this.stopped);
          } else if (['text', 'email', 'tel', 'url', 'number', 'search', 'textarea'].includes(type) || (type === 'date' && row.decision.type === 'REMEMBERED_ANSWER')) {
            setValue(el, value);
          } else throw new Error('Unsupported control; complete manually.');
          if (!row.element.isConnected) throw new Error('Field rerendered; preview the updated step.');
          if (el.type!=='radio' && !['combobox', 'listbox', 'radiogroup', 'checkbox', 'date-picker'].includes(type) && norm(el.value) !== norm(type === 'select' ? exactOption(el.options, value).value : value)) throw new Error('Value was not retained.');
          if (typeof row.element.checkValidity === 'function' && !row.element.checkValidity()) throw new Error('Site validation requires review.');
          row.outcome = 'filled';
          row.committedValue = currentValue(row.element);
        } catch (error) { row.outcome = 'needs_review'; row.reason = error.message; }
      }
      if (!this.stopped) {
        const known = new Set(this.rows.map(row => row.element));
        this.rescanRequired = collectFields(this.root).some(control => !known.has(control)) ||
          this.rows.some(row => row.outcome === 'needs_review' && row.element.isConnected &&
            JSON.stringify(this.contextFor(row.element)) !== JSON.stringify(row.context));
        this.state = this.rescanRequired || this.rows.some(r => r.action === 'needs_review' || r.outcome === 'needs_review') ? 'NEEDS_REVIEW' : 'IDLE';
      }
    } finally {
      for (const doc of docs) doc.removeEventListener('submit', prevent, true);
      for (const restore of restores.reverse()) restore();
    }
    return this.report();
  }
}

export function reconcileWorkdayFields(fields, profile = {}) {
  return fields.map(field => ({ ...field, decision: classifyQuestion(field.context || { combined: norm(field.label), inputType: 'text' }, profile) }));
}
export function generateCompletionSummary(filled = [], manualReview = [], errors = [], unansweredRequired = []) {
  return { filled, manualReview, errors, unansweredRequired, submitted: false };
}

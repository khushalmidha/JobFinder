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
    questionText(container?.querySelector('[role="heading"], .M7eMe, label')) || questionText(legend) || groupLabel || '';
  const descriptionText = refs('aria-describedby') || text(container?.querySelector('.zHQkBf, [data-automation-id="helpText"]'));
  let inputType = norm(element.getAttribute('type') || 'text');
  const role = element.getAttribute('role') || (element.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : null);
  if (element.tagName === 'TEXTAREA') inputType = 'textarea';
  if (element.tagName === 'SELECT') inputType = 'select';
  if (['combobox', 'listbox', 'radio', 'radiogroup', 'checkbox'].includes(role)) inputType = role;
  const fallback = ['name', 'id', 'placeholder', 'autocomplete', 'data-automation-id'].map(a => element.getAttribute(a) || '').join(' ');
  if (inputType === 'radio') labelText = questionText(legend) || groupLabel || refs('aria-labelledby') || '';
  const popupId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
  const popup = popupId && !popupId.includes(' ') ? get(popupId) : null;
  const options = element.tagName === 'SELECT' ? [...element.options].map(option => option.label) : inputType === 'radio' ? radioGroup(element).map(r => r.getAttribute('aria-label') || [...(r.labels || [])].map(text).join(' ') || r.value) :
    [...(popup || group || element).querySelectorAll('[role="option"], [role="radio"]')].map(text);
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

export function classifyQuestion(context, profile = CANDIDATE_PROFILE) {
  profile = normalizeProfile(profile);
  const q = context.combined || '';
  // Safety/ambiguity precedes personal-data matching.
  if (/terms|privacy|agree|consent|declar|certif|attest|signature|sign here|background check|acknowledge/i.test(q))
    return review('LEGAL_CONSENT_OR_TERMS', 'Requires explicit applicant action.');
  if (/captcha|verification code|\botp\b|password|security code/i.test(q)) return review('VERIFICATION', 'Complete verification manually.');
  const remembered = recallAnswer(profile.answers_bank, context.labelText || q, context.inputType, context.options || [], context.scope || '');
  // Sensitive/application-specific answers must be explicitly scoped to this form.
  if (remembered && (context.scope || !/salary|ctc|compensation|notice|availab|relocat|sponsor|visa|authoriz|citizen|nationality/i.test(q)))
    return { type: 'REMEMBERED_ANSWER', value: remembered.answer, verified: true, confidence: null, source: `answer_bank:${remembered.provenance}` };
  if (/gender|disabil|veteran|ethnic|race\b/i.test(q) && norm(profile.preferences?.eeo_default) === 'prefer not to say' && context.options?.some(option => norm(option) === 'prefer not to say'))
    return { type: 'EEO_PREFERENCE', value: context.options.find(option => norm(option) === 'prefer not to say'), verified: true, source: 'applicant_profile_eeo_preference', confidence: null };
  if (/salary|\bctc\b|compensation|remuneration|expected pay|notice|availab|start date|relocat|sponsor|visa|authoriz|eligible to work|gender|pronoun|disabil|veteran|ethnic|race\b|citizen|nationality|passport|aadhaar|pan number|date of birth|\bdob\b/i.test(q))
    return review('SENSITIVE_OR_APPLICATION_SPECIFIC', 'Confirm this answer for this application.');
  if (context.inputType === 'file') return review('MANUAL_UPLOAD', 'Select the real resume PDF manually.');
  if (/why|describe|explain|challenge|tell us|about yourself|summary|motivation/i.test(q) || context.inputType === 'textarea')
    return review('WRITTEN_ANSWER', 'Draft and review using selected resume facts and the actual question.');
  if (/company name|employer|emergency contact|next of kin|recruiter|reference|referee|manager|parent|guardian|spouse/i.test(q)) return review('OTHER_PERSON_OR_EMPLOYER', 'Not an applicant profile field.');
  if (/10th|tenth|12th|twelfth|high school|secondary|country code|dial.*code/i.test(q)) return review('EDUCATION_OR_PHONE_DETAIL', 'This specific fact requires an explicit answer.');
  const mappings = [
    [/first.?name|given.?name|fname/i, 'FIRST_NAME', profile.firstName],
    [/last.?name|family.?name|surname|lname/i, 'LAST_NAME', profile.lastName],
    [/full.?name|your name|candidate name|^name\s*$/i, 'FULL_NAME', profile.fullName],
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
    if (!pattern.test(q)) continue;
    if (value === undefined || value === null || String(value).trim() === '') return review(type, 'Missing applicant-reviewed profile fact.');
    return { type, value: String(value), verified: true, confidence: null, source: profile.provenance?.[type] || 'applicant_reviewed_profile' };
  }
  return review(context.isRequired ? 'UNKNOWN_REQUIRED' : 'UNMATCHED_OPTIONAL', 'No supported profile evidence for this question.');
}

const selector = 'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], [role="listbox"], [role="radiogroup"], [role="checkbox"]';
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
    const dropdown = ['combobox', 'listbox'].includes(el.getAttribute('role')) || el.getAttribute('aria-haspopup') === 'listbox';
    return (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || dropdown) && !el.disabled && !el.readOnly && rendered(el) &&
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
  const popupId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
  const popup = popupId && !popupId.includes(' ') ? el.getRootNode().getElementById?.(popupId) || el.ownerDocument.getElementById(popupId) : null;
  // An actual enabled choice wins over wording that resembles a prompt.
  if (popup && [...popup.querySelectorAll('[role="option"], option')].some(option => !option.disabled && option.getAttribute('aria-disabled') !== 'true' && norm(option.getAttribute('aria-label') || option.label || text(option)) === norm(displayed))) return false;
  const placeholder = el.getAttribute('data-placeholder') || el.getAttribute('placeholder');
  if (placeholder && norm(placeholder) === norm(displayed)) return true;
  const label = norm(extractQuestionContext(el).labelText).replace(/[.*:\s]+$/g, '');
  const nouns = ['option', 'country', 'state', ...(label ? [label] : [])];
  const endings = ['', 'one', 'a value', ...nouns.flatMap(noun => [noun, `a ${noun}`, `an ${noun}`, `your ${noun}`])];
  return ['select', 'choose', 'please select', 'please choose'].some(prefix => endings.some(ending => value === `${prefix}${ending ? ' ' + ending : ''}`));
}
function currentValue(el) {
  const role = el.getAttribute('role') || (el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : null);
  if(el.type==='radio')return radioGroup(el).some(r=>r.checked)?'selected':'';
  if (role === 'radiogroup') return el.querySelector('[aria-checked="true"]')?.getAttribute('data-value') || text(el.querySelector('[aria-checked="true"]'));
  if (['checkbox', 'radio'].includes(el.type) || role === 'checkbox') return (el.checked || el.getAttribute('aria-checked') === 'true') ? 'checked' : '';
  if (role === 'combobox' || role === 'listbox') {
    const explicit = el.getAttribute('aria-valuetext') || el.value || el.getAttribute('data-value');
    if (explicit) return explicit;
    const displayed = text(el);
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
function safeClick(el) {
  if (el.closest('a, [formaction], button:not([type="button"]), input[type="submit"], input[type="image"]'))
    throw new Error('Control can submit or navigate; use it manually.');
  el.click();
}
const exactOption = (items, value) => {
  const matches = [...items].filter(el => {
    const label = el.tagName === 'OPTION' ? el.label : el.getAttribute('aria-label') || [...(el.labels || [])].map(text).join(' ') || text(el);
    return !el.disabled && norm(label || el.getAttribute('data-value') || el.value) === norm(value);
  });
  if (matches.length !== 1) throw new Error('No unique exact option; choose manually.');
  return matches[0];
};
async function waitForChoice(el, value, stopped) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !stopped() && el.isConnected) {
    const popupId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (popupId && !/\s/.test(popupId)) {
      const popup = el.getRootNode().getElementById?.(popupId) || el.ownerDocument.getElementById(popupId);
      if (popup && rendered(popup)) {
        const options = [...popup.querySelectorAll('[role="option"]')].filter(option =>
          rendered(option) && option.getAttribute('aria-disabled') !== 'true' &&
          norm(option.getAttribute('aria-label') || text(option)) === norm(value));
        if (options.length > 1) throw new Error('Ambiguous dropdown options.');
        if (options.length === 1) return options[0];
      }
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Dropdown option unavailable; complete manually.');
}

export class FormFillSession {
  constructor(root) { this.root = root; this.state = 'IDLE'; this.rows = []; this.stopped = false; }
  scan(profile) {
    if (this.state === 'FILL') throw new Error('Fill already running.');
    this.stopped = false; this.state = 'SCAN'; this.rescanRequired = false;
    this.rows = collectFields(this.root).map((element, index) => {
      const context = { ...extractQuestionContext(element), scope: answerScope(element) };
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
    return { state: this.state, rescanRequired: !!this.rescanRequired, fields: this.rows.map(({ element: _element, ...row }) => row),
      filledCount: this.rows.filter(r => r.outcome === 'filled').length,
      needsReviewCount: this.rows.filter(r => r.action === 'needs_review' || r.outcome === 'needs_review').length };
  }
  async fill() {
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
      for (const row of this.rows) {
        if (this.stopped) break;
        if (row.action !== 'fill') continue;
        const el = row.element;
        try {
          if (!el.isConnected || !rendered(el) || JSON.stringify({ ...extractQuestionContext(el), scope: answerScope(el) }) !== JSON.stringify(row.context)) throw new Error('Field changed; preview again.');
          if (currentValue(el) !== row.before) { row.outcome = 'preserved_manual_change'; continue; }
          const { value } = row.decision;
          const type = row.context.inputType;
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
            const choice = exactOption(el.options, value);
            if ([...el.options].filter(option => option.value === choice.value).length !== 1) throw new Error('Duplicate option values require manual selection.');
            setValue(el, choice.value);
          } else if (type === 'radiogroup') {
            const option = exactOption(el.querySelectorAll('[role="radio"]'), value);
            safeClick(option);
            if (option.getAttribute('aria-checked') !== 'true') throw new Error('Radio selection was not retained.');
          } else if (type === 'combobox' || type === 'listbox') {
            safeClick(el);
            const option = await waitForChoice(el, value, () => this.stopped);
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
          } else if (['text', 'email', 'tel', 'url', 'number', 'search', 'textarea'].includes(type) || (type === 'date' && row.decision.type === 'REMEMBERED_ANSWER')) {
            setValue(el, value);
          } else throw new Error('Unsupported control; complete manually.');
          if (!row.element.isConnected) throw new Error('Field rerendered; preview the updated step.');
          if (el.type!=='radio' && !['combobox', 'listbox', 'radiogroup', 'checkbox'].includes(type) && norm(el.value) !== norm(type === 'select' ? exactOption(el.options, value).value : value)) throw new Error('Value was not retained.');
          if (typeof row.element.checkValidity === 'function' && !row.element.checkValidity()) throw new Error('Site validation requires review.');
          row.outcome = 'filled';
        } catch (error) { row.outcome = 'needs_review'; row.reason = error.message; }
      }
      if (!this.stopped) {
        const known = new Set(this.rows.map(row => row.element));
        this.rescanRequired = collectFields(this.root).some(control => !known.has(control));
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

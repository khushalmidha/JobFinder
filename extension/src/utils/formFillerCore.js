// Imported by both the packaged content script and DOM tests. No private defaults.
export const CANDIDATE_PROFILE = Object.freeze({});
export const FORM_STATES = Object.freeze(['IDLE', 'SCAN', 'PLAN', 'FILL', 'VERIFY', 'NEEDS_REVIEW', 'STOPPED']);
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const text = el => el?.textContent?.replace(/\s+/g, ' ').trim() || '';
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
  const refs = attr => (element.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map(id => text(get(id))).join(' ');
  const container = element.closest('[role="listitem"], .Qr7Oae, [data-automation-id^="formField"], .field, .form-group');
  const legend = element.closest('fieldset')?.querySelector('legend');
  const group = element.closest('[role="radiogroup"], [role="group"]');
  const groupLabel = group?.getAttribute('aria-label') || (group?.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(get(id))).join(' ');
  const labelText = refs('aria-labelledby') || element.getAttribute('aria-label') ||
    [...(element.labels || [])].map(text).join(' ') || text(element.closest('label')) ||
    text(container?.querySelector('[role="heading"], .M7eMe, label')) || text(legend) || groupLabel || '';
  const descriptionText = refs('aria-describedby') || text(container?.querySelector('.zHQkBf, [data-automation-id="helpText"]'));
  let inputType = norm(element.getAttribute('type') || 'text');
  const role = element.getAttribute('role');
  if (element.tagName === 'TEXTAREA') inputType = 'textarea';
  if (element.tagName === 'SELECT') inputType = 'select';
  if (['combobox', 'listbox', 'radio', 'radiogroup', 'checkbox'].includes(role)) inputType = role;
  const fallback = ['name', 'id', 'placeholder', 'autocomplete', 'data-automation-id'].map(a => element.getAttribute(a) || '').join(' ');
  return { labelText: labelText || fallback.trim(), descriptionText, inputType,
    combined: norm(`${labelText} ${descriptionText} ${text(legend)} ${groupLabel} ${fallback}`),
    isRequired: element.required || element.getAttribute('aria-required') === 'true' || labelText.includes('*') };
}

export function classifyQuestion(context, profile = CANDIDATE_PROFILE) {
  const q = context.combined || '';
  // Safety/ambiguity precedes personal-data matching.
  if (/terms|privacy|agree|consent|declar|certif|attest|signature|sign here|background check|acknowledge/i.test(q))
    return review('LEGAL_CONSENT_OR_TERMS', 'Requires explicit applicant action.');
  if (/salary|\bctc\b|compensation|remuneration|expected pay|notice|availab|start date|relocat|sponsor|visa|authoriz|eligible to work|gender|pronoun|disabil|veteran|ethnic|race\b|citizen|nationality|passport|aadhaar|pan number|date of birth|\bdob\b/i.test(q))
    return review('SENSITIVE_OR_APPLICATION_SPECIFIC', 'Confirm this answer for this application.');
  if (/captcha|verification code|\botp\b|password|security code/i.test(q)) return review('VERIFICATION', 'Complete verification manually.');
  if (context.inputType === 'file') return review('MANUAL_UPLOAD', 'Select the real resume PDF manually.');
  if (/why|describe|explain|challenge|tell us|about yourself|summary|motivation/i.test(q) || context.inputType === 'textarea')
    return review('WRITTEN_ANSWER', 'Draft and review using selected resume facts and the actual question.');
  if (/company name|employer|emergency contact|next of kin|recruiter|reference|referee|manager|parent|guardian|spouse/i.test(q)) return review('OTHER_PERSON_OR_EMPLOYER', 'Not an applicant profile field.');
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

const selector = 'input, textarea, select, [role="combobox"], [role="listbox"], [role="radiogroup"], [role="checkbox"]';
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
export function collectFields(root, visited = new Set()) {
  if (visited.has(root)) return [];
  visited.add(root);
  const fields = [...root.querySelectorAll(selector)].filter(el => {
    const type = norm(el.getAttribute('type'));
    const dropdown = ['combobox', 'listbox'].includes(el.getAttribute('role'));
    return (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || dropdown) && !el.disabled && !el.readOnly && rendered(el) &&
      !(el.type==='radio' && radioGroup(el)[0]!==el) &&
      !el.closest('[hidden], [aria-hidden="true"], [data-jobfinder-ui]') &&
      !(el.getAttribute('role') !== 'radiogroup' && el.closest('[role="radiogroup"]')) &&
      !el.parentElement?.closest('[role="combobox"], [role="listbox"]');
  });
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) fields.push(...collectFields(el.shadowRoot, visited));
    if (el.tagName === 'IFRAME' && rendered(el)) {
      try { if (el.contentDocument) fields.push(...collectFields(el.contentDocument, visited)); } catch { /* Cross-origin needs manual help. */ }
    }
  }
  return fields;
}
function currentValue(el) {
  const role = el.getAttribute('role');
  if(el.type==='radio')return radioGroup(el).some(r=>r.checked)?'selected':'';
  if (role === 'radiogroup') return el.querySelector('[aria-checked="true"]')?.getAttribute('data-value') || text(el.querySelector('[aria-checked="true"]'));
  if (['checkbox', 'radio'].includes(el.type) || role === 'checkbox') return (el.checked || el.getAttribute('aria-checked') === 'true') ? 'checked' : '';
  if (role === 'combobox' || role === 'listbox') {
    const explicit = el.getAttribute('aria-valuetext') || el.value || el.getAttribute('data-value');
    if (explicit) return explicit;
    const displayed = text(el);
    // Recognize only clear empty prompts. Other rendered content is preserved.
    return /^(select|choose)( an?| your)?( option| country| state)?[.\s…]*$/i.test(displayed) ? '' : displayed;
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
  if (el.tagName === 'A' || el.type === 'submit' || el.type === 'image' || (el.tagName === 'BUTTON' && el.getAttribute('type') !== 'button'))
    throw new Error('Control can submit or navigate; use it manually.');
  el.click();
}
const exactOption = (items, value) => {
  const matches = [...items].filter(el => !el.disabled && (norm(text(el)) === norm(value) || norm([...(el.labels || [])].map(text).join(' '))===norm(value) || norm(el.getAttribute('aria-label')) === norm(value) || norm(el.getAttribute('data-value') || el.value) === norm(value)));
  if (matches.length !== 1) throw new Error('No unique exact option; choose manually.');
  return matches[0];
};

export class FormFillSession {
  constructor(root) { this.root = root; this.state = 'IDLE'; this.rows = []; this.stopped = false; }
  scan(profile) {
    if (this.state === 'FILL') throw new Error('Fill already running.');
    this.stopped = false; this.state = 'SCAN';
    this.rows = collectFields(this.root).map((element, index) => {
      const context = extractQuestionContext(element);
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
    return { state: this.state, fields: this.rows.map(({ element: _element, ...row }) => row),
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
          if (!el.isConnected || !rendered(el) || JSON.stringify(extractQuestionContext(el)) !== JSON.stringify(row.context)) throw new Error('Field changed; preview again.');
          if (currentValue(el) !== row.before) { row.outcome = 'preserved_manual_change'; continue; }
          const { value } = row.decision;
          const type = row.context.inputType;
          if (el.type === 'checkbox' || type === 'checkbox') throw new Error('Review checkbox manually.');
          if (el.maxLength >= 0 && value.length > el.maxLength) throw new Error('Answer exceeds character limit.');
          if (el.type === 'radio') {
            const option=exactOption(radioGroup(el),value);safeClick(option);
            if(!option.checked)throw new Error('Radio selection was not retained.');
          } else if (type === 'select') {
            setValue(el, exactOption(el.options, value).value);
          } else if (type === 'radiogroup') {
            const option = exactOption(el.querySelectorAll('[role="radio"]'), value);
            safeClick(option);
            if (option.getAttribute('aria-checked') !== 'true') throw new Error('Radio selection was not retained.');
          } else if (type === 'combobox' || type === 'listbox') {
            const popupId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
            if (!popupId || popupId.includes(' ')) throw new Error('Dropdown has no unique associated popup.');
            safeClick(el);
            await new Promise(resolve => setTimeout(resolve, 40));
            if (this.stopped) break;
            const popup = el.getRootNode().getElementById?.(popupId) || el.ownerDocument.getElementById(popupId);
            if (!popup) throw new Error('Dropdown popup unavailable.');
            const option = exactOption(popup.querySelectorAll('[role="option"]'), value);
            safeClick(option);
            await new Promise(resolve => setTimeout(resolve, 40));
            if (norm(currentValue(el)) !== norm(value) && norm(text(el)) !== norm(value)) throw new Error('Dropdown value was not retained.');
          } else if (['text', 'email', 'tel', 'url', 'number', 'search'].includes(type)) {
            setValue(el, value);
          } else throw new Error('Unsupported control; complete manually.');
          if (!el.isConnected) throw new Error('Field rerendered; preview the updated step.');
          if (el.type!=='radio' && !['combobox', 'listbox', 'radiogroup'].includes(type) && norm(el.value) !== norm(type === 'select' ? exactOption(el.options, value).value : value)) throw new Error('Value was not retained.');
          if (typeof el.checkValidity === 'function' && !el.checkValidity()) throw new Error('Site validation requires review.');
          row.outcome = 'filled';
        } catch (error) { row.outcome = 'needs_review'; row.reason = error.message; }
      }
      if (!this.stopped) { this.state = 'VERIFY'; this.state = this.rows.some(r => r.action === 'needs_review' || r.outcome === 'needs_review') ? 'NEEDS_REVIEW' : 'IDLE'; }
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

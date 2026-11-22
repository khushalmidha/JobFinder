const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeProfile } = require('../../extension/src/utils/candidateProfile.js');
const { classifyQuestion } = require('../../extension/src/utils/formFillerCore.js');
const source = ['candidateProfile.js', 'formFillerCore.js'].map(file => fs.readFileSync(path.join(__dirname, '../../extension/src/utils', file), 'utf8')
  .replace(/^import .*?;\r?\n/gm, '').replace(/export /g, '')).join('\n');
// Both modules define `norm`; keep module scopes separate in the browser bundle.
const browserSource = `(()=>{const api=(()=>{${source.slice(0, source.indexOf('// Imported by both'))}return {normalizeProfile,recallAnswer};})();
const {normalizeProfile,recallAnswer}=api;
${source.slice(source.indexOf('// Imported by both'))}
window.__jfSmartApply={collectFields,extractQuestionContext,currentValue,radioGroup,answerIdentity};})();`;
const equal = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
function permitted(url, allowedHosts) {
  try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !/(^|\.)linkedin\.com$/i.test(u.hostname) && allowedHosts.includes(u.hostname); } catch { return false; }
}
async function frameScope(frame) {
  const documents = [];
  for (let current = frame; current; current = current.parentFrame()) {
    let embedding = null;
    if (current.parentFrame()) { const host = await current.frameElement(); embedding = await host.evaluate(el => window.__jfSmartApply.answerIdentity(el)); await host.dispose(); }
    documents.push({ url: current.url(), embedding });
  }
  return JSON.stringify(documents);
}
async function safeClick(element, timeout) {
  if (!await element.evaluate(el => !el.closest('a, [formaction], button:not([type="button"]), input[type="submit"], input[type="image"]'))) throw Error('This control can submit or navigate; use it manually.');
  await element.click({ timeout });
}
class SmartApplyEngine {
  constructor(page, { profile, allowedHosts, outputDirectory, shouldStop = () => false, timeout = 2000 }) {
    this.page = page; this.profile = normalizeProfile(profile); this.allowedHosts = allowedHosts;
    this.outputDirectory = outputDirectory; this.shouldStop = shouldStop; this.timeout = timeout; this.fields = [];
  }
  allowedFrame(frame) {
    for (let current = frame; current; current = current.parentFrame()) if (!permitted(current.url(), this.allowedHosts)) return false;
    return true;
  }
  async preview() {
    if (!permitted(this.page.url(), this.allowedHosts)) throw Error('Open an explicitly allowed application host; LinkedIn is manual only.');
    this.fields = []; this.report = { id: crypto.randomUUID(), url: this.page.url(), state: 'PLAN', submitted: false, fields: [], inaccessibleFrames: [] };
    for (const frame of this.page.frames()) {
      if (!this.allowedFrame(frame)) { this.report.inaccessibleFrames.push('Frame or ancestor host not approved (blank frames require manual completion)'); continue; }
      try {
        const challenge = frame.locator('input[type="password"], input[autocomplete="one-time-code"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey]');
        for (let i = 0; i < await challenge.count(); i++) if (await challenge.nth(i).isVisible()) { this.report.state = 'NEEDS_INPUT'; this.report.reason = 'Login, CAPTCHA or OTP: complete manually and preview again.'; return this.report; }
        await frame.evaluate(browserSource);
        const handles = await frame.evaluateHandle(() => window.__jfSmartApply.collectFields(document, new Set(), { frames: false }));
        const properties = await handles.getProperties();
        for (const [key, handle] of properties) {
          if (!/^\d+$/.test(key)) continue;
          const element = handle.asElement(); if (!element) continue;
          const metadata = await element.evaluate(el => {
            const { extractQuestionContext } = window.__jfSmartApply;
            const context = extractQuestionContext(el);
            const before = window.__jfSmartApply.currentValue(el);
            return { context, identity: window.__jfSmartApply.answerIdentity(el), before, tag: el.tagName, type: el.type, role: el.getAttribute('role') || (el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : null) };
          });
          metadata.context.scope = JSON.stringify({ documents: JSON.parse(await frameScope(frame)), field: metadata.identity });
          delete metadata.identity;
          // Profile/answers never enter employer page JavaScript: classify in Node.
          metadata.decision = classifyQuestion(metadata.context, this.profile);
          const action = metadata.before ? 'preserve' : metadata.decision.requiresManualReview ? 'needs_review' : 'fill';
          const row = { ...metadata, action, outcome: null }; this.report.fields.push(row); this.fields.push({ element, frame, row });
        }
        await handles.dispose();
      } catch (error) { this.report.inaccessibleFrames.push(error.message); }
    }
    return this.report;
  }
  async fill() {
    if (!this.report || this.report.state !== 'PLAN' || this.page.url() !== this.report.url) throw Error('Preview the current page first.');
    this.guarded ||= [];
    if (!this.networkGuard) {
      this.networkGuard = async route => {
        const req = route.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || req.isNavigationRequest()) { this.blockedRequests = (this.blockedRequests || 0) + 1; if (this.report) this.report.blockedRequests = this.blockedRequests; return route.abort('blockedbyclient'); }
        return route.fallback();
      };
      await this.page.context().route('**/*', this.networkGuard);
    }
      for (const frame of this.page.frames()) {
        if (!this.allowedFrame(frame) || this.guarded.includes(frame)) continue;
        await frame.evaluate(() => {
          const prevent = event => { event.preventDefault(); event.stopImmediatePropagation(); };
          const proto = HTMLFormElement.prototype;
          const originals = ['submit', 'requestSubmit'].map(name => [name, Object.getOwnPropertyDescriptor(proto, name)]);
          document.addEventListener('submit', prevent, true);
          for (const [name] of originals) Object.defineProperty(proto, name, { configurable: true, value() { throw Error('Smart Apply never submits applications.'); } });
          window.__jfRemoveGuard = () => { document.removeEventListener('submit', prevent, true); for (const [name, original] of originals) Object.defineProperty(proto, name, original); delete window.__jfRemoveGuard; };
        });
        this.guarded.push(frame);
      }
      this.report.networkGuardActive = true; this.report.blockedRequests = this.blockedRequests || 0;
      const report = await this.fillGuarded();
      return report;
  }
  async releaseForManualReview() {
    for (const frame of this.guarded || []) await frame.evaluate(() => window.__jfRemoveGuard?.()).catch(() => {});
    this.guarded = [];
    if (this.networkGuard) await this.page.context().unroute('**/*', this.networkGuard);
    this.networkGuard = null;
    if (this.report) this.report.state = 'MANUAL_CONTROL';
  }
  async fillGuarded() {
    if (!this.report || this.report.state !== 'PLAN' || this.page.url() !== this.report.url) throw Error('Preview the current page first.');
    this.report.state = 'FILL';
    if (this.shouldStop()) { this.report.state = 'STOPPED'; await this.saveReport(); return this.report; }
    for (const { element, frame, row } of this.fields) {
      if (this.shouldStop()) { this.report.state = 'STOPPED'; break; }
      if (row.action !== 'fill') continue;
      try {
        if (!this.allowedFrame(frame) || this.page.url() !== this.report.url) throw Error('Page changed; preview again.');
        const current = await element.evaluate(el => ({ context: window.__jfSmartApply.extractQuestionContext(el), identity: window.__jfSmartApply.answerIdentity(el) }));
        const context = current.context;
        context.scope = JSON.stringify({ documents: JSON.parse(await frameScope(frame)), field: current.identity });
        if (JSON.stringify(context) !== JSON.stringify(row.context)) throw Error('Question or options changed; preview again.');
        const before = await element.evaluate(el => window.__jfSmartApply.currentValue(el));
        if (before !== row.before) { row.outcome = 'preserved_manual_change'; continue; }
        const value = row.decision.value;
        if (row.type === 'checkbox' || row.role === 'checkbox' || row.type === 'file') throw Error('Upload/consent requires manual review.');
        if (row.tag === 'SELECT') {
          const options = await element.evaluate(el => [...el.options].map((o, index) => ({ label: o.label, value: o.value, disabled: o.disabled, index })));
          const matches = options.filter(o => !o.disabled && equal(o.label || o.value, value));
          if (matches.length !== 1) throw Error('No unique exact option; choose manually.');
          await element.selectOption({ index: matches[0].index }, { timeout: this.timeout });
          const selected = await element.evaluate(el => ({ index: el.selectedIndex, value: el.value, label: el.selectedOptions[0]?.label }));
          if (selected.index !== matches[0].index || !equal(selected.value, matches[0].value) || !equal(selected.label, matches[0].label)) throw Error('Selection was not retained.');
        } else if (['combobox', 'listbox'].includes(row.role)) {
          const popup = await element.getAttribute('aria-controls') || await element.getAttribute('aria-owns');
          if (!popup || /\s/.test(popup)) throw Error('Dropdown needs one associated popup.');
          if (row.tag === 'BUTTON' && await element.getAttribute('type') !== 'button') throw Error('Potential submit button requires manual action.');
          await safeClick(element, this.timeout);
          if (row.tag === 'INPUT') await element.type(value, { delay: 20, timeout: this.timeout + value.length * 30 });
          const listbox = frame.locator(`[id=${JSON.stringify(popup)}]`);
          const option = listbox.getByRole('option', { name: value, exact: true });
          await option.first().waitFor({ state: 'visible', timeout: this.timeout });
          if (await option.count() !== 1) throw Error('Ambiguous dropdown options.');
          await safeClick(option, this.timeout);
          const actual = await element.evaluate(el => el.getAttribute('aria-valuetext') || el.getAttribute('data-value') || (el.tagName === 'INPUT' ? '' : el.textContent));
          if (!equal(actual, value)) throw Error('Dropdown selection was not retained.');
        } else if (row.type === 'radio' || row.role === 'radiogroup') {
          const groupHandle = await element.evaluateHandle(el => el.getAttribute('role') === 'radiogroup' ? [...el.querySelectorAll('[role="radio"]')] : window.__jfSmartApply.radioGroup(el));
          const all = [...(await groupHandle.getProperties()).values()].map(handle => handle.asElement()).filter(Boolean); const matches = [];
          for (const candidate of all) {
            const data = await candidate.evaluate(el => ({ name: el.name, label: el.getAttribute('aria-label') || [...(el.labels || [])].map(l => l.textContent).join(' ') || el.textContent, value: el.value }));
            if (equal(data.label || data.value, value)) matches.push(candidate);
          }
          if (matches.length !== 1) throw Error('Radio requires one exact matching option.');
          await safeClick(matches[0], this.timeout);
          if (!await matches[0].evaluate(el => el.checked || el.getAttribute('aria-checked') === 'true')) throw Error('Radio selection was not retained.');
        } else if (['INPUT', 'TEXTAREA'].includes(row.tag) && !['submit', 'button', 'password', 'hidden'].includes(row.type)) {
          await element.fill(value, { timeout: this.timeout });
          await element.press('Tab', { timeout: this.timeout });
          if (!equal(await element.inputValue(), value)) throw Error('Value was not retained.');
        } else throw Error('Unsupported widget: complete manually.');
        if (!await element.evaluate(el => !el.checkValidity || el.checkValidity())) throw Error('Site validation requires review.');
        row.outcome = 'verified';
      } catch (error) {
        row.outcome = 'needs_review'; row.reason = error.message;
        if (row.role === 'combobox' && row.tag === 'INPUT') {
          // Clear only our own uncommitted query; never erase an applicant edit.
          try { const pending = await element.inputValue(); const committed = await element.getAttribute('aria-valuetext') || await element.getAttribute('data-value'); if (!committed && pending === row.decision.value) await element.fill(row.before || '', { timeout: this.timeout }); } catch { /* Detached/changed fields remain manual. */ }
        }
      }
    }
    if (this.report.state !== 'STOPPED') this.report.state = 'NEEDS_REVIEW';
    await this.saveReport(); return this.report;
  }
  async saveReport() {
    if (!this.outputDirectory) return;
    fs.mkdirSync(this.outputDirectory, { recursive: true, mode: 0o700 });
    const base = path.join(this.outputDirectory, this.report.id);
    await this.page.screenshot({ path: base + '.png', fullPage: true });
    fs.writeFileSync(base + '.json', JSON.stringify(this.report, null, 2), { mode: 0o600 });
    // Local DOM may contain applicant PII. Never upload or commit these files.
    fs.writeFileSync(base + '.html', await this.page.content(), { mode: 0o600 });
  }
}
module.exports = { SmartApplyEngine, permitted };

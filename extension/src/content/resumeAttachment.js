import { answerScope } from '../utils/formFillerCore.js';

const limit = 10 * 1024 * 1024;
const resumeLabel = /^(?:(?:upload|attach|add|select|choose) (?:your )?)?(?:r[eé]sum[eé]|cv|curriculum vitae)(?:\s*(?:\/|or)\s*(?:r[eé]sum[eé]|cv|curriculum vitae))?(?:\s*\([^)]*\))?\s*[:*]?$/i;
const filenamePattern = /\.pdf(?:\s|$)/i;

function nearbyResumeLabel(input) {
  const own = [...input.labels].map(label => label.textContent.trim());
  const refs = (input.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  const aria = input.getAttribute('aria-label') || refs.map(id => input.ownerDocument.getElementById(id)?.textContent.trim() || '').join(' ');
  for (let node = input.parentElement, depth = 0; node && depth < 5 && !node.matches('form, main, body'); node = node.parentElement, depth++) {
    if (node.querySelectorAll('input[type="file"]').length !== 1) break;
    const nearby = [...node.querySelectorAll('label, legend')].map(label => label.textContent.trim());
    if ([...own, aria, ...nearby].some(label => resumeLabel.test(label))) return node;
  }
  return null;
}

export function findResumeTarget(document) {
  const candidates = [];
  for (const input of document.querySelectorAll('input[type="file"]')) {
    if (input.disabled) continue;
    const accepted = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
    if (accepted.length && !accepted.some(value => ['.pdf', 'application/pdf', 'application/*', '*/*'].includes(value))) continue;
    const wrapper = nearbyResumeLabel(input);
    if (!wrapper || wrapper.closest('[hidden], [aria-hidden="true"], [inert]') || !wrapper.getClientRects().length) continue;
    candidates.push({ input, wrapper, scope: answerScope(input) });
  }
  if (candidates.length !== 1) throw new Error('Could not identify one resume field that accepts PDF. Use the form’s upload control.');
  return candidates[0];
}

export async function attachReviewedResume(document, request) {
  const { input, wrapper, scope } = findResumeTarget(document);
  if (scope !== request.scope || document.location.href !== request.url) throw new Error('The form changed. Choose your PDF for the current form again.');
  if (input.files?.length || filenamePattern.test(wrapper.innerText || ''))
    throw new Error('This form already shows a resume. Check its filename before replacing it.');
  const { name, encoded } = request;
  if (typeof name !== 'string' || name.length > 255 || /[\\/\x00-\x1f]/.test(name) || !/\.pdf$/i.test(name) ||
      typeof encoded !== 'string' || encoded.length > Math.ceil(limit / 3) * 4) throw new Error('Choose a PDF under 10 MB.');
  const raw = atob(encoded);
  if (raw.length > limit || !raw.startsWith('%PDF-')) throw new Error('The selected file is not a valid PDF.');
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  const win = document.defaultView;
  const files = new win.DataTransfer();
  files.items.add(new win.File([bytes], name, { type: 'application/pdf' }));
  input.files = files.files;
  input.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
  for (let check = 0; check < 10; check++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const visibleFilename = (wrapper.innerText || '').includes(name);
    const selected = input.isConnected && [...input.files].some(file => file.name === name && file.size === bytes.length);
    if (visibleFilename || (selected && check > 1)) return { success: true, name, visibleFilename };
  }
  throw new Error('The site did not show the PDF after selection. Check the form before attaching again.');
}

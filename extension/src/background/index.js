/**
 * Background Service Worker for JobFinder AI Auto-Apply
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('JobFinder AI Auto-Apply extension installed.');
});

// Message listener for coordinating content script, popup, and backend
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'JF_GUARD_SUBMIT') {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0) return false;
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [0] }, world: 'MAIN',
      func: (enabled) => {
        const key = '__jobfinderSubmitGuard';
        if (!enabled) { window[key]?.restore(); return { installed: false }; }
        if (window[key]) return { installed: true };
        const restores = []; const seen = new Set();
        function guard(win) {
          if (seen.has(win)) return; seen.add(win);
          const doc = win.document;
          const block = event => event.preventDefault();
          doc.addEventListener('submit', block, true);
          restores.push(() => doc.removeEventListener('submit', block, true));
          for (const name of ['submit', 'requestSubmit']) {
            const proto = win.HTMLFormElement.prototype;
            const original = Object.getOwnPropertyDescriptor(proto, name);
            Object.defineProperty(proto, name, { configurable: true, writable: true, value() { throw new Error('JobFinder: automatic form submission blocked'); } });
            restores.push(() => Object.defineProperty(proto, name, original));
          }
          for (const frame of doc.querySelectorAll('iframe')) { try { if (frame.contentDocument) guard(frame.contentWindow); } catch { /* Cross-origin forms remain manual. */ } }
        }
        const restore = () => { for (const fn of restores.reverse()) fn(); clearTimeout(window[key]?.timer); delete window[key]; };
        try { guard(window); window[key] = { restore, timer: setTimeout(restore, 300000) }; return { installed: true }; }
        catch (error) { restore(); return { installed: false, error: error.message }; }
      }, args: [request.enabled === true]
    }).then(results => sendResponse({ success: request.enabled === true ? !!results[0]?.result?.installed : true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'FETCH_OTP') {
    sendResponse({ success: false, error: 'Complete OTP/login challenges manually; Smart Apply pauses for you.' });
    return false;
  }

  if (request.action === 'GENERATE_HUMANOID_ANSWER') {
    handleGenerateAnswer(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleGenerateAnswer(request) {
  const { token, backendUrl = 'https://jobfinder-backend.onrender.com' } = await chrome.storage.local.get(['token', 'backendUrl']);
  if (!token) {
    return { success: false, error: 'Not logged in' };
  }

  const res = await fetch(`${backendUrl}/api/mail/generate-form-answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      company: request.company,
      role: request.role,
      question: request.question,
      resumeDetails: request.resumeDetails
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to generate answer');
  return { success: true, answer: data.answer };
}

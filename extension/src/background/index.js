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
    handleFetchOtp(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'GENERATE_HUMANOID_ANSWER') {
    handleGenerateAnswer(request)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * Strategy to fetch OTP:
 * 1. Try Backend IMAP endpoint
 * 2. If backend fails or not logged in, search any open Gmail tab for verification code
 */
async function handleFetchOtp(request) {
  const { token, backendUrl = 'https://jobfinder-backend.onrender.com' } = await chrome.storage.local.get(['token', 'backendUrl']);

  // 1. Try backend IMAP first if logged in
  if (token) {
    try {
      const response = await fetch(`${backendUrl}/api/mail/latest-otp`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (response.ok && data.otp) {
        return { success: true, otp: data.otp, source: 'backend_imap', subject: data.subject };
      }
    } catch (err) {
      console.warn('Backend IMAP OTP fetch failed, attempting Gmail tab fallback:', err);
    }
  }

  // 2. Fallback: Search open Gmail tabs
  try {
    const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
    if (tabs && tabs.length > 0) {
      const gmailTab = tabs[0];
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: gmailTab.id },
        func: () => {
          // Look for recent email subjects / bodies in Gmail DOM
          const textSnippets = [];
          
          // Thread subjects and snippets in inbox list
          document.querySelectorAll('tr.zA, div.h7, div.a3s').forEach(el => {
            textSnippets.push(el.innerText || '');
          });

          const fullText = textSnippets.join(' \n ');
          
          // Regex for OTP / verification codes
          const regexes = [
            /(?:code|otp|verification code|security code|pin)[^\d]{1,15}(\d{4,8})/i,
            /\b(\d{4,8})\b(?=\s*(?:is your verification code|is your OTP|is your security code))/i,
            /\b(\d{6})\b/
          ];

          for (const rx of regexes) {
            const m = fullText.match(rx);
            if (m && m[1]) {
              return m[1];
            }
          }
          return null;
        }
      });

      if (result) {
        return { success: true, otp: result, source: 'gmail_tab' };
      }
    }
  } catch (err) {
    console.error('Gmail tab OTP scraper failed:', err);
  }

  return { 
    success: false, 
    error: 'Could not automatically find an OTP in inbox or open Gmail tabs. Ensure email credentials are saved in settings or keep Gmail open.' 
  };
}

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

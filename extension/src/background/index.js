/**
 * Background Service Worker for JobFinder AI Auto-Apply
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('JobFinder AI Auto-Apply extension installed.');
});

// Tab navigation listener for 1-click & custom link auto-apply triggers
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && (tab.url.includes('jf-autoapply=true') || tab.url.includes('jf-autoapply'))) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'AUTO_FILL_FORM' }, (res) => {
        if (chrome.runtime.lastError) {
          // Handled by content script's self-initialization
        }
      });
    }, 1200);
  }
});

// Message listener for coordinating content script, popup, and backend
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

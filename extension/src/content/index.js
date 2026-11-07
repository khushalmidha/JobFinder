import { FormFillSession, collectFields } from '../utils/formFillerCore.js';

if (!window.__JOBFINDER_INJECTED__) {
  window.__JOBFINDER_INJECTED__ = true;
  const session = new FormFillSession(document);
  let fillBusy = false;
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (request.action === 'ANALYZE_PAGE') {
      respond({ hasForm: collectFields(document).length > 0, formFieldsCount: collectFields(document).length, title: document.title });
    } else if (request.action === 'JF_PREVIEW') {
      if (fillBusy) { respond({ success: false, error: 'Fill already running.' }); return false; }
      chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed', 'candidateProfileVersion']).then(data => {
        if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
        session.profileVersion = data.candidateProfileVersion;
        respond({ success: true, ...session.scan(data.candidateProfile) });
      }).catch(error => respond({ success: false, error: error.message }));
      return true;
    } else if (request.action === 'JF_FILL') {
      if (fillBusy) { respond({ success: false, error: 'Fill already running.' }); return false; }
      fillBusy = true;
      chrome.storage.local.get(['candidateProfileReviewed', 'candidateProfileVersion']).then(data => {
        if (!data.candidateProfileReviewed || session.profileVersion !== data.candidateProfileVersion) throw new Error('Profile changed; save and preview again.');
        return (async () => {
          const guard = await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: true });
          if (!guard?.success) throw new Error('Submission guard unavailable; fill manually.');
          try { return await session.fill(); }
          finally { await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: false }); }
        })();
      }).then(result => respond({ success: true, ...result })).catch(error => respond({ success: false, error: error.message })).finally(() => { fillBusy = false; });
      return true;
    } else if (request.action === 'JF_STOP') {
      session.stop(); respond({ success: true, ...session.report() });
    }
    return false;
  });
}

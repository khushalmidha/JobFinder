import { FormFillSession, collectFields } from '../utils/formFillerCore.js';

if (!window.__JOBFINDER_INJECTED__) {
  window.__JOBFINDER_INJECTED__ = true;
  const session = new FormFillSession(document);
  let fillBusy = false;
  let stopRequested = false;
  let latestRun = null;
  const status = () => ({ success: true, running: fillBusy, result: latestRun });
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (request.action === 'ANALYZE_PAGE') {
      respond({ hasForm: collectFields(document).length > 0, formFieldsCount: collectFields(document).length, title: document.title });
    } else if (request.action === 'JF_STATUS') {
      respond(status());
    } else if (request.action === 'JF_PREVIEW') {
      if (fillBusy) { respond({ success: false, error: 'Fill already running.' }); return false; }
      chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed', 'candidateProfileVersion']).then(data => {
        if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
        session.profileVersion = data.candidateProfileVersion;
        respond({ success: true, ...session.scan(data.candidateProfile) });
      }).catch(error => respond({ success: false, error: error.message }));
      return true;
    } else if (request.action === 'JF_FILL' || request.action === 'JF_START_FILL') {
      const detached = request.action === 'JF_START_FILL';
      if (fillBusy) {
        respond(detached ? status() : { success: false, error: 'Fill already running.' });
        return false;
      }
      fillBusy = true;
      latestRun = null;
      stopRequested = false;
      const run = async () => {
        const data = await chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed', 'candidateProfileVersion']);
        const start = detached;
        if (!start && (!data.candidateProfileReviewed || session.profileVersion !== data.candidateProfileVersion)) throw new Error('Profile changed; save and preview again.');
        if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
        const guard = await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: true });
        if (!guard?.success) throw new Error('Submission guard unavailable; fill manually.');
        try {
          if (stopRequested) return session.report();
          if (start) {
            session.profileVersion = data.candidateProfileVersion;
            return await session.fillStep(data.candidateProfile);
          }
          return await session.fill();
        } finally {
          await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: false });
        }
      };
      const finish = result => {
        latestRun = result;
        fillBusy = false;
        if (!detached) respond(result);
      };
      void run().then(
        result => finish({ success: true, ...result }),
        error => finish({ success: false, error: error.message })
      );
      if (detached) { respond(status()); return false; }
      return true;
    } else if (request.action === 'JF_STOP') {
      stopRequested = true;
      session.stop(); respond(status());
    }
    return false;
  });
}

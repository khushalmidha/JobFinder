import { FormFillSession, collectFields, extractQuestionContext } from '../utils/formFillerCore.js';

import { createFormNotice } from './formNotice.js';

if (!window.__JOBFINDER_INJECTED__) {
  window.__JOBFINDER_INJECTED__ = true;
  const session = new FormFillSession(document);
  let fillBusy = false;
  let stopRequested = false;
  let latestRun = null;
  const status = () => ({ success: true, running: fillBusy, result: latestRun });
  const notice = createFormNotice(
    () => startFill(true, () => {}),
    () => {
      const row = session.rows.find(item => item.element.isConnected &&
        (item.action === 'needs_review' || item.outcome === 'needs_review'));
      row?.element.scrollIntoView({ block: 'center' });
      row?.element.focus({ preventScroll: true });
    }
  );
  function startFill(detached, respond) {
    if (fillBusy) {
      respond(detached ? status() : { success: false, error: 'Fill already running.' });
      return false;
    }
    fillBusy = true;
    latestRun = null;
    stopRequested = false;
    notice.show('Filling supported fields in this tab…', null, { fresh: true });
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
      if (result.success) {
        const preserved = result.fields.filter(row => row.action === 'preserve' && row.outcome !== 'filled').length;
        const text = result.state === 'STOPPED' ? 'Filling stopped.' :
          `${result.filledCount} filled · ${preserved} already entered · ${result.needsReviewCount} to review`;
        notice.show(text, result.needsReviewCount ? 'review' : null);
      } else {
        notice.show('Open Smart Apply in the toolbar to check the profile or form.', null);
      }
      if (!detached) respond(result);
    };
    void run().then(
      result => finish({ success: true, ...result }),
      error => finish({ success: false, error: error.message })
    );
    if (detached) { respond(status()); return false; }
    return true;
  }
  function offerFill() {
    if (fillBusy || latestRun) return true;
    const fields = collectFields(document).map(extractQuestionContext);
    const labels = fields.map(field => field.labelText).join(' ');
    if (location.hostname !== 'binary.so' &&
        !/application|apply|careers|intern|engineer|job/i.test(document.title + ' ' + (document.querySelector('h1')?.textContent || ''))) return false;
    if (fields.length < 3 || !/name|email|phone|resume|résumé|degree|work experience/i.test(labels)) return false;
    notice.show('Fill supported fields from your reviewed profile?', 'fill', { fresh: true });
    return true;
  }
  chrome.storage.local.get('candidateProfileReviewed').then(({ candidateProfileReviewed }) => {
    if (!candidateProfileReviewed || offerFill()) return;
    // Client-rendered portals may add the form shortly after document_idle.
    let checks = 0;
    const timer = setInterval(() => { if (offerFill() || ++checks >= 10) clearInterval(timer); }, 750);
  }).catch(() => { /* Extension reloaded while this document was open. */ });

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
      return startFill(request.action === 'JF_START_FILL', respond);
    } else if (request.action === 'JF_STOP') {
      stopRequested = true;
      session.stop(); respond(status());
    }
    return false;
  });
}

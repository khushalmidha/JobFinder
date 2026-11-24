import { FormFillSession, collectFields, extractQuestionContext } from '../utils/formFillerCore.js';

import { createFormNotice } from './formNotice.js';
import { perceptionApplicationDraft } from '../utils/perceptionApplicationDraft.js';
import { attachReviewedResume, findResumeTarget } from './resumeAttachment.js';

const version = chrome.runtime.getManifest().version;
if (window.__JOBFINDER_INJECTED__ !== version) {
  window.__JOBFINDER_INJECTED__ = version;
  document.querySelector('[data-jobfinder-ui]')?.remove();
  const session = new FormFillSession(document, perceptionApplicationDraft);
  let fillBusy = false;
  let stopRequested = false;
  let latestRun = null;
  let progress = null;
  const status = () => ({ success: true, running: fillBusy, result: latestRun, progress });
  function showProgress(current) {
    progress = current;
    const checked = current?.total ? `${current.checked} of ${current.total} fields checked` : 'Scanning this form…';
    const label = current?.label?.trim().slice(0, 85);
    notice.show({
      title: 'Smart Apply · Filling',
      phase: 'running',
      text: label ? `${checked} · ${label}` : checked,
      progress: current,
      fresh: !current
    });
  }
  const notice = createFormNotice(
    () => startFill(true, () => {}),
    () => {
      const row = session.rows.find(item => item.element.isConnected &&
        (item.action === 'needs_review' || item.outcome === 'needs_review' || item.decision.type === 'REVIEW_DRAFT'));
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
    showProgress(null);
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
          return await session.fillStep(data.candidateProfile, showProgress);
        }
        return await session.fill(showProgress);
      } finally {
        await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: false });
      }
    };
    const finish = result => {
      latestRun = result;
      fillBusy = false;
      progress = null;
      if (result.success) {
        const preserved = result.fields.filter(row => row.action === 'preserve' && row.outcome !== 'filled').length;
        const counts = `${result.filledCount} filled · ${preserved} already entered · ${result.needsReviewCount} to review`;
        if (result.state === 'STOPPED') {
          notice.show({ title: 'Smart Apply · Stopped', phase: 'review', text: counts, nextAction: 'fill' });
        } else if (!result.fields.length) {
          notice.show({ title: 'Smart Apply · No fields found', phase: 'review',
            text: 'Open the application form and try again.', nextAction: 'fill' });
        } else {
          notice.show({ title: result.needsReviewCount || result.rescanRequired ? 'Fill done · Review needed' : 'Fill done',
            phase: result.needsReviewCount || result.rescanRequired ? 'review' : 'done',
            text: counts, nextAction: result.needsReviewCount ? 'review' : null });
        }
      } else {
        notice.show({ title: 'Smart Apply · Could not fill', phase: 'error', text: result.error, nextAction: 'fill' });
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
    notice.show({ title: 'Smart Apply · Ready', phase: 'ready', text: 'Fill supported fields from your reviewed profile?', nextAction: 'fill', fresh: true });
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
    } else if (request.action === 'JF_RESUME_TARGET') {
      const url = location.href;
      const readTarget = async () => {
        for (let attempt = 0; ; attempt++) {
          if (location.href !== url) throw new Error('The form changed. Choose the PDF again.');
          try {
            return { success: true, scope: findResumeTarget(document).scope, url };
          } catch (error) {
            if (attempt === 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 120));
          }
        }
      };
      void readTarget().then(respond, error => respond({ success: false, error: error.message }));
      return true;
    } else if (request.action === 'JF_ATTACH_RESUME') {
      if (fillBusy) { respond({ success: false, error: 'Wait for the current fill to finish.' }); return false; }
      fillBusy = true;
      const attach = async () => {
        const guard = await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: true });
        if (!guard?.success) throw new Error('Submission guard unavailable. Use the form’s upload control.');
        try {
          return await attachReviewedResume(document, request);
        } finally {
          await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: false });
        }
      };
      const finish = result => { fillBusy = false; respond(result); };
      void attach().then(finish, error => finish({ success: false, error: error.message }));
      return true;
    } else if (request.action === 'JF_READ_CHOICES') {
      if (fillBusy) { respond({ success: false, error: 'Fill already running.' }); return false; }
      fillBusy = true;
      const read = async () => {
        const data = await chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed', 'candidateProfileVersion']);
        if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
        const guard = await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: true });
        if (!guard?.success) throw new Error('Submission guard unavailable. Read the choices directly on the form.');
        try {
          const report = await session.readChoices(request.scope, data.candidateProfile);
          session.profileVersion = data.candidateProfileVersion;
          return { success: true, ...report };
        } finally {
          await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: false });
        }
      };
      const finish = result => { fillBusy = false; respond(result); };
      void read().then(finish, error => finish({ success: false, error: error.message }));
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

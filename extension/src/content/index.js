import { FormFillSession, collectFields, extractQuestionContext, profileLinkField, submittedFieldValue } from '../utils/formFillerCore.js';

import { createFormNotice } from './formNotice.js';
import { perceptionApplicationDraft } from '../utils/perceptionApplicationDraft.js';
import { resumeBulletDraft } from '../utils/resumeAnswerDraft.js';
import { attachReviewedResume, findResumeTarget } from './resumeAttachment.js';
import { readApplicantFormDetails, readSmartApplyPreferences, rememberProfileLink } from '../utils/profileMemory.js';

import { draftFacts, draftQuestion, draftSettingsKey } from '../utils/fieldDraftProviders.js';
import { captureSubmittedAnswers, memoryIdentity, reusableAnswer, submissionKey, submissionPreference } from '../utils/submissionMemory.js';

const version = chrome.runtime.getManifest().version;
if (window.__JOBFINDER_INJECTED__ !== version) {
  window.__JOBFINDER_INJECTED__ = version;
  document.querySelector('[data-jobfinder-ui]')?.remove();
  const session = new FormFillSession(document, (context, profile, el, committed) => {
    const tailored = perceptionApplicationDraft(context, profile, el, committed);
    if (tailored) return tailored;
    const bullets = resumeBulletDraft(context, profile);
    return bullets ? { value: bullets.answer, source: bullets.sources.join(', ') } : null;
  });
  let fillBusy = false;
  let stopRequested = false;
  let latestRun = null;
  let progress = null;
  let activeProfile = null;
  let submitGesture = null;
  const editedLinks = new WeakSet();
  document.addEventListener('click', event => {
    if (!event.isTrusted || fillBusy || activeProfile?.url !== location.href) return;
    const button = event.target.closest?.('button, input[type="submit"]');
    const label = button?.getAttribute('aria-label') || button?.value || button?.textContent || '';
    if (button?.form && /submit|apply|finish|send application/i.test(label) && !/next|continue|review|save|draft/i.test(label))
      submitGesture = { button, time: Date.now() };
  }, true);
  document.addEventListener('submit', event => {
    const active = activeProfile;
    const gesture = submitGesture;
    submitGesture = null;
    if (!event.isTrusted || fillBusy || !active?.learning || active.url !== location.href || gesture?.button !== event.submitter ||
        !gesture || Date.now() - gesture.time > 1200 || !(event.target instanceof HTMLFormElement)) return;
    const entries = captureSubmittedAnswers(event.target, active.profile, submittedFieldValue);
    if (!entries.length) return;
    const reusable = entries.filter(([key]) => reusableAnswer(key));
    void chrome.storage.local.get(active.reusableKey).then(data => {
      const previous = Array.isArray(data[active.reusableKey]) ? data[active.reusableKey] : [];
      return chrome.storage.local.set({
        [active.memoryKey]: entries,
        ...(reusable.length ? { [active.reusableKey]: [...new Map([...previous, ...reusable])].slice(-40) } : {})
      });
    }).catch(() => {});
  }, true);
  const learnInput = event => {
    const input = event.target;
    if (activeProfile?.rememberLinks && activeProfile.url === location.href && event.isTrusted && input?.tagName === 'INPUT' &&
        profileLinkField(extractQuestionContext(input))) editedLinks.add(input);
  };
  const learnChange = event => {
    const input = event.target;
    if (activeProfile?.url !== location.href || !event.isTrusted || !editedLinks.delete(input)) return;
    const kind = profileLinkField(extractQuestionContext(input));
    if (kind) void rememberProfileLink(kind, input.value, activeProfile.owner).then(saved => {
      if (saved && activeProfile?.url === location.href) notice.feedback('Profile link saved for future forms.');
    }).catch(() => {});
  };
  document.addEventListener('input', learnInput, true);
  document.addEventListener('change', learnChange, true);
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
    const url = location.href;
    notice.feedback('');
    showProgress(null);
    const run = async () => {
      const data = await readSmartApplyPreferences(detached);
      const start = detached;
      if (!start && (!data.candidateProfileReviewed || session.profileVersion !== data.candidateProfileVersion)) throw new Error('Profile changed; save and preview again.');
      if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
      const memoryKey = data.owner && globalThis.crypto?.subtle ? await submissionKey(data.owner, url) : '';
      const reusableKey = memoryKey ? await submissionKey(data.owner) : '';
      const keys = [submissionPreference, draftSettingsKey, ...(memoryKey ? [memoryKey, reusableKey] : [])];
      const preferences = await chrome.storage.local.get(keys);
      activeProfile = data.owner ? { url, owner: data.owner, profile: data.profile, memoryKey, reusableKey,
        learning: !!memoryKey && preferences[submissionPreference] !== false, rememberLinks: data.rememberLinks } : null;
      session.submitted = new Map(activeProfile?.learning
        ? [reusableKey, memoryKey].flatMap(key => Array.isArray(preferences[key]) ? preferences[key] : [])
        : []);
      session.memoryIdentity = memoryIdentity;
      session.generated = new Map();
      const guard = await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: true });
      if (!guard?.success) throw new Error('Submission guard unavailable; fill manually.');
      try {
        if (stopRequested) return session.report();
        if (start) {
          session.profileVersion = data.candidateProfileVersion;
          let report = await session.fillStep(data.profile, showProgress);
          if (preferences[draftSettingsKey]?.enabled && !stopRequested && location.href === url) {
            const targets = session.rows.filter(row => row.action === 'needs_review' &&
              ['WRITTEN_ANSWER', 'UNKNOWN_REQUIRED', 'UNMATCHED_OPTIONAL'].includes(row.decision.type))
              .flatMap(row => {
                const question = draftQuestion(row.context, row.id);
                return question ? [{ row, question }] : [];
              }).slice(0, 12);
            const facts = draftFacts(data.profile);
            if (targets.length && facts.length) {
              notice.feedback('Drafting remaining professional questions…');
              let result;
              try {
                result = await chrome.runtime.sendMessage({ action: 'JF_DRAFT_FIELDS', questions: targets.map(target => target.question), facts });
              } catch { result = { errors: ['AI drafts unavailable'] }; }
              if (stopRequested || location.href !== url) return session.report();
              for (const draft of result?.answers || []) {
                const target = targets.find(item => item.question.id === draft.id);
                if (target) session.generated.set(target.row.context.scope, { value: draft.answer, source: draft.source });
              }
              if (session.generated.size) {
                const prior = new Map(session.rows.filter(row => row.outcome === 'filled').map(row => [row.context.scope, row]));
                report = await session.fillStep(data.profile, showProgress, prior);
              }
              const message = result?.errors?.join(' · ');
              report.aiStatus = session.generated.size ? 'AI drafts inserted for review.' : message || 'AI found no grounded drafts.';
            }
          }
          if (data.defaultResume && !stopRequested && location.href === url) {
            let target;
            try { target = findResumeTarget(document); } catch { /* This step may have no accessible resume control. */ }
            if (target) {
              try {
                const result = await attachReviewedResume(document, { ...data.defaultResume, scope: target.scope, url });
                report.resumeStatus = result.visibleFilename ? `Resume on form: ${result.name}` : `Resume selected: ${result.name}. Check upload status.`;
              } catch (error) { report.resumeStatus = error.message; }
            }
          }
          return report;
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
        if (result.resumeStatus || result.aiStatus) notice.feedback([result.resumeStatus, result.aiStatus].filter(Boolean).join(' · '));
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
    } else if (request.action === 'JF_READ_FORM_DETAILS') {
      if (fillBusy) respond({ success: false, error: 'Wait for the current fill to finish.' });
      else respond({ success: true, details: readApplicantFormDetails(document) });
    } else if (request.action === 'JF_PREVIEW') {
      if (fillBusy) { respond({ success: false, error: 'Fill already running.' }); return false; }
      readSmartApplyPreferences().then(data => {
        if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
        session.profileVersion = data.candidateProfileVersion;
        respond({ success: true, ...session.scan(data.profile) });
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
        const data = await readSmartApplyPreferences();
        if (!data.candidateProfileReviewed || !data.candidateProfile) throw new Error('Review and save your candidate profile first.');
        const guard = await chrome.runtime.sendMessage({ action: 'JF_GUARD_SUBMIT', enabled: true });
        if (!guard?.success) throw new Error('Submission guard unavailable. Read the choices directly on the form.');
        try {
          const report = await session.readChoices(request.scope, data.profile);
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

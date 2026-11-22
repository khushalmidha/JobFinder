import React, { useEffect, useState } from 'react';
import { normalizeProfile, rememberAnswer } from '../utils/candidateProfile.js';
import { formDraftPayload } from '../utils/formDraftPayload.js';

const exampleProfile = { fullName: '', firstName: '', lastName: '', email: '', phoneRaw: '', college: '', degree: '', major: '', cgpa: '', graduationYear: '', location: { city: '', state: '', country: '' }, links: { github: '', linkedin: '', portfolio: '' }, provenance: {}, supportingEvidence: [], companyFacts: [] };

export const AutoApplyPanel = ({ token, backendUrl }) => {
  const [profileText, setProfileText] = useState(JSON.stringify(exampleProfile, null, 2));
  const [confirmed, setConfirmed] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [answerDraft, setAnswerDraft] = useState(null);
  const [factSelections, setFactSelections] = useState([]);
  const [companyFactSelection, setCompanyFactSelection] = useState('');
  let evidence = [];
  let companyFacts = [];
  try { const profile = normalizeProfile(JSON.parse(profileText)); evidence = profile.supportingEvidence.filter(fact => typeof fact.text === 'string' && fact.text.length <= 500 && fact.source); companyFacts = (profile.companyFacts || []).filter(fact => typeof fact.text === 'string' && fact.text.length <= 500 && /^https?:\/\//.test(fact.source)); } catch { /* JSON editor may be incomplete. */ }
  useEffect(() => {
    chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed']).then(data => {
      if (data.candidateProfile) setProfileText(JSON.stringify(data.candidateProfile, null, 2));
      setConfirmed(!!data.candidateProfileReviewed);
    });
  }, []);
  async function saveProfile() {
    try {
      const profile = normalizeProfile(JSON.parse(profileText));
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Enter a profile object.');
      if (!confirmed) throw new Error('Confirm the profile facts before saving.');
      await chrome.storage.local.set({ candidateProfile: profile, candidateProfileReviewed: true, candidateProfileVersion: Date.now() });
      setReport(null); setError('Profile saved locally. Preview the current step.');
    } catch (err) { setError(err.message); }
  }
  async function importProfile(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 1024 * 1024) throw new Error('Profile JSON must be under 1 MB.');
      const profile = normalizeProfile(JSON.parse(await file.text()));
      setProfileText(JSON.stringify(profile, null, 2)); setConfirmed(false); setReport(null);
      await chrome.storage.local.set({ candidateProfileReviewed: false });
      setError('Imported locally. Review the facts and save before filling.');
    } catch (err) { setError(err.message); }
  }
  async function saveAnswer(field, value) {
    try {
      const data = await chrome.storage.local.get(['candidateProfile']);
      const profile = normalizeProfile(data.candidateProfile || {});
      profile.answers_bank = rememberAnswer(profile.answers_bank, { question: field.context.labelText,
        type: field.context.inputType, options: field.context.options || [], scope: field.context.scope || '', answer: value, approved: true });
      await chrome.storage.local.set({ candidateProfile: profile, candidateProfileVersion: Date.now() });
      setProfileText(JSON.stringify(profile, null, 2)); setReport(null); setError('Answer saved for this question and site. Preview again.');
    } catch (err) { setError(err.message); }
  }
  async function command(action) {
    setBusy(true); setError('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open an online application form first.');
      if (/(^|\.)linkedin\.com$/i.test(new URL(tab.url).hostname)) throw new Error('LinkedIn is manual only.');
      const response = await chrome.tabs.sendMessage(tab.id, { action }, { frameId: 0 });
      if (!response?.success) throw new Error(response?.error || 'Reload this page after updating the extension.');
      setReport(response);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function draftAnswer() {
    setBusy(true); setError('');
    try {
      const saved = await chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed']);
      if (!saved.candidateProfileReviewed) throw new Error('Save a reviewed profile with supportingEvidence first.');
      const approvedFacts = evidence.filter(fact => factSelections.includes(JSON.stringify([fact.text, fact.source])));
      if (!approvedFacts.length || approvedFacts.length > 5) throw new Error('Select 1–5 reviewed resume facts for this question.');
      const response = await fetch(`${backendUrl}/api/mail/generate-form-answers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formDraftPayload({ question, company, role, supportingEvidence: approvedFacts, companyFacts: companyFacts.filter(fact => companyFactSelection === JSON.stringify([fact.text, fact.source])) }))
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setAnswerDraft(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="space-y-3 p-3 text-sm">
    <h2 className="font-bold text-lg">Application assistant</h2>
    <p>Review your profile, preview this step, then fill. Salary, consent, work authorization, written answers and resume PDF upload need your review.</p>
    <details><summary className="cursor-pointer">Edit candidate profile</summary>
      <label className="block">Import resume profile JSON <input type="file" accept="application/json,.json" onChange={importProfile} /></label>
      <p>Use only facts confirmed from your selected resume. Saved in this browser. Empty facts stay unanswered.</p>
      <textarea aria-label="Candidate profile JSON" rows={12} className="w-full p-2 bg-zinc-900 font-mono" value={profileText} onChange={e => { setProfileText(e.target.value); setConfirmed(false); setReport(null); chrome.storage.local.set({ candidateProfileReviewed: false }); }} />
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed these facts against my selected resume.</label>
      <button type="button" className="p-2 border rounded" onClick={saveProfile}>Save reviewed profile</button>
    </details>
    <div className="flex gap-2">
      <button type="button" className="p-2 border rounded" disabled={busy} onClick={() => command('JF_PREVIEW')}>Preview current step</button>
      <button type="button" className="p-2 bg-yellow-500 text-black rounded" disabled={busy || report?.state !== 'PLAN'} onClick={() => command('JF_FILL')}>Fill current step</button>
      <button type="button" className="p-2 border rounded" onClick={() => command('JF_STOP')}>Stop</button>
    </div>
    {error && <p role="status">{error}</p>}
    {report && <div aria-live="polite"><p>{report.state} · {report.filledCount || 0} verified fills · {report.needsReviewCount || 0} need review</p>
      <ul>{report.fields?.map(field => <li key={field.id} className="py-2 border-b border-zinc-700">
        <strong>{field.context.labelText}</strong>: {field.outcome || field.action}
        {field.action === 'fill' && <span> → {field.decision.value} ({field.decision.source})</span>}
        <p>{field.reason || field.decision.reason}</p>
        {field.action === 'needs_review' && !['LEGAL_CONSENT_OR_TERMS', 'VERIFICATION', 'MANUAL_UPLOAD'].includes(field.decision.type) && <AnswerEditor field={field} onSave={saveAnswer} />}
      </li>)}</ul>
    </div>}
    <details><summary>Draft a written answer</summary>
      <p>Add supportingEvidence entries (text and resume source) to your reviewed profile. Company reasons also need companyFacts entries with a public source URL.</p>
      <p>Select up to five facts to send to your configured JobFinder backend. Contact details and saved answers are excluded.</p>
      {evidence.map((fact, index) => { const key = JSON.stringify([fact.text, fact.source]); return <label key={index} className="block"><input type="checkbox" checked={factSelections.includes(key)} onChange={event => setFactSelections(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))} /> {fact.text}</label>; })}
      <label>Optional cited company fact<select aria-label="Company fact to share" value={companyFactSelection} onChange={event => setCompanyFactSelection(event.target.value)}><option value="">None</option>{companyFacts.map((fact, index) => <option key={index} value={JSON.stringify([fact.text, fact.source])}>{fact.text}</option>)}</select></label>
      <input aria-label="Target company" className="w-full p-2 bg-zinc-900" placeholder="Target company" value={company} onChange={e => setCompany(e.target.value)} />
      <input aria-label="Target role" className="w-full p-2 bg-zinc-900" placeholder="Target role" value={role} onChange={e => setRole(e.target.value)} />
      <select aria-label="Detected written question" className="w-full p-2 bg-zinc-900" value={question} onChange={e => setQuestion(e.target.value)}><option value="">Choose a detected question</option>{report?.fields?.filter(f => f.decision.type === 'WRITTEN_ANSWER').map(f => <option key={f.id} value={f.context.labelText}>{f.context.labelText}</option>)}</select>
      <textarea aria-label="Actual application question" className="w-full p-2 bg-zinc-900" value={question} onChange={e => setQuestion(e.target.value)} />
      <button type="button" className="p-2 border rounded" disabled={busy || !question || !token} onClick={draftAnswer}>Draft from confirmed facts</button>
      {answerDraft && <div><textarea aria-label="Review written answer" rows={6} className="w-full p-2 bg-zinc-900" value={answerDraft.answer} onChange={e => setAnswerDraft({ ...answerDraft, answer: e.target.value })} /><p>{answerDraft.uncertainty?.join(' ')}</p><button type="button" disabled={!answerDraft.answer} onClick={() => navigator.clipboard.writeText(answerDraft.answer)}>Copy reviewed answer</button><p>Review and paste into the matching question manually.</p></div>}
    </details>
    <details><summary>Saved answers (editable in profile JSON)</summary><pre className="whitespace-pre-wrap">{(() => { try { return JSON.stringify(JSON.parse(profileText).answers_bank || [], null, 2); } catch { return 'Fix profile JSON first.'; } })()}</pre></details>
    <p>Review the page before using its navigation or submit controls. Cross-origin frames and unsupported controls may require manual completion.</p>
  </section>;
};

function AnswerEditor({ field, onSave }) {
  const [value, setValue] = useState('');
  return <div><input aria-label={`Answer: ${field.context.labelText}`} className="w-full p-2 bg-zinc-900" value={value} onChange={event => setValue(event.target.value)} />
    <button type="button" disabled={!value.trim()} onClick={() => onSave(field, value)}>Approve & remember this answer</button></div>;
}

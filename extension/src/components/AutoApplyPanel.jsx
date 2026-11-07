import React, { useEffect, useState } from 'react';

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
  useEffect(() => {
    chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed']).then(data => {
      if (data.candidateProfile) setProfileText(JSON.stringify(data.candidateProfile, null, 2));
      setConfirmed(!!data.candidateProfileReviewed);
    });
  }, []);
  async function saveProfile() {
    try {
      const profile = JSON.parse(profileText);
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Enter a profile object.');
      if (!confirmed) throw new Error('Confirm the profile facts before saving.');
      await chrome.storage.local.set({ candidateProfile: profile, candidateProfileReviewed: true, candidateProfileVersion: Date.now() });
      setReport(null); setError('Profile saved locally. Preview the current step.');
    } catch (err) { setError(err.message); }
  }
  async function command(action) {
    setBusy(true); setError('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open an online application form first.');
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
      const response = await fetch(`${backendUrl}/api/mail/generate-form-answers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, company, role, resumeDetails: { ...saved.candidateProfile, confirmed: true } })
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setAnswerDraft(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="space-y-3 p-3 text-sm">
    <h2 className="font-bold text-lg">Application assistant</h2>
    <p>Review your profile, preview this step, then fill. Salary, consent, work authorization, written answers and resume PDF upload need your review.</p>
    <details><summary className="cursor-pointer">Edit candidate profile</summary>
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
      </li>)}</ul>
    </div>}
    <details><summary>Draft a written answer</summary>
      <p>Add supportingEvidence entries (text and resume source) to your reviewed profile. Company reasons also need companyFacts entries with a public source URL.</p>
      <input aria-label="Target company" className="w-full p-2 bg-zinc-900" placeholder="Target company" value={company} onChange={e => setCompany(e.target.value)} />
      <input aria-label="Target role" className="w-full p-2 bg-zinc-900" placeholder="Target role" value={role} onChange={e => setRole(e.target.value)} />
      <select aria-label="Detected written question" className="w-full p-2 bg-zinc-900" value={question} onChange={e => setQuestion(e.target.value)}><option value="">Choose a detected question</option>{report?.fields?.filter(f => f.decision.type === 'WRITTEN_ANSWER').map(f => <option key={f.id} value={f.context.labelText}>{f.context.labelText}</option>)}</select>
      <textarea aria-label="Actual application question" className="w-full p-2 bg-zinc-900" value={question} onChange={e => setQuestion(e.target.value)} />
      <button type="button" className="p-2 border rounded" disabled={busy || !question || !token} onClick={draftAnswer}>Draft from confirmed facts</button>
      {answerDraft && <div><textarea aria-label="Review written answer" rows={6} className="w-full p-2 bg-zinc-900" value={answerDraft.answer} onChange={e => setAnswerDraft({ ...answerDraft, answer: e.target.value })} /><p>{answerDraft.uncertainty?.join(' ')}</p><button type="button" disabled={!answerDraft.answer} onClick={() => navigator.clipboard.writeText(answerDraft.answer)}>Copy reviewed answer</button><p>Review and paste into the matching question manually.</p></div>}
    </details>
    <p>Review the page before using its navigation or submit controls. Cross-origin frames and unsupported controls may require manual completion.</p>
  </section>;
};

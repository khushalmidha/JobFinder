import React, { useEffect, useState } from 'react';
import api from '../services/api';

export default function Research() {
  const [status, setStatus] = useState('qualified');
  const [data, setData] = useState({ companies: [], counts: {} });
  const [detail, setDetail] = useState(null);
  const [jobId, setJobId] = useState('');
  const [contactId, setContactId] = useState('');
  const [name, setName] = useState('');
  const [resumeLink, setResumeLink] = useState('');
  const [highlight, setHighlight] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState(null);
  const [budget, setBudget] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    let active = true;
    Promise.all([api.get(`/research/companies?status=${status}`), api.get('/research/budget'), api.get('/research/drafts'), api.get('/research/queue')])
      .then(([c,b,d,q]) => { if (active) { setData(c.data); setBudget(b.data); setDrafts(d.data); setTasks(q.data); } })
      .catch(e => { if (active) setMessage(e.response?.data?.error || e.message); });
    return () => { active = false; };
  }, [status]);
  async function run(fn) {
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }
  async function selectCompany(companyId) {
    setDetail(null); setDraft(null); setJobId(''); setContactId('');
    const { data: result } = await api.get(`/research/companies/${companyId}`);
    setDetail(result);
  }
  async function discover() {
    const companyId = detail.company._id;
    const result = await api.post(`/research/companies/${companyId}/discover`);
    await selectCompany(companyId);
    setMessage(result.data.reason || `Found ${result.data.totalFound} sourced contacts. Individual mailbox existence remains unverified.`);
    setBudget((await api.get('/research/budget')).data);
  }
  async function createDraft() {
    const { data: result } = await api.post('/research/drafts', { companyId: detail.company._id, jobId, contactId,
      candidate: { name, resumeLink, confirmed, highlights: [{ text: highlight, source: resumeLink }] } });
    setDraft(result); setDrafts((await api.get('/research/drafts')).data);
  }
  async function saveDraft() {
    setDraft((await api.patch(`/research/drafts/${draft._id}`, { subject: draft.subject, body: draft.body, reviewed: true })).data);
    setMessage('Reviewed draft saved. No email sent.'); setDrafts((await api.get('/research/drafts')).data);
  }
  const [importJson, setImportJson] = useState('');
  const [validationPreview, setValidationPreview] = useState(null);
  const [showImporter, setShowImporter] = useState(false);

  async function handleValidateEvidence() {
    if (!importJson.trim()) return setMessage('Please paste salary evidence JSON to validate.');
    try {
      const parsed = JSON.parse(importJson);
      const res = await api.post('/research/evidence/validate', parsed);
      setValidationPreview(res.data.results);
      setMessage(`Validated ${res.data.validatedCount} company evidence record(s).`);
    } catch (e) {
      setMessage(`Invalid JSON or validation error: ${e.response?.data?.error || e.message}`);
    }
  }

  async function handleImportEvidence() {
    if (!validationPreview || validationPreview.length === 0) return setMessage('Validate evidence before importing.');
    try {
      const res = await api.post('/research/evidence/import', validationPreview);
      setMessage(`Successfully imported ${res.data.importedTotal} salary evidence items across ${res.data.importedCompanies?.length || 0} companies.`);
      setValidationPreview(null);
      setImportJson('');
      // Refresh companies list
      const c = await api.get(`/research/companies?status=${status}`);
      setData(c.data);
    } catch (e) {
      setMessage(`Import failed: ${e.response?.data?.error || e.message}`);
    }
  }

  const field = 'w-full bg-zinc-900 border border-zinc-700 rounded p-3';
  return <main className="p-8 space-y-6 max-w-6xl mx-auto">
    <div><h1 className="text-3xl font-bold text-white">Recruitment research</h1><p className="text-zinc-400 mt-2">Source-backed fixed base above ₹15 LPA → relevant opening → professional contact → reviewed draft.</p></div>
    <div className="flex flex-wrap gap-3">{Object.entries(data.counts).map(([key,count]) => <span key={key} className="rounded border border-zinc-700 px-3 py-2">{key.replaceAll('_',' ')}: {count}</span>)}</div>
    {budget && <section className="p-4 border border-zinc-700 rounded space-y-2">
      <p>Research {budget.globalStop || budget.policy.stopped ? 'stopped' : 'available on demand'} · Paid providers {budget.policy.paidProvidersEnabled ? 'enabled' : 'off'} · Credit cap: {budget.policy.monthlyCredits} / month · Requests: {budget.policy.dailyRequests} / day</p>
      <button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={() => run(async () => { await api.put('/research/budget', { stopped: !budget.policy.stopped }); setBudget((await api.get('/research/budget')).data); })}>{budget.policy.stopped ? 'Resume research' : 'Stop research'}</button>
      <details><summary>Reserved usage (includes failed and cached attempts)</summary>{budget.usage.map(u => <p key={u._id}>{u.key}: {u.reserved}</p>)}</details>
    </section>}
    <section className="p-4 border border-zinc-700 rounded space-y-2"><p>Local research queue · {tasks.length} checkpointed tasks</p>
      <button type="button" className="p-2 border rounded" disabled={busy || budget?.policy.stopped || budget?.globalStop} onClick={() => run(async () => { const result=await api.post('/research/queue/run'); setMessage(JSON.stringify(result.data)); setTasks((await api.get('/research/queue')).data); setBudget((await api.get('/research/budget')).data); })}>Run one queued task now</button>
      <details><summary>Queue results</summary>{tasks.map(t => <p key={t._id}>{t.companyId} · {t.status} · attempt {t.attempts} · {t.lastError || t.result?.reason || `${t.result?.sourcedContacts || 0} sourced contacts`}</p>)}</details>
    </section>
    {/* Salary Evidence Review / Import UI */}
    <section className="p-4 border border-zinc-700 rounded space-y-3 bg-zinc-900/50">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Salary Evidence Importer</h2>
          <p className="text-xs text-zinc-400">Review & import verified researcher findings (strict &gt; ₹15 LPA fixed base) directly into the directory.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowImporter(!showImporter)}
          className="border border-zinc-700 px-3 py-1.5 rounded text-xs hover:bg-zinc-800"
        >
          {showImporter ? 'Hide Importer' : '+ Review & Import Evidence'}
        </button>
      </div>

      {showImporter && (
        <div className="space-y-3 pt-2">
          <textarea
            rows={5}
            placeholder='Paste company evidence JSON or array (e.g. from research/company-evidence/*.json)'
            value={importJson}
            onChange={e => setImportJson(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2.5 text-xs font-mono text-zinc-200 outline-none focus:border-yellow-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !importJson.trim()}
              onClick={() => run(handleValidateEvidence)}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold rounded text-zinc-100 disabled:opacity-50"
            >
              1. Validate Evidence
            </button>
            <button
              type="button"
              disabled={busy || !validationPreview || validationPreview.length === 0}
              onClick={() => run(handleImportEvidence)}
              className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-xs font-bold rounded text-zinc-950 disabled:opacity-50"
            >
              2. Import Validated Records
            </button>
          </div>

          {validationPreview && (
            <div className="border border-zinc-800 rounded p-3 bg-zinc-950/80 space-y-2 max-h-60 overflow-y-auto">
              <h3 className="text-xs font-bold text-yellow-400">Validation Results ({validationPreview.length} companies):</h3>
              {validationPreview.map((c, idx) => (
                <div key={idx} className="text-xs border-b border-zinc-800 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">{c.legalName} ({c.rootDomain})</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.qualificationStatus === 'qualified' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                      c.qualificationStatus === 'supported_estimate' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                      'bg-red-950 text-red-400 border border-red-800'
                    }`}>
                      {c.qualificationStatus.replaceAll('_', ' ')}
                    </span>
                  </div>
                  {c.salaryEvidence.map((ev, i) => (
                    <div key={i} className="text-zinc-400 text-[11px] mt-1 pl-2 border-l border-zinc-700">
                      {ev.role} · Base: ₹{ev.salaryBaseMinINR?.toLocaleString('en-IN') || 'N/A'} - ₹{ev.salaryBaseMaxINR?.toLocaleString('en-IN') || 'N/A'} · Source: {ev.salarySourceType}
                      <p className="text-zinc-500 italic truncate">{ev.evidenceExcerpt}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>

    <label className="block">Company status<select className={field} value={status} onChange={e => setStatus(e.target.value)}>{['qualified','research_needed','supported_estimate','conflicting','not_qualified','all'].map(s => <option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label>
    {!data.companies.length && <p className="p-5 border border-zinc-700 rounded">No companies in this category. Existing seed lists are research prospects until dated fixed-base evidence is reviewed. Use “research needed” to inspect them.</p>}
    <div className="grid md:grid-cols-3 gap-6">
      <div className="space-y-2 max-h-[650px] overflow-auto">{data.companies.map(c => <button type="button" key={c._id} disabled={busy} onClick={() => run(() => selectCompany(c._id))} className="block w-full text-left p-3 border border-zinc-700 rounded hover:bg-zinc-800"><strong>{c.name}</strong><p className="text-xs">{c.domain} · {c.qualificationStatus.replaceAll('_',' ')}</p></button>)}</div>
      {detail && <section className="md:col-span-2 space-y-4">
        <h2 className="text-xl font-semibold">{detail.company.name}</h2>
        <a className="text-yellow-400" href={detail.company.careersUrl} target="_blank" rel="noreferrer">Official careers page</a>
        <p>{detail.company.qualificationStatus.replaceAll('_',' ')} — annual fixed base must strictly exceed ₹15,00,000.</p>
        {detail.company.salaryEvidence.map((e,i) => <article key={i} className="p-3 border border-zinc-700 rounded"><p>{e.role} · {e.location} · {e.level}</p><p>₹{e.salaryBaseMinINR?.toLocaleString('en-IN')} – ₹{e.salaryBaseMaxINR?.toLocaleString('en-IN')} / {e.payPeriod} · {e.baseVsCTC}</p><p>Reported {e.reportedOn?.slice(0,10)} · Checked {e.lastCheckedAt?.slice(0,10)} · {e.assessment.status}</p><a href={e.salarySourceUrl} target="_blank" rel="noreferrer" className="text-yellow-400">Pay evidence</a><p>{e.evidenceExcerpt}</p><p>{e.assessment.reasons.join('; ')}</p></article>)}
        <button type="button" className="p-3 border rounded" disabled={busy || detail.company.qualificationStatus !== 'qualified' || budget?.policy.stopped || budget?.globalStop} onClick={() => run(discover)}>Check public recruiting inboxes (up to 5 requests)</button>
        <button type="button" className="p-3 border rounded ml-2" disabled={busy || detail.company.qualificationStatus !== 'qualified'} onClick={() => run(async () => { await api.post('/research/queue',{companyIds:[detail.company._id]}); setTasks((await api.get('/research/queue')).data); setMessage('Task queued. Runs only through your explicit action or an enabled local scheduler.'); })}>Queue local research</button>
        <label className="block">Relevant fresher opening<select className={field} value={jobId} onChange={e => setJobId(e.target.value)}><option value="">Select an opening</option>{detail.jobs.map(j => <option key={j._id} value={j._id}>{j.title} — {j.location}</option>)}</select></label>
        {!detail.jobs.length && <p>No linked fresher openings stored. Check the careers page and refresh jobs; no active role is assumed.</p>}
        <label className="block">Sourced contact<select className={field} value={contactId} onChange={e => setContactId(e.target.value)}><option value="">Select a professional contact</option>{detail.contacts.map(c => <option key={c._id} value={c._id} disabled={!!c.blockReason}>{c.email} — {c.verificationStatus} {c.blockReason ? `(${c.blockReason})` : ''}</option>)}</select></label>
        {detail.contacts.map(c => <div key={c._id} className="text-sm"><p>{c.email} · {c.verificationStatus} · Opportunity {c.opportunity.score}/100</p>{c.opportunity.components.map(p => <span key={p.reason} className="mr-3">{p.reason}: {p.points}</span>)}{c.provenance.map((p,i) => <a className="block text-yellow-400" key={i} href={p.url} target="_blank" rel="noreferrer">{p.provider} source · {p.observedAt?.slice(0,10)}</a>)}</div>)}
        <label className="block">Your name<input className={field} value={name} onChange={e => { setName(e.target.value); setConfirmed(false); }} /></label>
        <label className="block">Selected resume link<input className={field} type="url" value={resumeLink} onChange={e => { setResumeLink(e.target.value); setConfirmed(false); }} /></label>
        <label className="block">One concrete, resume-supported highlight<textarea className={field} maxLength={500} value={highlight} onChange={e => { setHighlight(e.target.value); setConfirmed(false); }} /></label>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirmed these facts against my selected resume.</label>
        <button type="button" className="bg-yellow-500 text-black rounded p-3" disabled={busy || !confirmed || !jobId || !contactId} onClick={() => run(createDraft)}>Create draft for review</button>
      </section>}
    </div>
    {draft && <section className="space-y-3 border border-zinc-700 rounded p-5"><h2 className="text-xl">Review draft</h2><p>Recipient: {draft.recipient} · {draft.status}</p><input aria-label="Draft subject" className={field} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value, status: 'draft' })} /><textarea aria-label="Draft body" rows={12} className={field} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value, status: 'draft' })} /><button type="button" className="p-3 border rounded" disabled={busy} onClick={() => run(saveDraft)}>Save reviewed draft</button><p>Reviewing saves a draft. No email is sent.</p></section>}
    {drafts.length > 0 && <details><summary>Saved drafts ({drafts.length})</summary>{drafts.map(d => <button type="button" key={d._id} className="block p-2 text-left" onClick={() => setDraft(d)}>{d.recipient} · {d.subject} · {d.status}</button>)}</details>}
    {message && <p role="status" className="p-4 border border-yellow-700 rounded">{message}</p>}
  </main>;
}

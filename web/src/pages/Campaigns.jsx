import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';

const field = 'w-full rounded border border-zinc-700 bg-zinc-950 p-2.5';
const button = 'rounded border border-zinc-600 px-3 py-2 disabled:opacity-40 hover:bg-zinc-800';
const emptyDraft = () => ({ name: '', senderId: '', localDateTime: '', timezone: 'Asia/Kolkata', dailyLimit: 10, intervalSeconds: 180, recipients: [] });
const statusOf = campaign => campaign?.state || campaign?.status || 'draft';
const errorText = error => error.response?.data?.error || error.message;
const recipientEmail = row => row.recipientEmail || row.normalizedRecipientEmail || row.email || row.recipient || '';
function mergeOptions(previous, next, recipients) {
  const selected = new Set(recipients.map(row => row.contactId));
  const contacts = new Map((previous.contacts || []).filter(row => selected.has(row._id)).map(row => [row._id, row]));
  for (const row of next.contacts || []) contacts.set(row._id, row);
  return { ...next, contacts: [...contacts.values()] };
}

function ReconciliationForm({ dispatch, busy, reconcile }) {
  const [outcome, setOutcome] = useState('');
  const [providerMessageId, setProviderMessageId] = useState('');
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  return <form className="mt-3 min-w-64 max-w-lg space-y-3 rounded border border-amber-800 p-3" onSubmit={event => {
    event.preventDefault();
    if (busy || !acknowledged || !outcome || notes.trim().length < 10 || (outcome === 'sent' && !providerMessageId.trim())) return;
    reconcile(dispatch._id, { outcome, providerMessageId: providerMessageId.trim(), notes: notes.trim(), acknowledge: true });
  }}>
    <p className="text-amber-200">Review this message in your provider history before recording its outcome. This action never retries it.</p>
    <label className="block">Confirmed provider outcome<select required className={field} value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">Select reviewed outcome</option><option value="sent">Provider accepted / sent</option><option value="not_sent">Provider confirms it was not sent</option></select></label>
    {outcome === 'sent' && <label className="block">Provider message identifier<input required maxLength={500} className={field} value={providerMessageId} onChange={event => setProviderMessageId(event.target.value)} /></label>}
    <label className="block">Provider-history review notes<textarea required minLength={10} maxLength={1000} rows={3} className={field} value={notes} onChange={event => setNotes(event.target.value)} /></label>
    <label className="block"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I reviewed the provider history for this exact recipient and message.</label>
    <button type="submit" className={button} disabled={busy || !acknowledged || !outcome || notes.trim().length < 10 || (outcome === 'sent' && !providerMessageId.trim())}>Record reviewed outcome</button>
    <p className="text-zinc-400">The campaign stays under review until you explicitly resume it. A confirmed unsent record remains failed; sending it later requires a separate approved campaign.</p>
  </form>;
}

export default function Campaigns() {
  const [options, setOptions] = useState({ senders: [], contacts: [], sendingEnabled: false, workerEnabled: false });
  const [draft, setDraft] = useState(emptyDraft);
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saved, setSaved] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [subjectTemplate, setSubjectTemplate] = useState('Interest in software engineering opportunities at {{company}}');
  const [bodyTemplate, setBodyTemplate] = useState('Hello recruiting team,\n\n');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const dialogRef = useRef(null);
  const approveRef = useRef(null);

  async function refresh() {
    const [{ data: nextOptions }, { data: list }] = await Promise.all([api.get('/campaigns/options'), api.get('/campaigns')]);
    setOptions(previous => mergeOptions(previous, nextOptions, draft.recipients));
    setCampaigns(list.campaigns || []);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api.get('/campaigns/options'), api.get('/campaigns')]).then(([a, b]) => {
      if (active) { setOptions(a.data); setCampaigns(b.data.campaigns || []); }
    }).catch(error => { if (active) setMessage(errorText(error)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (confirming) { setApprovalChecked(false); dialogRef.current?.focus(); }
    else approveRef.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (!selected?.campaign?._id) return undefined;
    let active = true;
    const id = selected.campaign._id;
    const timer = setInterval(() => {
      api.get(`/campaigns/${id}`).then(({ data }) => { if (active) setSelected(data); }).catch(() => {});
    }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [selected?.campaign?._id]);

  async function run(action) {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(errorText(error)); setConfirming(false); }
    finally { setBusy(false); }
  }
  function change(next) {
    setDraft(next); setPreview(null); setSaved(null); setConfirming(false);
  }
  function editRecipient(contactId, patch) {
    change({ ...draft, recipients: draft.recipients.map(row => row.contactId === contactId ? { ...row, ...patch } : row) });
  }
  function renderTemplate(text, contact) {
    return text.replaceAll('{{company}}', contact.company || '').replaceAll('{{name}}', contact.hrName || 'recruiting team');
  }
  function toggleContact(contact, checked) {
    change({ ...draft, recipients: checked ? [...draft.recipients, {
      contactId: contact._id, subject: renderTemplate(subjectTemplate, contact), body: renderTemplate(bodyTemplate, contact), overrideSalary: false
    }] : draft.recipients.filter(row => row.contactId !== contact._id) });
  }
  async function dryRun() {
    const { data } = await api.post('/campaigns/preview', draft);
    setPreview(data); setSaved(null);
    setMessage('Dry run complete. Review every exact message below. No email sent.');
  }
  async function saveDraft() {
    const { data } = editingId ? await api.patch(`/campaigns/${editingId}`, draft) : await api.post('/campaigns', draft);
    const campaign = data.campaign || data;
    setSaved(campaign);
    setEditingId(campaign._id);
    await refresh();
    setMessage('Draft saved without scheduling or sending.');
    return campaign;
  }
  async function approve() {
    if (!approvalChecked || !preview?.digest || preview.blocked?.length) return;
    // Re-render on the server before saving; compare the exact preview digest.
    const { data: latest } = await api.post('/campaigns/preview', draft);
    if (latest.digest !== preview.digest || latest.blocked?.length) {
      setPreview(latest); setConfirming(false);
      throw new Error('Recipient or schedule details changed. Review the new preview before approving.');
    }
    const campaign = saved || await saveDraft();
    await api.post(`/campaigns/${campaign._id}/approve`, { digest: preview.digest });
    setConfirming(false);
    setSelected((await api.get(`/campaigns/${campaign._id}`)).data);
    setSaved(null); setEditingId(null); setPreview(null); setDraft(emptyDraft());
    await refresh();
    setMessage('Campaign approved and scheduled. Dispatch still requires the configured sending gate and a running backend worker.');
  }
  async function action(id, verb) {
    await api.post(`/campaigns/${id}/${verb}`);
    setSelected((await api.get(`/campaigns/${id}`)).data);
    await refresh();
    setMessage(`Campaign ${verb} request recorded. An already accepted provider request cannot be recalled.`);
  }
  async function searchAllContacts() {
    const { data } = await api.get('/campaigns/options', { params: { q: search.trim() } });
    setOptions(previous => mergeOptions(previous, data, draft.recipients));
    setMessage(`Loaded ${data.contacts.length} matching contacts from your database${data.contactsTruncated ? '; narrow your search to see additional matches' : ''}. Selected recipients are preserved.`);
  }
  async function reconcile(dispatchId, payload) {
    const campaignId = selected.campaign._id;
    await api.post(`/campaigns/${campaignId}/dispatches/${dispatchId}/reconcile`, payload);
    setSelected((await api.get(`/campaigns/${campaignId}`)).data);
    await refresh();
    setMessage('Provider outcome recorded. No message was retried. Review the campaign before explicitly resuming remaining queued messages.');
  }
  function editSavedCampaign(campaign) {
    const snapshot = campaign.snapshot || campaign;
    change({ name: campaign.name || snapshot.name || '', senderId: snapshot.senderId || '',
      localDateTime: snapshot.localDateTime || '', timezone: snapshot.timezone || 'Asia/Kolkata',
      dailyLimit: snapshot.dailyLimit || 10, intervalSeconds: snapshot.intervalSeconds || 180,
      recipients: (snapshot.recipients || []).map(row => ({ contactId: String(row.contactId), subject: row.subject, body: row.body, overrideSalary: !!row.overrideSalary })) });
    setEditingId(campaign._id);
    setMessage('Draft loaded for editing. Run a new preview before approval.');
    document.getElementById('campaign-editor')?.scrollIntoView({ behavior: 'smooth' });
  }
  const contacts = options.contacts.filter(contact => `${contact.company} ${contact.email}`.toLowerCase().includes(search.toLowerCase()));
  const previewRows = preview?.snapshot?.recipients || [];
  const startAt = preview?.startAtUtc || preview?.snapshot?.startAtUtc;
  const sender = options.senders.find(row => String(row.id) === String(draft.senderId));
  const approvedSenderName = preview?.snapshot?.senderName || sender?.name;
  const approvedSenderEmail = preview?.snapshot?.senderEmail || sender?.email;
  const heartbeat = options.runtime?.lastPollAt;
  const staleHeartbeat = options.workerEnabled && (!heartbeat || Date.now() - new Date(heartbeat).getTime() > 120000);

  return <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
    <header><h1 className="text-3xl font-bold text-white">Scheduled campaigns</h1><p className="mt-2 text-zinc-400">Choose recipients, review their exact messages, then explicitly approve a future queue start.</p></header>
    <div className="rounded border border-zinc-700 p-4 text-sm space-y-1">
      <p>Real sending: <strong>{options.sendingEnabled ? 'enabled' : 'disabled'}</strong> · Backend worker: <strong>{options.workerEnabled ? 'enabled' : 'disabled'}</strong></p>
      {staleHeartbeat && <p role="alert" className="text-amber-200">The worker has no recent heartbeat. Scheduled dispatch may be delayed; check backend availability and refresh status.</p>}
      {heartbeat && <p>Last worker poll: {new Date(heartbeat).toISOString()}</p>}
      <p>The backend must be online at the scheduled time. A sleeping or powered-off laptop cannot dispatch mail. A missed start requires review.</p>
      <p>Paid enrichment and new cloud resources: ₹0 configured by this feature. Your email provider’s existing charges and limits still apply.</p>
    </div>
    {message && <p role="status" className="rounded border border-yellow-700 p-4 whitespace-pre-wrap">{message}</p>}
    <section aria-labelledby="campaign-editor" className="rounded border border-zinc-700 p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap justify-between gap-3"><h2 id="campaign-editor" className="text-xl font-semibold">{editingId ? 'Edit campaign draft' : 'Create a campaign'}</h2>{editingId && <button type="button" className={button} disabled={busy} onClick={() => { change(emptyDraft()); setEditingId(null); }}>Start a new draft</button>}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <label>Campaign name<input className={field} maxLength={120} value={draft.name} onChange={event => change({ ...draft, name: event.target.value })} /></label>
        <label>Sender account<select className={field} value={draft.senderId} onChange={event => change({ ...draft, senderId: event.target.value })}><option value="">Select your configured sender</option>{options.senders.map(row => <option key={row.id} value={row.id}>{row.name || row.email} — {row.email}</option>)}</select></label>
        <label>Start date and local time<input type="datetime-local" className={field} value={draft.localDateTime} onChange={event => change({ ...draft, localDateTime: event.target.value })} /></label>
        <label>Timezone<input list="campaign-timezones" className={field} value={draft.timezone} onChange={event => change({ ...draft, timezone: event.target.value })} /><datalist id="campaign-timezones">{['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Singapore', 'Australia/Sydney'].map(zone => <option key={zone} value={zone} />)}</datalist></label>
        <label>Maximum per day<input type="number" min="1" max={options.maxDailyLimit || 100} className={field} value={draft.dailyLimit} onChange={event => change({ ...draft, dailyLimit: Number(event.target.value) })} /></label>
        <label>Minimum seconds between messages<input type="number" min="180" className={field} value={draft.intervalSeconds} onChange={event => change({ ...draft, intervalSeconds: Number(event.target.value) })} /></label>
      </div>
      <p className="text-sm text-zinc-400">The selected time starts processing at or after that instant. Daily limits use UTC days and are shared across your campaigns; your account cap is {options.maxDailyLimit || 'enforced by the server'}. Daily limits can spread delivery over several days. Ambiguous or nonexistent daylight-saving times must be corrected.</p>
      <div className="grid md:grid-cols-2 gap-4">
        <label>Subject for newly selected recipients<input className={field} value={subjectTemplate} maxLength={200} onChange={event => setSubjectTemplate(event.target.value)} /></label>
        <label>Body for newly selected recipients<textarea rows={4} className={field} value={bodyTemplate} maxLength={10000} onChange={event => setBodyTemplate(event.target.value)} /></label>
      </div>
      <p className="text-sm text-zinc-400">Use {'{{company}}'} or {'{{name}}'}. Selecting a recipient copies these templates into that recipient’s editable message.</p>
      <div className="flex flex-wrap items-end gap-3"><label className="block flex-1">Search contacts<input type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); run(searchAllContacts); } }} /></label><button type="button" className={button} disabled={busy} onClick={() => run(searchAllContacts)}>Search entire contact database</button></div>
      <p className="text-sm text-zinc-400">The table filters loaded results as you type. Use “Search entire contact database” to find other saved contacts; each server search returns up to 1,000 results.{options.contactsTruncated ? ' More matches exist: narrow the company or email search.' : ''} Selected recipients remain available across searches.</p>
      <div className="overflow-auto max-h-80 rounded border border-zinc-800"><table className="w-full text-sm text-left"><caption className="text-left p-3 text-zinc-400">{draft.recipients.length} selected · {options.contacts.length} contacts loaded · Suppressed and unsourced contacts cannot be selected.</caption><thead className="bg-zinc-900"><tr><th className="p-3">Select</th><th className="p-3">Company / email</th><th className="p-3">Evidence and eligibility</th></tr></thead><tbody>{contacts.map(contact => <tr key={contact._id} className="border-t border-zinc-800"><td className="p-3"><input type="checkbox" aria-label={`Select ${contact.email}`} disabled={!!contact.blockReason || busy} checked={draft.recipients.some(row => row.contactId === contact._id)} onChange={event => toggleContact(contact, event.target.checked)} /></td><td className="p-3"><strong>{contact.company}</strong><p>{contact.email}</p></td><td className="p-3"><p>{contact.blockReason || (contact.salaryQualified ? 'Qualifying salary evidence' : 'Salary / role eligibility needs research')}</p><p>{contact.verificationStatus || 'Mailbox not independently verified'}</p>{contact.provenance?.map((proof, index) => proof.url && <a className="block text-yellow-400" href={proof.url} key={index} target="_blank" rel="noreferrer">Public evidence</a>)}</td></tr>)}</tbody></table>{!contacts.length && <p className="p-4">No matching contacts. Add sourced recruiting leads through research first.</p>}</div>
      {draft.recipients.map((row, index) => {
        const contact = options.contacts.find(item => item._id === row.contactId);
        return <fieldset key={row.contactId} className="border border-zinc-700 rounded p-4 space-y-3"><legend className="px-2">Message {index + 1}: {contact?.email}</legend><label className="block">Exact subject<input className={field} maxLength={200} value={row.subject} onChange={event => editRecipient(row.contactId, { subject: event.target.value })} /></label><label className="block">Exact body<textarea className={field} rows={6} maxLength={10000} value={row.body} onChange={event => editRecipient(row.contactId, { body: event.target.value })} /></label>{!contact?.salaryQualified && <label className="block rounded border border-amber-800 p-3 text-amber-200"><input type="checkbox" checked={row.overrideSalary} onChange={event => editRecipient(row.contactId, { overrideSalary: event.target.checked })} /> I have reviewed the missing salary / role evidence and explicitly allow this recipient for this campaign. Mailbox suppression and source requirements still apply.</label>}</fieldset>;
      })}
      <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !draft.recipients.length || !draft.senderId} onClick={() => run(dryRun)}>Dry run & preview</button><button type="button" className={button} disabled={busy || !preview || !!preview.blocked?.length} onClick={() => run(saveDraft)}>Save draft</button></div>
    </section>
    {preview && <section className="rounded border border-yellow-700 p-4 md:p-6 space-y-4" aria-labelledby="exact-preview"><h2 id="exact-preview" className="text-xl font-semibold">Exact campaign preview</h2><p>Sender: {approvedSenderName ? `${approvedSenderName} <${approvedSenderEmail}>` : approvedSenderEmail} · {draft.localDateTime} {draft.timezone}</p><p>UTC start: <strong>{startAt ? new Date(startAt).toISOString() : 'Unavailable'}</strong></p><p>{previewRows.length} approved-candidate messages · {draft.dailyLimit}/day · at least {draft.intervalSeconds} seconds apart · estimated active pacing {preview.estimatedMinutes ?? '—'} minutes · at least {preview.minimumDays || Math.ceil(previewRows.length / draft.dailyLimit)} UTC quota day(s) (shared quotas can extend this)</p>{preview.blocked?.length > 0 && <div role="alert" className="text-red-300"><p>Scheduling blocked. Resolve every excluded recipient and run preview again.</p>{preview.blocked.map((row, index) => <p key={row.contactId || index}>{row.email}: {row.reason}</p>)}</div>}{previewRows.map((row, index) => <article key={row.contactId || index} className="border border-zinc-700 p-3 rounded"><p>To: {recipientEmail(row) || options.contacts.find(contact => contact._id === row.contactId)?.email}</p><p className="font-semibold">{row.subject}</p><pre className="font-sans whitespace-pre-wrap break-words mt-2">{row.body}</pre></article>)}<p className="text-sm text-zinc-400">Editing any campaign field clears this preview and its approval. Provider acceptance can have an uncertain outcome; those messages are held for manual review instead of being retried.</p><button ref={approveRef} type="button" disabled={busy || !!preview.blocked?.length || !preview.digest || !previewRows.length} className="rounded bg-yellow-500 px-4 py-3 font-semibold text-black disabled:opacity-40" onClick={() => setConfirming(true)}>Approve & Schedule</button></section>}
    <section aria-labelledby="saved-campaigns" className="space-y-3"><div className="flex justify-between gap-3"><h2 id="saved-campaigns" className="text-xl font-semibold">Campaign status</h2><button type="button" className={button} disabled={busy} onClick={() => run(refresh)}>Refresh</button></div>{!campaigns.length && <p>No campaigns saved yet.</p>}{campaigns.map(campaign => <button type="button" className="w-full rounded border border-zinc-700 p-4 text-left hover:bg-zinc-900" key={campaign._id} disabled={busy} onClick={() => run(async () => setSelected((await api.get(`/campaigns/${campaign._id}`)).data))}><strong>{campaign.name}</strong> · {statusOf(campaign)}<p className="text-sm">{campaign.startAtUtc ? new Date(campaign.startAtUtc).toISOString() : 'Unscheduled'} · {campaign.timezone}</p></button>)}</section>
    {selected && <section className="rounded border border-zinc-700 p-4 space-y-4" aria-labelledby="campaign-progress"><h2 id="campaign-progress" className="text-xl">{selected.campaign.name} — {statusOf(selected.campaign)}</h2>{selected.campaign.reason && <p>{selected.campaign.reason}</p>}<div className="flex flex-wrap gap-3">{statusOf(selected.campaign) === 'draft' && <button type="button" className={button} disabled={busy} onClick={() => editSavedCampaign(selected.campaign)}>Edit this draft</button>}{['scheduled', 'running'].includes(statusOf(selected.campaign)) && <button type="button" className={button} disabled={busy} onClick={() => run(() => action(selected.campaign._id, 'pause'))}>Pause campaign</button>}{['paused', 'needs_review'].includes(statusOf(selected.campaign)) && <button type="button" className={button} disabled={busy} onClick={() => run(() => action(selected.campaign._id, 'resume'))}>Confirm resume campaign</button>}{!['completed', 'cancelled'].includes(statusOf(selected.campaign)) && <button type="button" className={button} disabled={busy} onClick={() => run(() => action(selected.campaign._id, 'cancel'))}>Cancel remaining messages</button>}</div><div className="overflow-auto"><table className="w-full text-sm text-left"><caption className="text-left py-2">Per-recipient dispatch log. Unknown outcomes require review and are never automatically retried.</caption><thead><tr><th className="p-2">Recipient</th><th className="p-2">Status</th><th className="p-2">Reason / provider ID</th></tr></thead><tbody>{(selected.dispatches || []).map(row => <tr key={row._id} className="border-t border-zinc-800"><td className="p-2">{recipientEmail(row)}</td><td className="p-2">{row.status}</td><td className="p-2">{row.reason || row.lastError || row.error || row.providerMessageId || '—'}{row.status === 'unknown_outcome' && <ReconciliationForm dispatch={row} busy={busy} reconcile={(dispatchId, payload) => run(() => reconcile(dispatchId, payload))} />}</td></tr>)}</tbody></table></div></section>}
    {confirming && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) setConfirming(false);
      if (event.key === 'Tab') {
        const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="approve-campaign-title" className="rounded border border-yellow-700 bg-zinc-900 p-6 max-w-xl space-y-4"><h2 id="approve-campaign-title" className="text-xl font-semibold">Approve this exact campaign?</h2><p>{previewRows.length} messages from {approvedSenderName ? `${approvedSenderName} <${approvedSenderEmail}>` : approvedSenderEmail}, starting {draft.localDateTime} {draft.timezone} ({startAt ? new Date(startAt).toISOString() : ''} UTC).</p><p>Approval freezes these recipients, messages, sender, schedule and limits. The sending feature must be separately configured; this action will not enable it.</p><label className="block"><input type="checkbox" checked={approvalChecked} onChange={event => setApprovalChecked(event.target.checked)} /> I reviewed each exact recipient, subject and body and approve this scheduled campaign.</label><div className="flex gap-3"><button type="button" className={button} disabled={busy} onClick={() => setConfirming(false)}>Back to review</button><button type="button" className="rounded bg-yellow-500 text-black font-semibold px-3 py-2 disabled:opacity-40" disabled={busy || !approvalChecked} onClick={() => run(approve)}>Confirm approval & schedule</button></div></div></div>}
  </main>;
}

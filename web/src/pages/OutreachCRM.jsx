import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const inputStyle = 'w-full p-2 rounded bg-zinc-950 border border-zinc-700 text-zinc-100';
const buttonStyle = 'px-3 py-2 rounded border border-zinc-600 hover:bg-zinc-800 disabled:opacity-40';
const safeLink = url => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } };
export default function OutreachCRM() {
  const [data, setData] = useState({ reminders: [], graph: [] });
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState('');
  const [contactId, setContactId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [snippet, setSnippet] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = async () => setData((await api.get('/crm/overview')).data);
  useEffect(() => { refresh().catch(e => setError(e.response?.data?.error || e.message)); }, []);
  async function run(fn) {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); await refresh(); } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }
  const findContacts = () => run(async () => {
    const rows = (await api.get('/crm/contacts', { params: { q: query } })).data.contacts;
    setContacts(rows); setContactId(''); setConfirmed(false); setSnippet('');
    if (!rows.length) setMessage('No owned contacts matched.');
  });
  const save = event => {
    event.preventDefault();
    run(async () => {
      const date = new Date(dueAt);
      if (!Number.isFinite(+date)) throw new Error('Choose a valid reminder date and time.');
      const result = (await api.post('/crm/reminders', { contactId, dueAt: date.toISOString(), subject, body, note })).data;
      setMessage(result.status === 'cancelled' ? 'Recipient changed during save. Reminder cancelled.' : 'Reminder saved. This does not send an email.');
    });
  };
  const close = (row, status) => run(async () => { await api.patch(`/crm/reminders/${row._id}`, { status, revision: row.revision }); setDraft(null); });
  return <main className="p-4 md:p-8 max-w-6xl mx-auto space-y-7">
    <h1 className="text-2xl font-bold text-zinc-100">Outreach CRM</h1>
    <p>Plan follow-ups and review linked hiring evidence. Reminders do not send emails. Sending requires a separate exact campaign preview and approval in <Link className="text-yellow-400 underline" to="/campaigns">Scheduled Campaigns</Link>.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-green-300">{message}</p>}
    <section className="p-4 border border-zinc-700 rounded space-y-3">
      <h2 className="text-xl text-zinc-100">Plan a follow-up</h2>
      <div className="flex gap-2"><label className="grow">Find your contact<input className={inputStyle} value={query} onChange={e => setQuery(e.target.value)} /></label><button className={buttonStyle} disabled={busy} onClick={findContacts}>Search contacts</button></div>
      <label className="block">Contact<select aria-label="Contact" className={inputStyle} value={contactId} onChange={e => { setContactId(e.target.value); setConfirmed(false); setSnippet(''); setDraft(null); }}><option value="">Select a contact</option>{contacts.map(c => <option key={c._id} value={c._id}>{c.company} — {c.email} ({c.status})</option>)}</select></label>
      <form onSubmit={save} className="space-y-3">
        <label className="block">Reminder date and time ({timezone})<input aria-label="Reminder date and time" type="datetime-local" className={inputStyle} value={dueAt} onChange={e => setDueAt(e.target.value)} required /></label>
        <label className="block">Follow-up subject<input className={inputStyle} value={subject} maxLength={300} onChange={e => setSubject(e.target.value)} required /></label>
        <label className="block">Follow-up body<textarea className={inputStyle} rows={5} value={body} maxLength={20000} onChange={e => setBody(e.target.value)} required /></label>
        <label className="block">Private reminder note<input className={inputStyle} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>
        <button className={buttonStyle} disabled={busy || !contactId}>Save reminder</button>
      </form>
      <div className="pt-3 border-t border-zinc-800 space-y-2">
        <label className="block">Received reply (record manually)<textarea className={inputStyle} rows={2} value={snippet} maxLength={2000} onChange={e => setSnippet(e.target.value)} /></label>
        <button className={buttonStyle} disabled={busy || !contactId || !snippet.trim()} onClick={() => run(async () => { await api.post(`/crm/contacts/${contactId}/reply`, { snippet }); setDraft(null); setMessage('Reply recorded; open reminders for this recipient cancelled.'); })}>Record reply</button>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirm this recipient asked to stop receiving outreach.</label>
        <button className={buttonStyle} disabled={busy || !contactId || !confirmed} onClick={() => run(async () => { await api.post(`/crm/contacts/${contactId}/opt-out`, { confirmed: true }); setDraft(null); setConfirmed(false); setMessage('Recipient opted out. Open reminders cancelled and future sending blocked.'); })}>Record opt-out</button>
      </div>
    </section>
    <section className="space-y-3"><div className="flex gap-4"><h2 className="text-xl text-zinc-100">Reminders</h2><button className={buttonStyle} disabled={busy} onClick={() => run(async () => {})}>Refresh</button></div>
      {!data.reminders.length && <p>No reminders yet.</p>}
      {data.reminders.map(row => <article key={row._id} className="border border-zinc-700 rounded p-3 space-y-2">
        <h3 className="font-semibold text-zinc-100">{row.contact?.company || 'Unavailable contact'} — {row.contact?.email}</h3>
        <p>{new Date(row.dueAt).toLocaleString()} ({timezone}) · {row.status}{row.status === 'open' && new Date(row.dueAt) <= new Date() ? ' · Due' : ''}</p>
        <p>{row.subject}</p>{row.note && <p>{row.note}</p>}{row.blockedReason && <p className="text-yellow-300">Blocked: {row.blockedReason}</p>}
        {row.status === 'open' && <div className="flex flex-wrap gap-2"><button className={buttonStyle} disabled={busy || !!row.blockedReason} onClick={() => run(async () => setDraft((await api.get(`/crm/reminders/${row._id}/draft`)).data))}>Review draft</button><button className={buttonStyle} disabled={busy} onClick={() => close(row, 'completed')}>Mark complete</button><button className={buttonStyle} disabled={busy} onClick={() => close(row, 'cancelled')}>Cancel reminder</button></div>}
      </article>)}
      {draft && <div className="p-4 rounded border border-yellow-700 space-y-2"><h3>Draft for review — {draft.recipientEmail}</h3><label className="block">Reviewed subject<input className={inputStyle} readOnly value={draft.subject} /></label><label className="block">Reviewed body<textarea aria-label="Reviewed body" className={inputStyle} readOnly rows={6} value={draft.body} /></label><p>Copy the text for review. Previously sent recipients remain protected by campaign duplicate-send rules.</p><button className={buttonStyle} onClick={() => setDraft(null)}>Close draft</button></div>}
    </section>
    <section className="space-y-3"><h2 className="text-xl text-zinc-100">RecruiterGraph</h2><p>Links use stored company identities. Salary qualification is evaluated from dated fixed-base evidence. Job records may be stale; check the employer page. {data.unlinkedContactCount || 0} of your contacts have no company link.</p>
      {data.truncated && <p className="text-yellow-300">Showing bounded results. Search the company directory for additional records.</p>}
      {!data.graph.length && <p>No linked company evidence yet.</p>}
      {data.graph.map(node => <article key={node.company._id} className="p-4 border border-zinc-700 rounded space-y-2">
        <h3 className="text-lg text-zinc-100">{node.company.name}</h3><p>Salary: {node.company.qualificationStatus} · Evidence score: {node.score}/85</p>
        {node.contacts.map(c => <p key={c._id}>Your contact: {c.hrName} {c.email} · {c.verificationStatus} · {c.status}{c.blockedReason ? ` · ${c.blockedReason}` : ''}</p>)}
        {node.jobs.map(j => <p key={j._id}>Role: <a className="text-yellow-400 underline" href={safeLink(j.url)} target="_blank" rel="noreferrer">{j.title}</a></p>)}
        {node.publicLeads.map(l => <p key={l._id || l.email}>Public inbox: {l.email} · mailbox existence unconfirmed · <a className="text-yellow-400 underline" href={safeLink(l.evidenceUrl)} target="_blank" rel="noreferrer">Employer source</a></p>)}
      </article>)}
    </section>
  </main>;
}

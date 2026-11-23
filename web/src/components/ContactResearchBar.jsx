import { useState } from 'react';
import api from '../services/api';

const button = 'rounded border border-zinc-700 px-3 py-2 disabled:opacity-50';

export default function ContactResearchBar({ onImported }) {
  const [domains, setDomains] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [sheet, setSheet] = useState(null);

  async function run(action) {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(error.response?.data?.error || error.message); }
    finally { setBusy(false); }
  }
  async function loadRows(domainFilter = []) {
    const [{ data }, { data: research }] = await Promise.all([
      api.get('/professional-discovery/leads'),
      api.get('/professional-discovery/people'),
    ]);
    const found = [...data.leads, ...research.people].filter(row => !domainFilter.length || domainFilter.includes(row.domain)).slice(0, 100);
    setRows(found);
    setSelected(found.filter(row => !row.inferenceFlag && row.email).map(row => row._id));
    setSheet(null);
    if (!found.length) setMessage('No sourced contacts awaiting review.');
  }
  async function discover() {
    const list = [...new Set(domains.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    if (!list.length) return;
    await api.post('/professional-discovery/scan', { domains: list, dryRun: false, saveToContacts: false, maxRequests: 25 });
    await loadRows(list);
  }
  async function importSaved() {
    const { data } = await api.post('/professional-discovery/import', { leadIds: selected });
    await onImported?.();
    await loadRows();
    setMessage('Added ' + data.added + '; existing ' + data.duplicates + '; excluded ' + data.excluded + '; awaiting checks ' + data.staged + '.');
  }
  async function sync(action) {
    const body = action === 'reconcile' ? { reconcile: true } : { leadIds: selected, ...(action === 'approve' ? { approvedDigest: sheet.digest } : {}) };
    const { data } = await api.post('/professional-discovery/google-sheet', body);
    setSheet(data);
  }
  return <details className="rounded-lg border border-zinc-800 p-3">
    <summary className="cursor-pointer font-semibold">Find HR, recruiters, managers &amp; SDE contacts</summary>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <input aria-label="Company domains for contacts" value={domains} onChange={event => setDomains(event.target.value)} placeholder="company.com, another.com" className="min-w-0 max-w-full rounded border border-zinc-700 bg-zinc-900 p-2" />
      <button type="button" className={button} disabled={busy || !domains.trim()} onClick={() => run(discover)}>Find contacts</button>
      <button type="button" className={button} disabled={busy} onClick={() => run(() => loadRows())}>Review saved contacts</button>
    </div>
    {!!rows.length && <div className="mt-3 space-y-2">
      <ul className="max-h-72 space-y-2 overflow-auto">
        {rows.map(row => <li key={row._id} className="break-words rounded border border-zinc-800 p-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" disabled={busy || !row.email || row.inferenceFlag} checked={selected.includes(row._id)} onChange={event => {
              setSelected(previous => event.target.checked ? [...previous, row._id] : previous.filter(id => id !== row._id));
              setSheet(null);
            }} />
            <span>{row.name || row.title || row.company} · {row.company} · {row.email && !row.inferenceFlag ? row.email : 'Research lead'}
              <span className="block text-xs text-zinc-400">{row.email && !row.inferenceFlag ? 'Public source · mailbox unverified' : 'Published address required'}</span>
            </span>
          </label>
          {/^https:\/\//i.test(row.sourceUrl) && <a className="text-yellow-400 underline" href={row.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
        </li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !selected.length} className={button} onClick={() => run(importSaved)}>Add selected to Emails</button>
        <button type="button" disabled={busy || !selected.length} className={button} onClick={() => run(() => sync('preview'))}>Preview Google Sheet</button>
      </div>
    </div>}
    <button type="button" disabled={busy} className={button + ' mt-2'} onClick={() => run(() => sync('reconcile'))}>Check pending Sheet sync</button>
    {sheet?.status === 'preview' && <div className="mt-2 text-sm">
      <p>{sheet.rows.length} new Sheet rows</p>
      <ul className="max-h-48 overflow-auto break-words">{sheet.rows.map(row => <li key={row[0]}>{row.slice(1).join(' · ')}</li>)}</ul>
      <button type="button" disabled={busy || !sheet.rows.length} className={button} onClick={() => run(() => sync('approve'))}>Approve Sheet append</button>
    </div>}
    {sheet && sheet.status !== 'preview' && <p role="status" className="mt-2 text-sm">{sheet.status.replaceAll('_', ' ')}{sheet.range && ' · ' + sheet.range}</p>}
    {message && <p role="status" className="mt-2 text-sm text-yellow-300">{message}</p>}
  </details>;
}

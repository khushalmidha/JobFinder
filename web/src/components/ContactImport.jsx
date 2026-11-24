import { useState } from 'react';
import api from '../services/api';

export default function ContactImport({ onSaved, initiallyOpen = false }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function preview(event, mode) {
    event.preventDefault();
    setBusy(true);
    setRows([]);
    setStatus('');
    try {
      const override = company.trim();
      let data;
      if (mode === 'file') {
        const payload = new FormData();
        payload.append('file', file);
        payload.append('localOnly', 'true');
        payload.append('companyOverride', override);
        ({ data } = await api.post('/upload/parse', payload));
      } else {
        ({ data } = await api.post('/upload/parse-text', { text, companyOverride: override, localOnly: true }));
      }
      const unique = new Map();
      for (const row of data.contacts || []) {
        const email = String(row.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || unique.has(email)) continue;
        unique.set(email, { company: override || row.company || 'Unknown', email,
          hrName: row.hrName || '', role: row.role || '', package: row.package || '', source: 'excel_upload' });
      }
      setRows([...unique.values()]);
      setStatus(unique.size ? `${unique.size} contacts ready to review.` : 'No email addresses found.');
    } catch (error) {
      setStatus(error.response?.data?.error || 'Could not parse these contacts.');
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    let added = 0, staged = 0, rejected = 0, processed = 0;
    try {
      for (let offset = 0; offset < rows.length; offset += 200) {
        const batch = rows.slice(offset, offset + 200);
        const { data } = await api.post('/contacts/bulk', { contacts: batch });
        added += data.added || 0;
        staged += data.staged || 0;
        rejected += data.rejected || 0;
        processed += batch.length;
      }
      setStatus(`${added} added · ${staged} pending verification · ${rejected} rejected · ${processed - added - staged - rejected} skipped.`);
    } catch (error) {
      setStatus(`${processed} reviewed rows processed before import paused. ${error.response?.data?.error || 'Retry the remaining rows.'}`);
    } finally {
      setRows(rows.slice(processed));
      setBusy(false);
      if (processed) void onSaved();
    }
  }

  return <details open={initiallyOpen || undefined} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
    <summary className="cursor-pointer font-semibold text-zinc-100">Import contacts</summary>
    <div className="mt-3 space-y-3 text-sm text-zinc-300">
      <label className="block">Company override (optional)
        <input className="ml-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1" value={company} onChange={event => { setCompany(event.target.value); setRows([]); }} disabled={busy} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <form onSubmit={event => preview(event, 'file')} className="space-y-2">
          <label className="block">Contact file (XLSX, CSV, PDF or TXT)<input className="block max-w-full" type="file"
            accept=".xlsx,.csv,.pdf,.txt" onChange={event => { setFile(event.target.files?.[0] || null); setRows([]); }} disabled={busy} /></label>
          <button type="submit" disabled={busy || !file} className="rounded bg-zinc-800 px-3 py-2 disabled:opacity-50">Preview file</button>
        </form>
        <form onSubmit={event => preview(event, 'text')} className="space-y-2">
          <label className="block">Paste contact text<textarea className="block w-full rounded border border-zinc-700 bg-zinc-950 p-2"
            rows={3} value={text} onChange={event => { setText(event.target.value); setRows([]); }} disabled={busy} /></label>
          <button type="submit" disabled={busy || !text.trim()} className="rounded bg-zinc-800 px-3 py-2 disabled:opacity-50">Preview pasted contacts</button>
        </form>
      </div>
      {status && <p role="status">{status}</p>}
      {!!rows.length && <div className="space-y-2">
        <div className="max-h-52 overflow-auto"><table className="w-full text-left">
          <thead><tr><th scope="col">Company</th><th scope="col">Email</th></tr></thead>
          <tbody>{rows.slice(0, 50).map(row => <tr key={row.email}><td>{row.company}</td><td>{row.email}</td></tr>)}</tbody>
        </table></div>
        {rows.length > 50 && <p>Showing 50 of {rows.length} contacts.</p>}
        <button type="button" disabled={busy} onClick={save} className="rounded bg-yellow-500 px-3 py-2 font-semibold text-zinc-950 disabled:opacity-50">Import {rows.length} contacts</button>
      </div>}
    </div>
  </details>;
}

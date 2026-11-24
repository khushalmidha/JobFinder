import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, FileType, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../services/api';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const literalEmail = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi;
const formats = ['csv', 'xls', 'xlsx', 'pdf', 'txt'];
const columns = [['company', 'Company'], ['email', 'Email'], ['hrName', 'HR Name'], ['role', 'Role'], ['package', 'Package']];
const button = 'bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-medium py-3 px-8 rounded-lg shadow-sm transition disabled:opacity-50 w-full max-w-xs';
const input = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-yellow-500';
const pageSize = 100;

function errorMessage(error, fallback) {
  const message = error.response?.data?.error || error.message;
  return typeof message === 'string' && message.length < 500 ? message : fallback;
}

export default function Import() {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  const [useGemini, setUseGemini] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [syncAccounts, setSyncAccounts] = useState([]);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [operation, setOperation] = useState('');
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const busy = Boolean(operation);

  useEffect(() => {
    let active = true;
    api.get('/contacts/companies').then(({ data }) => { if (active && Array.isArray(data)) setCompanies(data); }).catch(() => {});
    api.get('/auth/settings').then(({ data }) => {
      if (active && Array.isArray(data?.syncedAccountEmails)) setSyncAccounts(data.syncedAccountEmails);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  function selectFile(selected) {
    setStatus(null);
    if (selected && !formats.includes(selected.name.split('.').pop().toLowerCase())) {
      setFile(null);
      setStatus({ error: true, text: 'Choose a CSV, XLS, XLSX, PDF or TXT file.' });
      return;
    }
    setFile(selected || null);
  }

  async function parse(event, mode, ai) {
    event.preventDefault();
    if (mode === 'file' && !file) return;
    setOperation(mode);
    setProgress(null);
    setStatus(null);
    const override = company.trim();
    let fallback = false;
    const onDownloadProgress = ({ event: download }) => {
      const partial = download?.target?.responseText;
      if (partial) setProgress((partial.match(/"email"\s*:/g) || []).length);
    };
    try {
      let data;
      if (mode === 'file') {
        const form = new FormData();
        form.append('file', file);
        form.append('localOnly', String(!ai));
        form.append('companyOverride', override);
        ({ data } = await api.post('/upload/parse', form, { onDownloadProgress }));
      } else {
        try {
          ({ data } = await api.post('/upload/parse-text', { text, companyOverride: override, localOnly: !ai }, { onDownloadProgress }));
        } catch (error) {
          const emails = text.match(literalEmail);
          if (!emails?.length) throw error;
          fallback = true;
          data = { contacts: emails.map(email => ({ email })) };
        }
      }
      const unique = new Map();
      const allowed = mode === 'text' ? new Set((text.match(literalEmail) || []).map(email => email.toLowerCase())) : null;
      for (const contact of data?.contacts || []) {
        const email = String(contact.email || '').trim().toLowerCase();
        if (!emailPattern.test(email) || unique.has(email) || (allowed && !allowed.has(email))) continue;
        unique.set(email, {
          id: unique.size,
          email,
          company: override || contact.company || 'Unknown',
          hrName: contact.hrName || '',
          role: contact.role || '',
          package: contact.package || ''
        });
      }
      if (!unique.size) setStatus({ error: true, text: data?.error || 'No email addresses found.' });
      else if (fallback || data?.error) setStatus({ text: fallback ? 'Extracted emails from the pasted text using local parsing.' : 'Extraction ended early. Review the returned rows.' });
      setRows([...unique.values()]);
      setPage(0);
    } catch (error) {
      setStatus({ error: true, text: errorMessage(error, 'Could not extract contacts.') });
    } finally {
      setOperation('');
      setProgress(null);
    }
  }

  async function save() {
    const queue = new Map();
    for (const { id: _id, ...row } of rows) {
      const email = row.email.trim().toLowerCase();
      if (!emailPattern.test(email)) {
        setStatus({ error: true, text: 'Correct or remove invalid emails before saving.' });
        return;
      }
      if (!queue.has(email)) queue.set(email, { ...row, email, source: 'excel_upload' });
    }
    const contacts = [...queue.values()];
    setOperation('save');
    setStatus(null);
    setProgress(0);
    let processed = 0, added = 0, staged = 0, rejected = 0;
    const reviewDuplicates = rows.length - contacts.length;
    try {
      for (; processed < contacts.length;) {
        const chunk = contacts.slice(processed, processed + 200);
        const { data } = await api.post('/contacts/bulk', { contacts: chunk });
        added += data.added || 0;
        staged += data.staged || 0;
        rejected += data.rejected || 0;
        processed += chunk.length;
        setProgress(processed);
      }
      setStatus({ text: `Added ${added} · Pending verification ${staged} · Rejected ${rejected} · Skipped ${reviewDuplicates + processed - added - staged - rejected}.` });
      setRows([]);
      setFile(null);
      setText('');
    } catch (error) {
      const completed = new Set(contacts.slice(0, processed).map(row => row.email));
      setRows(rows.filter(row => !completed.has(row.email.trim().toLowerCase())));
      setPage(0);
      setStatus({ error: true, text: `${processed} of ${contacts.length} rows processed. ${errorMessage(error, 'Import paused. Retry the remaining rows.')}` });
    } finally {
      setOperation('');
      setProgress(null);
    }
  }

  function updateRow(id, field, value) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row));
  }
  function removeRow(id) {
    setRows(current => current.filter(row => row.id !== id));
    setPage(Math.min(page, Math.max(0, Math.ceil((rows.length - 1) / pageSize) - 1)));
  }

  return (
    <section className="p-4 md:p-8 max-w-5xl mx-auto font-sans">
      {busy && <progress className="fixed top-0 left-0 z-50 h-1 w-full accent-yellow-500"
        aria-label={operation === 'save' ? 'Import progress' : 'Extracting contacts'}
        {...(operation === 'save' ? { value: progress || 0, max: rows.length } : {})} />}
      <header className="mb-8 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Import Contacts</h1>
          <p className="text-zinc-400 text-sm mt-1">Upload a contact file or paste text, then review the extracted contacts before saving.</p>
        </div>
        <Link to="/" className="text-sm text-yellow-400 hover:underline">Back to Mails</Link>
      </header>
      {!!syncAccounts.length && <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-300 flex flex-wrap justify-between gap-3">
        <p className="break-all"><strong>One-way sync configured:</strong> {syncAccounts.join(', ')}</p>
        <Link to="/settings" className="text-yellow-400 hover:underline">Manage Sync in Settings →</Link>
      </div>}
      {status && <div role={status.error ? 'alert' : 'status'} className={`p-4 mb-6 rounded-lg border flex items-center gap-3 ${status.error ? 'bg-red-500/10 text-red-300 border-red-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'}`}>
        {status.error ? <AlertCircle className="h-5 w-5 shrink-0" /> : <CheckCircle className="h-5 w-5 shrink-0" />}
        <span>{status.text}</span>
      </div>}

      {!rows.length ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-5 md:p-8 flex flex-col justify-center">
          <h2 className="font-bold text-zinc-100 mb-2 text-center">Upload File</h2>
          <p className="text-sm text-zinc-400 mb-6 text-center">Upload a spreadsheet, text file, or PDF containing contact data.</p>
          <form onSubmit={event => parse(event, 'file', useGemini && file?.name.toLowerCase().endsWith('.pdf'))} className="flex flex-col items-center">
            <label className={`w-full border-2 border-dashed rounded-xl p-6 md:p-8 text-center cursor-pointer focus-within:ring-2 focus-within:ring-yellow-500 ${dragging ? 'bg-yellow-500/10 border-yellow-500' : 'border-zinc-700 hover:bg-zinc-800/50'}`}
              onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) selectFile(event.dataTransfer.files[0]); }}>
              <UploadCloud className="w-12 h-12 text-zinc-500 mx-auto mb-4" aria-hidden="true" />
              <span className="block font-medium text-zinc-300">Click to upload or drag and drop</span>
              <span className="block text-sm text-zinc-400">CSV, XLS, XLSX, PDF or TXT</span>
              <input type="file" aria-label="Contact file" className="sr-only" accept={formats.map(ext => '.' + ext).join(',')}
                disabled={busy} onChange={event => selectFile(event.target.files[0])} />
            </label>
            {file && <div className="mt-6 flex items-center max-w-full bg-zinc-800 px-4 py-2 rounded-lg text-sm text-zinc-300">
              <FileType className="w-4 h-4 mr-2 text-yellow-500 shrink-0" />
              <span className="truncate">{file.name}</span><span className="ml-2 text-zinc-400 shrink-0">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
            </div>}
            <button type="submit" disabled={!file || busy} className={`mt-8 ${button}`}>
              {operation === 'file' ? `Parsing… (${progress || 0} extracted)` : 'Extract from File'}
            </button>
          </form>
        </div>
        <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-5 md:p-8 flex flex-col">
          <h2 className="font-bold text-zinc-100 mb-2">AI Magic Paste</h2>
          <p className="text-sm text-zinc-400 mb-4">Paste emails or unstructured text with names and companies.</p>
          <form onSubmit={event => parse(event, 'text', useGemini)} className="flex flex-1 flex-col gap-4">
            <label className="block text-sm font-medium text-zinc-400">Force Company (Optional)
              <input className={`mt-1 ${input}`} list="import-company-list" value={company} onChange={event => setCompany(event.target.value)} disabled={busy} />
            </label>
            <datalist id="import-company-list">{companies.map(name => <option key={name} value={name} />)}</datalist>
            <textarea aria-label="Paste contact text" value={text} onChange={event => setText(event.target.value)} disabled={busy}
              placeholder="e.g. Recruiting team at Acme, careers@acme.example"
              className={`min-h-[170px] flex-1 resize-y ${input}`} />
            <label className="text-sm text-zinc-400"><input type="checkbox" checked={useGemini} onChange={event => setUseGemini(event.target.checked)} disabled={busy}
              className="mr-2 accent-yellow-500" />Use my configured Gemini key for pasted text and PDFs</label>
            <button type="submit" className={`self-center ${button}`} disabled={!text.trim() || busy}>
              {operation === 'text' ? `Extracting… (${progress || 0} extracted)` : useGemini ? 'Extract with Gemini' : 'Extract from Text'}
            </button>
          </form>
        </div>
      </div> : <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-zinc-800 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">Review Sheet Data</h2>
            <p className="text-sm text-zinc-400">{rows.length} {rows.length === 1 ? 'contact' : 'contacts'} detected. Edit or remove rows before saving.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => { setRows([]); setStatus(null); }} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800">Clear / Cancel</button>
            <button type="button" disabled={busy} onClick={save} className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-sm font-bold text-zinc-950 disabled:opacity-50">
              {operation === 'save' ? `Importing… ${progress} / ${rows.length}` : `Save All ${rows.length} ${rows.length === 1 ? 'Contact' : 'Contacts'}`}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead><tr className="border-b border-zinc-800 text-zinc-400 text-xs uppercase">
              {columns.map(([field, label]) => <th key={field} scope="col" className="p-4">{label}</th>)}
              <th scope="col" className="p-4 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {rows.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => <tr key={row.id} className="hover:bg-zinc-800/50">
                {columns.map(([field, label]) => <td key={field} className={`p-2 ${field === 'email' ? 'min-w-56' : ''}`}>
                  <input type={field === 'email' ? 'email' : 'text'} aria-label={`${label}, row ${page * pageSize + index + 1}`}
                    value={row[field]} onChange={event => updateRow(row.id, field, event.target.value)} disabled={busy}
                    className="w-full bg-transparent focus:bg-zinc-800 focus:ring-1 focus:ring-yellow-500 rounded p-2 text-sm text-zinc-200" />
                </td>)}
                <td className="p-4 text-right"><button type="button" aria-label={`Remove row ${page * pageSize + index + 1}`} disabled={busy}
                  onClick={() => removeRow(row.id)} className="text-red-400 hover:text-red-300 text-sm">Remove</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {rows.length > pageSize && <div className="p-4 border-t border-zinc-800 flex flex-wrap justify-between gap-2 text-sm">
          <button type="button" disabled={busy || page === 0} onClick={() => setPage(page - 1)} className="disabled:opacity-40">Previous</button>
          <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}</span>
          <button type="button" disabled={busy || (page + 1) * pageSize >= rows.length} onClick={() => setPage(page + 1)} className="disabled:opacity-40">Next</button>
        </div>}
      </div>}
    </section>
  );
}

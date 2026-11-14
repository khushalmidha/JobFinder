import React, { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { UploadCloud, FileType, CheckCircle, AlertCircle } from 'lucide-react';

function formatErrorMessage(err, fallback = 'Failed to process request.') {
  if (!err) return fallback;
  let raw = err.response?.data?.error || err.response?.data?.message || err.message || err;

  if (typeof raw === 'object') {
    if (raw.message) raw = raw.message;
    else {
      try {
        raw = JSON.stringify(raw);
      } catch (e) {
        return fallback;
      }
    }
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.error?.message) {
        raw = parsed.error.message;
      } else if (parsed.message) {
        raw = parsed.message;
      }
    } catch (e) {
      // plain string
    }

    if (raw.includes('experiencing high demand') || raw.includes('503') || raw.includes('UNAVAILABLE')) {
      return '⚠️ Google Gemini AI servers are currently experiencing high traffic. Please retry in a few moments or ensure your API key has quota.';
    }
    if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429') || raw.includes('quota')) {
      return '⚠️ Gemini API quota exceeded or rate limited. Please try again shortly or check your Gemini API key in Settings.';
    }
    if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid')) {
      return '⚠️ Invalid Gemini API key. Please update your API key in Settings.';
    }
    return raw;
  }

  return fallback;
}

const Import = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parsedContacts, setParsedContacts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [rawText, setRawText] = useState('');
  const [textLoading, setTextLoading] = useState(false);
  const [companyOverride, setCompanyOverride] = useState('');
  const [existingCompanies, setExistingCompanies] = useState([]);
  const [syncedAccountEmails, setSyncedAccountEmails] = useState([]);
  const [progress, setProgress] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const { data } = await api.get('/contacts/companies');
        setExistingCompanies(data || []);
      } catch (err) {
        console.error('Failed to fetch companies', err);
      }
    };
    fetchCompanies();

    // Fetch user sync settings
    api.get('/auth/settings')
      .then(({ data }) => {
        if (data && data.syncedAccountEmails) {
          setSyncedAccountEmails(data.syncedAccountEmails);
        }
      })
      .catch(console.error);
  }, []);

  const startProgressTimer = () => {
    setProgress(0);
    const expectedTimeMs = 12000;
    const updateInterval = 100;
    const totalSteps = expectedTimeMs / updateInterval;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const newProgress = 95 * (1 - Math.pow(1 - (currentStep / totalSteps), 3));
      if (currentStep >= totalSteps) {
        setProgress(95);
      } else {
        setProgress(newProgress);
      }
    }, updateInterval);

    return interval;
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const normalizeContacts = (contactsData) => {
      let lastCompanyText = 'Unknown';
      const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com'];

      return contactsData.map(c => {
        let comp = c.company || '';
        const originalEmail = c.email || '';
        const emailLower = originalEmail.toLowerCase();
        
        if (companyOverride && companyOverride.trim()) {
          comp = companyOverride.trim();
        } else {
          if ((!comp || comp.toLowerCase() === 'unknown') && emailLower.includes('@')) {
            const emails = emailLower.split(/[\s,]+/).filter(e => e.trim() !== '');
            for (const e of emails) {
              if (e.includes('@')) {
                const domain = e.split('@')[1];
                if (domain && !genericDomains.includes(domain)) {
                  const domainName = domain.split('.')[0];
                  comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
                  break;
                }
              }
            }
          }

          if (comp && comp.toLowerCase() !== 'unknown') {
            lastCompanyText = comp;
          } else {
            comp = lastCompanyText;
          }
        }

        return {
          company: comp,
          email: originalEmail,
          hrName: c.hrName || '',
          role: c.role || '',
          package: c.package || ''
        };
      }).filter(c => c.email && /.+@.+\..+/.test(c.email));
    };

    let timer;
    try {
      setLoading(true);
      setStatus('');
      setLiveCount(0);
      timer = startProgressTimer();
      const { data } = await api.post('/upload/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onDownloadProgress: (progressEvent) => {
          const text = progressEvent.event.target.responseText;
          if (text) {
            const match = text.match(/"email"\s*:/gi);
            if (match) {
              setLiveCount(match.length);
            }
          }
        }
      });
      clearInterval(timer);
      setProgress(100);
      
      let contacts = data.contacts || [];
      if (file.name.toLowerCase().endsWith('.pdf')) {
        contacts = normalizeContacts(contacts);
      }
      setParsedContacts(contacts);
    } catch (err) {
      clearInterval(timer);
      setProgress(0);
      setStatus(formatErrorMessage(err, 'Failed to parse file. Make sure Gemini API Key is set in Settings.'));
    } finally {
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 500);
    }
  };

  const handleTextParse = async () => {
    if (!rawText.trim()) return;

    const normalizeContacts = (contactsData) => {
      let lastCompanyText = 'Unknown';
      const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com'];

      return contactsData.map(c => {
        let comp = c.company || '';
        const originalEmail = c.email || '';
        const emailLower = originalEmail.toLowerCase();
        
        if (companyOverride && companyOverride.trim()) {
          comp = companyOverride.trim();
        } else {
          if ((!comp || comp.toLowerCase() === 'unknown') && emailLower.includes('@')) {
            const emails = emailLower.split(/[\s,]+/).filter(e => e.trim() !== '');
            for (const e of emails) {
              if (e.includes('@')) {
                const domain = e.split('@')[1];
                if (domain && !genericDomains.includes(domain)) {
                  const domainName = domain.split('.')[0];
                  comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
                  break;
                }
              }
            }
          }

          if (comp && comp.toLowerCase() !== 'unknown') {
            lastCompanyText = comp;
          } else {
            comp = lastCompanyText;
          }
        }

        return {
          company: comp,
          email: originalEmail,
          hrName: c.hrName || '',
          role: c.role || '',
          package: c.package || ''
        };
      }).filter(c => c.email && /.+@.+\..+/.test(c.email));
    };

    let timer;
    try {
      setTextLoading(true);
      setStatus('');
      setLiveCount(0);
      timer = startProgressTimer();
      const { data } = await api.post('/upload/parse-text', { 
        text: rawText,
        companyOverride: companyOverride 
      }, {
        onDownloadProgress: (progressEvent) => {
          const text = progressEvent.event.target.responseText;
          if (text) {
            const match = text.match(/"email"\s*:/gi);
            if (match) {
              setLiveCount(match.length);
            }
          }
        }
      });
      clearInterval(timer);
      setProgress(100);
      
      const contacts = normalizeContacts(data.contacts || []);
      setParsedContacts(contacts);
      setRawText('');
      setCompanyOverride('');
    } catch (err) {
      clearInterval(timer);
      setProgress(0);

      // Instant client-side fallback in case of Network Error or server timeout!
      const emailMatches = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (emailMatches && emailMatches.length > 0) {
        const fallbackContacts = normalizeContacts(
          emailMatches.map(em => ({
            company: companyOverride || 'Unknown',
            email: em,
            hrName: '',
            role: '',
            package: ''
          }))
        );
        setParsedContacts(fallbackContacts);
        setRawText('');
        setCompanyOverride('');
        setStatus(`✨ Extracted ${fallbackContacts.length} contacts automatically via offline instant engine!`);
      } else {
        setStatus(formatErrorMessage(err, 'Failed to parse text. Please check your connection or settings.'));
      }
    } finally {
      setTimeout(() => {
        setTextLoading(false);
        setProgress(0);
      }, 500);
    }
  };

  const handleSave = async () => {
    if (parsedContacts.length === 0) return;
    
    try {
      setSaving(true);
      setStatus('');
      const allToSave = parsedContacts.map(c => ({...c, source: 'excel_upload'}));
      const CHUNK_SIZE = 500;
      let totalAdded = 0, totalStaged = 0, totalRejected = 0;

      for (let i = 0; i < allToSave.length; i += CHUNK_SIZE) {
        const chunk = allToSave.slice(i, i + CHUNK_SIZE);
        const currentProcessed = Math.min(i + chunk.length, allToSave.length);
        const percent = Math.round((currentProcessed / allToSave.length) * 100);
        
        setStatus(`⏳ Importing contacts into database... ${currentProcessed} / ${allToSave.length} (${percent}%)`);
        setProgress(percent);

        const { data } = await api.post('/contacts/bulk', { contacts: chunk });
        totalAdded += (data.added || 0);
        totalStaged += (data.staged || 0); totalRejected += (data.rejected || 0);
      }

      const syncMsg = (syncedAccountEmails && syncedAccountEmails.length > 0)
        ? ` and automatically one-way synced to ${syncedAccountEmails.join(', ')}`
        : '';
      setStatus(`🎉 Success! Added ${totalAdded} new contacts. ${totalStaged} pending in Email Checks; ${totalRejected} rejected (duplicates skipped${syncMsg}).`);
      setParsedContacts([]);
      setFile(null);
    } catch (err) {
      setStatus(formatErrorMessage(err, 'Failed to save contacts.'));
    } finally {
      setSaving(false);
      setProgress(0);
    }
  };

  const updateContact = (index, field, value) => {
    const updated = [...parsedContacts];
    updated[index][field] = value;
    setParsedContacts(updated);
  };

  const removeContact = (index) => {
    const updated = [...parsedContacts];
    updated.splice(index, 1);
    setParsedContacts(updated);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto font-sans">
      {(loading || textLoading || saving) && (
        <div className="fixed top-0 left-0 right-0 h-1.5 bg-zinc-900 z-50 overflow-hidden">
          <div 
            className="h-full bg-yellow-500 transition-all duration-300 ease-out"
            style={{ width: `${saving ? 100 : progress}%` }}
          ></div>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Import Contacts</h1>
        <p className="text-zinc-400 text-sm mt-1">Upload a CSV, Excel, or PDF file. Gemini AI will automatically extract contact info.</p>
      </div>

      {/* One-Way Contact Sync Banner */}
      {syncedAccountEmails && syncedAccountEmails.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <span className="text-lg leading-none">🔄</span>
            <div>
              <span className="font-bold text-yellow-400 uppercase tracking-wider text-[11px] block sm:inline mr-2">
                One-Way Sync Active:
              </span>
              <span>
                Imported contacts will automatically be duplicated into: <strong className="font-mono text-zinc-100">{syncedAccountEmails.join(', ')}</strong>
              </span>
            </div>
          </div>
          <a
            href="/settings"
            className="text-yellow-400 hover:text-yellow-200 underline font-bold shrink-0 text-xs"
          >
            Manage Sync in Settings →
          </a>
        </div>
      )}

      {status && (
        <div className={`p-4 mb-6 rounded-lg border font-medium flex items-center ${
          status.includes('Success') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {status.includes('Success') ? <CheckCircle className="w-5 h-5 mr-3 shrink-0" /> : <AlertCircle className="w-5 h-5 mr-3 shrink-0" />}
          <span>{status}</span>
        </div>
      )}

      {parsedContacts.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-8 flex flex-col justify-center">
            <h2 className="font-bold text-zinc-100 mb-2 text-center">Upload File</h2>
            <p className="text-sm text-zinc-400 mb-6 text-center">Upload a CSV, Excel, or PDF file containing contact data.</p>
            <form onSubmit={handleUpload} className="flex flex-col items-center">
              <div 
                className="w-full max-w-xl border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center hover:bg-zinc-800/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
                <p className="font-medium text-zinc-300 mb-1">Click to upload or drag and drop</p>
                <p className="text-sm text-zinc-500">CSV, XLS, XLSX, or PDF</p>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  accept=".csv, .xlsx, .xls, .pdf"
                  onChange={(e) => setFile(e.target.files[0])}
                />
              </div>
              
              {file && (
                <div className="mt-6 flex items-center bg-zinc-800 px-4 py-2 rounded-lg text-sm text-zinc-300">
                  <FileType className="w-4 h-4 mr-2 text-yellow-500" />
                  <span className="font-medium">{file.name}</span>
                  <span className="ml-2 text-zinc-500">({Math.round(file.size / 1024)} KB)</span>
                </div>
              )}
              
              <button 
                type="submit"
                disabled={!file || loading}
                className="mt-8 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-medium py-3 px-8 rounded-lg shadow-sm transition disabled:opacity-50 w-full max-w-xs"
              >
                {loading ? `Parsing... (${liveCount} extracted)` : 'Extract from File'}
              </button>
            </form>
          </div>

          <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-8 flex flex-col">
            <h2 className="font-bold text-zinc-100 mb-2">AI Magic Paste</h2>
            <p className="text-sm text-zinc-400 mb-4">Paste random text containing emails, names, or companies. Gemini will extract them automatically.</p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-400 mb-1">Force Company (Optional)</label>
              <input 
                type="text"
                list="company-list"
                value={companyOverride}
                onChange={(e) => setCompanyOverride(e.target.value)}
                placeholder="Leave blank for AI auto-detect"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-yellow-500 transition-colors"
              />
              <datalist id="company-list">
                {existingCompanies.map((c, i) => (
                  <option key={i} value={c} />
                ))}
              </datalist>
            </div>

            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="e.g. Sundar Pichai (sundar@google.com) from Google.&#10;Nvidia recruiter is jensen@nvidia.com..."
              className="flex-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-yellow-500 transition-colors min-h-[200px] resize-none mb-6"
            />
            <div className="flex justify-center">
              <button
                onClick={handleTextParse}
                disabled={!rawText.trim() || textLoading}
                className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-medium py-3 px-8 rounded-lg shadow-sm transition disabled:opacity-50 w-full max-w-xs"
              >
                {textLoading ? `Extracting... (${liveCount} extracted)` : 'Extract with Gemini'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 overflow-hidden">
          <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                <span>📋 Review Sheet Data</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                  {parsedContacts.length} contacts detected
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                {parsedContacts.length > 100 
                  ? `Showing preview of first 100 contacts for ultra-fast rendering. All ${parsedContacts.length} contacts will be imported safely!`
                  : 'Please verify extracted data before saving.'}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setParsedContacts([])}
                className="px-4 py-2 text-zinc-400 font-medium hover:bg-zinc-800 hover:text-zinc-200 rounded-lg transition text-xs cursor-pointer"
              >
                Clear / Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-green-500 hover:bg-green-400 text-zinc-950 font-black rounded-lg shadow-lg transition disabled:opacity-50 text-xs cursor-pointer"
              >
                {saving ? 'Importing...' : `Save All ${parsedContacts.length} Contacts`}
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                  <th className="p-4 font-semibold">Company</th>
                  <th className="p-4 font-semibold">Email</th>
                  <th className="p-4 font-semibold">HR Name</th>
                  <th className="p-4 font-semibold">Role</th>
                  <th className="p-4 font-semibold">Package</th>
                  <th className="p-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {parsedContacts.slice(0, 100).map((c, i) => (
                  <tr key={i} className="hover:bg-zinc-800/50 transition">
                    <td className="p-2"><input type="text" value={c.company} onChange={(e) => updateContact(i, 'company', e.target.value)} className="w-full border-transparent bg-transparent hover:border-zinc-700 focus:border-yellow-500 focus:bg-zinc-800 rounded p-2 outline-none text-sm text-zinc-200" /></td>
                    <td className="p-2"><input type="text" value={c.email} onChange={(e) => updateContact(i, 'email', e.target.value)} className="w-full border-transparent bg-transparent hover:border-zinc-700 focus:border-yellow-500 focus:bg-zinc-800 rounded p-2 outline-none text-sm text-zinc-200" /></td>
                    <td className="p-2"><input type="text" value={c.hrName || ''} onChange={(e) => updateContact(i, 'hrName', e.target.value)} className="w-full border-transparent bg-transparent hover:border-zinc-700 focus:border-yellow-500 focus:bg-zinc-800 rounded p-2 outline-none text-sm text-zinc-200" /></td>
                    <td className="p-2"><input type="text" value={c.role || ''} onChange={(e) => updateContact(i, 'role', e.target.value)} className="w-full border-transparent bg-transparent hover:border-zinc-700 focus:border-yellow-500 focus:bg-zinc-800 rounded p-2 outline-none text-sm text-zinc-200" /></td>
                    <td className="p-2"><input type="text" value={c.package || ''} onChange={(e) => updateContact(i, 'package', e.target.value)} className="w-full border-transparent bg-transparent hover:border-zinc-700 focus:border-yellow-500 focus:bg-zinc-800 rounded p-2 outline-none text-sm text-zinc-200" /></td>
                    <td className="p-4 text-right">
                      <button onClick={() => removeContact(i)} className="text-red-400 hover:text-red-300 text-sm font-medium">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {parsedContacts.length > 100 && (
            <div className="p-3.5 bg-zinc-950/80 border-t border-zinc-800 text-center text-xs text-zinc-400 font-semibold">
              + <strong>{parsedContacts.length - 100} more contacts</strong> ready in memory. All <strong>{parsedContacts.length} contacts</strong> will be safely imported into your database when you hit "Save All"!
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Import;

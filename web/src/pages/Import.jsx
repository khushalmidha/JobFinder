import React, { useState, useRef } from 'react';
import api from '../services/api';
import { UploadCloud, FileType, CheckCircle, AlertCircle } from 'lucide-react';

const Import = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parsedContacts, setParsedContacts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef(null);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setLoading(true);
      setStatus('');
      const { data } = await api.post('/upload/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setParsedContacts(data.contacts || []);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to parse file. Make sure Gemini API Key is set in Settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (parsedContacts.length === 0) return;
    
    try {
      setSaving(true);
      setStatus('');
      const { data } = await api.post('/contacts/bulk', { 
        contacts: parsedContacts.map(c => ({...c, source: 'excel_upload'})) 
      });
      setStatus(`Success! Added ${data.added} new contacts.`);
      setParsedContacts([]);
      setFile(null);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to save contacts.');
    } finally {
      setSaving(false);
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Import Contacts</h1>
        <p className="text-zinc-400 text-sm mt-1">Upload a CSV or Excel file. Gemini AI will automatically extract contact info.</p>
      </div>

      {status && (
        <div className={`p-4 mb-6 rounded-lg border font-medium flex items-center ${
          status.includes('Success') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {status.includes('Success') ? <CheckCircle className="w-5 h-5 mr-3" /> : <AlertCircle className="w-5 h-5 mr-3" />}
          {status}
        </div>
      )}

      {parsedContacts.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-8">
          <form onSubmit={handleUpload} className="flex flex-col items-center">
            <div 
              className="w-full max-w-xl border-2 border-dashed border-zinc-700 rounded-xl p-12 text-center hover:bg-zinc-800/50 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
              <p className="font-medium text-zinc-300 mb-1">Click to upload or drag and drop</p>
              <p className="text-sm text-zinc-500">CSV, XLS, or XLSX</p>
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                accept=".csv, .xlsx, .xls"
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
              className="mt-8 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-medium py-3 px-8 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {loading ? 'AI is parsing file...' : 'Extract with Gemini'}
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 overflow-hidden">
          <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-zinc-100">Review Data</h2>
              <p className="text-sm text-zinc-400">Please verify AI extracted data before saving.</p>
            </div>
            <div className="flex space-x-3">
              <button 
                onClick={() => setParsedContacts([])}
                className="px-4 py-2 text-zinc-400 font-medium hover:bg-zinc-800 hover:text-zinc-200 rounded-lg transition"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-green-500 hover:bg-green-400 text-zinc-950 font-medium rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : `Save ${parsedContacts.length} Contacts`}
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
                {parsedContacts.map((c, i) => (
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
        </div>
      )}
    </div>
  );
};

export default Import;

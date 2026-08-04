import React, { useState } from 'react';
import api from '../services/api';
import { X, Send } from 'lucide-react';

const ComposePanel = ({ selectedIds, jobLinkOverride, onClose, onSuccess }) => {
  const [subjectOverride, setSubjectOverride] = useState('');
  const [bodyOverride, setBodyOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    try {
      setLoading(true);
      setError('');
      await api.post('/mail/send', { 
        contactIds: selectedIds,
        subjectOverride: subjectOverride || undefined,
        bodyOverride: bodyOverride || undefined,
        jobLinkOverride: jobLinkOverride || undefined
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to queue emails');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex justify-end z-50">
      <div className="bg-zinc-950 w-full max-w-2xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-zinc-800">
        <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">Compose Batch</h2>
            <p className="text-sm text-zinc-400">Sending to {selectedIds.length} contact{selectedIds.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <div className="mb-6 p-4 bg-red-500/10 text-red-400 rounded-lg border border-red-500/20">{error}</div>}
          
          <div className="mb-6">
            <p className="text-sm text-zinc-400 mb-4">
              Leave fields blank to use your default template from Settings.
              Placeholders available: <code className="bg-zinc-800 px-1 py-0.5 rounded text-yellow-500">{"{{companyName}}"}</code>, <code className="bg-zinc-800 px-1 py-0.5 rounded text-yellow-500">{"{{hrName}}"}</code>, <code className="bg-zinc-800 px-1 py-0.5 rounded text-yellow-500">{"{{userName}}"}</code>.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">Subject Override (Optional)</label>
              <input 
                type="text" 
                value={subjectOverride}
                onChange={e => setSubjectOverride(e.target.value)}
                placeholder="e.g. Application for Software Engineer at {{companyName}}"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none text-zinc-200"
              />
            </div>
            
            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-semibold text-zinc-300 mb-1">Body Override (Optional)</label>
              <textarea 
                value={bodyOverride}
                onChange={e => setBodyOverride(e.target.value)}
                placeholder="Hi {{hrName}},\n\nI'm applying for..."
                className="w-full h-64 bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none resize-none font-mono text-zinc-200"
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-zinc-800 bg-zinc-900 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 text-zinc-400 font-medium hover:bg-zinc-800 hover:text-zinc-200 rounded-lg mr-3 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSend}
            disabled={loading}
            className="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold rounded-lg flex items-center transition-colors shadow-sm disabled:opacity-50"
          >
            {loading ? 'Queueing...' : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Confirm & Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComposePanel;

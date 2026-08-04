import React, { useState } from 'react';
import api from '../services/api';
import { X, Send } from 'lucide-react';

const ComposePanel = ({ selectedIds, onClose, onSuccess }) => {
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
        bodyOverride: bodyOverride || undefined
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to queue emails');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-end z-50">
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Compose Batch</h2>
            <p className="text-sm text-slate-500">Sending to {selectedIds.length} contact{selectedIds.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-100">{error}</div>}
          
          <div className="mb-6">
            <p className="text-sm text-slate-500 mb-4">
              Leave fields blank to use your default template from Settings.
              Placeholders available: <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-600">{"{{companyName}}"}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-600">{"{{hrName}}"}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-600">{"{{userName}}"}</code>.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Subject Override (Optional)</label>
              <input 
                type="text" 
                value={subjectOverride}
                onChange={e => setSubjectOverride(e.target.value)}
                placeholder="e.g. Application for Software Engineer at {{companyName}}"
                className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            
            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Body Override (Optional)</label>
              <textarea 
                value={bodyOverride}
                onChange={e => setBodyOverride(e.target.value)}
                placeholder="Hi {{hrName}},\n\nI'm applying for..."
                className="w-full h-64 border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono"
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-lg mr-3 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSend}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center transition-colors shadow-sm disabled:opacity-50"
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

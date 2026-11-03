import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { X, Send, Mail, FileText, CheckCircle2, AlertCircle, ChevronDown, Star, Sparkles, Settings as SettingsIcon } from 'lucide-react';

const ComposePanel = ({ selectedIds, jobLinkOverride, roleOverride, onClose, onSuccess }) => {
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  
  const [smtpAccounts, setSmtpAccounts] = useState([]);
  const [selectedSmtpId, setSelectedSmtpId] = useState('');
  const [hasBrevo, setHasBrevo] = useState(false);
  const [useBrevoDirect, setUseBrevoDirect] = useState(false);

  const [subjectOverride, setSubjectOverride] = useState('');
  const [bodyOverride, setBodyOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Interactive Popup Modal when no SMTP account is chosen
  const [showSmtpModal, setShowSmtpModal] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await api.get('/auth/settings');
        
        // Templates
        const tmpls = data.emailTemplates && data.emailTemplates.length > 0 
          ? data.emailTemplates 
          : [{
              _id: 'default_1',
              name: 'Default Template',
              subject: data.mailTemplate?.subject || 'Application for Software Engineering Intern',
              body: data.mailTemplate?.body || '',
              isDefault: true
            }];
        setTemplates(tmpls);

        // Determine default selected template
        const activeTmplId = data.selectedTemplateId || tmpls[0]?._id;
        setSelectedTemplateId(activeTmplId);
        const activeTmpl = tmpls.find(t => t._id === activeTmplId) || tmpls[0];
        if (activeTmpl) {
          setSubjectOverride(activeTmpl.subject || '');
          setBodyOverride(activeTmpl.body || '');
        }

        // SMTP Accounts
        const smtps = data.smtpConfigs && data.smtpConfigs.length > 0 
          ? data.smtpConfigs 
          : (data.smtpConfig && data.smtpConfig.user ? [{
              _id: 'smtp_legacy',
              name: data.smtpConfig.user,
              user: data.smtpConfig.user,
              host: data.smtpConfig.host || 'smtp.gmail.com',
              port: data.smtpConfig.port || 465,
              isDefault: true
            }] : []);
        setSmtpAccounts(smtps);

        // Brevo check
        const brevoAvailable = !!data.brevoApiKey;
        setHasBrevo(brevoAvailable);

        // Determine selected SMTP
        const activeSmtpId = data.selectedSmtpId || (smtps.length > 0 ? smtps[0]._id : '');
        setSelectedSmtpId(activeSmtpId);

      } catch (err) {
        console.error('Failed to load settings in ComposePanel:', err);
      } finally {
        setLoadingSettings(false);
      }
    };
    fetchSettings();
  }, []);

  // Handle template selection change
  const handleTemplateSelect = (templateId) => {
    setSelectedTemplateId(templateId);
    const tmpl = templates.find(t => t._id === templateId);
    if (tmpl) {
      setSubjectOverride(tmpl.subject || '');
      setBodyOverride(tmpl.body || '');
    }
  };

  const handleSend = async (smtpIdToUse = null) => {
    const effectiveSmtpId = smtpIdToUse !== null ? smtpIdToUse : selectedSmtpId;

    // Check if an SMTP connection is selected
    if (!useBrevoDirect && !effectiveSmtpId) {
      setShowSmtpModal(true);
      return;
    }

    const payload = { 
      contactIds: selectedIds,
      templateId: selectedTemplateId || undefined,
      smtpId: useBrevoDirect ? undefined : effectiveSmtpId,
      subjectOverride: subjectOverride || undefined,
      bodyOverride: bodyOverride || undefined,
      jobLinkOverride: jobLinkOverride || undefined,
      roleOverride: roleOverride || undefined
    };

    const sendRequest = () => api.post('/mail/send', payload);

    try {
      setLoading(true);
      setError('');

      try {
        await sendRequest();
      } catch (firstErr) {
        // If it's a network glitch/nodemon restart, retry once after 800ms
        if (!firstErr.response) {
          console.warn('Network error on send attempt, retrying once...', firstErr);
          await new Promise(res => setTimeout(res, 800));
          await sendRequest();
        } else {
          throw firstErr;
        }
      }

      setShowSmtpModal(false);
      onSuccess();
    } catch (err) {
      console.error('Failed to queue emails:', err);
      const backendErr = err.response?.data?.error;
      const backendMsg = err.response?.data?.message;
      if (backendErr === 'NO_SMTP_SELECTED') {
        setShowSmtpModal(true);
      } else if (!err.response) {
        setError('Connection interrupted. Please click "Confirm & Send" or "Try Again" below.');
      } else {
        setError(backendMsg || backendErr || err.message || 'Failed to queue emails');
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedSmtpAccount = smtpAccounts.find(s => s._id === selectedSmtpId);

  return (
    <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex justify-end z-50">
      <div className="bg-zinc-950 w-full max-w-2xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-zinc-800">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900">
          <div>
            <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
              <Mail className="w-5 h-5 text-yellow-500" />
              Compose Batch Outreach
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Ready to send to <span className="text-yellow-400 font-bold">{selectedIds.length}</span> recipient{selectedIds.length > 1 ? 's' : ''}
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-500/10 text-red-400 rounded-xl border border-red-500/20 text-sm flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
                <span className="leading-relaxed">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={loading}
                className="shrink-0 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-bold transition disabled:opacity-50"
              >
                {loading ? 'Retrying...' : 'Try Again'}
              </button>
            </div>
          )}

          {/* SENDER SMTP ACCOUNT SELECTOR */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-yellow-500" />
                Sender Account (SMTP Connection)
              </label>
              {smtpAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSmtpModal(true)}
                  className="text-xs text-yellow-500 hover:text-yellow-400 font-semibold"
                >
                  Change Account
                </button>
              )}
            </div>

            {smtpAccounts.length === 0 && !hasBrevo ? (
              <div className="p-3 bg-red-950/30 border border-red-800/40 rounded-lg text-xs text-red-400 flex items-center justify-between">
                <span>No SMTP accounts configured in Settings!</span>
                <a 
                  href="/settings" 
                  className="font-bold underline text-yellow-400 flex items-center gap-1"
                >
                  Configure in Settings <SettingsIcon className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {smtpAccounts.map((acc) => {
                  const isChosen = !useBrevoDirect && selectedSmtpId === acc._id;
                  return (
                    <button
                      key={acc._id}
                      type="button"
                      onClick={() => {
                        setUseBrevoDirect(false);
                        setSelectedSmtpId(acc._id);
                      }}
                      className={`p-3 rounded-lg border text-left transition flex items-start justify-between gap-2 ${
                        isChosen
                          ? 'bg-zinc-800 border-yellow-500/60 shadow-sm shadow-yellow-500/5'
                          : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-zinc-100 truncate">{acc.name || acc.user}</p>
                          {isChosen && (
                            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.2 rounded font-bold">
                              Selected
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400 truncate font-mono mt-0.5">{acc.user}</p>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                        isChosen ? 'border-yellow-500 bg-yellow-500 text-zinc-950' : 'border-zinc-700'
                      }`}>
                        {isChosen && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}

                {hasBrevo && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseBrevoDirect(true);
                      setSelectedSmtpId('');
                    }}
                    className={`p-3 rounded-lg border text-left transition flex items-start justify-between gap-2 ${
                      useBrevoDirect
                        ? 'bg-zinc-800 border-yellow-500/60'
                        : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-zinc-100">Brevo API</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">Cloud Delivery via HTTPS</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                      useBrevoDirect ? 'border-yellow-500 bg-yellow-500 text-zinc-950' : 'border-zinc-700'
                    }`}>
                      {useBrevoDirect && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* TEMPLATE SELECTOR */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-yellow-500" />
                Select Email Template
              </label>
              <span className="text-xs text-zinc-500">
                {templates.length} Template{templates.length > 1 ? 's' : ''} available
              </span>
            </div>

            {/* Template Selection Pills */}
            <div className="flex flex-wrap gap-2 mb-3">
              {templates.map((tmpl) => {
                const isSelected = selectedTemplateId === tmpl._id;
                return (
                  <button
                    key={tmpl._id}
                    type="button"
                    onClick={() => handleTemplateSelect(tmpl._id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-yellow-500 text-zinc-950 border-yellow-500 font-bold shadow-sm'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-zinc-100'
                    }`}
                  >
                    <span>{tmpl.name}</span>
                    {tmpl.isDefault && <Star className={`w-3 h-3 ${isSelected ? 'fill-zinc-950' : 'text-yellow-500'}`} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* SUBJECT & BODY INPUTS */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                Subject
              </label>
              <input 
                type="text" 
                value={subjectOverride}
                onChange={e => setSubjectOverride(e.target.value)}
                placeholder="e.g. Application for Software Engineer at {{companyName}}"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none text-zinc-200"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Email Body
                </label>
                <span className="text-[11px] text-zinc-500 font-mono">
                  Supports Handlebars placeholders
                </span>
              </div>
              <textarea 
                value={bodyOverride}
                onChange={e => setBodyOverride(e.target.value)}
                rows={12}
                placeholder="Greetings,\n\nI am {{userName}}..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none resize-y font-mono text-zinc-200 leading-relaxed"
              />
            </div>
          </div>

          <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80 text-xs text-zinc-400 leading-relaxed">
            Placeholders: <code className="text-yellow-400">{"{{companyName}}"}</code>, <code className="text-yellow-400">{"{{hrName}}"}</code>, <code className="text-yellow-400">{"{{role}}"}</code>, <code className="text-yellow-400">{"{{userName}}"}</code>, <code className="text-yellow-400">{"{{resumeLink}}"}</code>.
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-zinc-800 bg-zinc-900 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            {selectedSmtpAccount ? (
              <span>Sending from <strong className="text-zinc-200">{selectedSmtpAccount.user}</strong></span>
            ) : useBrevoDirect ? (
              <span>Sending via <strong className="text-zinc-200">Brevo API</strong></span>
            ) : (
              <span className="text-amber-400 font-semibold">⚠️ No sender account chosen</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={onClose}
              className="px-5 py-2.5 text-zinc-400 font-medium hover:bg-zinc-800 hover:text-zinc-200 rounded-xl transition"
            >
              Cancel
            </button>
            <button 
              onClick={() => handleSend()}
              disabled={loading}
              className="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-extrabold rounded-xl flex items-center transition shadow-lg shadow-yellow-500/10 disabled:opacity-50 cursor-pointer"
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

      {/* ========================================================
          POPUP MODAL: SELECT SMTP CONNECTION
          (Prompted if no account was selected before clicking Send)
          ======================================================== */}
      {showSmtpModal && (
        <div className="fixed inset-0 bg-zinc-950/85 backdrop-blur-md z-60 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-100">Select Sender Account</h3>
                  <p className="text-xs text-zinc-400">Choose which connection to send from</p>
                </div>
              </div>
              <button 
                onClick={() => setShowSmtpModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 mb-4 leading-relaxed">
              You haven't selected an active email connection for this batch. Pick one of your configured SMTP accounts below to proceed:
            </p>

            {smtpAccounts.length === 0 && !hasBrevo ? (
              <div className="text-center py-6 bg-zinc-950/60 rounded-xl border border-zinc-800 p-4">
                <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-zinc-200">No SMTP Accounts Configured</p>
                <p className="text-xs text-zinc-400 mt-1 mb-4">
                  Please add your Gmail or custom SMTP credentials in Settings first.
                </p>
                <a
                  href="/settings"
                  className="inline-flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 text-xs font-bold py-2 px-4 rounded-lg"
                >
                  <SettingsIcon className="w-3.5 h-3.5" /> Open Settings
                </a>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {smtpAccounts.map((acc) => (
                  <button
                    key={acc._id}
                    type="button"
                    onClick={() => {
                      setSelectedSmtpId(acc._id);
                      setUseBrevoDirect(false);
                      setShowSmtpModal(false);
                      handleSend(acc._id);
                    }}
                    className="w-full p-3.5 rounded-xl border border-zinc-800 hover:border-yellow-500/50 bg-zinc-950/60 hover:bg-zinc-800/60 text-left transition flex items-center justify-between group"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-zinc-100 group-hover:text-yellow-400 transition">
                        {acc.name || acc.user}
                      </h4>
                      <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{acc.user}</p>
                      <span className="text-[10px] text-zinc-500 mt-0.5 block">{acc.host}:{acc.port}</span>
                    </div>

                    <div className="bg-yellow-500/10 group-hover:bg-yellow-500 text-yellow-400 group-hover:text-zinc-950 text-xs font-bold px-3 py-1.5 rounded-lg border border-yellow-500/30 transition flex items-center gap-1 shrink-0">
                      <Send className="w-3 h-3" />
                      Select & Send
                    </div>
                  </button>
                ))}

                {hasBrevo && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseBrevoDirect(true);
                      setSelectedSmtpId('');
                      setShowSmtpModal(false);
                      handleSend('brevo');
                    }}
                    className="w-full p-3.5 rounded-xl border border-zinc-800 hover:border-yellow-500/50 bg-zinc-950/60 hover:bg-zinc-800/60 text-left transition flex items-center justify-between group"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-zinc-100 group-hover:text-yellow-400 transition">
                        Brevo API
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-0.5">Cloud Delivery via HTTPS</p>
                    </div>
                    <div className="bg-yellow-500/10 group-hover:bg-yellow-500 text-yellow-400 group-hover:text-zinc-950 text-xs font-bold px-3 py-1.5 rounded-lg border border-yellow-500/30 transition flex items-center gap-1 shrink-0">
                      <Send className="w-3 h-3" />
                      Select & Send
                    </div>
                  </button>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowSmtpModal(false)}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ComposePanel;

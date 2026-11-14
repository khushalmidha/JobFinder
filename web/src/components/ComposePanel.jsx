import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { X, Send, Mail, FileText, CheckCircle2, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Star, Sparkles, Settings as SettingsIcon, ShieldCheck, AlertTriangle } from 'lucide-react';

const ComposePanel = ({ selectedIds, jobLinkOverride, roleOverride, onClose, onSuccess }) => {
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  
  const [smtpAccounts, setSmtpAccounts] = useState([]);
  const [selectedSmtpId, setSelectedSmtpId] = useState('');
  const [hasBrevo, setHasBrevo] = useState(false);

  const [subjectOverride, setSubjectOverride] = useState('');
  const [bodyOverride, setBodyOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Interactive Review & Explicit Approval states
  const [previewData, setPreviewData] = useState(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [approving, setApproving] = useState(false);

  // Recipient Review Pagination & Inspection
  const [recipientPage, setRecipientPage] = useState(0);
  const [expandedRecipientIndices, setExpandedRecipientIndices] = useState({});

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

        // Brevo check (for informational status only; durable worker requires SMTP)
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
    setPreviewData(null);
    setApprovalChecked(false);
    const tmpl = templates.find(t => t._id === templateId);
    if (tmpl) {
      setSubjectOverride(tmpl.subject || '');
      setBodyOverride(tmpl.body || '');
    }
  };

  const handlePreview = async (smtpIdToUse = null) => {
    const effectiveSmtpId = smtpIdToUse !== null ? smtpIdToUse : selectedSmtpId;

    // Check if an SMTP connection is selected
    if (!effectiveSmtpId) {
      setShowSmtpModal(true);
      return;
    }

    const payload = { 
      contactIds: selectedIds,
      templateId: selectedTemplateId || undefined,
      smtpId: effectiveSmtpId,
      subjectOverride: subjectOverride || undefined,
      bodyOverride: bodyOverride || undefined,
      jobLinkOverride: jobLinkOverride || undefined,
      roleOverride: roleOverride || undefined
    };

    try {
      setLoading(true);
      setError('');

      const { data } = await api.post('/mail/preview', payload);
      setPreviewData(data);
      setRecipientPage(0);
      setExpandedRecipientIndices({});
      setShowReviewModal(true);
      setApprovalChecked(false);
    } catch (err) {
      console.error('Failed to preview immediate outreach:', err);
      const backendErr = err.response?.data?.error;
      const backendMsg = err.response?.data?.message;
      if (backendErr === 'NO_SMTP_SELECTED') {
        setShowSmtpModal(true);
      } else if (!err.response) {
        setError('Connection interrupted. Please click "Review & Preview" or "Try Again" below.');
      } else {
        setError(backendMsg || backendErr || err.message || 'Failed to preview campaign');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndQueue = async () => {
    if (!previewData || !previewData.campaignId || !previewData.digest || !approvalChecked) {
      return;
    }

    try {
      setApproving(true);
      setError('');

      const payload = {
        campaignId: previewData.campaignId,
        approvedDigest: previewData.digest
      };

      await api.post('/mail/send', payload);
      setShowReviewModal(false);
      onSuccess();
    } catch (err) {
      console.error('Failed to approve and queue emails:', err);
      const backendErr = err.response?.data?.error;
      const backendMsg = err.response?.data?.message;
      setError(backendMsg || backendErr || err.message || 'Approval failed; preview details may have changed');
    } finally {
      setApproving(false);
    }
  };

  const toggleExpandRecipient = (idx) => {
    setExpandedRecipientIndices(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const selectedSmtpAccount = smtpAccounts.find(s => s._id === selectedSmtpId);
  const eligibleRecipients = previewData?.snapshot?.recipients || [];
  const pageSize = 5;
  const totalPages = Math.ceil(eligibleRecipients.length / pageSize);
  const currentRecipients = eligibleRecipients.slice(recipientPage * pageSize, (recipientPage + 1) * pageSize);

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
                onClick={() => handlePreview()}
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

            {smtpAccounts.length === 0 ? (
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
                  const isChosen = selectedSmtpId === acc._id;
                  return (
                    <button
                      key={acc._id}
                      type="button"
                      onClick={() => {
                        setSelectedSmtpId(acc._id);
                        setPreviewData(null);
                        setApprovalChecked(false);
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
              </div>
            )}

            {hasBrevo && (
              <div className="mt-3 p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-xs text-zinc-500 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-zinc-400">Brevo API:</span>
                  <span className="ml-1 text-[11px] text-zinc-500">Not supported for durable campaign worker dispatch (SMTP only).</span>
                </div>
                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-medium">
                  Disabled
                </span>
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
                onChange={e => {
                  setSubjectOverride(e.target.value);
                  setPreviewData(null);
                  setApprovalChecked(false);
                }}
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
                onChange={e => {
                  setBodyOverride(e.target.value);
                  setPreviewData(null);
                  setApprovalChecked(false);
                }}
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
            ) : (
              <span className="text-amber-400 font-semibold">⚠️ No SMTP sender chosen</span>
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
              onClick={() => handlePreview()}
              disabled={loading}
              className="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-extrabold rounded-xl flex items-center transition shadow-lg shadow-yellow-500/10 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Generating Preview...' : (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Review & Preview
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================
          POPUP MODAL: SELECT SMTP CONNECTION
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

            {smtpAccounts.length === 0 ? (
              <div className="text-center py-6 bg-zinc-950/60 rounded-xl border border-zinc-800 p-4">
                <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-zinc-200">No SMTP Accounts Configured</p>
                <p className="text-xs text-zinc-400 mt-1 mb-4">
                  Please add your Gmail or custom SMTP credentials in Settings first. Brevo API is not supported for durable campaign worker dispatch.
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
                      setPreviewData(null);
                      setApprovalChecked(false);
                      setShowSmtpModal(false);
                      handlePreview(acc._id);
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
                      <ShieldCheck className="w-3 h-3" />
                      Select & Review
                    </div>
                  </button>
                ))}
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

      {/* ========================================================
          EXPLICIT APPROVAL & REVIEW MODAL
          ======================================================== */}
      {showReviewModal && previewData && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-md z-60 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 max-w-2xl w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-100">Review & Explicit Approval</h3>
                  <p className="text-xs text-zinc-400">Frozen campaign digest: <span className="font-mono text-yellow-400">{previewData.digest?.slice(0, 16)}...</span></p>
                </div>
              </div>
              <button 
                onClick={() => setShowReviewModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Sender & Interval & Flag Status Banner */}
              <div className="p-3.5 bg-zinc-950/85 rounded-xl border border-zinc-800 text-xs space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Sender Account:</span>
                  <span className="font-semibold text-zinc-200">{previewData.snapshot?.senderName} &lt;{previewData.snapshot?.senderEmail}&gt;</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Execution Mode:</span>
                  <span className="text-yellow-400 font-semibold">Immediate durable dispatch queue</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Configured Cooldown:</span>
                  <span className="font-mono text-zinc-300 font-semibold">{previewData.intervalSeconds || previewData.snapshot?.intervalSeconds || 180}s interval between sends</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Daily Quota Cap:</span>
                  <span className="text-zinc-300">{previewData.snapshot?.dailyLimit} emails/day (UTC)</span>
                </div>

                <div className="pt-2 border-t border-zinc-800/80 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Outbound Sending Gate:</span>
                    <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${previewData.sendingEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                      {previewData.sendingEnabled ? 'ENABLED' : 'DISABLED (OUTREACH_SENDING_ENABLED=false)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Worker Status:</span>
                    <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${previewData.workerEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                      {previewData.workerEnabled ? 'RUNNING' : 'STANDBY / DISABLED (OUTREACH_WORKER_ENABLED=false)'}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 leading-normal pt-1">
                    Immediate outreach queues for the next worker poll cycle subject to cooldown interval, not an instant SMTP guarantee.
                  </p>
                </div>
              </div>

              {/* Counts summary */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 bg-zinc-950/60 border border-zinc-800 rounded-xl text-center">
                  <p className="text-[11px] text-zinc-400 font-medium">Selected</p>
                  <p className="text-xl font-black text-zinc-200 mt-0.5">{previewData.selectedCount || (previewData.eligibleCount + previewData.blockedCount)}</p>
                </div>
                <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/50 rounded-xl text-center">
                  <p className="text-[11px] text-emerald-400 font-medium">Eligible</p>
                  <p className="text-xl font-black text-emerald-300 mt-0.5">{previewData.eligibleCount}</p>
                </div>
                <div className="p-2.5 bg-zinc-950/60 border border-zinc-800 rounded-xl text-center">
                  <p className="text-[11px] text-zinc-400 font-medium">Excluded</p>
                  <p className="text-xl font-black text-zinc-400 mt-0.5">{previewData.blockedCount}</p>
                </div>
              </div>

              {/* Exclusions list if any */}
              {previewData.blocked && previewData.blocked.length > 0 && (
                <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Excluded Contacts ({previewData.blocked.length})</span>
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-[11px]">
                    {previewData.blocked.map((b, idx) => (
                      <div key={idx} className="flex justify-between items-center text-zinc-400 border-b border-zinc-800/50 pb-1">
                        <span className="font-mono text-zinc-300 truncate max-w-[200px]">{b.email || b.contactId || 'Unavailable'}</span>
                        <span className="text-amber-300/80 text-[10px]">{b.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Complete Eligible Recipient List with Pagination & Inspection */}
              {eligibleRecipients.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Frozen Eligible Recipients ({eligibleRecipients.length})
                    </span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <button
                          type="button"
                          onClick={() => setRecipientPage(p => Math.max(0, p - 1))}
                          disabled={recipientPage === 0}
                          className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 flex items-center"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span>
                          Page {recipientPage + 1} of {totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRecipientPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={recipientPage >= totalPages - 1}
                          className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 flex items-center"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {currentRecipients.map((r, pageIdx) => {
                      const globalIdx = recipientPage * pageSize + pageIdx;
                      const isExpanded = !!expandedRecipientIndices[globalIdx];
                      return (
                        <div key={globalIdx} className="p-3 bg-zinc-950/80 border border-zinc-800 rounded-xl space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 truncate">
                              <span className="font-mono text-zinc-200 font-semibold truncate">{r.recipientEmail}</span>
                              {r.company && (
                                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded truncate">
                                  {r.company}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleExpandRecipient(globalIdx)}
                              className="text-[11px] text-yellow-500 hover:text-yellow-400 shrink-0 font-medium"
                            >
                              {isExpanded ? 'Collapse' : 'Inspect Message'}
                            </button>
                          </div>

                          <div>
                            <span className="text-[11px] text-zinc-400">Subject: </span>
                            <span className="text-yellow-400 font-medium">{r.subject}</span>
                          </div>

                          {isExpanded ? (
                            <div className="mt-2 pt-2 border-t border-zinc-800">
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-semibold">Personalized Body:</p>
                              <pre className="text-zinc-300 font-sans text-xs whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/60">
                                {r.body}
                              </pre>
                            </div>
                          ) : (
                            <p className="text-[11px] text-zinc-400 line-clamp-1 italic">
                              {r.body}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Error banner inside Review Modal if approval or check fails */}
              {error && (
                <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span className="leading-snug">{error}</span>
                </div>
              )}

              {/* Approval Checkbox */}
              {previewData.eligibleCount > 0 ? (
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={approvalChecked}
                    onChange={(e) => setApprovalChecked(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 text-yellow-500 focus:ring-yellow-500/20"
                  />
                  <span className="text-xs text-zinc-200 leading-snug">
                    I have reviewed all {previewData.eligibleCount} frozen recipient messages, personalized subjects, bodies, exclusions, sender account, and cooldown interval. I explicitly approve queueing this immediate outreach through the durable campaign worker.
                  </span>
                </label>
              ) : (
                <div className="p-3 bg-red-950/30 border border-red-800/40 rounded-xl text-xs text-red-300 text-center">
                  All selected recipients were excluded due to existing outreach history, suppression, or qualification rules. Nothing to send.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition"
              >
                Back to Edit
              </button>

              {previewData.eligibleCount > 0 && (
                <button
                  type="button"
                  onClick={handleApproveAndQueue}
                  disabled={!approvalChecked || approving}
                  className="px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 text-xs font-extrabold rounded-xl flex items-center gap-1.5 transition disabled:opacity-40 cursor-pointer shadow-lg shadow-yellow-500/10"
                >
                  {approving ? 'Queueing...' : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Approve & Queue Now ({previewData.eligibleCount})
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ComposePanel;

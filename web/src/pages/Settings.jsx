import React, { useState, useEffect } from 'react';
import api from '../services/api';
import AccountEmailVerification from '../components/AccountEmailVerification';
import { 
  Save, User, Key, Mail, FileText, CheckCircle, Plus, Trash2, 
  Copy, Star, AlertCircle, RefreshCw, Check, ExternalLink, ShieldCheck, 
  ChevronRight, Sparkles, Users, ArrowRight, Share2, X
} from 'lucide-react';

const generateHexId = () => {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return timestamp + random;
};

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [copyToast, setCopyToast] = useState('');

  // AI Converter state
  const [showAiConverter, setShowAiConverter] = useState(false);
  const [rawAiText, setRawAiText] = useState('');
  const [converting, setConverting] = useState(false);

  // Candidate profile default
  const defaultCandidateProfile = {
    fullName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    college: '',
    degree: '',
    graduationDate: '',
    expectedAnnualSalaryINR: '',
    expectedAnnualCtcLpa: '',
    currentCompany: '',
    currentRole: '',
    internshipDuration: ''
  };

  // Settings state
  const [settings, setSettings] = useState({
    name: '',
    email: '',
    resumeLink: '',
    defaultJobLink: '',
    geminiApiKey: '',
    brevoApiKey: '',
    candidateProfile: defaultCandidateProfile,
    emailTemplates: [],
    selectedTemplateId: '',
    smtpConfigs: [],
    selectedSmtpId: '',
    dailyEmailLimit: 450,
    syncedAccountEmails: []
  });

  // Sync accounts state
  const [availableSyncAccounts, setAvailableSyncAccounts] = useState([]);
  const [customSyncEmail, setCustomSyncEmail] = useState('');

  // Active template tab index
  const [activeTemplateIdx, setActiveTemplateIdx] = useState(0);

  // SMTP accounts testing states: { [accountId or idx]: { testing: boolean, result: { type, message } } }
  const [smtpTesting, setSmtpTesting] = useState({});
  const [editingSmtpIdx, setEditingSmtpIdx] = useState(null);
  const [showAddSmtpModal, setShowAddSmtpModal] = useState(false);
  const [newSmtpForm, setNewSmtpForm] = useState({
    name: '',
    host: 'smtp.gmail.com',
    port: 465,
    user: '',
    pass: '',
    isDefault: false
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await api.get('/auth/settings');
        
        let templates = data.emailTemplates && data.emailTemplates.length > 0 
          ? data.emailTemplates 
          : [{
              _id: 'default_1',
              name: 'Default Template',
              subject: data.mailTemplate?.subject || 'Application for Software Engineering Intern',
              body: data.mailTemplate?.body || '',
              isDefault: true
            }];

        let smtpList = data.smtpConfigs && data.smtpConfigs.length > 0 
          ? data.smtpConfigs 
          : (data.smtpConfig && data.smtpConfig.user ? [{
              _id: 'smtp_1',
              name: data.smtpConfig.user || 'Primary Account',
              host: data.smtpConfig.host || 'smtp.gmail.com',
              port: data.smtpConfig.port || 465,
              user: data.smtpConfig.user || '',
              pass: data.smtpConfig.pass || '',
              isDefault: true
            }] : []);

        const activeTemplateId = data.selectedTemplateId || templates[0]?._id;
        const activeSmtpId = data.selectedSmtpId || (smtpList.length > 0 ? smtpList[0]._id : '');

        setSettings({
          ...data,
          candidateProfile: {
            ...defaultCandidateProfile,
            ...(data.candidateProfile || {})
          },
          emailTemplates: templates,
          selectedTemplateId: activeTemplateId,
          smtpConfigs: smtpList,
          selectedSmtpId: activeSmtpId,
          dailyEmailLimit: data.dailyEmailLimit ?? 450,
          syncedAccountEmails: data.syncedAccountEmails || []
        });

        // Set active template tab index
        const foundIdx = templates.findIndex(t => t._id === activeTemplateId);
        setActiveTemplateIdx(foundIdx >= 0 ? foundIdx : 0);

        // Fetch available registered accounts for sync
        api.get('/auth/available-sync-accounts')
          .then(({ data: accounts }) => setAvailableSyncAccounts(accounts || []))
          .catch(console.error);

      } catch (err) {
        console.error('Error fetching settings:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleProfileChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      candidateProfile: {
        ...(prev.candidateProfile || defaultCandidateProfile),
        [field]: value
      }
    }));
  };

  const handleToggleSyncAccount = (targetEmail) => {
    const norm = targetEmail.toLowerCase().trim();
    setSettings(prev => {
      const current = prev.syncedAccountEmails || [];
      const exists = current.some(e => e.toLowerCase().trim() === norm);
      const updated = exists 
        ? current.filter(e => e.toLowerCase().trim() !== norm)
        : [...current, norm];
      return { ...prev, syncedAccountEmails: updated };
    });
  };

  const handleAddCustomSyncEmail = (e) => {
    if (e) e.preventDefault();
    const trimmed = customSyncEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }
    if (trimmed === (settings.email || '').toLowerCase().trim()) {
      alert('You cannot sync contacts to your own active account.');
      return;
    }
    setSettings(prev => {
      const current = prev.syncedAccountEmails || [];
      if (current.some(e => e.toLowerCase().trim() === trimmed)) {
        return prev;
      }
      return { ...prev, syncedAccountEmails: [...current, trimmed] };
    });
    setCustomSyncEmail('');
  };

  const handleRemoveSyncAccount = (emailToRemove) => {
    setSettings(prev => ({
      ...prev,
      syncedAccountEmails: (prev.syncedAccountEmails || []).filter(
        e => e.toLowerCase().trim() !== emailToRemove.toLowerCase().trim()
      )
    }));
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      const { data } = await api.patch('/auth/settings', settings);
      setSettings(prev => ({
        ...prev,
        ...data
      }));
      setStatus('Settings saved successfully!');
      setTimeout(() => setStatus(''), 4000);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // --- TEMPLATES LOGIC ---
  const currentTemplate = settings.emailTemplates[activeTemplateIdx] || settings.emailTemplates[0];

  const handleTemplateChange = (field, value) => {
    setSettings(prev => {
      const updated = [...prev.emailTemplates];
      if (!updated[activeTemplateIdx]) return prev;
      updated[activeTemplateIdx] = {
        ...updated[activeTemplateIdx],
        [field]: value
      };
      return { ...prev, emailTemplates: updated };
    });
  };

  const handleAddTemplate = () => {
    const newId = generateHexId();
    const newTemplate = {
      _id: newId,
      name: `Template ${settings.emailTemplates.length + 1}`,
      subject: `Referral request | ${settings.name || 'Applicant'}`,
      body: `Hello recruiting team,\n\nI am {{userName}}. I am interested in the {{role}} opportunity at {{companyName}}.\n\nPlease review my resume: {{resumeLink}}\n\nBest regards,\n{{userName}}`,
      isDefault: settings.emailTemplates.length === 0
    };

    setSettings(prev => ({
      ...prev,
      emailTemplates: [...prev.emailTemplates, newTemplate],
      selectedTemplateId: prev.selectedTemplateId || newId
    }));
    setActiveTemplateIdx(settings.emailTemplates.length);
  };

  const handleDeleteTemplate = (idxToDelete) => {
    if (settings.emailTemplates.length <= 1) {
      alert('You must have at least one template saved.');
      return;
    }
    const templateToDelete = settings.emailTemplates[idxToDelete];
    if (!window.confirm(`Are you sure you want to delete template "${templateToDelete.name}"?`)) {
      return;
    }

    setSettings(prev => {
      const filtered = prev.emailTemplates.filter((_, idx) => idx !== idxToDelete);
      let newSelectedId = prev.selectedTemplateId;
      if (prev.selectedTemplateId === templateToDelete._id) {
        newSelectedId = filtered[0]?._id || '';
      }
      return {
        ...prev,
        emailTemplates: filtered,
        selectedTemplateId: newSelectedId
      };
    });

    setActiveTemplateIdx(0);
  };

  const handleDuplicateTemplate = () => {
    if (!currentTemplate) return;
    const newId = generateHexId();
    const duplicated = {
      ...currentTemplate,
      _id: newId,
      name: `${currentTemplate.name} (Copy)`,
      isDefault: false
    };

    setSettings(prev => ({
      ...prev,
      emailTemplates: [...prev.emailTemplates, duplicated]
    }));
    setActiveTemplateIdx(settings.emailTemplates.length);
  };

  const handleSelectDefaultTemplate = (templateId) => {
    setSettings(prev => {
      const updated = prev.emailTemplates.map(t => ({
        ...t,
        isDefault: t._id === templateId
      }));
      return {
        ...prev,
        emailTemplates: updated,
        selectedTemplateId: templateId
      };
    });
  };

  const handleAiConvert = async () => {
    if (!rawAiText.trim()) return;
    setConverting(true);
    try {
      const { data } = await api.post('/auth/convert-template', { rawText: rawAiText });
      if (data.subject || data.body) {
        handleTemplateChange('subject', data.subject || currentTemplate?.subject || '');
        handleTemplateChange('body', data.body || currentTemplate?.body || '');
      }
      setShowAiConverter(false);
      setRawAiText('');
      setStatus('AI template conversion applied! Click "Save Settings" to persist.');
      setTimeout(() => setStatus(''), 5000);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to convert template with AI');
    } finally {
      setConverting(false);
    }
  };

  const copyToClipboard = (tag) => {
    navigator.clipboard.writeText(tag);
    setCopyToast(`Copied ${tag}`);
    setTimeout(() => setCopyToast(''), 2000);
  };

  // --- SMTP CONFIGURATIONS LOGIC ---
  const handleSelectActiveSmtp = (smtpId) => {
    setSettings(prev => {
      const updated = prev.smtpConfigs.map(s => ({
        ...s,
        isDefault: s._id === smtpId
      }));
      return {
        ...prev,
        smtpConfigs: updated,
        selectedSmtpId: smtpId
      };
    });
  };

  const handleDeleteSmtp = (idxToDelete) => {
    const account = settings.smtpConfigs[idxToDelete];
    if (!window.confirm(`Are you sure you want to remove SMTP account "${account.name || account.user}"?`)) {
      return;
    }

    setSettings(prev => {
      const filtered = prev.smtpConfigs.filter((_, idx) => idx !== idxToDelete);
      let newSelectedId = prev.selectedSmtpId;
      if (prev.selectedSmtpId === account._id) {
        newSelectedId = filtered[0]?._id || '';
      }
      return {
        ...prev,
        smtpConfigs: filtered,
        selectedSmtpId: newSelectedId
      };
    });
  };

  const handleSaveSmtpAccount = (accountData, idxToUpdate = null) => {
    if (!accountData.user) {
      alert('Please enter an SMTP username / email address.');
      return;
    }
    if (!accountData.pass) {
      alert('Please enter the SMTP password or Google App Password.');
      return;
    }

    setSettings(prev => {
      let updatedList = [...prev.smtpConfigs];
      if (idxToUpdate !== null && idxToUpdate >= 0) {
        updatedList[idxToUpdate] = {
          ...updatedList[idxToUpdate],
          ...accountData
        };
      } else {
        const newId = generateHexId();
        const isFirst = updatedList.length === 0;
        updatedList.push({
          ...accountData,
          _id: newId,
          name: accountData.name || accountData.user,
          isDefault: isFirst || accountData.isDefault
        });
      }

      // If marked default or first, set selectedSmtpId
      let selectedId = prev.selectedSmtpId;
      if (accountData.isDefault || updatedList.length === 1) {
        selectedId = updatedList[idxToUpdate !== null ? idxToUpdate : updatedList.length - 1]._id;
      }

      return {
        ...prev,
        smtpConfigs: updatedList,
        selectedSmtpId: selectedId
      };
    });

    setShowAddSmtpModal(false);
    setEditingSmtpIdx(null);
    setNewSmtpForm({
      name: '',
      host: 'smtp.gmail.com',
      port: 465,
      user: '',
      pass: '',
      isDefault: false
    });
  };

  const handleTestAccountConnection = async (account, testKey) => {
    setSmtpTesting(prev => ({ ...prev, [testKey]: { testing: true, result: null } }));
    try {
      const { data } = await api.post('/mail/test-connection', {
        smtpConfig: {
          host: account.host || 'smtp.gmail.com',
          port: Number(account.port) || 465,
          user: account.user,
          pass: account.pass
        },
        smtpId: account._id
      });
      setSmtpTesting(prev => ({
        ...prev,
        [testKey]: { testing: false, result: { type: 'success', message: data.message || 'Connected successfully!' } }
      }));
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to connect. Please check credentials.';
      setSmtpTesting(prev => ({
        ...prev,
        [testKey]: { testing: false, result: { type: 'error', message: errorMsg } }
      }));
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-zinc-400 flex flex-col items-center justify-center min-h-[50vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-yellow-500 mb-4" />
        <p className="text-sm font-medium">Loading your settings...</p>
      </div>
    );
  }

  const placeholders = [
    { tag: '{{userName}}', desc: 'Your Name' },
    { tag: '{{userEmail}}', desc: 'Your Email' },
    { tag: '{{resumeLink}}', desc: 'Resume URL' },
    { tag: '{{companyName}}', desc: 'Company' },
    { tag: '{{hrName}}', desc: 'HR / Contact Name' },
    { tag: '{{role}}', desc: 'Target Role' },
    { tag: '{{jobLink}}', desc: 'Job Post Link' }
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-zinc-100 tracking-tight flex items-center">
            Settings & Outreach Configuration
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Manage your personal profile, email templates, and multiple SMTP connections.
          </p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold py-2.5 px-6 rounded-xl shadow-lg shadow-yellow-500/10 transition-all duration-200 disabled:opacity-50 flex items-center shrink-0 cursor-pointer"
        >
          {saving ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <AccountEmailVerification />
      {status && (
        <div className={`p-4 mb-6 rounded-xl border text-sm font-medium flex items-center shadow-sm animate-in fade-in duration-200 ${
          status.includes('success') 
            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60' 
            : 'bg-red-950/40 text-red-400 border-red-800/60'
        }`}>
          {status.includes('success') ? (
            <CheckCircle className="w-5 h-5 mr-3 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 mr-3 shrink-0 text-red-400" />
          )}
          <span>{status}</span>
        </div>
      )}

      {copyToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-yellow-500 text-zinc-950 text-xs font-bold px-4 py-2 rounded-lg shadow-xl flex items-center animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 mr-1.5" />
          {copyToast}
        </div>
      )}

      <div className="space-y-8">
        
        {/* ========================================================
            SECTION 0: CANDIDATE PROFILE & COMPENSATION STANDARDS
            ======================================================== */}
        <section className="bg-zinc-900/90 rounded-2xl shadow-xl border border-yellow-500/30 p-6 md:p-7 backdrop-blur-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/5 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
                  <User className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-zinc-100">Candidate Profile & Compensation Standards</h2>
                <span className="text-xs bg-emerald-950 text-emerald-400 font-bold px-2.5 py-1 rounded-full border border-emerald-800/80">
                  Verified Resume & Preferences
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1.5">
                Primary source of truth for verified academic/internship credentials and applicant-configured target compensation. Edit independently anytime.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Full Name</label>
              <input
                type="text"
                value={settings.candidateProfile?.fullName || ''}
                onChange={(e) => handleProfileChange('fullName', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Primary Email</label>
              <input
                type="email"
                value={settings.candidateProfile?.email || ''}
                onChange={(e) => handleProfileChange('email', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Mobile / Phone</label>
              <input
                type="text"
                value={settings.candidateProfile?.phone || ''}
                onChange={(e) => handleProfileChange('phone', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">College / Institution</label>
              <input
                type="text"
                value={settings.candidateProfile?.college || ''}
                onChange={(e) => handleProfileChange('college', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Degree & Major</label>
              <input
                type="text"
                value={settings.candidateProfile?.degree || ''}
                onChange={(e) => handleProfileChange('degree', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Graduation Date</label>
              <input
                type="text"
                value={settings.candidateProfile?.graduationDate || ''}
                onChange={(e) => handleProfileChange('graduationDate', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-yellow-500/20 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-yellow-400 font-bold text-xs uppercase tracking-wide">💰 Target Compensation Standards (Candidate Preference)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">
                  Expected Annual Salary (INR)
                </label>
                <input
                  type="text"
                  value={settings.candidateProfile?.expectedAnnualSalaryINR || ''}
                  onChange={(e) => handleProfileChange('expectedAnnualSalaryINR', e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-750 rounded-lg p-2.5 text-xs font-mono font-bold text-yellow-400 focus:border-yellow-500 outline-none"
                />
                <p className="text-[11px] text-zinc-400 mt-1">Used when application asks for annual compensation/salary in INR.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">
                  Expected Annual CTC (in LPA)
                </label>
                <input
                  type="text"
                  value={settings.candidateProfile?.expectedAnnualCtcLpa || ''}
                  onChange={(e) => handleProfileChange('expectedAnnualCtcLpa', e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-750 rounded-lg p-2.5 text-xs font-mono font-bold text-yellow-400 focus:border-yellow-500 outline-none"
                />
                <p className="text-[11px] text-zinc-400 mt-1">Used when form explicitly asks for expected CTC in LPA (value: 30).</p>
              </div>
            </div>
            <p className="text-[11px] text-zinc-400 mt-2.5 italic">
              * Note: Expected compensation is candidate-configured target preference, not an unverified past resume fact. The automation never confuses annual compensation with monthly salary, fixed pay, or current compensation. Current salary or notice period are never fabricated.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Internship Company</label>
              <input
                type="text"
                value={settings.candidateProfile?.currentCompany || ''}
                onChange={(e) => handleProfileChange('currentCompany', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Internship Role</label>
              <input
                type="text"
                value={settings.candidateProfile?.currentRole || ''}
                onChange={(e) => handleProfileChange('currentRole', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-300 block mb-1">Internship Duration</label>
              <input
                type="text"
                value={settings.candidateProfile?.internshipDuration || ''}
                onChange={(e) => handleProfileChange('internshipDuration', e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:border-yellow-500 outline-none"
              />
            </div>
          </div>
        </section>

        {/* ========================================================
            SECTION 1: MULTIPLE EMAIL TEMPLATES
            ======================================================== */}
        <section className="bg-zinc-900/90 rounded-2xl shadow-xl border border-zinc-800 p-6 md:p-7 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
                  <FileText className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-zinc-100">Email Templates</h2>
                <span className="text-xs bg-zinc-800 text-zinc-300 font-semibold px-2.5 py-1 rounded-full border border-zinc-700">
                  {settings.emailTemplates.length} Saved
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1.5">
                Save multiple outreach templates for different roles or companies. Whichever you select will be used for sending.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setShowAiConverter(!showAiConverter)}
                className="flex-1 sm:flex-initial bg-zinc-800 hover:bg-zinc-700/80 text-yellow-400 hover:text-yellow-300 text-xs font-semibold py-2 px-3.5 rounded-lg border border-zinc-700 transition flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {showAiConverter ? 'Hide AI Converter' : 'Convert with AI ✨'}
              </button>
              <button
                type="button"
                onClick={handleAddTemplate}
                className="flex-1 sm:flex-initial bg-yellow-500 hover:bg-yellow-400 text-zinc-950 text-xs font-bold py-2 px-3.5 rounded-lg transition flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Template
              </button>
            </div>
          </div>

          {/* AI Converter Expandable Box */}
          {showAiConverter && (
            <div className="mb-6 bg-gradient-to-br from-zinc-900 to-zinc-850 p-5 rounded-xl border border-yellow-500/30 shadow-lg animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-yellow-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                  AI Cold Email Converter
                </h3>
                <span className="text-xs text-zinc-400">Powered by Gemini</span>
              </div>
              <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                Paste any drafted email below. The AI will automatically detect placeholders and replace company names, roles, and contacts with parameterized tags (<code className="text-yellow-400">{"{{companyName}}"}</code>, <code className="text-yellow-400">{"{{role}}"}</code>, etc.) for the current template.
              </p>
              <textarea 
                value={rawAiText}
                onChange={(e) => setRawAiText(e.target.value)}
                placeholder="Paste raw email with Subject and Body here..."
                className="w-full h-36 bg-zinc-950 border border-zinc-750 text-zinc-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none resize-none mb-3 font-mono placeholder:text-zinc-600"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowAiConverter(false); setRawAiText(''); }}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAiConvert}
                  disabled={converting || !rawAiText.trim()}
                  className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 text-xs font-bold py-2 px-4 rounded-lg shadow transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {converting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {converting ? 'Converting...' : 'Apply to Active Template'}
                </button>
              </div>
            </div>
          )}

          {/* Template Tabs Selector */}
          <div className="flex flex-wrap items-center gap-2 mb-6 border-b border-zinc-800/80 pb-3">
            {settings.emailTemplates.map((tmpl, idx) => {
              const isSelected = activeTemplateIdx === idx;
              const isDefault = settings.selectedTemplateId === tmpl._id || tmpl.isDefault;
              return (
                <button
                  key={tmpl._id || idx}
                  type="button"
                  onClick={() => setActiveTemplateIdx(idx)}
                  className={`group relative text-xs font-medium px-4 py-2 rounded-xl transition flex items-center gap-2 border ${
                    isSelected 
                      ? 'bg-zinc-800 text-yellow-400 border-yellow-500/50 shadow-sm' 
                      : 'bg-zinc-900/60 text-zinc-400 border-zinc-800 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <span className="truncate max-w-[150px] font-semibold">{tmpl.name || `Template ${idx + 1}`}</span>
                  {isDefault && (
                    <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <Star className="w-2.5 h-2.5 fill-yellow-400" />
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active Template Editor Form */}
          {currentTemplate && (
            <div className="space-y-5 bg-zinc-950/50 p-5 rounded-xl border border-zinc-800/80">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-800/60">
                <div className="flex-1 max-w-md">
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                    Template Name
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.name || ''}
                    onChange={(e) => handleTemplateChange('name', e.target.value)}
                    placeholder="e.g. 6-Month SWE Intern Template"
                    className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-yellow-500 outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSelectDefaultTemplate(currentTemplate._id)}
                    className={`text-xs font-semibold px-3 py-2 rounded-lg border transition flex items-center gap-1.5 ${
                      settings.selectedTemplateId === currentTemplate._id
                        ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                        : 'bg-zinc-800 text-zinc-300 hover:text-yellow-400 border-zinc-700'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${settings.selectedTemplateId === currentTemplate._id ? 'fill-emerald-400' : ''}`} />
                    {settings.selectedTemplateId === currentTemplate._id ? 'Active Default Template' : 'Set as Active Default'}
                  </button>

                  <button
                    type="button"
                    onClick={handleDuplicateTemplate}
                    title="Duplicate Template"
                    className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 rounded-lg border border-zinc-700 transition"
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  {settings.emailTemplates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(activeTemplateIdx)}
                      title="Delete Template"
                      className="p-2 bg-red-950/30 hover:bg-red-900/40 text-red-400 rounded-lg border border-red-800/40 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                  Subject Line
                </label>
                <input
                  type="text"
                  value={currentTemplate.subject || ''}
                  onChange={(e) => handleTemplateChange('subject', e.target.value)}
                  placeholder="Referral request | Your name"
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                  Email Body
                </label>
                <textarea
                  value={currentTemplate.body || ''}
                  onChange={(e) => handleTemplateChange('body', e.target.value)}
                  rows={10}
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none font-mono resize-y leading-relaxed"
                />
              </div>

              {/* Clickable Placeholders Tag Bar */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Click to copy placeholder tags:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map(({ tag, desc }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => copyToClipboard(tag)}
                      className="bg-zinc-800/80 hover:bg-zinc-700 text-yellow-500/90 hover:text-yellow-400 text-xs px-2.5 py-1 rounded-md border border-zinc-700 transition flex items-center gap-1"
                      title={desc}
                    >
                      <code>{tag}</code>
                      <span className="text-[10px] text-zinc-400">({desc})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ========================================================
            SECTION 2: MULTIPLE SMTP CONNECTIONS
            ======================================================== */}
        <section className="bg-zinc-900/90 rounded-2xl shadow-xl border border-zinc-800 p-6 md:p-7 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
                  <Mail className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-zinc-100">SMTP Connections (Email Accounts)</h2>
                <span className="text-xs bg-zinc-800 text-zinc-300 font-semibold px-2.5 py-1 rounded-full border border-zinc-700">
                  {settings.smtpConfigs.length} Configured
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1.5">
                Save multiple sender email accounts. Pick one as the active sender, or choose dynamically in the compose dialog.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingSmtpIdx(null);
                setNewSmtpForm({
                  name: '',
                  host: 'smtp.gmail.com',
                  port: 465,
                  user: '',
                  pass: '',
                  isDefault: settings.smtpConfigs.length === 0
                });
                setShowAddSmtpModal(true);
              }}
              className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 text-xs font-bold py-2 px-4 rounded-lg transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add SMTP Account
            </button>
          </div>

          {/* Important Gmail Notice */}
          <div className="mb-6 p-4 bg-amber-950/25 border border-amber-800/40 rounded-xl text-xs text-amber-200/90 leading-relaxed flex items-start gap-3">
            <span className="text-base leading-none">⚠️</span>
            <div>
              <strong className="text-amber-300">Important for Gmail Accounts:</strong> Google blocks normal account passwords for automated apps. You must enable 2-Step Verification on your Google Account and generate a 16-character <strong>App Password</strong> at{' '}
              <a 
                href="https://myaccount.google.com/apppasswords" 
                target="_blank" 
                rel="noreferrer" 
                className="underline font-bold text-yellow-400 hover:text-yellow-300 inline-flex items-center gap-0.5"
              >
                myaccount.google.com/apppasswords <ExternalLink className="w-3 h-3" />
              </a>
              , then paste that 16-character code into the password field without spaces.
            </div>
          </div>

          {/* Daily Outreach Safety Limit (Cap) */}
          <div className="mb-6 p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-400 mt-0.5 border border-yellow-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-zinc-100">Daily Outreach Safety Limit</h3>
                  <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-bold">
                    Default: 450 / day (50 reserved for personal use)
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 max-w-xl leading-relaxed">
                  Automatically stops sending emails once this daily limit is reached. 
                  Gmail allows 500 emails/day — setting this to 450 reserves <strong>50 emails for your personal &amp; job emails</strong>!
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 self-start sm:self-auto">
              <input
                type="number"
                min="1"
                max="500"
                name="dailyEmailLimit"
                value={settings.dailyEmailLimit ?? 450}
                onChange={handleChange}
                className="w-24 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-yellow-400 font-bold text-center outline-none focus:ring-2 focus:ring-yellow-500 shadow-inner"
              />
              <span className="text-xs text-zinc-400 font-semibold">mails / day</span>
            </div>
          </div>

          {/* SMTP Accounts List */}
          {settings.smtpConfigs.length === 0 ? (
            <div className="text-center py-10 bg-zinc-950/40 rounded-xl border border-zinc-800/80 p-6">
              <Mail className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-zinc-300">No SMTP accounts added yet</p>
              <p className="text-xs text-zinc-500 mt-1 mb-4">Add your Gmail or custom SMTP credentials to start sending outreach emails.</p>
              <button
                type="button"
                onClick={() => setShowAddSmtpModal(true)}
                className="bg-zinc-800 hover:bg-zinc-700 text-yellow-400 text-xs font-bold py-2 px-4 rounded-lg border border-zinc-700 transition"
              >
                + Add Your First Account
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {settings.smtpConfigs.map((acc, idx) => {
                const isActive = settings.selectedSmtpId === acc._id || (!settings.selectedSmtpId && idx === 0);
                const testState = smtpTesting[acc._id || idx];

                return (
                  <div
                    key={acc._id || idx}
                    className={`relative rounded-xl p-5 border transition-all ${
                      isActive 
                        ? 'bg-zinc-900 border-yellow-500/60 shadow-lg shadow-yellow-500/5' 
                        : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-zinc-100">{acc.name || acc.user}</h4>
                          {isActive && (
                            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <Star className="w-2.5 h-2.5 fill-yellow-400" />
                              Active Sender
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 font-mono mt-0.5">{acc.user}</p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSmtpIdx(idx);
                            setNewSmtpForm({ ...acc });
                            setShowAddSmtpModal(true);
                          }}
                          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition"
                          title="Edit Account"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSmtp(idx)}
                          className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition"
                          title="Delete Account"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-zinc-500 flex items-center gap-3 mb-4">
                      <span>Host: <code className="text-zinc-300">{acc.host}:{acc.port}</code></span>
                      <span>Password: <code className="text-zinc-400">••••••••</code></span>
                    </div>

                    {/* Test result message if available */}
                    {testState?.result && (
                      <div className={`mb-3 p-2.5 rounded-lg text-xs border ${
                        testState.result.type === 'success'
                          ? 'bg-emerald-950/30 text-emerald-400 border-emerald-800/40'
                          : 'bg-red-950/30 text-red-400 border-red-800/40'
                      }`}>
                        {testState.result.message}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
                      <button
                        type="button"
                        onClick={() => handleTestAccountConnection(acc, acc._id || idx)}
                        disabled={testState?.testing}
                        className="text-xs font-semibold px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 rounded-lg border border-zinc-700 transition flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {testState?.testing ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5" />
                        )}
                        {testState?.testing ? 'Testing...' : 'Test Connection'}
                      </button>

                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => handleSelectActiveSmtp(acc._id)}
                          className="text-xs font-semibold px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-yellow-400 rounded-lg border border-zinc-700 transition"
                        >
                          Select as Active
                        </button>
                      ) : (
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Default Chosen
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Modal / Inline Dialog to Add or Edit SMTP Account */}
          {showAddSmtpModal && (
            <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-150">
                <h3 className="text-lg font-bold text-zinc-100 mb-1">
                  {editingSmtpIdx !== null ? 'Edit SMTP Account' : 'Add New SMTP Account'}
                </h3>
                <p className="text-xs text-zinc-400 mb-5">
                  Enter your mail server credentials. For Gmail, use an App Password.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                      Account Name / Label
                    </label>
                    <input
                      type="text"
                      value={newSmtpForm.name}
                      onChange={(e) => setNewSmtpForm({ ...newSmtpForm, name: e.target.value })}
                      placeholder="e.g. Primary Gmail, Work Account, College Mail"
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                        Host
                      </label>
                      <input
                        type="text"
                        value={newSmtpForm.host}
                        onChange={(e) => setNewSmtpForm({ ...newSmtpForm, host: e.target.value })}
                        placeholder="smtp.gmail.com"
                        className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                        Port
                      </label>
                      <input
                        type="number"
                        value={newSmtpForm.port}
                        onChange={(e) => setNewSmtpForm({ ...newSmtpForm, port: Number(e.target.value) })}
                        placeholder="465"
                        className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                      SMTP Username / Email
                    </label>
                    <input
                      type="email"
                      value={newSmtpForm.user}
                      onChange={(e) => setNewSmtpForm({ ...newSmtpForm, user: e.target.value })}
                      placeholder="khushalmidha18@gmail.com"
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                      SMTP Password / App Password
                    </label>
                    <input
                      type="password"
                      value={newSmtpForm.pass}
                      onChange={(e) => setNewSmtpForm({ ...newSmtpForm, pass: e.target.value })}
                      placeholder="16-character Google App Password"
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="isDefaultSmtp"
                      checked={newSmtpForm.isDefault}
                      onChange={(e) => setNewSmtpForm({ ...newSmtpForm, isDefault: e.target.checked })}
                      className="rounded bg-zinc-800 border-zinc-700 text-yellow-500 focus:ring-yellow-500"
                    />
                    <label htmlFor="isDefaultSmtp" className="text-xs text-zinc-300 font-medium">
                      Set as active default sender account
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSmtpModal(false);
                      setEditingSmtpIdx(null);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveSmtpAccount(newSmtpForm, editingSmtpIdx)}
                    className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 text-xs font-bold rounded-lg shadow transition"
                  >
                    {editingSmtpIdx !== null ? 'Update Account' : 'Save Account'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ========================================================
            SECTION 3: SYNC ACCOUNTS (ONE-WAY CONTACT SYNC)
            ======================================================== */}
        <section className="bg-zinc-900/90 rounded-2xl shadow-xl border border-zinc-800 p-6 md:p-7 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
                  <Users className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-zinc-100">Sync Accounts (One-Way Auto-Import)</h2>
                <span className="text-[10px] bg-yellow-500/20 text-yellow-400 font-bold px-2.5 py-1 rounded-full border border-yellow-500/30 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" /> One-Way Push Only
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                When you import contacts into this account (via Excel/CSV, PDF, or Scout), they will automatically be imported into your selected accounts below. <strong>It will never sync back from those accounts to this account.</strong>
              </p>
            </div>
            
            <div className="text-xs bg-zinc-800/80 text-zinc-300 font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 shrink-0">
              {(settings.syncedAccountEmails || []).length} Synced Account{((settings.syncedAccountEmails || []).length === 1) ? '' : 's'}
            </div>
          </div>

          {/* Active Synced Accounts Tags */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Currently Synced Accounts (Will Receive All Your New Contacts)
            </label>
            {(settings.syncedAccountEmails || []).length === 0 ? (
              <div className="p-4 bg-zinc-950/40 rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-500 text-center">
                No sync accounts selected. Select from registered accounts below or type an email to add.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {settings.syncedAccountEmails.map((email) => (
                  <div
                    key={email}
                    className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm animate-in fade-in"
                  >
                    <span className="font-mono">{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSyncAccount(email)}
                      className="text-yellow-500/70 hover:text-yellow-200 transition p-0.5 rounded cursor-pointer"
                      title="Remove from sync"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Select Registered Accounts */}
          {availableSyncAccounts.length > 0 && (
            <div className="mb-6">
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Click to Select / Unselect Registered Accounts:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {availableSyncAccounts.map((acc) => {
                  const isSelected = (settings.syncedAccountEmails || []).some(
                    e => e.toLowerCase().trim() === acc.email.toLowerCase().trim()
                  );
                  return (
                    <button
                      key={acc._id}
                      type="button"
                      onClick={() => handleToggleSyncAccount(acc.email)}
                      className={`p-3 rounded-xl border text-left transition flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-800 border-yellow-500/60 shadow-sm text-yellow-400'
                          : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate text-zinc-200">{acc.name || 'User'}</p>
                        <p className="text-[11px] text-zinc-400 font-mono truncate">{acc.email}</p>
                      </div>
                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-yellow-500 border-yellow-500 text-zinc-950 font-bold' : 'border-zinc-700'
                      }`}>
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Custom Email Form */}
          <div className="pt-4 border-t border-zinc-800/80">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Or Add Custom Account Email to Sync:
            </label>
            <div className="flex gap-2 max-w-md">
              <input
                type="email"
                value={customSyncEmail}
                onChange={(e) => setCustomSyncEmail(e.target.value)}
                placeholder="e.g. your-second-account@gmail.com"
                className="flex-1 bg-zinc-950 border border-zinc-750 text-zinc-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-yellow-500 outline-none font-mono"
              />
              <button
                type="button"
                onClick={handleAddCustomSyncEmail}
                disabled={!customSyncEmail.trim()}
                className="bg-zinc-800 hover:bg-zinc-700 text-yellow-400 text-xs font-bold px-4 py-2 rounded-lg border border-zinc-700 transition disabled:opacity-40 cursor-pointer"
              >
                Add Email
              </button>
            </div>
          </div>

          <div className="mt-4 p-3 bg-zinc-950/40 border border-zinc-800 rounded-lg text-xs text-zinc-400 flex items-start gap-2">
            <span className="text-yellow-500 shrink-0">🔒</span>
            <span>
              <strong>One-Way Safe Guarantee:</strong> When you import contacts, duplicate checking runs automatically on each target account so no duplicates are created. The target accounts cannot view or modify your settings or contacts.
            </span>
          </div>
        </section>

        {/* ========================================================
            SECTION 4: PERSONAL INFO
            ======================================================== */}
        <section className="bg-zinc-900/90 rounded-2xl shadow-xl border border-zinc-800 p-6 md:p-7 backdrop-blur-sm">
          <div className="flex items-center gap-2.5 mb-6 pb-4 border-b border-zinc-800">
            <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">Personal Info</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Used to fill in {"{{userName}}"} and {"{{resumeLink}}"}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Full Name</label>
              <input 
                type="text" 
                name="name" 
                value={settings.name || ''} 
                onChange={handleChange} 
                className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Registered Email</label>
              <input 
                type="email" 
                name="email" 
                value={settings.email || ''} 
                disabled 
                className="w-full bg-zinc-800/40 border border-zinc-800 text-zinc-500 rounded-lg p-2.5 text-sm cursor-not-allowed font-mono" 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Resume Link (Google Drive / Doc)</label>
              <input 
                type="text" 
                name="resumeLink" 
                value={settings.resumeLink || ''} 
                onChange={handleChange} 
                placeholder="https://drive.google.com/..." 
                className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Default Job Post Link (Optional)</label>
              <input 
                type="text" 
                name="defaultJobLink" 
                value={settings.defaultJobLink || ''} 
                onChange={handleChange} 
                placeholder="https://company.com/jobs/..." 
                className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" 
              />
            </div>
          </div>
        </section>

        {/* ========================================================
            SECTION 4: API KEYS (GEMINI & BREVO)
            ======================================================== */}
        <section className="bg-zinc-900/90 rounded-2xl shadow-xl border border-zinc-800 p-6 md:p-7 backdrop-blur-sm">
          <div className="flex items-center gap-2.5 mb-6 pb-4 border-b border-zinc-800">
            <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500 border border-yellow-500/20">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">API Keys & Services</h2>
              <p className="text-xs text-zinc-400 mt-0.5">External keys for AI automation and cloud mail delivery.</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                Gemini API Key
              </label>
              <p className="text-xs text-zinc-500 mb-2">Used for parsing Excel/CSV files, contact OSINT extraction, and AI template conversion.</p>
              <input 
                type="password" 
                name="geminiApiKey" 
                value={settings.geminiApiKey || ''} 
                onChange={handleChange} 
                placeholder="AIzaSy..." 
                className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none font-mono" 
              />
            </div>

            <div className="pt-2">
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                Brevo API Key (Optional Alternative to SMTP)
              </label>
              <p className="text-xs text-zinc-500 mb-2">Free at brevo.com — emails can be sent via Brevo HTTPS API instead of direct SMTP if your cloud provider blocks port 465/587.</p>
              <input 
                type="password" 
                name="brevoApiKey" 
                value={settings.brevoApiKey || ''} 
                onChange={handleChange} 
                placeholder="xkeysib-..." 
                className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-yellow-500 outline-none font-mono" 
              />
            </div>
          </div>
        </section>

        {/* Bottom Save Action */}
        <div className="flex justify-end pt-4 pb-12">
          <button 
            onClick={handleSave}
            disabled={saving}
            className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-extrabold py-3 px-8 rounded-xl shadow-xl shadow-yellow-500/10 transition-all duration-200 disabled:opacity-50 flex items-center text-sm cursor-pointer"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {saving ? 'Saving...' : 'Save All Settings'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default Settings;

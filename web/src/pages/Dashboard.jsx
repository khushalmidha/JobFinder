import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../services/api';
import { Search, Mail, Filter, AlertCircle, Briefcase, ChevronDown, ChevronUp, Download, Play, Pause, RefreshCw, Trash2, Sparkles, CheckCircle2, ShieldCheck, XCircle, AlertTriangle, RotateCcw, ArrowRightLeft, X, FileText, Copy } from 'lucide-react';
import ComposePanel from '../components/ComposePanel';
import ContactImport from '../components/ContactImport';
import ContactDiscoveryStatus from '../components/ContactDiscoveryStatus';

function contactRole(contact) {
  if (contact.contactKind && contact.contactKind !== 'unknown') return contact.contactKind;
  const title = contact.role || '';
  if (/recruit|human resources|talent acquisition|\bhr\b/i.test(title)) return 'recruiter';
  if (/hiring manager|engineering manager|head of engineering/i.test(title)) return 'hiring_manager';
  if (/software engineer|software developer|\bsde\b|backend engineer|frontend engineer/i.test(title)) return 'engineer';
  if (/^(?:careers|jobs|recruiting|recruitment|talent|hr)@/i.test(contact.email || '')) return 'role_inbox';
  return 'unknown';
}
const Dashboard = () => {
  const { state: linkedJob, search: routeSearch } = useLocation();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => linkedJob?.employer || '');
  const [activeTab, setActiveTab] = useState('unverified');
  const [kindFilter,setKindFilter]=useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [composeData, setComposeData] = useState({ ids: [], jobLink: '' });
  const [error, setError] = useState('');
  const [jobLinks, setJobLinks] = useState(() => linkedJob?.employer ? { [linkedJob.employer]: linkedJob.jobUrl || '' } : {}); // { companyName: 'jobLink' }
  const [roles, setRoles] = useState(() => linkedJob?.employer ? { [linkedJob.employer]: linkedJob.role || '' } : {}); // { companyName: 'role' }
  const [queueStatus, setQueueStatus] = useState({ pending: 0, size: 0, isPaused: false, limitFailedCount: 0 });
  const [blockedCompanies, setBlockedCompanies] = useState([]);
  const [companyToBlock, setCompanyToBlock] = useState(null);
  const [shareToast, setShareToast] = useState('');
  const [contactToDelete, setContactToDelete] = useState(null);
  const [deletingContact, setDeletingContact] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [blockingEmails, setBlockingEmails] = useState(false);
  const [patternRows,setPatternRows]=useState([]);
  const loadPatterns=()=>api.get('/contact-intake/pattern-leads').then(({data})=>setPatternRows(data.rows||[])).catch(()=>{});
  async function verifyPattern(row) {
    if(!window.confirm('Allow one Hunter check for this pattern candidate?')) return;
    setCheckingMailbox(true);
    try {
      const {data}=await api.post('/contact-intake/pattern-leads/'+row._id+'/verify',{approved:true});
      setShareToast('Hunter result: '+(data.providerOutcome||'existing mailbox proof'));
      await Promise.all([loadPatterns(),fetchContacts(true)]);
    } catch (failure) {setError(failure.response?.data?.error||'Mailbox verification failed.');}
    finally {setCheckingMailbox(false);}
  }
  const [checkingMailbox,setCheckingMailbox]=useState(false);
  async function ownerCheck(checked) {
    if (checked && !window.confirm('Confirm you personally checked the selected addresses. This is separate from mailbox verification.')) return;
    try {
      await api.post('/contacts/owner-checked',{ids:[...selectedIds],checked});
      setSelectedIds(new Set());
      await fetchContacts(true);
    } catch (failure) { setError(failure.response?.data?.error || 'Could not save contact checks.'); }
  }
  async function verifySelected() {
    if (selectedIds.size!==1 || !window.confirm('Allow one verification check using your Hunter credit budget?')) return;
    setCheckingMailbox(true);
    try {
      const [id]=selectedIds;
      const {data}=await api.post('/contact-intake/contact/'+id+'/verify',{approved:true});
      setShareToast('Hunter result: '+(data.providerOutcome||'existing mailbox proof'));
      setSelectedIds(new Set());
      await fetchContacts(true);
    } catch (failure) { setError(failure.response?.data?.error || 'Mailbox verification failed.'); }
    finally { setCheckingMailbox(false); }
  }
  const handleEmailBlocks = async (ids, block = true) => {
    if (!ids.length || blockingEmails) return;
    setBlockingEmails(true); setError('');
    try {
      const { data } = await api.post(block ? '/contacts/block-emails' : '/contacts/unblock-emails', { contactIds: ids });
      const response = await api.get('/contacts'); setContacts(response.data);
      setSelectedIds(new Set());
      setShareToast(block ? `${data.uniqueEmails} selected email(s) blocked. History preserved.` : `${data.unblocked} email(s) unblocked; ${data.blocked} remain suppressed by other evidence.`);
      setTimeout(() => setShareToast(''), 6000);
    } catch (err) { setError(err.response?.data?.error || 'Could not update email blocks. Retry safely.'); }
    finally { setBlockingEmails(false); }
  };


  // Daily limit & switch account states
  const [smtpAccounts, setSmtpAccounts] = useState([]);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [selectedSwitchSmtpId, setSelectedSwitchSmtpId] = useState('');
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [restoringLimit, setRestoringLimit] = useState(false);

  const handleDeleteContact = async () => {
    if (!contactToDelete) return;
    try {
      setDeletingContact(true);
      await api.delete(`/contacts/${contactToDelete._id}`);
      setContacts(prev => prev.filter(c => c._id !== contactToDelete._id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(contactToDelete._id);
        return next;
      });
      setShareToast(`🗑️ Removed contact: ${contactToDelete.hrName || contactToDelete.email}`);
      setTimeout(() => setShareToast(''), 3500);
      setContactToDelete(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete contact.');
    } finally {
      setDeletingContact(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      setDeletingBulk(true);
      const contactIds = Array.from(selectedIds);
      await api.post('/contacts/bulk-delete', { contactIds });
      setContacts(prev => prev.filter(c => !selectedIds.has(c._id)));
      setShareToast(`🗑️ Removed ${contactIds.length} contacts successfully.`);
      setTimeout(() => setShareToast(''), 3500);
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove selected contacts.');
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleToggleShared = async (contactId) => {
    try {
      const { data } = await api.put(`/contacts/${contactId}/toggle-shared`);
      setContacts(prev => prev.map(c => c._id === contactId ? { ...c, isShared: data.contact.isShared } : c));
      setShareToast(data.contact?.isShared ? '🌐 Contact successfully shared to Master Directory!' : '🔒 Contact unshared (Made Private again)!');
      setTimeout(() => setShareToast(''), 3500);
    } catch (err) {
      console.error(err);
    }
  };




  const handleMarkReplied = async (contactId) => {
    try {
      const { data } = await api.put(`/contacts/${contactId}/mark-replied`);
      setContacts(prev => prev.map(c => c._id === contactId ? { ...c, status: 'replied', repliedAt: new Date() } : c));
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkMarkReplied = async () => {
    if (selectedIds.size === 0) return;
    try {
      await api.post('/contacts/bulk-mark-replied', { contactIds: Array.from(selectedIds) });
      setContacts(prev => prev.map(c => selectedIds.has(c._id) ? { ...c, status: 'replied', repliedAt: new Date() } : c));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkToggleShared = async (setShared) => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    try {
      await api.post('/contacts/bulk-toggle-shared', { contactIds: Array.from(selectedIds), setShared });
      setContacts(prev => prev.map(c => selectedIds.has(c._id) ? { ...c, isShared: setShared } : c));
      setShareToast(setShared ? `🌐 ${count} contacts marked as Shared in Master Directory!` : `🔒 ${count} contacts unshared (Made Private again)!`);
      setTimeout(() => setShareToast(''), 3500);
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchContacts = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const { data } = await api.get('/contacts');
      setContacts(data);
    } catch (err) {
      if (!quiet) setError('Failed to load contacts');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const fetchQueueStatus = async () => {
    try {
      const { data } = await api.get('/mail/queue-status');
      setQueueStatus(data);
    } catch (err) {
      console.error('Failed to load queue status');
    }
  };

  const toggleQueue = async () => {
    try {
      const endpoint = queueStatus.isPaused ? '/mail/resume-queue' : '/mail/pause-queue';
      const { data } = await api.post(endpoint);
      setQueueStatus(prev => ({ ...prev, isPaused: data.isPaused }));
      fetchQueueStatus();
    } catch (err) {
      console.error('Failed to toggle queue');
    }
  };



  const handleRestoreLimitFailed = async () => {
    try {
      setRestoringLimit(true);
      const { data } = await api.post('/mail/restore-limit-failed');
      setShareToast(`✅ ${data.message}`);
      setTimeout(() => setShareToast(''), 4500);
      fetchContacts();
      fetchQueueStatus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to restore limit-failed contacts');
    } finally {
      setRestoringLimit(false);
    }
  };

  const handleSwitchQueueAccount = async (targetSmtpId) => {
    try {
      setSwitchingAccount(true);
      const { data } = await api.post('/mail/switch-queue-account', { smtpId: targetSmtpId });
      setShareToast(`🚀 ${data.message}`);
      setTimeout(() => setShareToast(''), 4500);
      setShowSwitchModal(false);
      fetchQueueStatus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to switch sender account');
    } finally {
      setSwitchingAccount(false);
    }
  };

  useEffect(() => {
    fetchContacts();
    loadPatterns();
    fetchQueueStatus();
    
    // Fetch settings to get blocked companies and SMTP accounts
    api.get('/auth/settings')
      .then(({ data }) => {
        if (data && data.blockedCompanies) {
          setBlockedCompanies(data.blockedCompanies);
        }
        if (data && data.smtpConfigs) {
          setSmtpAccounts(data.smtpConfigs);
          if (data.selectedSmtpId) {
            setSelectedSwitchSmtpId(data.selectedSmtpId);
          } else if (data.smtpConfigs.length > 0) {
            setSelectedSwitchSmtpId(data.smtpConfigs[0]._id);
          }
        }
      })
      .catch(console.error);

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchQueueStatus();
    }, 6000);
    const refresh = setInterval(() => { if (!document.hidden) { fetchContacts(true);loadPatterns(); } }, 60000);
    return () => { clearInterval(interval); clearInterval(refresh); };
  }, []);

  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const toggleSelectCompany = (companyContacts) => {
    const companyIds = companyContacts.map(c => c._id);
    const allSelected = companyIds.every(id => selectedIds.has(id));
    
    const newSelected = new Set(selectedIds);
    if (allSelected) {
      companyIds.forEach(id => newSelected.delete(id));
    } else {
      companyIds.forEach(id => newSelected.add(id));
    }
    setSelectedIds(newSelected);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'replied':
      case 'reply_received': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold';
      case 'sent': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'bounced': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'failed': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'positive_response': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'negative_response': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'auto_reply': return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
      case 'follow_up_later': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default: return 'bg-zinc-800 text-zinc-300 border-zinc-700';
    }
  };

  const parseLpa = (pkg) => {
    if (!pkg) return 15;
    if (pkg.includes('Cr') || pkg.includes('Crore')) {
      const crMatch = pkg.match(/(\d+(?:\.\d+)?)\s*Cr/i);
      return crMatch ? Math.round(parseFloat(crMatch[1]) * 100) : 100;
    }
    const match = pkg.match(/(\d+)\s*LPA/i) || pkg.match(/₹?\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 15;
  };

  // 1. Separate Active (Deliverable) and Invalid contacts
  const blockedCompanyNames = new Set(blockedCompanies.map(name => name.trim().toLowerCase()));
  const contactSection = contact => {
    if (blockedCompanyNames.has((contact.company || '').trim().toLowerCase()) || contact.emailBlocked ||
      contact.suppressedAt || contact.optOutAt || contact.deliverabilityStatus === 'invalid' ||
      contact.verificationStatus === 'invalid' || ['bounced','removed'].includes(contact.status)) return 'blocked';
    return contact.mailboxVerified || contact.ownerVerifiedAt ? 'verified' : 'unverified';
  };
  const sectionCounts = { verified:0, unverified:0, blocked:0 };
  for (const contact of contacts) sectionCounts[contactSection(contact)]++;
  const filteredContacts = contacts.filter(contact => {
    if (contactSection(contact) !== activeTab) return false;
    const term = search.trim().toLowerCase();
    const kind = contactRole(contact);
    const matchesRole = !kindFilter || kind === kindFilter || (kindFilter === 'recruiter' && kind === 'role_inbox');
    if (term.startsWith('@')) return matchesRole && String(contact.email||'').toLowerCase().endsWith(term);
    return matchesRole && [contact.company,contact.hrName,contact.email].some(value=>String(value||'').toLowerCase().includes(term));
  });
  const capitalizeCompany = (name) => {
    return name.split(' ').map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '').join(' ');
  };

  const selectionContacts = filteredContacts;
  const allFilteredSelected = selectionContacts.length > 0 && selectionContacts.every(c => selectedIds.has(c._id));
  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    selectionContacts.forEach(c => allFilteredSelected ? next.delete(c._id) : next.add(c._id));
    setSelectedIds(next);
  };

  const groupedContacts = filteredContacts.reduce((acc, contact) => {
    const rawComp = (contact.company || 'Unknown').trim();
    const originalComp = capitalizeCompany(rawComp);
    const normalizedKey = originalComp.toLowerCase();
    
    // Find if we already have this company under a different casing
    const existingKey = Object.keys(acc).find(k => k.toLowerCase() === normalizedKey);
    const compKey = existingKey || originalComp;
    
    if (!acc[compKey]) acc[compKey] = [];
    acc[compKey].push(contact);
    return acc;
  }, {});

  const handleComposeCompany = (company, companyContacts) => {
    const isBlocked = blockedCompanies.some(b => b.toLowerCase() === company.toLowerCase());
    if (isBlocked) return;

    const selectedInCompany = companyContacts.filter(c => selectedIds.has(c._id)).map(c => c._id);
    const idsToUse = selectedInCompany.length > 0 ? selectedInCompany : companyContacts.map(c => c._id);
    
    setComposeData({
      ids: idsToUse,
      jobLink: jobLinks[company] || '',
      role: roles[company] || ''
    });
    setShowCompose(true);
  };

  const confirmBlockCompany = async () => {
    if (!companyToBlock) return;
    try {
      const { data } = await api.post('/auth/block-company', { company: companyToBlock });
      setBlockedCompanies(data.blockedCompanies);
      
      const newSelected = new Set(selectedIds);
      filteredContacts.forEach(c => {
        if (capitalizeCompany((c.company || 'Unknown').trim()).toLowerCase() === companyToBlock.toLowerCase()) {
          newSelected.delete(c._id);
        }
      });
      setSelectedIds(newSelected);
    } catch (err) {
      console.error('Failed to block company', err);
    } finally {
      setCompanyToBlock(null);
    }
  };

  const handleUnblockCompany = async (companyName) => {
    try {
      const { data } = await api.post('/auth/unblock-company', { company: companyName });
      setBlockedCompanies(data.blockedCompanies);
    } catch (err) {
      console.error('Failed to unblock company', err);
    }
  };


  const downloadTxt = (onlySelected = false, includeDetails = false) => {
    const listToExport = onlySelected 
      ? contacts.filter(c => selectedIds.has(c._id))
      : filteredContacts;

    if (listToExport.length === 0) {
      alert('No contacts selected to export.');
      return;
    }

    let textContent = '';
    if (includeDetails) {
      textContent = listToExport
        .map(c => `${c.hrName || 'HR'} <${c.email}> | Company: ${c.company || 'N/A'} | Role: ${c.role || 'N/A'}`)
        .join('\n');
    } else {
      // Pure email addresses list (one email per line)
      textContent = listToExport
        .map(c => c.email?.trim())
        .filter(Boolean)
        .join('\n');
    }

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const count = listToExport.length;
    link.download = onlySelected 
      ? `selected_emails_${count}.txt`
      : `contacts_emails_${count}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setShareToast(`📄 Exported ${count} emails to ${link.download}!`);
    setTimeout(() => setShareToast(''), 3500);
  };

  const copySelectedEmails = () => {
    const listToExport = contacts.filter(c => selectedIds.has(c._id));
    if (listToExport.length === 0) return;
    const emails = listToExport.map(c => c.email?.trim()).filter(Boolean).join(', ');
    navigator.clipboard.writeText(emails);
    setShareToast(`📋 Copied ${listToExport.length} emails to clipboard!`);
    setTimeout(() => setShareToast(''), 3500);
  };

  const copySingleEmail = (email) => {
    if (!email) return;
    navigator.clipboard.writeText(email);
    setShareToast(`📋 Copied ${email} to clipboard!`);
    setTimeout(() => setShareToast(''), 2500);
  };

  const downloadSingleEmailTxt = (contact) => {
    if (!contact || !contact.email) return;
    const textContent = `${contact.email}\n`;
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const namePart = (contact.hrName || contact.company || 'email').replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `${namePart}_email.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setShareToast(`📄 Exported ${contact.email} to ${link.download}!`);
    setTimeout(() => setShareToast(''), 3000);
  };

  return (
    <div className="px-4 py-6 md:px-8 max-w-7xl mx-auto font-sans">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">Contacts by Company</h1>
            {!loading && contacts.length > 0 && (
              <span className="bg-zinc-800 text-yellow-500 text-xs px-2.5 py-1 rounded-full font-bold border border-yellow-500/20 shadow-sm">
                {filteredContacts.length} {filteredContacts.length !== contacts.length ? `of ${contacts.length} ` : ''}Contacts
              </span>
            )}
          </div>
          <div className="mt-3 space-y-2">
            <ContactImport initiallyOpen={new URLSearchParams(routeSearch).get('import') === '1'} onSaved={() => fetchContacts(true)} />
            <ContactDiscoveryStatus />
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="flex max-w-full flex-wrap items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400">
              Queue: {queueStatus.pending || 0}
            </span>
            {queueStatus.dailyLimit && (
              <button
                type="button"
                onClick={() => setShowSwitchModal(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all shadow-sm cursor-pointer group ${
                  queueStatus.sentToday >= queueStatus.dailyLimit 
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30' 
                    : 'bg-zinc-950/80 text-zinc-200 border-zinc-700/80 hover:border-zinc-500 hover:bg-zinc-800/90'
                }`}
                title={`Active Email: ${queueStatus.activeSender || 'Account'}\nSent today: ${queueStatus.sentToday || 0}/${queueStatus.dailyLimit}\nCan send: ${Math.max(0, (queueStatus.dailyLimit || 450) - (queueStatus.sentToday || 0))} more mails today\nClick to view all accounts & quota`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-zinc-400 font-semibold max-w-[120px] truncate">
                  {queueStatus.activeSender ? queueStatus.activeSender.split('@')[0] : 'Account'}:
                </span>
                <span className="text-yellow-400 font-black">
                  {queueStatus.sentToday || 0}/{queueStatus.dailyLimit}
                </span>
                <span className="text-[10px] text-emerald-400 font-bold px-1.5 py-0.2 bg-emerald-500/15 rounded border border-emerald-500/30">
                  {Math.max(0, (queueStatus.dailyLimit || 450) - (queueStatus.sentToday || 0))} left
                </span>
                <ChevronDown className="w-3 h-3 text-zinc-400 group-hover:text-zinc-200 transition-transform" />
              </button>
            )}
            {queueStatus.pauseReason === 'DAILY_SAFETY_LIMIT_REACHED' && (
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                <ShieldCheck className="w-2.5 h-2.5 text-amber-400" /> Limit Paused ({queueStatus.dailyLimit || 450})
              </span>
            )}
            {queueStatus.pauseReason === 'DAILY_LIMIT_EXCEEDED' && (
              <span className="text-[10px] font-bold text-red-400 bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5 text-red-400" /> Gmail Limit
              </span>
            )}
            {queueStatus.pauseReason === 'SMTP_AUTH_ERROR' && (
              <span className="text-[10px] font-bold text-red-400 bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5 text-red-400" /> Auth Error (535)
              </span>
            )}
            {(queueStatus.pauseReason === 'NETWORK_ERROR' || queueStatus.pauseReason === 'SEND_ERROR') && (
              <span className="text-[10px] font-bold text-orange-400 bg-orange-500/20 border border-orange-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5 text-orange-400" /> Paused (Error)
              </span>
            )}
            <button 
              onClick={toggleQueue}
              className={`p-1 rounded flex items-center justify-center transition-colors ${queueStatus.isPaused ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'}`}
              title={queueStatus.isPaused ? 'Resume Queue' : 'Pause Queue'}
            >
              {queueStatus.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          </div>

        </div>
      </div>

      {/* SMTP Auth Error (535) Banner */}
      {queueStatus.pauseReason === 'SMTP_AUTH_ERROR' && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-red-500/20 via-orange-500/15 to-amber-500/15 border border-red-500/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 rounded-xl bg-red-500/20 text-red-400 mt-0.5 border border-red-500/30">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h3 className="text-sm font-bold text-red-200">
                  🛑 Gmail Login Error: 535-5.7.8 (Username and Password not accepted)
                </h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-500/25 text-red-300 border border-red-500/40">
                  Queue Paused Automatically
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                Google rejected login for <code>{queueStatus.limitAccount || 'your email account'}</code>. 
                Queue was paused immediately so your contacts stay safely <strong>Pending</strong>.
                Generate a fresh 16-character App Password at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-yellow-400 underline font-semibold">myaccount.google.com/apppasswords</a> and update it in Settings, or switch to another account below.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 flex-shrink-0">
            {Boolean(queueStatus.limitFailedCount > 0) && (
              <button
                onClick={handleRestoreLimitFailed}
                disabled={restoringLimit}
                className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/50 text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${restoringLimit ? 'animate-spin' : ''}`} />
                <span>{restoringLimit ? 'Restoring...' : `Restore ${queueStatus.limitFailedCount} Contacts`}</span>
              </button>
            )}
            <button
              onClick={() => setShowSwitchModal(true)}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 text-xs font-extrabold shadow-lg shadow-orange-950/40 transition-all cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Switch Account &amp; Resume</span>
            </button>
            <a
              href="/settings"
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-yellow-400 border border-zinc-700 text-xs font-semibold transition"
            >
              <span>Settings</span>
            </a>
          </div>
        </div>

      )}

      {/* Connection or Send Error Banner */}
      {(queueStatus.pauseReason === 'NETWORK_ERROR' || queueStatus.pauseReason === 'SEND_ERROR') && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-orange-500/20 via-amber-500/15 to-yellow-500/15 border border-orange-500/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 rounded-xl bg-orange-500/20 text-orange-400 mt-0.5 border border-orange-500/30">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-orange-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h3 className="text-sm font-bold text-orange-200">
                  {queueStatus.pauseReason === 'NETWORK_ERROR' ? '🌐 Connection / Network Interruption' : '⚠️ Sending Interrupted'}
                </h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-orange-500/25 text-orange-300 border border-orange-500/40">
                  Queue Paused Automatically
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                {queueStatus.limitMessage || 'Queue was paused to keep remaining contacts pending and safe.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 flex-shrink-0">
            <button
              onClick={toggleQueue}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Retry / Resume</span>
            </button>
            <button
              onClick={() => setShowSwitchModal(true)}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-semibold transition cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Switch Account</span>
            </button>
          </div>
        </div>
      )}

      {/* Daily Safety Limit (450 Emails) Cap Reached Banner */}
      {queueStatus.pauseReason === 'DAILY_SAFETY_LIMIT_REACHED' && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-yellow-500/15 border border-amber-500/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 mt-0.5 border border-amber-500/30">
              <ShieldCheck className="w-5 h-5 flex-shrink-0 text-amber-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h3 className="text-sm font-bold text-amber-200">
                  🛑 Daily Outreach Limit Reached ({queueStatus.sentToday || 450}/{queueStatus.dailyLimit || 450} Sent Today)
                </h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/25 text-amber-300 border border-amber-500/40">
                  Queue Paused Automatically
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                You reached your daily cap of <strong>{queueStatus.dailyLimit || 450} emails</strong> for <code>{queueStatus.limitAccount || 'your email account'}</code>. 
                Outreach was paused to safely reserve 50 emails in Gmail for your <strong>important personal &amp; job emails</strong>!
                Remaining contacts stay safely as <strong>Pending</strong> in the queue.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 flex-shrink-0">
            <button
              onClick={() => setShowSwitchModal(true)}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 text-xs font-extrabold shadow-lg shadow-orange-950/40 transition-all cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Switch Account &amp; Resume</span>
            </button>
            <a
              href="/settings"
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-xs font-semibold transition"
            >
              <span>Adjust Limit in Settings</span>
            </a>
          </div>
        </div>
      )}

      {/* Daily Sending Limit Exceeded Warning Banner */}
      {Boolean(queueStatus.pauseReason === 'DAILY_LIMIT_EXCEEDED' || (queueStatus.limitFailedCount && queueStatus.limitFailedCount > 0)) && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-red-500/15 border border-amber-500/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 mt-0.5 border border-amber-500/30">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h3 className="text-sm font-bold text-amber-200">
                  {queueStatus.pauseReason === 'DAILY_LIMIT_EXCEEDED' 
                    ? `⚠️ Gmail Daily Sending Limit Reached ${queueStatus.limitAccount ? `(${queueStatus.limitAccount})` : ''}`
                    : `⚠️ Gmail Daily Limit Detected`}
                </h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/25 text-amber-300 border border-amber-500/40">
                  Queue Paused Automatically
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                Gmail returned: <code className="text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">550-5.4.5 Daily user sending limit exceeded</code>. 
                The current email was safely kept in queue as <strong>Pending</strong> and sending was paused immediately so no contacts fail.
                {Boolean(queueStatus.limitFailedCount > 0) && (
                  <span className="block mt-1 text-amber-200/90 font-medium">
                    📍 <strong>{queueStatus.limitFailedCount} contacts</strong> previously failed from this limit error. You can restore them back to <strong>Pending</strong> in 1 click!
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 flex-shrink-0">
            {Boolean(queueStatus.limitFailedCount > 0) && (
              <button
                onClick={handleRestoreLimitFailed}
                disabled={restoringLimit}
                className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/50 text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${restoringLimit ? 'animate-spin' : ''}`} />
                <span>{restoringLimit ? 'Restoring...' : `Restore ${queueStatus.limitFailedCount} Contacts to Pending`}</span>
              </button>
            )}

            <button
              onClick={() => setShowSwitchModal(true)}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 text-xs font-extrabold shadow-lg shadow-orange-950/40 transition-all cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Switch Account & Resume</span>
            </button>
          </div>
        </div>
      )}

      {shareToast && (
        <div className="mb-4 p-3 rounded-xl bg-blue-950/80 border border-blue-500/40 text-blue-200 text-xs font-bold flex items-center justify-between shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
            <span>{shareToast}</span>
          </div>
          <button onClick={() => setShareToast('')} className="text-zinc-400 hover:text-zinc-200 text-sm font-black ml-2 cursor-pointer">×</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 border-b border-zinc-800">
        {Object.entries({verified:'Verified',unverified:'Unverified',blocked:'Blocked'}).map(([key,label]) =>
          <button key={key} type="button" aria-pressed={activeTab===key} onClick={() => {setActiveTab(key);setSelectedIds(new Set());}}
            className={'px-3 pb-3 text-sm font-semibold border-b-2 ' + (activeTab===key?'border-yellow-500 text-yellow-300':'border-transparent text-zinc-400')}>
            {label} ({sectionCounts[key]})
          </button>)}
      </div>

      <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 mb-8 p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative w-full sm:min-w-48 sm:flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input 
              type="text" 
              aria-label="Search contacts"
              placeholder="Search company, email or @gmail.com"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedIds(new Set()); }}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>

          <select aria-label="Contact type" value={kindFilter} onChange={event=>{setKindFilter(event.target.value);setSelectedIds(new Set());}} className="rounded border border-zinc-700 bg-zinc-800 p-2 text-sm">
            <option value="">All roles</option><option value="recruiter">HR / Recruiters</option><option value="hiring_manager">Hiring managers</option><option value="engineer">SDE / Engineers</option><option value="unknown">Unclassified</option>
          </select>
        </div>

        <div className="flex items-center space-x-4 shrink-0">
          <label className="flex items-center space-x-2 cursor-pointer text-zinc-300 font-medium text-xs sm:text-sm whitespace-nowrap">
            <input 
              type="checkbox" 
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900 w-4 h-4 sm:w-5 sm:h-5"
            />
            <span>Select All Filtered</span>
          </label>
          {activeTab !== 'blocked' && <button
            onClick={() => {
              setComposeData({ ids: Array.from(selectedIds), jobLink: '', role: '' });
              setShowCompose(true);
            }}
            disabled={selectedIds.size === 0}
            className="flex items-center px-4 py-2 bg-yellow-500 text-zinc-950 hover:bg-yellow-400 rounded-lg font-bold transition-colors shadow-sm text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Mail className="w-4 h-4 mr-1.5" />
            Send ({selectedIds.size})
          </button>}
        </div>
      </div>

      {/* Bulk Action Bar for Replied & Shared */}
      {selectedIds.size > 0 && (
        <div className="bg-zinc-900 border border-yellow-500/40 rounded-xl p-3.5 mb-6 shadow-xl flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
            <span className="text-xs font-bold text-zinc-200">
              <strong className="text-yellow-400">{selectedIds.size}</strong> contacts selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab==='unverified'&&<button type="button" onClick={()=>ownerCheck(true)} className="rounded border border-zinc-700 px-3 py-2 text-xs">Mark personally checked</button>}
            {activeTab==='verified'&&<button type="button" onClick={()=>ownerCheck(false)} className="rounded border border-zinc-700 px-3 py-2 text-xs">Remove personal check</button>}
            {activeTab==='unverified'&&selectedIds.size===1&&<button type="button" onClick={verifySelected} disabled={checkingMailbox} className="rounded border border-zinc-700 px-3 py-2 text-xs">Verify with Hunter</button>}
            <button onClick={() => handleEmailBlocks(Array.from(selectedIds), activeTab !== 'blocked')} disabled={blockingEmails}
              className="px-3 py-1.5 rounded-lg bg-red-950 text-red-300 border border-red-700 text-xs font-bold disabled:opacity-50">
              {blockingEmails ? 'Updating blocks...' : activeTab === 'blocked' ? `Unblock Selected Emails (${selectedIds.size})` : `Block Selected Emails (${selectedIds.size})`}
            </button>
            <button
              onClick={() => downloadTxt(true, false)}
              className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-zinc-950 rounded-lg text-xs font-black transition flex items-center gap-1.5 shadow-md cursor-pointer"
              title="Download selected individual emails as a .txt file (one email per line)"
            >
              <FileText className="w-3.5 h-3.5" />
              Export TXT ({selectedIds.size})
            </button>
            <button
              onClick={copySelectedEmails}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Copy selected emails to clipboard (comma-separated, ready to paste into Gmail To/BCC)"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Emails ({selectedIds.size})
            </button>
            <button
              onClick={handleBulkMarkReplied}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-extrabold transition flex items-center gap-1 shadow-sm cursor-pointer"
            >
              💬 Mark Replied ({selectedIds.size})
            </button>
            <button
              onClick={() => handleBulkToggleShared(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-extrabold transition flex items-center gap-1 shadow-sm cursor-pointer"
            >
              🌐 Mark as Shared ({selectedIds.size})
            </button>
            <button
              onClick={() => handleBulkToggleShared(false)}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
              title="Remove selected contacts from Master Directory"
            >
              🔒 Unshare / Set Private ({selectedIds.size})
            </button>
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="px-3 py-1.5 bg-red-950/60 hover:bg-red-900 border border-red-800/80 text-red-300 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-sm"
              title="Delete selected contacts permanently"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              Remove Selected ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center p-12 text-zinc-500">Loading contacts...</div>
      ) : (Object.keys(groupedContacts).length === 0) ? (
        <div className="text-center p-12 bg-zinc-900 rounded-xl border border-zinc-800">
          <AlertCircle className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-medium">No {activeTab} contacts found.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedContacts).map(([company, companyContacts]) => {
            const isBlocked = activeTab === 'blocked';
            const companyWideBlocked = blockedCompanies.some(b => b.toLowerCase() === company.toLowerCase());
            
            return (
            <div key={company} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden shadow-sm">
              {/* Company Header */}
              <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {!isBlocked && (
                    <input 
                      type="checkbox" 
                      checked={companyContacts.length > 0 && companyContacts.every(c => selectedIds.has(c._id))}
                      onChange={() => toggleSelectCompany(companyContacts)}
                      className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900 w-5 h-5"
                    />
                  )}
                  <h2 className="text-lg font-bold text-zinc-100">{company}</h2>
                  <span className="bg-zinc-800 text-zinc-400 text-xs px-2 py-0.5 rounded-full font-medium">
                    {companyContacts.length} contact{companyContacts.length > 1 ? 's' : ''}
                  </span>
                  
                  <button
                    disabled={blockingEmails || (isBlocked && !companyWideBlocked && !companyContacts.some(c => c.emailBlockSource === 'owner_block'))}
                    onClick={() => isBlocked ? (companyWideBlocked ? handleUnblockCompany(company) : handleEmailBlocks(companyContacts.filter(c => c.emailBlockSource === 'owner_block').map(c => c._id), false)) : setCompanyToBlock(company)}
                    className={`ml-2 text-xs font-bold px-3 py-1.5 rounded transition-colors ${isBlocked ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                  >
                    {isBlocked ? (companyWideBlocked ? 'Unblock company' : 'Unblock email blocks') : 'Block company'}
                  </button>
                </div>
                
                {!isBlocked && (
                  <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
                    <div className="relative min-w-32 flex-1 lg:w-40">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input 
                        type="text" 
                        placeholder="Role (e.g. SDE 1)"
                        value={roles[company] || ''}
                        onChange={(e) => setRoles({ ...roles, [company]: e.target.value })}
                        className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
                      />
                    </div>
                    <div className="relative min-w-32 flex-1 lg:w-40">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input 
                        type="text" 
                        placeholder="Job ID or Link"
                        value={jobLinks[company] || ''}
                        onChange={(e) => setJobLinks({ ...jobLinks, [company]: e.target.value })}
                        className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
                      />
                    </div>
                    <button 
                      onClick={() => handleComposeCompany(company, companyContacts)}
                      className="flex-shrink-0 flex items-center px-4 py-2 bg-yellow-500 text-zinc-950 hover:bg-yellow-400 rounded-lg font-bold transition-colors shadow-sm text-sm"
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Send to Company
                    </button>
                    <button 
                      onClick={() => {
                        const emails = companyContacts.map(c => c.email?.trim()).filter(Boolean).join('\n');
                        const blob = new Blob([emails], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `${company.replace(/[^a-zA-Z0-9]/g, '_')}_emails_${companyContacts.length}.txt`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        setShareToast(`📄 Exported ${companyContacts.length} emails from ${company} to TXT!`);
                        setTimeout(() => setShareToast(''), 3500);
                      }}
                      className="flex-shrink-0 flex items-center px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg font-bold transition-colors text-xs cursor-pointer shadow-sm"
                      title={`Export all ${companyContacts.length} emails from ${company} to a .txt file`}
                    >
                      <FileText className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                      TXT
                    </button>
                  </div>
                )}
              </div>

              {/* Contacts List */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <tbody className="divide-y divide-zinc-800/50">
                    {companyContacts.map(contact => (
                      <tr key={contact._id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="p-3 pl-4 w-12 text-center">
                          <input 
                            type="checkbox" 
                            aria-label={`Select ${contact.email}`}
                            checked={selectedIds.has(contact._id)}
                            onChange={() => toggleSelect(contact._id)}
                            className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900"
                          />
                        </td>
                        <td className="p-3 text-zinc-300 font-medium w-1/4"><span>{contact.hrName || 'Professional contact'}</span>{contact.mailboxVerified ? <span className="ml-2 text-xs text-emerald-300">Mailbox verified</span> : contact.ownerVerifiedAt ? <span className="ml-2 text-xs text-yellow-300">Personally checked</span> : null}{contact.inferenceFlag && <span className="ml-2 text-xs text-amber-300">Guessed · mailbox unverified</span>}{!contact.inferenceFlag&&contact.verificationStatus==='publicly_sourced'&&<span className="ml-2 text-xs text-zinc-500">{contact.deliverabilityStatus==='unverified'?'Public source · mailbox unverified':'Public source'}</span>}{contact.contactKind&&contact.contactKind!=='unknown'&&<span className="ml-2 text-xs text-zinc-500">{contact.contactKind}</span>}{contact.source==='career_crawler'&&contact.contactKind!=='unknown'&&contact.role&&<span className="block text-xs text-zinc-500">{contact.role}</span>}</td>
                        <td className="p-3 text-zinc-400 w-1/4">{contact.email}</td>
                        <td className="p-3 w-1/4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {contact.status === 'replied' || contact.status === 'reply_received' ? (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                                💬 Replied
                              </span>
                            ) : contact.status === 'sent' && contact.lastMailedAt ? (
                              <span className="text-zinc-400 text-xs font-medium">
                                Sent {new Date(contact.lastMailedAt).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(contact.status)}`}>
                                {contact.status === 'sent' ? 'Sent' : contact.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                              </span>
                            )}

                            {contact.isShared && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                🌐 Shared
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button aria-label={`${contact.emailBlocked ? 'Unblock' : 'Block'} ${contact.email}`}
                              onClick={() => handleEmailBlocks([contact._id], !contact.emailBlocked)}
                              disabled={blockingEmails || (contact.emailBlocked && contact.emailBlockSource !== 'owner_block')}
                              className="px-2 py-1 rounded bg-red-950/50 text-red-300 text-xs font-bold disabled:opacity-50"
                              title={contact.emailBlocked && contact.emailBlockSource !== 'owner_block' ? 'Opt-out or confirmed-invalid suppression cannot be removed here' : 'Block or unblock this email only'}>
                              {contact.emailBlocked ? (contact.emailBlockSource === 'owner_block' ? 'Unblock email' : 'Suppressed') : 'Block email'}
                            </button>
                            <button
                              onClick={() => handleMarkReplied(contact._id)}
                              className={`p-1.5 rounded-md text-xs font-bold transition ${
                                contact.status === 'replied' 
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-emerald-400'
                              }`}
                              title={contact.status === 'replied' ? 'Already marked Replied' : 'Mark Recruiter Replied'}
                            >
                              💬
                            </button>
                            <button
                              onClick={() => handleToggleShared(contact._id)}
                              className={`p-1.5 rounded-md text-xs font-bold transition ${
                                contact.isShared 
                                  ? 'bg-blue-950 text-blue-400 border border-blue-850 hover:bg-red-950/40 hover:text-red-400 hover:border-red-800' 
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-blue-400'
                              }`}
                              title={contact.isShared ? 'Shared in Master Directory (Click to Unshare / Make Private)' : 'Locked / Private (Click to Share in Master Directory)'}
                            >
                              {contact.isShared ? '🌐' : '🔒'}
                            </button>
                            <button
                              onClick={() => copySingleEmail(contact.email)}
                              className="p-1.5 rounded-md text-xs font-bold transition bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-amber-300 cursor-pointer"
                              title={`Copy ${contact.email} to clipboard`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => downloadSingleEmailTxt(contact)}
                              className="p-1.5 rounded-md text-xs font-bold transition bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-amber-300 cursor-pointer"
                              title={`Download ${contact.email} as a .txt file`}
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setContactToDelete(contact)}
                              className="p-1.5 rounded-md text-xs font-bold transition bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 hover:border hover:border-red-800 cursor-pointer"
                              title="Remove Contact"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* INVALID / UNVERIFIED EMAILS TAB (SEPARATED, NOT DELETED) */}
      {activeTab==='unverified'&&patternRows.some(row=>!kindFilter||row.kind===kindFilter)&&<details className="my-3 rounded-lg border border-zinc-800 p-3">
        <summary className="cursor-pointer text-sm">Pattern candidates for verification</summary>
        {patternRows.filter(row=>(!kindFilter||row.kind===kindFilter)&&(!search||[row.company,row.email,row.name].some(value=>value?.toLowerCase().includes(search.toLowerCase())))).map(row=>
          <div key={row._id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-2 text-sm">
            <span className="break-all">{row.name} · {row.company} · {row.email} <span className="text-amber-300">Guess</span></span>
            <button type="button" disabled={checkingMailbox} onClick={()=>verifyPattern(row)} className="rounded border border-zinc-700 px-3 py-1.5">Verify with Hunter</button>
          </div>)}
      </details>}

      {showCompose && (
        <ComposePanel 
          selectedIds={composeData.ids} 
          jobLinkOverride={composeData.jobLink}
          roleOverride={composeData.role}
          onClose={() => setShowCompose(false)} 
          onSuccess={(result) => {
            setShareToast(`${result.message}${(!result.sendingEnabled || !result.workerEnabled) ? ' Delivery is currently paused; the approved queue is saved.' : ''}`);
            setTimeout(() => setShareToast(''), 10000);
            setShowCompose(false);
            setSelectedIds(new Set());
            fetchContacts();
            fetchQueueStatus();
          }} 
        />
      )}

      {companyToBlock && (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center space-x-3 text-red-500 mb-4">
              <AlertCircle className="w-6 h-6" />
              <h2 className="text-lg font-bold text-zinc-100">Block {companyToBlock}?</h2>
            </div>
            <p className="text-zinc-400 mb-6 text-sm leading-relaxed">
              Are you sure you want to block <strong className="text-zinc-200">{companyToBlock}</strong>? 
              This will instantly remove all their contacts from the active list and prevent any future emails from being queued for them.
            </p>
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setCompanyToBlock(null)}
                className="px-4 py-2 text-zinc-400 font-medium hover:bg-zinc-800 hover:text-zinc-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmBlockCompany}
                className="px-4 py-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 font-bold rounded-lg transition-colors"
              >
                Confirm Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Remove Single Contact Modal */}
      {contactToDelete && (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-150 space-y-4">
            <div className="flex items-center space-x-3 text-red-500">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-100">Remove Contact?</h2>
                <p className="text-xs text-zinc-500">Action cannot be undone</p>
              </div>
            </div>

            <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Name:</span>
                <span className="font-bold text-zinc-200">{contactToDelete.hrName || 'HR / Recruiter'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Email:</span>
                <span className="font-mono text-yellow-400 font-bold">{contactToDelete.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Company:</span>
                <span className="font-bold text-zinc-300">{contactToDelete.company}</span>
              </div>
            </div>

            <p className="text-zinc-400 text-xs leading-relaxed">
              Are you sure you want to remove <strong className="text-zinc-200">{contactToDelete.hrName || contactToDelete.email}</strong>? 
              This recruiter will be permanently removed from your outreach database.
            </p>

            <div className="flex justify-end space-x-2.5 pt-2">
              <button 
                onClick={() => setContactToDelete(null)}
                disabled={deletingContact}
                className="px-4 py-2 text-zinc-400 font-bold hover:bg-zinc-800 hover:text-zinc-200 rounded-xl transition text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteContact}
                disabled={deletingContact}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-extrabold rounded-xl transition text-xs flex items-center gap-1.5 shadow-lg shadow-red-950/50 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingContact ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Bulk Remove Contacts Modal */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-150 space-y-4">
            <div className="flex items-center space-x-3 text-red-500">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-100">Remove {selectedIds.size} Contacts?</h2>
                <p className="text-xs text-zinc-500">Permanent deletion</p>
              </div>
            </div>

            <p className="text-zinc-300 text-xs leading-relaxed">
              Are you sure you want to permanently delete all <strong className="text-yellow-400">{selectedIds.size} selected contacts</strong>? 
              They will be completely removed from your outreach queue and cannot be recovered.
            </p>

            <div className="flex justify-end space-x-2.5 pt-2">
              <button 
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={deletingBulk}
                className="px-4 py-2 text-zinc-400 font-bold hover:bg-zinc-800 hover:text-zinc-200 rounded-xl transition text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleBulkDelete}
                disabled={deletingBulk}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-extrabold rounded-xl transition text-xs flex items-center gap-1.5 shadow-lg shadow-red-950/50 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingBulk ? 'Removing All...' : `Confirm Remove (${selectedIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Switch Sender Account & Daily Quota Modal */}
      {showSwitchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <button 
              onClick={() => setShowSwitchModal(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2.5 rounded-xl bg-orange-500/20 text-orange-400 border border-orange-500/30">
                <ArrowRightLeft className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">Email Accounts &amp; Daily Limits</h3>
                <p className="text-xs text-zinc-400">Har account ki apni <strong>450 mails/day</strong> limit hai.</p>
              </div>
            </div>

            {/* Quota Summary Header */}
            {queueStatus.accounts && queueStatus.accounts.length > 0 && (
              <div className="my-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-zinc-900/60 rounded-lg border border-zinc-800">
                  <span className="text-[10px] text-zinc-400 block font-medium uppercase">Active Account</span>
                  <span className="text-xs font-bold text-yellow-400 truncate block mt-0.5" title={queueStatus.activeSender}>
                    {queueStatus.activeSender ? queueStatus.activeSender.split('@')[0] : 'None'}
                  </span>
                </div>
                <div className="p-2 bg-zinc-900/60 rounded-lg border border-zinc-800">
                  <span className="text-[10px] text-zinc-400 block font-medium uppercase">Total Sent Today</span>
                  <span className="text-xs font-extrabold text-zinc-200 block mt-0.5">
                    {queueStatus.accounts.reduce((sum, a) => sum + (a.sentToday || 0), 0)} mails
                  </span>
                </div>
                <div className="p-2 bg-zinc-900/60 rounded-lg border border-zinc-800">
                  <span className="text-[10px] text-zinc-400 block font-medium uppercase">Total Can Send</span>
                  <span className="text-xs font-extrabold text-emerald-400 block mt-0.5">
                    {queueStatus.accounts.reduce((sum, a) => sum + (a.remaining || 0), 0)} left
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3 my-4 max-h-72 overflow-y-auto pr-1">
              {(!queueStatus.accounts || queueStatus.accounts.length === 0) ? (
                <div className="p-5 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-center">
                  <p className="text-xs text-zinc-400">No alternate SMTP accounts configured.</p>
                  <a href="/settings" className="text-xs text-orange-400 underline font-semibold mt-1.5 inline-block">
                    Add another email account in Settings →
                  </a>
                </div>
              ) : (
                queueStatus.accounts.map((acc) => {
                  const isActive = queueStatus.activeSender && acc.user?.toLowerCase() === queueStatus.activeSender.toLowerCase();
                  const isLimitReached = acc.sentToday >= acc.dailyLimit;
                  const isSelected = selectedSwitchSmtpId === acc._id;
                  const percent = Math.min(100, Math.round(((acc.sentToday || 0) / (acc.dailyLimit || 450)) * 100));

                  return (
                    <div 
                      key={acc._id}
                      onClick={() => !isLimitReached && setSelectedSwitchSmtpId(acc._id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                        isLimitReached 
                          ? 'border-red-500/40 bg-red-950/20 opacity-75'
                          : isActive 
                            ? 'border-emerald-500/60 bg-emerald-950/20 ring-1 ring-emerald-500/30'
                            : isSelected 
                              ? 'border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/40' 
                              : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : isLimitReached ? 'bg-red-400' : 'bg-zinc-500'}`} />
                          <span className="text-xs font-bold text-zinc-100">{acc.user}</span>
                          {isActive && (
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                              Current Active
                            </span>
                          )}
                          {acc.isDefault && (
                            <span className="text-[10px] text-zinc-400 bg-zinc-800 border border-zinc-700 px-1.5 py-0.2 rounded">
                              Default
                            </span>
                          )}
                        </div>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-orange-500 bg-orange-500' : isActive ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-600'}`}>
                          {(isSelected || isActive) && <div className="w-1.5 h-1.5 rounded-full bg-zinc-950" />}
                        </div>
                      </div>

                      {/* Quota Progress Bar */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-zinc-400">
                            Sent today: <strong className="text-yellow-400">{acc.sentToday || 0}</strong> / {acc.dailyLimit || 450}
                          </span>
                          <span className={isLimitReached ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                            {isLimitReached ? 'Daily Limit Reached' : `${acc.remaining || 0} mails left`}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-300 ${isLimitReached ? 'bg-red-500' : percent > 75 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
              <a
                href="/settings"
                className="text-xs text-yellow-400 hover:text-yellow-300 font-semibold underline"
              >
                + Add / Manage Accounts in Settings →
              </a>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowSwitchModal(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                >
                  Close
                </button>
                <button
                  onClick={() => handleSwitchQueueAccount(selectedSwitchSmtpId)}
                  disabled={!selectedSwitchSmtpId || switchingAccount}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-zinc-950 text-xs font-extrabold shadow-md transition disabled:opacity-50 cursor-pointer"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>{switchingAccount ? 'Switching...' : 'Switch Account & Resume'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

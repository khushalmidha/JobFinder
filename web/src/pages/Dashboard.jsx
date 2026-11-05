import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Search, Mail, Filter, AlertCircle, Briefcase, ChevronDown, ChevronUp, Download, Play, Pause, RefreshCw, Trash2, Sparkles, CheckCircle2, ShieldCheck, XCircle, AlertTriangle, RotateCcw, ArrowRightLeft, X, FileText, Copy } from 'lucide-react';
import ComposePanel from '../components/ComposePanel';
import * as XLSX from 'xlsx';

const Dashboard = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [daysFilter, setDaysFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [composeData, setComposeData] = useState({ ids: [], jobLink: '' });
  const [error, setError] = useState('');
  const [jobLinks, setJobLinks] = useState({}); // { companyName: 'jobLink' }
  const [roles, setRoles] = useState({}); // { companyName: 'role' }
  const [queueStatus, setQueueStatus] = useState({ pending: 0, size: 0, isPaused: false, limitFailedCount: 0 });
  const [blockedCompanies, setBlockedCompanies] = useState([]);
  const [activeTab, setActiveTab] = useState('active'); // 'active', 'invalid', 'blocked'
  const [companyToBlock, setCompanyToBlock] = useState(null);
  const [shareToast, setShareToast] = useState('');
  const [invalidCompanyFilter, setInvalidCompanyFilter] = useState('all');
  const [invalidSearch, setInvalidSearch] = useState('');
  const [ctcFilter, setCtcFilter] = useState('all');
  const [validatingEmails, setValidatingEmails] = useState(false);
  const [validationToast, setValidationToast] = useState('');
  const [contactToDelete, setContactToDelete] = useState(null);
  const [deletingContact, setDeletingContact] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);

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

  const handleValidateDeliverability = async () => {
    try {
      setValidatingEmails(true);
      setValidationToast('⚡ Running DNS MX & SMTP checks across all contacts...');
      const { data } = await api.post('/contacts/validate-deliverability');
      setValidationToast(data.message);
      setTimeout(() => setValidationToast(''), 7000);
      fetchContacts();
    } catch (err) {
      setValidationToast(err.response?.data?.error || 'Validation failed');
      setTimeout(() => setValidationToast(''), 4000);
    } finally {
      setValidatingEmails(false);
    }
  };

  const handleRestoreToValid = async (contactId) => {
    try {
      await api.put(`/contacts/${contactId}/deliverability`, { status: 'valid', reason: 'Manually verified as deliverable' });
      setContacts(prev => prev.map(c => c._id === contactId ? { ...c, deliverabilityStatus: 'valid' } : c));
      setShareToast('✓ Contact moved to Active Deliverable Contacts!');
      setTimeout(() => setShareToast(''), 3000);
    } catch (err) {
      console.error('Failed to update deliverability status', err);
    }
  };

  const handleRestoreCompanyToValid = async (companyName) => {
    try {
      await api.post('/contacts/bulk-deliverability', { 
        company: companyName, 
        status: 'valid', 
        reason: 'Manually verified as deliverable' 
      });
      setContacts(prev => prev.map(c => 
        (c.company || '').toLowerCase() === companyName.toLowerCase() && c.deliverabilityStatus === 'invalid'
          ? { ...c, deliverabilityStatus: 'valid' } 
          : c
      ));
      setShareToast(`✓ All ${companyName} contacts moved to Active Contacts!`);
      setTimeout(() => setShareToast(''), 3000);
    } catch (err) {
      console.error('Failed to restore company contacts', err);
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

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/contacts');
      setContacts(data);
    } catch (err) {
      setError('Failed to load contacts');
    } finally {
      setLoading(false);
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

  const scanBounces = async () => {
    try {
      setLoading(true);
      const { data } = await api.post('/mail/scan-bounces');
      alert(data.message);
      fetchContacts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to scan bounces');
    } finally {
      setLoading(false);
    }
  };

  const deleteBounced = async () => {
    if (!window.confirm('Are you sure you want to delete all contacts marked as bounced?')) return;
    try {
      setLoading(true);
      const { data } = await api.delete('/mail/delete-bounced');
      alert(data.message);
      fetchContacts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete bounced contacts');
    } finally {
      setLoading(false);
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
    return () => clearInterval(interval);
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
  const activeContactsList = contacts.filter(c => c.deliverabilityStatus !== 'invalid');
  const invalidContactsList = contacts.filter(c => c.deliverabilityStatus === 'invalid');

  const filteredContacts = activeContactsList.filter(c => {
    const s = search.toLowerCase();
    const matchSearch = !search || 
      (c.company || '').toLowerCase().includes(s) || 
      (c.hrName || '').toLowerCase().includes(s) || 
      (c.email || '').toLowerCase().includes(s) || 
      (c.role || '').toLowerCase().includes(s);
    
    let matchStatus = true;
    if (statusFilter === 'replied') {
      matchStatus = c.status === 'replied' || c.status === 'reply_received' || c.status === 'positive_response';
    } else if (statusFilter === 'shared') {
      matchStatus = c.isShared === true;
    } else if (statusFilter === 'private') {
      matchStatus = !c.isShared;
    } else if (statusFilter) {
      matchStatus = c.status === statusFilter;
    }
    
    let matchDays = true;
    if (daysFilter) {
      if (daysFilter === 'never_mailed') {
        matchDays = !c.lastMailedAt;
      } else if (daysFilter === 'within_1_week') {
        const dateToCheck = c.lastMailedAt || c.createdAt;
        if (!dateToCheck) {
          matchDays = false;
        } else {
          const daysAgo = (new Date() - new Date(dateToCheck)) / (1000 * 60 * 60 * 24);
          matchDays = daysAgo < 7;
        }
      } else {
        const daysMap = {
          '1_week': 7,
          '2_weeks': 14,
          '3_weeks': 21,
          '4_weeks': 28,
          '8_weeks': 56,
          '7': 7,
          '14': 14,
          '21': 21,
          '28': 28,
          '56': 56,
          '10': 10,
          '20': 20,
          '30': 30
        };
        const minDays = daysMap[daysFilter] || parseInt(daysFilter, 10);
        const dateToCheck = c.lastMailedAt || c.createdAt;
        if (!dateToCheck) {
          matchDays = false;
        } else {
          const daysAgo = (new Date() - new Date(dateToCheck)) / (1000 * 60 * 60 * 24);
          matchDays = daysAgo >= minDays;
        }
      }
    }

    let matchCtc = true;
    if (ctcFilter !== 'all') {
      const lpa = parseLpa(c.package);
      if (ctcFilter === '1_cr_plus') matchCtc = lpa >= 100;
      else if (ctcFilter === '70_to_100') matchCtc = lpa >= 70 && lpa < 100;
      else if (ctcFilter === '50_to_70') matchCtc = lpa >= 50 && lpa < 70;
      else if (ctcFilter === '35_to_50') matchCtc = lpa >= 35 && lpa < 50;
      else if (ctcFilter === '20_to_35') matchCtc = lpa >= 20 && lpa < 35;
      else if (ctcFilter === '12_to_20') matchCtc = lpa >= 12 && lpa < 20;
      else if (ctcFilter === 'under_12') matchCtc = lpa < 12;
      else if (ctcFilter === 'above_50') matchCtc = lpa >= 50;
    }
    
    return matchSearch && matchStatus && matchDays && matchCtc;
  });

  const capitalizeCompany = (name) => {
    return name.split(' ').map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '').join(' ');
  };

  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.filter(c => {
    const originalComp = capitalizeCompany((c.company || 'Unknown').trim());
    return !blockedCompanies.some(b => b.toLowerCase() === originalComp.toLowerCase());
  }).every(c => selectedIds.has(c._id));

  const toggleSelectAll = () => {
    const newSelected = new Set(selectedIds);
    const unblockedFiltered = filteredContacts.filter(c => {
      const originalComp = capitalizeCompany((c.company || 'Unknown').trim());
      return !blockedCompanies.some(b => b.toLowerCase() === originalComp.toLowerCase());
    });

    if (allFilteredSelected) {
      unblockedFiltered.forEach(c => newSelected.delete(c._id));
    } else {
      unblockedFiltered.forEach(c => newSelected.add(c._id));
    }
    setSelectedIds(newSelected);
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

  const activeGroupedContacts = {};
  const blockedGroupedContacts = {};

  Object.entries(groupedContacts).forEach(([company, companyContacts]) => {
    const isBlocked = blockedCompanies.some(b => b.toLowerCase() === company.toLowerCase());
    if (isBlocked) {
      blockedGroupedContacts[company] = companyContacts;
    } else {
      activeGroupedContacts[company] = companyContacts;
    }
  });

  // Filter and group invalid contacts for the dedicated Invalid tab
  const filteredInvalidContacts = invalidContactsList.filter(c => {
    const s = invalidSearch.toLowerCase();
    const matchSearch = !invalidSearch ||
      (c.company || '').toLowerCase().includes(s) ||
      (c.hrName || '').toLowerCase().includes(s) ||
      (c.email || '').toLowerCase().includes(s) ||
      (c.validationReason || '').toLowerCase().includes(s);

    const matchCompany = invalidCompanyFilter === 'all' || 
      (c.company || '').toLowerCase() === invalidCompanyFilter.toLowerCase();

    return matchSearch && matchCompany;
  });

  const invalidGroupedContacts = filteredInvalidContacts.reduce((acc, contact) => {
    const rawComp = (contact.company || 'Unknown').trim();
    const originalComp = capitalizeCompany(rawComp);
    const normalizedKey = originalComp.toLowerCase();
    
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

  const downloadExcel = (onlySelected = false) => {
    const listToExport = onlySelected
      ? contacts.filter(c => selectedIds.has(c._id))
      : filteredContacts;

    if (listToExport.length === 0) {
      alert('No contacts available to export.');
      return;
    }
    
    const formattedData = listToExport.map(c => ({
      'Company': c.company || '',
      'HR Name': c.hrName || '',
      'Email': c.email || '',
      'Role': c.role || '',
      'Status': c.status || '',
      'Date Added': new Date(c.createdAt).toLocaleDateString(),
      'Last Mailed': c.lastMailedAt ? new Date(c.lastMailedAt).toLocaleDateString() : 'Never'
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, onlySelected ? "Selected Contacts" : "Contacts");
    
    // Auto-size columns roughly
    const colWidths = [
      { wch: 20 }, // Company
      { wch: 20 }, // HR Name
      { wch: 30 }, // Email
      { wch: 20 }, // Role
      { wch: 15 }, // Status
      { wch: 15 }, // Date Added
      { wch: 15 }  // Last Mailed
    ];
    worksheet['!cols'] = colWidths;

    const filename = onlySelected 
      ? `JobFinder_Selected_${listToExport.length}_Contacts.xlsx` 
      : "JobFinder_Contacts.xlsx";
    XLSX.writeFile(workbook, filename);
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
    <div className="p-8 max-w-7xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-8">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-zinc-100">Contacts by Company</h1>
            {!loading && contacts.length > 0 && (
              <span className="bg-zinc-800 text-yellow-500 text-xs px-2.5 py-1 rounded-full font-bold border border-yellow-500/20 shadow-sm">
                {filteredContacts.length} {filteredContacts.length !== contacts.length ? `of ${contacts.length} ` : ''}Contacts
              </span>
            )}
          </div>
          <p className="text-zinc-400 text-sm mt-1">Manage outreach per company and inject specific Job Links.</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400">
              Queue: {queueStatus.pending + queueStatus.size}
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
          <button 
            onClick={handleValidateDeliverability}
            disabled={validatingEmails}
            className="flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-4 py-2 rounded-lg font-bold transition-all shadow-md text-xs cursor-pointer disabled:opacity-50"
            title="Checks MX records & SMTP deliverability to separate bad/invalid emails without deleting them"
          >
            <Sparkles className="w-4 h-4 text-yellow-300" />
            <span>{validatingEmails ? 'Validating...' : '⚡ Validate Emails (SMTP/MX)'}</span>
          </button>
          <button 
            onClick={scanBounces}
            className="flex items-center space-x-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3.5 py-2 rounded-lg font-medium transition-colors border border-zinc-700 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Scan Bounces</span>
          </button>
          <button 
            onClick={deleteBounced}
            className="flex items-center space-x-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-3.5 py-2 rounded-lg font-medium transition-colors border border-red-500/20 text-xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Bounced</span>
          </button>
          <button 
            onClick={() => downloadTxt(selectedIds.size > 0, false)}
            disabled={contacts.length === 0}
            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-lg font-bold transition-all border text-xs cursor-pointer shadow-sm ${
              selectedIds.size > 0 
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 ring-1 ring-amber-500/30' 
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
            title={selectedIds.size > 0 ? `Download ${selectedIds.size} selected emails as .txt file` : 'Download all emails as .txt file'}
          >
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span>{selectedIds.size > 0 ? `Export TXT (${selectedIds.size})` : 'Export TXT'}</span>
          </button>
          <button 
            onClick={() => downloadExcel(selectedIds.size > 0)}
            disabled={contacts.length === 0}
            className="flex items-center space-x-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3.5 py-2 rounded-lg font-medium transition-colors border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs cursor-pointer"
            title={selectedIds.size > 0 ? `Export ${selectedIds.size} selected to Excel` : 'Export all to Excel'}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{selectedIds.size > 0 ? `Export Excel (${selectedIds.size})` : 'Export Excel'}</span>
          </button>
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

      {validationToast && (
        <div className="mb-4 p-3 rounded-xl bg-indigo-950/90 border border-indigo-500/50 text-indigo-200 text-xs font-bold flex items-center justify-between shadow-xl animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{validationToast}</span>
          </div>
          <button onClick={() => setValidationToast('')} className="text-zinc-400 hover:text-zinc-200 text-sm font-black ml-2 cursor-pointer">×</button>
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

      <div className="flex space-x-4 mb-6 border-b border-zinc-800">
        <button 
          onClick={() => setActiveTab('active')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'active' ? 'border-yellow-500 text-yellow-500' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Active Deliverable Contacts ({activeContactsList.length})
        </button>
        <button 
          onClick={() => setActiveTab('invalid')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center ${activeTab === 'invalid' ? 'border-amber-500 text-amber-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          <AlertCircle className="w-4 h-4 mr-1.5 text-amber-400" />
          Separated Invalid Emails
          {invalidContactsList.length > 0 && (
            <span className={`ml-2 px-2 py-0.5 text-xs rounded-full font-bold ${activeTab === 'invalid' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-zinc-800 text-zinc-400'}`}>
              {invalidContactsList.length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveTab('blocked')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center ${activeTab === 'blocked' ? 'border-red-500 text-red-500' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Blocked Companies
          {Object.keys(blockedGroupedContacts).length > 0 && (
            <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${activeTab === 'blocked' ? 'bg-red-500/20' : 'bg-zinc-800'}`}>
              {Object.keys(blockedGroupedContacts).length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'active' && (
      <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 mb-8 p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px] sm:min-w-[280px] max-w-md" style={{ minWidth: '220px' }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input 
              type="text" 
              placeholder="Search companies, emails, roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>

          <div className="relative w-36 sm:w-40 shrink-0">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full pl-8 pr-7 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-xs sm:text-sm appearance-none text-zinc-200 truncate cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="replied">💬 Replied Only</option>
              <option value="shared">🌐 Shared Only</option>
              <option value="private">🔒 Private Only</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="bounced">Bounced</option>
              <option value="failed">Failed</option>
              <option value="positive_response">Positive Response</option>
              <option value="negative_response">Negative Response</option>
              <option value="auto_reply">Auto Reply</option>
              <option value="follow_up_later">Follow Up Later</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          </div>

          <div className="relative w-40 sm:w-44 shrink-0">
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(e.target.value)}
              className="w-full pl-3 pr-7 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-xs sm:text-sm appearance-none text-zinc-200 truncate cursor-pointer"
              title="Filter contacts by weeks (last mailed or added)"
            >
              <option value="">Any Time</option>
              <option value="1_week">&gt; 1 Week Ago</option>
              <option value="2_weeks">&gt; 2 Weeks Ago</option>
              <option value="3_weeks">&gt; 3 Weeks Ago</option>
              <option value="4_weeks">&gt; 4 Weeks (1 Mo) Ago</option>
              <option value="8_weeks">&gt; 8 Weeks (2 Mo) Ago</option>
              <option value="within_1_week">&lt; 1 Week (Recent)</option>
              <option value="never_mailed">Never Mailed</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          </div>

          <div className="relative w-36 sm:w-40 shrink-0">
            <select
              value={ctcFilter}
              onChange={(e) => setCtcFilter(e.target.value)}
              className="w-full pl-3 pr-7 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-xs sm:text-sm appearance-none text-zinc-200 truncate cursor-pointer"
              title="Filter by Expected Entry-Level / SDE CTC"
            >
              <option value="all">All CTC Ranges</option>
              <option value="1_cr_plus">💎 1 Cr+</option>
              <option value="70_to_100">⚡ 70 - 100 LPA</option>
              <option value="50_to_70">🚀 50 - 70 LPA</option>
              <option value="35_to_50">🔥 35 - 50 LPA</option>
              <option value="20_to_35">🦄 20 - 35 LPA</option>
              <option value="12_to_20">⚡ 12 - 20 LPA</option>
              <option value="under_12">&lt; 12 LPA</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          </div>
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
          <button
            onClick={() => {
              setComposeData({ ids: Array.from(selectedIds), jobLink: '', role: '' });
              setShowCompose(true);
            }}
            disabled={selectedIds.size === 0}
            className="flex items-center px-4 py-2 bg-yellow-500 text-zinc-950 hover:bg-yellow-400 rounded-lg font-bold transition-colors shadow-sm text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Mail className="w-4 h-4 mr-1.5" />
            Send ({selectedIds.size})
          </button>
        </div>
      </div>
      )}

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
      ) : (Object.keys(activeTab === 'active' ? activeGroupedContacts : blockedGroupedContacts).length === 0) ? (
        <div className="text-center p-12 bg-zinc-900 rounded-xl border border-zinc-800">
          <AlertCircle className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-medium">No {activeTab === 'active' ? 'active' : 'blocked'} contacts found.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(activeTab === 'active' ? activeGroupedContacts : blockedGroupedContacts).map(([company, companyContacts]) => {
            const isBlocked = activeTab === 'blocked';
            
            return (
            <div key={company} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden shadow-sm">
              {/* Company Header */}
              <div className="p-4 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
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
                    onClick={() => isBlocked ? handleUnblockCompany(company) : setCompanyToBlock(company)}
                    className={`ml-2 text-xs font-bold px-3 py-1.5 rounded transition-colors ${isBlocked ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                  >
                    {isBlocked ? 'Unblock All' : 'Block'}
                  </button>
                </div>
                
                {!isBlocked && (
                  <div className="flex items-center space-x-3 w-full md:w-auto">
                    <div className="relative flex-1 md:w-48">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input 
                        type="text" 
                        placeholder="Role (e.g. SDE 1)"
                        value={roles[company] || ''}
                        onChange={(e) => setRoles({ ...roles, [company]: e.target.value })}
                        className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
                      />
                    </div>
                    <div className="relative flex-1 md:w-48">
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
                            checked={selectedIds.has(contact._id)}
                            onChange={() => toggleSelect(contact._id)}
                            className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900"
                          />
                        </td>
                        <td className="p-3 text-zinc-300 font-medium w-1/4">{contact.hrName || 'HR Team'}</td>
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
      {activeTab === 'invalid' && (
        <div className="space-y-6">
          <div className="p-4 bg-amber-950/30 border border-amber-500/40 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-amber-200">Separated Invalid &amp; Unverified Emails (Not Deleted)</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  These emails were identified as non-deliverable (e.g. domain does not exist, missing MX records, disposable domain, or malformed syntax). 
                  They are kept safely here so your Gmail reputation stays 100% protected. You can filter them by company or restore any contact to Active.
                </p>
              </div>
            </div>
          </div>

          {/* Company-wise Filter & Search bar for Invalid Tab */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search invalid emails or failure reasons..."
                  value={invalidSearch}
                  onChange={(e) => setInvalidSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Companywise Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-400">Filter Company:</span>
                <select
                  value={invalidCompanyFilter}
                  onChange={(e) => setInvalidCompanyFilter(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                >
                  <option value="all">All Companies ({Object.keys(invalidGroupedContacts).length})</option>
                  {Object.keys(invalidGroupedContacts).sort().map(comp => (
                    <option key={comp} value={comp}>{comp} ({invalidGroupedContacts[comp].length})</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleValidateDeliverability}
              disabled={validatingEmails}
              className="bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${validatingEmails ? 'animate-spin' : ''}`} />
              Re-Scan Deliverability
            </button>
          </div>

          {/* Invalid Contacts List Grouped by Company */}
          {Object.keys(invalidGroupedContacts).length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h3 className="text-base font-bold text-zinc-200">No Invalid Emails Found</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                {invalidContactsList.length === 0
                  ? 'All contacts have verified deliverable MX mail servers and valid formats! Hit "Validate Emails (SMTP/MX)" above anytime to verify.'
                  : 'No invalid emails matched your current company or search filter.'}
              </p>
            </div>
          ) : (
            Object.entries(invalidGroupedContacts).map(([company, companyContacts]) => (
              <div key={company} className="bg-zinc-900 border border-amber-500/20 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 bg-zinc-950/60 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-extrabold text-zinc-100">{company}</h2>
                    <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded-full font-bold">
                      {companyContacts.length} invalid email{companyContacts.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRestoreCompanyToValid(company)}
                    className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                    title={`Move all ${company} contacts back to Active Contacts`}
                  >
                    ✓ Move All to Active
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead className="bg-zinc-950/40 text-zinc-400 text-[11px] font-bold uppercase tracking-wider border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-4">Recruiter / HR</th>
                        <th className="py-2.5 px-4">Separated Email Address</th>
                        <th className="py-2.5 px-4">Deliverability Failure Reason</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {companyContacts.map(contact => (
                        <tr key={contact._id} className="hover:bg-zinc-800/30 transition">
                          <td className="py-3 px-4 text-zinc-300 font-medium">
                            {contact.hrName || 'Talent Acquisition'}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-red-400 font-bold">
                            {contact.email}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-800/60 text-red-300 text-[11px] font-semibold">
                              ⚠️ {contact.validationReason || 'Failed DNS MX check'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleRestoreToValid(contact._id)}
                                className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 rounded-lg text-xs font-bold transition cursor-pointer"
                                title="Override check and move this contact back to Active Contacts"
                              >
                                ✓ Move to Active
                              </button>
                              <button
                                onClick={() => copySingleEmail(contact.email)}
                                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-amber-300 rounded-lg text-xs font-bold transition cursor-pointer"
                                title={`Copy ${contact.email} to clipboard`}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setContactToDelete(contact)}
                                className="p-1.5 bg-zinc-800 hover:bg-red-950/60 border border-transparent hover:border-red-800 text-zinc-400 hover:text-red-400 rounded-lg text-xs font-bold transition cursor-pointer"
                                title="Remove Invalid Contact Permanently"
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
            ))
          )}
        </div>
      )}

      {showCompose && (
        <ComposePanel 
          selectedIds={composeData.ids} 
          jobLinkOverride={composeData.jobLink}
          roleOverride={composeData.role}
          onClose={() => setShowCompose(false)} 
          onSuccess={() => {
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

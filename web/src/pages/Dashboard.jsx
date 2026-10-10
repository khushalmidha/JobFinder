import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Search, Mail, Filter, AlertCircle, Briefcase, ChevronDown, ChevronUp, Download, Play, Pause, RefreshCw, Trash2 } from 'lucide-react';
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
  const [queueStatus, setQueueStatus] = useState({ pending: 0, size: 0, isPaused: false });
  const [blockedCompanies, setBlockedCompanies] = useState([]);
  const [activeTab, setActiveTab] = useState('active'); // 'active' or 'blocked'
  const [companyToBlock, setCompanyToBlock] = useState(null);
  const [shareToast, setShareToast] = useState('');

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

  useEffect(() => {
    fetchContacts();
    fetchQueueStatus();
    
    // Fetch settings to get blocked companies
    api.get('/auth/settings')
      .then(({ data }) => {
        if (data && data.blockedCompanies) {
          setBlockedCompanies(data.blockedCompanies);
        }
      })
      .catch(console.error);

    const interval = setInterval(fetchQueueStatus, 5000);
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

  const filteredContacts = contacts.filter(c => {
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
      if (!c.lastMailedAt) {
        matchDays = false;
      } else {
        const daysAgo = (new Date() - new Date(c.lastMailedAt)) / (1000 * 60 * 60 * 24);
        matchDays = daysAgo >= parseInt(daysFilter, 10);
      }
    }
    
    return matchSearch && matchStatus && matchDays;
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

  const downloadExcel = () => {
    if (contacts.length === 0) return;
    
    const formattedData = filteredContacts.map(c => ({
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
    XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts");
    
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

    XLSX.writeFile(workbook, "JobFinder_Contacts.xlsx");
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
            <button 
              onClick={toggleQueue}
              className={`p-1 rounded flex items-center justify-center transition-colors ${queueStatus.isPaused ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'}`}
              title={queueStatus.isPaused ? 'Resume Queue' : 'Pause Queue'}
            >
              {queueStatus.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button 
            onClick={scanBounces}
            className="flex items-center space-x-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-lg font-medium transition-colors border border-zinc-700"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Scan Bounces</span>
          </button>
          <button 
            onClick={deleteBounced}
            className="flex items-center space-x-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-2 rounded-lg font-medium transition-colors border border-red-500/20"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Bounced</span>
          </button>
          <button 
            onClick={downloadExcel}
            disabled={contacts.length === 0}
            className="flex items-center space-x-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-lg font-medium transition-colors border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

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
          Active Contacts
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
      <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 mb-8 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex space-x-4 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search companies, emails, roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm appearance-none text-zinc-200"
            >
              <option value="">All Statuses</option>
              <option value="replied">💬 Replied Only</option>
              <option value="shared">🌐 Manually Shared Only</option>
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
          </div>
          <div className="relative">
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(e.target.value)}
              className="pl-4 pr-8 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:ring-2 focus:ring-yellow-500 outline-none text-sm appearance-none text-zinc-200"
              title="Show contacts last mailed more than X days ago"
            >
              <option value="">Any Time</option>
              <option value="10">&gt; 10 Days Ago</option>
              <option value="20">&gt; 20 Days Ago</option>
              <option value="30">&gt; 30 Days Ago</option>
            </select>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer text-zinc-300 font-medium">
            <input 
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900 w-5 h-5"
            />
            <span>Select All Filtered</span>
          </label>
          <button
            onClick={() => {
              setComposeData({ ids: Array.from(selectedIds), jobLink: '', role: '' });
              setShowCompose(true);
            }}
            disabled={selectedIds.size === 0}
            className="flex items-center px-4 py-2 bg-yellow-500 text-zinc-950 hover:bg-yellow-400 rounded-lg font-bold transition-colors shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mail className="w-4 h-4 mr-2" />
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
    </div>
  );
};

export default Dashboard;

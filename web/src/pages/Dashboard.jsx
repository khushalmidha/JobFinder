import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Search, Mail, Filter, AlertCircle, Briefcase, ChevronDown, ChevronUp, Download } from 'lucide-react';
import ComposePanel from '../components/ComposePanel';

const Dashboard = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [composeData, setComposeData] = useState({ ids: [], jobLink: '' });
  const [error, setError] = useState('');
  const [jobLinks, setJobLinks] = useState({}); // { companyName: 'jobLink' }
  const [roles, setRoles] = useState({}); // { companyName: 'role' }

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

  useEffect(() => {
    fetchContacts();
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
    
    const matchStatus = !statusFilter || c.status === statusFilter;
    
    return matchSearch && matchStatus;
  });

  const groupedContacts = filteredContacts.reduce((acc, contact) => {
    const originalComp = (contact.company || 'Unknown').trim();
    const normalizedKey = originalComp.toLowerCase();
    
    // Find if we already have this company under a different casing
    const existingKey = Object.keys(acc).find(k => k.toLowerCase() === normalizedKey);
    const compKey = existingKey || originalComp;
    
    if (!acc[compKey]) acc[compKey] = [];
    acc[compKey].push(contact);
    return acc;
  }, {});

  const handleComposeCompany = (company, companyContacts) => {
    const selectedInCompany = companyContacts.filter(c => selectedIds.has(c._id)).map(c => c._id);
    const idsToUse = selectedInCompany.length > 0 ? selectedInCompany : companyContacts.map(c => c._id);
    
    setComposeData({
      ids: idsToUse,
      jobLink: jobLinks[company] || '',
      role: roles[company] || ''
    });
    setShowCompose(true);
  };

  const downloadCSV = () => {
    if (contacts.length === 0) return;
    
    // Headers
    const headers = ['Company', 'HR Name', 'Email', 'Role', 'Status', 'Date Added', 'Last Mailed'];
    
    // Data rows
    const rows = filteredContacts.map(c => [
      `"${(c.company || '').replace(/"/g, '""')}"`,
      `"${(c.hrName || '').replace(/"/g, '""')}"`,
      `"${(c.email || '').replace(/"/g, '""')}"`,
      `"${(c.role || '').replace(/"/g, '""')}"`,
      `"${(c.status || '').replace(/"/g, '""')}"`,
      `"${new Date(c.createdAt).toLocaleDateString()}"`,
      `"${c.lastMailedAt ? new Date(c.lastMailedAt).toLocaleDateString() : 'Never'}"`
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'jobfinder_contacts.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <div>
          <button 
            onClick={downloadCSV}
            disabled={contacts.length === 0}
            className="flex items-center space-x-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-lg font-medium transition-colors border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>Export to Excel (CSV)</span>
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 mb-8 p-4 flex space-x-4">
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
      </div>

      {loading ? (
        <div className="text-center p-12 text-zinc-500">Loading contacts...</div>
      ) : Object.keys(groupedContacts).length === 0 ? (
        <div className="text-center p-12 bg-zinc-900 rounded-xl border border-zinc-800">
          <AlertCircle className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-medium">No contacts found.</p>
          <p className="text-zinc-500 text-sm mt-1">Import some contacts or use the extension to add them.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedContacts).map(([company, companyContacts]) => (
            <div key={company} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden shadow-sm">
              {/* Company Header */}
              <div className="p-4 border-b border-zinc-800 bg-zinc-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <input 
                    type="checkbox" 
                    checked={companyContacts.length > 0 && companyContacts.every(c => selectedIds.has(c._id))}
                    onChange={() => toggleSelectCompany(companyContacts)}
                    className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900 w-5 h-5"
                  />
                  <h2 className="text-lg font-bold text-zinc-100">{company}</h2>
                  <span className="bg-zinc-800 text-zinc-400 text-xs px-2 py-0.5 rounded-full font-medium">
                    {companyContacts.length} contact{companyContacts.length > 1 ? 's' : ''}
                  </span>
                </div>
                
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
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(contact.status)}`}>
                            {contact.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </span>
                        </td>
                        <td className="p-3 text-zinc-500 text-xs max-w-xs truncate" title={contact.notes || ''}>
                          {contact.notes || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
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
          }} 
        />
      )}
    </div>
  );
};

export default Dashboard;

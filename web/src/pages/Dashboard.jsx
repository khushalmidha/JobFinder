import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Search, Mail, Filter, AlertCircle } from 'lucide-react';
import ComposePanel from '../components/ComposePanel';

const Dashboard = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [error, setError] = useState('');

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      
      const { data } = await api.get(`/contacts?${params.toString()}`);
      setContacts(data);
    } catch (err) {
      setError('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [search, statusFilter]);

  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map(c => c._id)));
    }
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

  return (
    <div className="p-8 max-w-7xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Contacts</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage and outreach to your saved contacts.</p>
        </div>
        <button 
          onClick={() => setShowCompose(true)}
          disabled={selectedIds.size === 0}
          className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors shadow-sm ${
            selectedIds.size > 0 ? 'bg-yellow-500 text-zinc-950 hover:bg-yellow-400' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
          }`}
        >
          <Mail className="w-4 h-4 mr-2" />
          Compose & Send ({selectedIds.size})
        </button>
      </div>

      <div className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-zinc-800 flex space-x-4 bg-zinc-900/50">
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

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                <th className="p-4 w-12 text-center">
                  <input 
                    type="checkbox" 
                    checked={contacts.length > 0 && selectedIds.size === contacts.length}
                    onChange={toggleSelectAll}
                    className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900"
                  />
                </th>
                <th className="p-4 font-semibold">Company</th>
                <th className="p-4 font-semibold">HR / Contact</th>
                <th className="p-4 font-semibold">Email</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-zinc-500">Loading contacts...</td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-12 text-center">
                    <AlertCircle className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                    <p className="text-zinc-400 font-medium">No contacts found.</p>
                    <p className="text-zinc-500 text-sm mt-1">Import some contacts or use the extension to add them.</p>
                  </td>
                </tr>
              ) : (
                contacts.map(contact => (
                  <tr key={contact._id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="p-4 text-center">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(contact._id)}
                        onChange={() => toggleSelect(contact._id)}
                        className="rounded border-zinc-700 bg-zinc-800 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-zinc-900"
                      />
                    </td>
                    <td className="p-4 font-medium text-zinc-200">{contact.company}</td>
                    <td className="p-4 text-zinc-400">{contact.hrName || '-'}</td>
                    <td className="p-4 text-zinc-400">{contact.email}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(contact.status)}`}>
                        {contact.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </span>
                    </td>
                    <td className="p-4 text-zinc-500 text-xs max-w-xs truncate" title={contact.notes || ''}>
                      {contact.notes || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCompose && (
        <ComposePanel 
          selectedIds={Array.from(selectedIds)} 
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

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
      case 'sent': return 'bg-green-100 text-green-800 border-green-200';
      case 'bounced': return 'bg-red-100 text-red-800 border-red-200';
      case 'failed': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
          <p className="text-slate-500 text-sm mt-1">Manage and outreach to your saved contacts.</p>
        </div>
        <button 
          onClick={() => setShowCompose(true)}
          disabled={selectedIds.size === 0}
          className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors shadow-sm ${
            selectedIds.size > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Mail className="w-4 h-4 mr-2" />
          Compose & Send ({selectedIds.size})
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 flex space-x-4 bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search companies, emails, roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none bg-white"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="bounced">Bounced</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="p-4 w-12 text-center">
                  <input 
                    type="checkbox" 
                    checked={contacts.length > 0 && selectedIds.size === contacts.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="p-4 font-semibold">Company</th>
                <th className="p-4 font-semibold">HR / Contact</th>
                <th className="p-4 font-semibold">Email</th>
                <th className="p-4 font-semibold">Role</th>
                <th className="p-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">Loading contacts...</td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-12 text-center">
                    <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">No contacts found.</p>
                    <p className="text-slate-400 text-sm mt-1">Import some contacts or use the extension to add them.</p>
                  </td>
                </tr>
              ) : (
                contacts.map(contact => (
                  <tr key={contact._id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-center">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(contact._id)}
                        onChange={() => toggleSelect(contact._id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-4 font-medium text-slate-900">{contact.company}</td>
                    <td className="p-4 text-slate-600">{contact.hrName || '-'}</td>
                    <td className="p-4 text-slate-600">{contact.email}</td>
                    <td className="p-4 text-slate-600">{contact.role || '-'}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(contact.status)}`}>
                        {contact.status.charAt(0).toUpperCase() + contact.status.slice(1)}
                      </span>
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

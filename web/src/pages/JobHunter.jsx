import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Briefcase, 
  Building2, 
  Download, 
  RotateCw, 
  Sparkles, 
  MapPin, 
  TrendingUp, 
  Users, 
  Clock, 
  ExternalLink, 
  CheckCircle2, 
  Search, 
  Filter, 
  Flame, 
  Layers, 
  Send, 
  Plus, 
  Calendar,
  ShieldAlert,
  ArrowUpRight,
  Globe
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const JobHunter = () => {
  const [activeTab, setActiveTab] = useState('jobs'); // 'jobs', 'international_remote', 'companies', 'recruiters', 'scheduler'
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');

  // Jobs state
  const [jobs, setJobs] = useState([]);
  const [jobStats, setJobStats] = useState({ 
    totalJobs: 0, 
    internationalInternships: 0,
    sixMonthInternships: 0, 
    internships: 0, 
    fullTimeJobs: 0, 
    fresherJobs: 0, 
    indiaJobs: 0, 
    remoteJobs: 0, 
    appliedJobs: 0 
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('all'); // 'all', 'india', 'remote'
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedJobType, setSelectedJobType] = useState('all'); // 'all', '6_months_internship', 'internship', 'full_time'
  const [fresherOnly, setFresherOnly] = useState(false);
  const [selectedMinCtc, setSelectedMinCtc] = useState('all'); // 'all', '12', '20', '35', '80'

  // Companies state
  const [companies, setCompanies] = useState([]);
  const [newCompany, setNewCompany] = useState({ name: '', domain: '', tier: 'Funded Tech Startup', careersUrl: '', atsType: 'greenhouse', atsToken: '' });
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);

  // Recruiters state
  const [recruiters, setRecruiters] = useState([]);
  const [importingRecruiters, setImportingRecruiters] = useState(false);
  const [recruiterMessage, setRecruiterMessage] = useState('');

  // Access control state for Shared Recruiter Database (Protected by Khushal Midha)
  const [accessStatus, setAccessStatus] = useState({ hasAccess: true, isOwner: false, status: 'loading' });
  const [accessReason, setAccessReason] = useState('');
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [accessMessage, setAccessMessage] = useState('');
  const [adminRequests, setAdminRequests] = useState([]);
  const [showAdminDrawer, setShowAdminDrawer] = useState(false);


  // Scheduler state
  const [schedulerConfig, setSchedulerConfig] = useState(null);
  const [systemScheduler, setSystemScheduler] = useState(null);

  const token = localStorage.getItem('token');
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    fetchJobs();
    fetchCompanies();
    checkAccessStatus();
    fetchScheduler();
  }, [selectedCategory, selectedLocation, selectedStatus, selectedJobType, fresherOnly, selectedMinCtc]);

  const checkAccessStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/recruiters/access-status`, authHeaders);
      setAccessStatus(res.data);
      if (res.data.isOwner) {
        fetchAdminRequests();
      }
      if (res.data.hasAccess) {
        fetchRecruiters();
      }
    } catch (err) {
      console.error('Check access error:', err);
    }
  };

  const handleRequestAccess = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      setRequestingAccess(true);
      setAccessMessage('');
      const res = await axios.post(`${API_BASE}/recruiters/request-access`, { reason: accessReason }, authHeaders);
      setAccessMessage(res.data.message);
      setAccessStatus(prev => ({ ...prev, status: 'pending' }));
    } catch (err) {
      setAccessMessage(err.response?.data?.error || 'Failed to submit access request.');
    } finally {
      setRequestingAccess(false);
    }
  };

  const fetchAdminRequests = async () => {
    try {
      const res = await axios.get(`${API_BASE}/recruiters/admin/requests`, authHeaders);
      setAdminRequests(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReviewRequest = async (requestId, action) => {
    try {
      await axios.post(`${API_BASE}/recruiters/admin/review-request`, { requestId, action }, authHeaders);
      fetchAdminRequests();
      fetchRecruiters();
    } catch (err) {
      console.error(err);
    }
  };

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (selectedLocation !== 'all') params.append('locationType', selectedLocation);
      if (selectedStatus !== 'all') params.append('status', selectedStatus);
      if (selectedJobType !== 'all') params.append('jobType', selectedJobType);
      if (fresherOnly) params.append('fresherOnly', 'true');
      if (selectedMinCtc !== 'all') params.append('minCtc', selectedMinCtc);
      if (searchQuery) params.append('search', searchQuery);

      const res = await axios.get(`${API_BASE}/jobs?${params.toString()}`, authHeaders);
      setJobs(res.data.jobs || []);
      setJobStats(res.data.stats || { 
        totalJobs: 0, 
        internationalInternships: 0,
        sixMonthInternships: 0, 
        internships: 0, 
        fullTimeJobs: 0, 
        fresherJobs: 0, 
        indiaJobs: 0, 
        remoteJobs: 0, 
        appliedJobs: 0 
      });
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const res = await axios.get(`${API_BASE}/jobs/companies`, authHeaders);
      setCompanies(res.data.companies || []);
    } catch (err) {
      console.error('Error fetching companies:', err);
    }
  };

  const fetchRecruiters = async () => {
    try {
      const res = await axios.get(`${API_BASE}/recruiters/curated`, authHeaders);
      setRecruiters(res.data.recruiters || []);
      setAccessStatus(prev => ({ ...prev, hasAccess: true }));
    } catch (err) {
      if (err.response?.status === 403) {
        setAccessStatus(prev => ({ ...prev, hasAccess: false, status: prev.status === 'pending' ? 'pending' : 'none' }));
      }
    }
  };

  const fetchScheduler = async () => {
    try {
      const res = await axios.get(`${API_BASE}/jobs/scheduler`, authHeaders);
      setSchedulerConfig(res.data.userConfig || null);
      setSystemScheduler(res.data.systemStatus || null);
    } catch (err) {
      console.error('Error fetching scheduler info:', err);
    }
  };

  const handleTriggerScan = async () => {
    try {
      setScanning(true);
      setScanMessage('Crawling Greenhouse, Lever, and Ashby portals for India & Remote openings...');
      const res = await axios.post(`${API_BASE}/jobs/scan`, {}, authHeaders);
      if (res.data.result?.status === 'already_running') {
        setScanMessage('A scan is already actively running in the background. Please wait a few moments and refresh.');
      } else if (res.data.result?.error) {
        setScanMessage('Scan completed with notice: ' + res.data.result.error);
      } else {
        setScanMessage(`Scan finished in ${res.data.result?.durationSec || 0}s! Found ${res.data.result?.totalDiscovered || 0} jobs, added ${res.data.result?.newJobsAdded || 0} new.`);
      }
      fetchJobs();
      fetchCompanies();
      fetchScheduler();
    } catch (err) {
      setScanMessage('Scan notice: ' + (err.response?.data?.error || err.message));
    } finally {
      setScanning(false);
    }
  };

  const handleExportJobs = () => {
    window.open(`${API_BASE}/jobs/export-sheet`, '_blank');
  };

  const handleExportRecruiters = () => {
    window.open(`${API_BASE}/recruiters/export-sheet`, '_blank');
  };

  const handleImportRecruiters = async () => {
    try {
      setImportingRecruiters(true);
      setRecruiterMessage('Importing Indian tech HRs to your ColdMail contacts...');
      const res = await axios.post(`${API_BASE}/recruiters/import-curated`, {}, authHeaders);
      setRecruiterMessage(res.data.message);
      fetchRecruiters();
    } catch (err) {
      setRecruiterMessage('Import failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setImportingRecruiters(false);
    }
  };


  const handleStatusChange = async (jobId, newStatus) => {
    try {
      await axios.patch(`${API_BASE}/jobs/${jobId}/status`, { status: newStatus }, authHeaders);
      setJobs(jobs.map(j => j._id === jobId ? { ...j, status: newStatus } : j));
    } catch (err) {
      console.error('Failed to update job status:', err);
    }
  };

  const handleAddCompany = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/jobs/companies`, newCompany, authHeaders);
      setShowAddCompanyModal(false);
      setNewCompany({ name: '', domain: '', tier: 'Funded Tech Startup', careersUrl: '', atsType: 'greenhouse', atsToken: '' });
      fetchCompanies();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add company');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs font-bold uppercase tracking-wider text-yellow-500">Auto Job Scout & HR Database</span>
          </div>
          <h1 className="text-3xl font-extrabold text-zinc-100 tracking-tight flex items-center gap-3">
            Career Portal Hunter & HR Sheet
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Continuous monitor of India & Global Remote openings across Greenhouse, Lever, and Ashby with automated resume matching & recruiter database.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleTriggerScan}
            disabled={scanning}
            className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-extrabold px-4 py-2.5 rounded-xl shadow-lg transition flex items-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
          >
            <RotateCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Crawling Portals...' : 'Scan Portals Now'}
          </button>

          <button
            onClick={handleExportJobs}
            className="bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-2 text-sm cursor-pointer shadow-sm"
          >
            <Download className="w-4 h-4 text-emerald-400" /> Export Jobs Sheet (.xlsx)
          </button>

          <button
            onClick={handleExportRecruiters}
            className="bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-2 text-sm cursor-pointer shadow-sm"
          >
            <Download className="w-4 h-4 text-blue-400" /> Export HR Sheet (.xlsx)
          </button>
        </div>
      </div>

      {scanMessage && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-400 text-xs font-semibold flex items-center justify-between">
          <span>{scanMessage}</span>
          <button onClick={() => setScanMessage('')} className="text-zinc-400 hover:text-zinc-200 font-bold ml-2">×</button>
        </div>
      )}

      {/* 5 Stat Metrics Cards (Interactive Filters) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Card 1: 6-Month Internships (Top Priority) */}
        <div 
          onClick={() => { setSelectedJobType('6_months_internship'); setActiveTab('jobs'); }}
          className={`bg-zinc-900 border rounded-xl p-3.5 shadow-sm cursor-pointer transition hover:border-amber-400/80 ${
            selectedJobType === '6_months_internship' && activeTab === 'jobs' ? 'border-amber-400 bg-amber-500/5 ring-1 ring-amber-400/40' : 'border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase">
            <span className="flex items-center gap-1.5 text-amber-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              6-Month Interns
            </span>
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 mt-1.5">{jobStats.sixMonthInternships || 0}</div>
          <div className="text-[11px] text-zinc-400 mt-1">⭐ High Priority Semester</div>
        </div>

        {/* Card 2: 🌍 International Remote Internships (Global USD) */}
        <div 
          onClick={() => { setSelectedJobType('international_remote'); setActiveTab('international_remote'); }}
          className={`bg-zinc-900 border rounded-xl p-3.5 shadow-sm cursor-pointer transition hover:border-cyan-400/80 ${
            activeTab === 'international_remote' || selectedJobType === 'international_remote' ? 'border-cyan-400 bg-cyan-500/5 ring-1 ring-cyan-400/40' : 'border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase">
            <span className="flex items-center gap-1.5 text-cyan-400 font-bold">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              Global Remote
            </span>
            <span className="text-[10px] text-cyan-300 font-bold bg-cyan-950/60 border border-cyan-800/60 px-1 rounded">USD</span>
          </div>
          <div className="text-2xl font-black text-cyan-300 mt-1.5">{jobStats.internationalInternships || 82}</div>
          <div className="text-[11px] text-cyan-400/90 font-medium mt-1">🌍 $1.5k - $4.5k/mo Stipend</div>
        </div>

        {/* Card 3: Full-Time (CTC > 12 LPA) */}
        <div 
          onClick={() => { setSelectedJobType('full_time'); setActiveTab('jobs'); }}
          className={`bg-zinc-900 border rounded-xl p-3.5 shadow-sm cursor-pointer transition hover:border-blue-400/80 ${
            selectedJobType === 'full_time' && activeTab === 'jobs' ? 'border-blue-400 bg-blue-500/5 ring-1 ring-blue-400/40' : 'border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase">
            <span className="text-blue-400 font-bold">Full-Time (&gt;12L)</span>
            <Briefcase className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-blue-400 mt-1.5">{jobStats.fullTimeJobs || 0}</div>
          <div className="text-[11px] text-zinc-400 mt-1">SDE 1 & Entry Level</div>
        </div>

        {/* Card 4: All Internships */}
        <div 
          onClick={() => { setSelectedJobType('internship'); setActiveTab('jobs'); }}
          className={`bg-zinc-900 border rounded-xl p-3.5 shadow-sm cursor-pointer transition hover:border-emerald-400/80 ${
            selectedJobType === 'internship' && activeTab === 'jobs' ? 'border-emerald-400 bg-emerald-500/5 ring-1 ring-emerald-400/40' : 'border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase">
            <span className="text-emerald-400 font-bold">All Internships</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1.5">{jobStats.internships || 0}</div>
          <div className="text-[11px] text-zinc-400 mt-1">India & Remote Co-ops</div>
        </div>

        {/* Card 5: High-Paying Tech Companies */}
        <div 
          onClick={() => setActiveTab('companies')}
          className={`bg-zinc-900 border rounded-xl p-3.5 shadow-sm cursor-pointer transition hover:border-yellow-500/60 ${
            activeTab === 'companies' ? 'border-yellow-500 bg-yellow-500/5 ring-1 ring-yellow-500/40' : 'border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase">
            <span className="text-yellow-400 font-bold">Companies</span>
            <Building2 className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <div className="text-2xl font-black text-zinc-100 mt-1.5">{companies.length || 99}</div>
          <div className="text-[11px] text-zinc-500 mt-1">Greenhouse • Lever • Ashby</div>
        </div>
      </div>

      {/* Modern Navigation Tabs */}
      <div className="flex border-b border-zinc-800 gap-2 overflow-x-auto">
        <button
          onClick={() => {
            setActiveTab('jobs');
            if (selectedJobType === 'international_remote') setSelectedJobType('all');
          }}
          className={`pb-3 px-4 text-sm font-bold transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'jobs'
              ? 'border-yellow-500 text-yellow-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Briefcase className="w-4 h-4" /> Live Openings ({jobStats.totalJobs || jobs.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('international_remote');
            setSelectedJobType('international_remote');
          }}
          className={`pb-3 px-4 text-sm font-bold transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'international_remote'
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-zinc-400 hover:text-cyan-300'
          }`}
        >
          <Globe className="w-4 h-4 text-cyan-400" /> 🌍 International Remote Internships ({jobStats.internationalInternships || 82})
        </button>

        <button
          onClick={() => setActiveTab('companies')}
          className={`pb-3 px-4 text-sm font-bold transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'companies'
              ? 'border-yellow-500 text-yellow-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Building2 className="w-4 h-4" /> Company Directory ({companies.length})
        </button>

        <button
          onClick={() => setActiveTab('recruiters')}
          className={`pb-3 px-4 text-sm font-bold transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'recruiters'
              ? 'border-yellow-500 text-yellow-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Users className="w-4 h-4" /> Indian HR & Recruiters ({recruiters.length})
        </button>

        <button
          onClick={() => setActiveTab('scheduler')}
          className={`pb-3 px-4 text-sm font-bold transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'scheduler'
              ? 'border-yellow-500 text-yellow-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Clock className="w-4 h-4" /> Scheduler & Timers
        </button>
      </div>

      {/* TAB 1: LIVE JOB OPENINGS */}
      {activeTab === 'jobs' && (
        <div className="space-y-4">
          {/* Quick Segregation Switcher Pills */}
          <div className="flex flex-wrap items-center gap-2 bg-zinc-900/60 border border-zinc-800/80 p-2.5 rounded-xl">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider px-2">Type:</span>
            
            <button
              onClick={() => setSelectedJobType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                selectedJobType === 'all'
                  ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All Openings ({jobStats.totalJobs})
            </button>

            <button
              onClick={() => setSelectedJobType('6_months_internship')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-sm ${
                selectedJobType === '6_months_internship'
                  ? 'bg-amber-400 text-zinc-950 shadow-amber-500/20'
                  : 'bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              ⭐ 6-Month Internships ({jobStats.sixMonthInternships || 0})
            </button>

            <button
              onClick={() => setSelectedJobType('international_remote')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-sm ${
                selectedJobType === 'international_remote'
                  ? 'bg-cyan-400 text-zinc-950 shadow-cyan-500/20'
                  : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              🌍 International Remote ({jobStats.internationalInternships || 82})
            </button>

            <button
              onClick={() => setSelectedJobType('full_time')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                selectedJobType === 'full_time'
                  ? 'bg-blue-500 text-zinc-100 shadow-sm'
                  : 'bg-blue-500/10 text-blue-300 border border-blue-500/30 hover:bg-blue-500/20'
              }`}
            >
              💼 Full-Time (CTC &gt; 12 LPA) ({jobStats.fullTimeJobs || 0})
            </button>

            <button
              onClick={() => setSelectedJobType('internship')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                selectedJobType === 'internship'
                  ? 'bg-emerald-500 text-zinc-950 shadow-sm'
                  : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20'
              }`}
            >
              🎓 All Internships ({jobStats.internships || 0})
            </button>

            <button
              onClick={() => setFresherOnly(!fresherOnly)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ml-auto ${
                fresherOnly
                  ? 'bg-emerald-400 text-zinc-950 font-black ring-2 ring-emerald-300 shadow-sm'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700'
              }`}
            >
              🎯 Fresher (0-1 YOE) Only {fresherOnly ? '✓' : ''}
            </button>
          </div>

          {/* Filters Bar */}
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="flex flex-1 min-w-[240px] items-center bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus-within:border-yellow-500">
              <Search className="w-4 h-4 text-zinc-500 mr-2" />
              <input
                type="text"
                placeholder="Search by job title, company, or city..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchJobs()}
                className="w-full bg-transparent outline-none text-zinc-100 placeholder:text-zinc-600 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Category Filter */}
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-yellow-500"
              >
                <option value="all">All Roles</option>
                <option value="SDE / Backend">SDE / Backend</option>
                <option value="Frontend / UI">Frontend / UI</option>
                <option value="Full Stack">Full Stack</option>
                <option value="Machine Learning & AI">Machine Learning & AI</option>
                <option value="Quant & C++ Systems">Quant & C++ Systems</option>
                <option value="Internship / Fresher">Internships / Freshers</option>
                <option value="Security & DevOps">Security & DevOps</option>
              </select>

              {/* Min CTC Filter */}
              <select
                value={selectedMinCtc}
                onChange={e => setSelectedMinCtc(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-yellow-400 outline-none focus:border-yellow-500"
              >
                <option value="all">Any CTC</option>
                <option value="12">CTC &gt; 12 LPA (Fresher Standard)</option>
                <option value="20">CTC &gt; 20 LPA (Top Unicorns)</option>
                <option value="35">CTC &gt; 35 LPA (FAANG / Product Titans)</option>
                <option value="80">CTC &gt; 80 LPA (Elite Quant / HFT)</option>
              </select>

              {/* Location Filter */}
              <select
                value={selectedLocation}
                onChange={e => setSelectedLocation(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-yellow-500"
              >
                <option value="all">All Locations</option>
                <option value="india">India Only</option>
                <option value="remote">Remote Only</option>
              </select>

              {/* Status Filter */}
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-yellow-500"
              >
                <option value="all">All Statuses</option>
                <option value="discovered">Discovered</option>
                <option value="ready_to_apply">Ready to Apply</option>
                <option value="applied">Applied</option>
                <option value="auto_applied">Auto-Applied</option>
              </select>
            </div>
          </div>

          {/* Jobs Table */}
          {loading ? (
            <div className="text-center py-16 text-zinc-500">Loading live openings...</div>
          ) : jobs.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center space-y-3">
              <Briefcase className="w-12 h-12 text-zinc-600 mx-auto" />
              <h3 className="text-lg font-bold text-zinc-200">No Matching Openings Found</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Try switching the filters or click "Scan Portals Now" to trigger the automated crawler across 99+ top companies.
              </p>
              <button
                onClick={handleTriggerScan}
                className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs"
              >
                Scan Portals Now
              </button>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-950/80 text-zinc-400 text-[11px] font-bold uppercase tracking-wider border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4">Type & Priority</th>
                      <th className="py-3 px-4">Company & Tier</th>
                      <th className="py-3 px-4">Job Title</th>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4">Comp / Stipend</th>
                      <th className="py-3 px-4">Best Resume Fit</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {jobs.map((job) => {
                      const isInternational = job.isInternationalRemote;
                      const is6M = job.is6MonthIntern || job.jobType === '6_months_internship';
                      const isStandardIntern = job.jobType === 'internship';

                      return (
                        <tr 
                          key={job._id} 
                          className={`hover:bg-zinc-850/50 transition ${
                            isInternational 
                              ? 'bg-cyan-500/[0.04]' 
                              : is6M 
                              ? 'bg-amber-500/[0.04]' 
                              : ''
                          }`}
                        >
                          {/* Opening Type & Priority */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {isInternational ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 border border-cyan-400/60 text-cyan-300 inline-flex items-center gap-1">
                                <Globe className="w-3 h-3 text-cyan-400" />
                                🌍 GLOBAL REMOTE
                              </span>
                            ) : is6M ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-500/20 border border-amber-400/60 text-amber-300 inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                ⭐ 6-MONTH INTERN
                              </span>
                            ) : isStandardIntern ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 inline-flex items-center gap-1">
                                🎓 INTERNSHIP
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 border border-blue-500/30 text-blue-300 inline-flex items-center gap-1">
                                💼 FULL-TIME
                              </span>
                            )}
                            {job.isFresherEligible && (
                              <div className="text-[10px] font-semibold text-emerald-400 mt-1">
                                ✓ Fresher Eligible
                              </div>
                            )}
                          </td>

                          {/* Company */}
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-zinc-100">{job.company}</div>
                            <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 font-medium">
                              {job.tier}
                            </span>
                          </td>

                          {/* Title */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-zinc-200">
                              {job.title}
                            </div>
                            <span className="text-[10px] text-zinc-400 font-medium">
                              {job.roleCategory}
                            </span>
                          </td>

                          {/* Location */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1 text-xs text-zinc-300">
                              <MapPin className="w-3 h-3 text-zinc-500" />
                              {job.location}
                            </div>
                            {isInternational ? (
                              <span className="text-[10px] text-cyan-400 font-bold flex items-center gap-1 mt-0.5">
                                <Globe className="w-2.5 h-2.5" /> Worldwide / US Remote
                              </span>
                            ) : job.isRemote ? (
                              <span className="text-[10px] text-purple-400 font-semibold mt-0.5 block">Remote Available</span>
                            ) : null}
                          </td>

                          {/* Salary / Stipend */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="text-xs font-black text-yellow-400">
                              {isInternational ? (job.stipendMonthly || '$1,500 - $4,500 / mo') : job.expectedCtc}
                            </div>
                            {isInternational ? (
                              <div className="text-[10px] text-cyan-300 font-semibold mt-0.5">
                                USD Stipend (~₹1.25L - ₹3.75L / mo)
                              </div>
                            ) : is6M || isStandardIntern ? (
                              <div className="text-[10px] text-amber-300 font-semibold mt-0.5">
                                Stipend: {job.stipendMonthly || '₹50,000 - ₹1,00,000 / mo'}
                              </div>
                            ) : (
                              <div className="text-[10px] text-zinc-400 mt-0.5">Base: {job.expectedBase}</div>
                            )}
                          </td>

                          {/* Resume Match */}
                          <td className="py-3.5 px-4">
                            <span className="text-xs font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-blue-400" />
                              {job.fitScore}% Fit
                            </span>
                            <div className="text-[10px] text-zinc-400 mt-0.5">
                              {job.matchedResumeId ? job.matchedResumeId.replace('variant_', '').replace('_', ' ').toUpperCase() : 'SDE RESUME'}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-4">
                            <select
                              value={job.status}
                              onChange={e => handleStatusChange(job._id, e.target.value)}
                              className={`text-[11px] font-bold rounded-lg px-2 py-1 border outline-none bg-zinc-950 ${
                                job.status === 'applied' || job.status === 'auto_applied'
                                  ? 'text-emerald-400 border-emerald-800/60'
                                  : job.status === 'ready_to_apply'
                                  ? 'text-yellow-400 border-yellow-800/60'
                                  : 'text-zinc-400 border-zinc-700'
                              }`}
                            >
                              <option value="discovered">Discovered</option>
                              <option value="ready_to_apply">Ready to Apply</option>
                              <option value="applied">Applied</option>
                              <option value="auto_applied">Auto-Applied</option>
                              <option value="ignored">Ignored</option>
                            </select>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                            <a
                              href={job.applyUrl || job.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold px-2.5 py-1.5 rounded-lg transition"
                            >
                              Apply Link <ArrowUpRight className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DEDICATED TAB: INTERNATIONAL REMOTE INTERNSHIPS */}
      {activeTab === 'international_remote' && (
        <div className="space-y-5">
          {/* Global Header Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-950/60 via-blue-950/40 to-zinc-900 border border-cyan-500/30 p-6 shadow-xl">
            <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '10s' }} />
                    Global Talent Pool • Worldwide Remote
                  </span>
                  <span className="text-xs text-zinc-400 font-medium">Stripe • Canonical • GitLab • Supabase • Ashby</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-zinc-100 tracking-tight flex items-center gap-2">
                  🌍 International Remote Internships
                </h2>
                <p className="text-zinc-300 text-sm mt-1 max-w-2xl leading-relaxed">
                  Direct career portals of global tech companies hiring engineering interns remotely. Fully eligible for Indian college students &amp; freshers with high USD stipends ($1,500 – $4,500/month).
                </p>
              </div>

              {/* Quick Summary Pill Stats */}
              <div className="flex flex-wrap md:flex-col items-start md:items-end gap-2 shrink-0">
                <div className="bg-zinc-900/90 border border-cyan-500/30 px-3.5 py-2 rounded-xl text-right">
                  <div className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Active Openings</div>
                  <div className="text-xl font-black text-cyan-300">{jobStats.internationalInternships || jobs.length || 82} Remote Interns</div>
                </div>
                <div className="bg-zinc-900/90 border border-emerald-500/30 px-3.5 py-2 rounded-xl text-right">
                  <div className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Typical Stipend</div>
                  <div className="text-sm font-extrabold text-emerald-400">$1,500 - $4,500 / month</div>
                </div>
              </div>
            </div>

            {/* Quick Feature Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-4 border-t border-cyan-500/20">
              <div className="flex items-center gap-2.5 text-xs text-zinc-300 bg-zinc-900/50 p-2.5 rounded-xl border border-zinc-800">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0"></span>
                <span><strong>No Visa / Relocation:</strong> 100% Remote, work from India</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-zinc-300 bg-zinc-900/50 p-2.5 rounded-xl border border-zinc-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                <span><strong>High Conversion:</strong> PPO offers to USD remote full-time SDE</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-zinc-300 bg-zinc-900/50 p-2.5 rounded-xl border border-zinc-800">
                <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0"></span>
                <span><strong>Best Resume Match:</strong> Coffeee.io + LeetCode Guardian ready</span>
              </div>
            </div>
          </div>

          {/* Filters Bar for International Tab */}
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="flex flex-1 min-w-[240px] items-center bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus-within:border-cyan-500">
              <Search className="w-4 h-4 text-zinc-500 mr-2" />
              <input
                type="text"
                placeholder="Search international internships (e.g. Stripe, Data Analyst, Software Engineer)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchJobs()}
                className="w-full bg-transparent outline-none text-zinc-100 placeholder:text-zinc-600 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-cyan-500"
              >
                <option value="all">All Roles</option>
                <option value="SDE / Backend">SDE / Backend</option>
                <option value="Frontend / UI">Frontend / UI</option>
                <option value="Machine Learning &amp; AI">Machine Learning &amp; AI</option>
                <option value="Quant &amp; C++ Systems">Quant &amp; C++ Systems</option>
                <option value="Internship / Fresher">Internships / Freshers</option>
                <option value="Security &amp; DevOps">Security &amp; DevOps</option>
              </select>

              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-cyan-500"
              >
                <option value="all">All Statuses</option>
                <option value="discovered">Discovered</option>
                <option value="ready_to_apply">Ready to Apply</option>
                <option value="applied">Applied</option>
                <option value="auto_applied">Auto-Applied</option>
              </select>

              <button
                onClick={handleExportJobs}
                className="bg-zinc-800 hover:bg-zinc-750 text-cyan-300 border border-cyan-500/30 font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" /> Export Sheet
              </button>
            </div>
          </div>

          {/* International Jobs Table */}
          {loading ? (
            <div className="text-center py-16 text-zinc-500">Loading international remote internships...</div>
          ) : jobs.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center space-y-3">
              <Globe className="w-12 h-12 text-zinc-600 mx-auto" />
              <h3 className="text-lg font-bold text-zinc-200">No International Remote Internships Found</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Click "Scan Portals Now" to trigger the automated crawler across global portals like Stripe, Canonical, GitLab, etc.
              </p>
              <button
                onClick={handleTriggerScan}
                className="bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs"
              >
                Scan Global Portals
              </button>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-950/80 text-zinc-400 text-[11px] font-bold uppercase tracking-wider border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Company &amp; Tier</th>
                      <th className="py-3 px-4">Internship Role</th>
                      <th className="py-3 px-4">Location / Remote</th>
                      <th className="py-3 px-4">Monthly Stipend</th>
                      <th className="py-3 px-4">Resume Fit</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Apply Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {jobs.map((job) => (
                      <tr key={job._id} className="hover:bg-cyan-500/[0.03] transition bg-zinc-900/40">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 border border-cyan-400/60 text-cyan-300 inline-flex items-center gap-1">
                            <Globe className="w-3 h-3 text-cyan-400" />
                            🌍 GLOBAL REMOTE
                          </span>
                          <div className="text-[10px] font-semibold text-emerald-400 mt-1">
                            ✓ Fresher &amp; Student
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-zinc-100 flex items-center gap-1.5">
                            {job.company}
                          </div>
                          <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 font-medium">
                            {job.tier}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-zinc-100">{job.title}</div>
                          <span className="text-[10px] text-zinc-400 font-medium">{job.roleCategory}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1 text-xs text-zinc-300">
                            <MapPin className="w-3 h-3 text-zinc-500" />
                            {job.location}
                          </div>
                          <span className="text-[10px] text-cyan-400 font-bold flex items-center gap-1 mt-0.5">
                            <Globe className="w-2.5 h-2.5" /> Worldwide / US Remote
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="text-xs font-black text-yellow-400">
                            {job.stipendMonthly || '$1,500 - $4,500 / mo'}
                          </div>
                          <div className="text-[10px] text-cyan-300 font-semibold mt-0.5">
                            USD Stipend (~₹1.25L - ₹3.75L / mo)
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="text-xs font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-blue-400" />
                            {job.fitScore}% Fit
                          </span>
                          <div className="text-[10px] text-zinc-400 mt-0.5">
                            {job.matchedResumeId ? job.matchedResumeId.replace('variant_', '').replace('_', ' ').toUpperCase() : 'SDE RESUME'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <select
                            value={job.status}
                            onChange={e => handleStatusChange(job._id, e.target.value)}
                            className={`text-[11px] font-bold rounded-lg px-2 py-1 border outline-none bg-zinc-950 ${
                              job.status === 'applied' || job.status === 'auto_applied'
                                ? 'text-emerald-400 border-emerald-800/60'
                                : job.status === 'ready_to_apply'
                                ? 'text-yellow-400 border-yellow-800/60'
                                : 'text-zinc-400 border-zinc-700'
                            }`}
                          >
                            <option value="discovered">Discovered</option>
                            <option value="ready_to_apply">Ready to Apply</option>
                            <option value="applied">Applied</option>
                            <option value="auto_applied">Auto-Applied</option>
                            <option value="ignored">Ignored</option>
                          </select>
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <a
                            href={job.applyUrl || job.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs bg-cyan-400 hover:bg-cyan-300 text-zinc-950 font-extrabold px-3 py-1.5 rounded-lg transition shadow-sm"
                          >
                            Apply Link <ArrowUpRight className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: COMPANY MASTER DIRECTORY */}
      {activeTab === 'companies' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <div>
              <h3 className="font-bold text-zinc-100 text-base">Tracked India & Remote Companies</h3>
              <p className="text-xs text-zinc-400">Total {companies.length} companies continually monitored for job postings.</p>
            </div>
            <button
              onClick={() => setShowAddCompanyModal(true)}
              className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold px-3.5 py-2 rounded-lg text-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> Add Company to Crawl List
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.map(c => (
              <div key={c._id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm hover:border-zinc-700 transition flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-extrabold text-zinc-100 text-base">{c.name}</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-800 text-yellow-400 border border-zinc-700">
                      {c.tier}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mb-3">{c.description || 'Technology enterprise.'}</p>
                  
                  <div className="text-[11px] text-zinc-400 space-y-1 mb-4">
                    <div>Locations: <strong className="text-zinc-200">{c.locations?.join(', ') || 'India / Remote'}</strong></div>
                    <div>ATS: <strong className="text-zinc-200 uppercase">{c.atsType}</strong> {c.atsToken ? `(${c.atsToken})` : ''}</div>
                    <div>Active Openings: <strong className="text-emerald-400 font-bold">{c.activeJobsCount || 0}</strong></div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
                  <span className="text-[10px] text-zinc-500">
                    Last crawl: {c.lastScannedAt ? new Date(c.lastScannedAt).toLocaleDateString('en-IN') : 'Pending'}
                  </span>
                  <a
                    href={c.careersUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-yellow-400 hover:underline flex items-center gap-1 font-semibold"
                  >
                    Careers Portal <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: INDIAN RECRUITER & HR DATABASE */}
      {activeTab === 'recruiters' && (
        <div className="space-y-4">
          {/* Top Header Card */}
          <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-blue-400" />
                <h3 className="font-extrabold text-zinc-100 text-lg">Indian Tech Recruiters & HR Sheet</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-800 text-amber-400 border border-zinc-700">
                  🔒 Protected Directory
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Direct verified Talent Acquisition partners & Tech Recruiters across Google, Amazon, Uber, Swiggy, Zomato, Razorpay, CRED, and Graviton.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {accessStatus.isOwner && (
                <button
                  onClick={() => setShowAdminDrawer(!showAdminDrawer)}
                  className="bg-purple-950 hover:bg-purple-900 text-purple-300 border border-purple-800 font-extrabold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  🛡️ Access Requests ({adminRequests.filter(r => r.status === 'pending').length})
                </button>
              )}

              {accessStatus.hasAccess && (
                <>

                  <button
                    onClick={handleImportRecruiters}
                    disabled={importingRecruiters}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition flex items-center gap-2 shadow-lg disabled:opacity-50 cursor-pointer"
                  >
                    <Users className="w-4 h-4" />
                    {importingRecruiters ? 'Importing...' : 'Add All to ColdMail Queue'}
                  </button>

                  <button
                    onClick={handleExportRecruiters}
                    className="bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 font-bold px-4 py-2.5 rounded-xl text-xs transition flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <Download className="w-4 h-4 text-blue-400" /> Download HR Sheet (.xlsx)
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Admin Review Drawer (for Khushal Midha) */}
          {accessStatus.isOwner && showAdminDrawer && (
            <div className="bg-zinc-950 border border-purple-800/80 rounded-xl p-5 shadow-2xl space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h4 className="font-extrabold text-sm text-purple-300 flex items-center gap-2">
                  <span>🛡️</span> Khushal's Security Console: Pending Access Requests
                </h4>
                <button onClick={() => setShowAdminDrawer(false)} className="text-zinc-500 hover:text-zinc-300 text-xs font-bold">Close ✕</button>
              </div>

              {adminRequests.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3 text-center">No access requests submitted yet.</div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {adminRequests.map((req) => (
                    <div key={req._id} className="bg-zinc-900 border border-zinc-800 p-3 rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-bold text-zinc-200">{req.requesterName} (<span className="text-yellow-400">{req.requesterEmail}</span>)</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">Reason: "{req.requesterReason || 'Looking for recruiters'}" • {new Date(req.createdAt).toLocaleDateString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {req.status === 'approved' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">Approved ✓</span>
                        ) : req.status === 'rejected' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-800">Rejected ✕</span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleReviewRequest(req._id, 'approve')}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReviewRequest(req._id, 'reject')}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-xs transition"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Access Protection Barrier for non-approved users */}
          {!accessStatus.hasAccess && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-2xl mx-auto text-center shadow-2xl space-y-4 my-6">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto text-2xl font-black">
                🔒
              </div>
              <h3 className="text-xl font-black text-zinc-100">Master Recruiter & Shared Contact Directory is Protected</h3>
              <p className="text-xs text-zinc-400 leading-relaxed max-w-md mx-auto">
                This database contains verified direct email IDs of Talent Acquisition partners. Access is private and strictly controlled by <strong>Khushal Midha</strong> (<span className="text-yellow-400">khushalmidha24@gmail.com</span>). You can request access below:
              </p>

              {accessStatus.status === 'pending' ? (
                <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-4 text-left space-y-2 max-w-lg mx-auto">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <span>⏳</span> Access Request Sent & Pending Approval!
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    An approval notification email with a 1-click verification link has been sent to <strong>khushalmidha24@gmail.com</strong>. Once Khushal clicks approve, your access will be activated immediately!
                  </p>
                </div>
              ) : (
                <form onSubmit={handleRequestAccess} className="space-y-3 text-left max-w-lg mx-auto pt-2">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">Reason for Requesting Access</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. SDE 1 job applications / tech outreach" 
                      value={accessReason} 
                      onChange={(e) => setAccessReason(e.target.value)} 
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-200 outline-none focus:border-yellow-500" 
                    />
                  </div>
                  <button 
                    type="submit" 
                    disabled={requestingAccess} 
                    className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 text-zinc-950 font-black py-3 rounded-xl text-xs hover:brightness-110 transition shadow-lg disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {requestingAccess ? 'Sending Request Email...' : '📩 Request Access from Khushal Midha'}
                  </button>
                </form>
              )}

              {accessMessage && (
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-yellow-400 font-semibold max-w-lg mx-auto">
                  {accessMessage}
                </div>
              )}
            </div>
          )}

          {recruiterMessage && (
            <div className="p-3 bg-blue-950/40 border border-blue-800/50 rounded-xl text-blue-300 text-xs font-semibold">
              {recruiterMessage}
            </div>
          )}

          {accessStatus.hasAccess && (

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/80 text-zinc-400 text-[11px] font-bold uppercase tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Company</th>
                    <th className="py-3 px-4">Recruiter / HR Name</th>
                    <th className="py-3 px-4">Verified Email</th>
                    <th className="py-3 px-4">Designation</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4 text-right">LinkedIn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {recruiters.map((r, idx) => (
                    <tr key={idx} className="hover:bg-zinc-850/50 transition">
                      <td className="py-3.5 px-4 font-bold text-zinc-100">{r.company}</td>
                      <td className="py-3.5 px-4 font-medium text-zinc-200">{r.hrName}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-yellow-400">{r.email}</td>
                      <td className="py-3.5 px-4 text-xs text-zinc-300">{r.role}</td>
                      <td className="py-3.5 px-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          r.source === 'hunter.io'
                            ? 'bg-amber-950/40 border-amber-800 text-amber-400'
                            : r.source === 'apollo.io'
                            ? 'bg-purple-950/40 border-purple-800 text-purple-400'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                        }`}>
                          {r.source || 'Curated'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-zinc-400">{r.location || 'India'}</td>
                      <td className="py-3.5 px-4 text-right">
                        {r.linkedinUrl ? (
                          <a
                            href={r.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                          >
                            Profile <ArrowUpRight className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      )}

      {/* TAB 4: AUTOMATED 3-SLOT SCHEDULER & TIMERS */}
      {activeTab === 'scheduler' && (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-yellow-400" /> Automated 3-Time Daily Job Watcher
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Runs background web scans across career portals automatically in the Morning, Afternoon, and Night so you are always the first applicant.
                </p>
              </div>
              <span className="text-xs font-bold px-3 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Active Daemon
              </span>
            </div>

            {/* 3 Scheduled Slot Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="text-xs font-bold uppercase text-yellow-400 mb-1">Slot 1: Morning Run</div>
                <div className="text-2xl font-black text-zinc-100">09:00 AM IST</div>
                <div className="text-[11px] text-zinc-400 mt-2">
                  Catches all overnight global remote postings and fresh morning openings.
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="text-xs font-bold uppercase text-yellow-400 mb-1">Slot 2: Afternoon Run</div>
                <div className="text-2xl font-black text-zinc-100">02:00 PM IST</div>
                <div className="text-[11px] text-zinc-400 mt-2">
                  Catches post-lunch recruiter releases across Indian tech hubs.
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="text-xs font-bold uppercase text-yellow-400 mb-1">Slot 3: Night Run</div>
                <div className="text-2xl font-black text-zinc-100">08:30 PM IST</div>
                <div className="text-[11px] text-zinc-400 mt-2">
                  Catches US/Europe remote jobs opening at the start of their business day.
                </div>
              </div>
            </div>

            {/* Scan History Log */}
            <div className="mt-6 border-t border-zinc-800 pt-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Recent Automated Scan History</h4>
              {schedulerConfig?.scanHistory && schedulerConfig.scanHistory.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {schedulerConfig.scanHistory.slice().reverse().map((run, idx) => (
                    <div key={idx} className="bg-zinc-950 border border-zinc-800/80 p-2.5 rounded-lg flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-semibold text-zinc-200">{run.slot}</span>
                        <span className="text-zinc-500">|</span>
                        <span className="text-zinc-400">{new Date(run.runAt).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="text-zinc-300">
                        Found <strong className="text-yellow-400">{run.jobsFound}</strong> jobs ({run.newJobsAdded} new)
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-zinc-500 text-center py-4">
                  No automated runs recorded yet. Schedulers trigger at 9:00 AM, 2:00 PM, and 8:30 PM IST.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Company Modal */}
      {showAddCompanyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-100 mb-4">Add Company to Crawl Directory</h3>
            <form onSubmit={handleAddCompany} className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Company Name</label>
                <input
                  type="text"
                  required
                  value={newCompany.name}
                  onChange={e => setNewCompany({ ...newCompany, name: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-sm text-zinc-200"
                  placeholder="e.g. Acme Corp"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Careers URL</label>
                <input
                  type="url"
                  required
                  value={newCompany.careersUrl}
                  onChange={e => setNewCompany({ ...newCompany, careersUrl: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-sm text-zinc-200"
                  placeholder="https://..."
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">ATS Type</label>
                  <select
                    value={newCompany.atsType}
                    onChange={e => setNewCompany({ ...newCompany, atsType: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-sm text-zinc-200"
                  >
                    <option value="greenhouse">Greenhouse</option>
                    <option value="lever">Lever</option>
                    <option value="ashby">Ashby</option>
                    <option value="custom">Custom / Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">ATS Token / Slug</label>
                  <input
                    type="text"
                    value={newCompany.atsToken}
                    onChange={e => setNewCompany({ ...newCompany, atsToken: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-sm text-zinc-200"
                    placeholder="e.g. acme"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddCompanyModal(false)}
                  className="flex-1 bg-zinc-800 text-zinc-300 font-bold py-2 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold py-2 rounded-lg text-xs"
                >
                  Save & Crawl
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default JobHunter;

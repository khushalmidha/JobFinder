import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Mail, Clock, CheckCircle, AlertCircle, RefreshCw, AlertTriangle, RotateCcw, ArrowRightLeft, Play, Pause, X, ShieldCheck, ChevronDown } from 'lucide-react';

const Logs = () => {
  const [logs, setLogs] = useState([]);
  const [queueStatus, setQueueStatus] = useState({ pending: 0, size: 0, isPaused: false, limitFailedCount: 0 });
  const [loading, setLoading] = useState(true);

  // Daily limit recovery & switch account state
  const [smtpAccounts, setSmtpAccounts] = useState([]);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [selectedSwitchSmtpId, setSelectedSwitchSmtpId] = useState('');
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [restoringLimit, setRestoringLimit] = useState(false);
  const [actionToast, setActionToast] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [logsRes, queueRes] = await Promise.all([
        api.get('/mail/logs'),
        api.get('/mail/queue-status')
      ]);
      setLogs(logsRes.data);
      setQueueStatus(queueRes.data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/auth/settings');
      if (data && data.smtpConfigs) {
        setSmtpAccounts(data.smtpConfigs);
        if (data.selectedSmtpId) {
          setSelectedSwitchSmtpId(data.selectedSmtpId);
        } else if (data.smtpConfigs.length > 0) {
          setSelectedSwitchSmtpId(data.smtpConfigs[0]._id);
        }
      }
    } catch (err) {
      console.error('Failed to load settings in Logs:', err);
    }
  };

  const toggleQueue = async () => {
    try {
      const endpoint = queueStatus.isPaused ? '/mail/resume-queue' : '/mail/pause-queue';
      const { data } = await api.post(endpoint);
      setQueueStatus(prev => ({ ...prev, isPaused: data.isPaused }));
      fetchData();
    } catch (err) {
      console.error('Failed to toggle queue');
    }
  };

  const handleRestoreLimitFailed = async () => {
    try {
      setRestoringLimit(true);
      const { data } = await api.post('/mail/restore-limit-failed');
      setActionToast(`✅ ${data.message}`);
      setTimeout(() => setActionToast(''), 4500);
      fetchData();
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
      setActionToast(`🚀 ${data.message}`);
      setTimeout(() => setActionToast(''), 4500);
      setShowSwitchModal(false);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to switch sender account');
    } finally {
      setSwitchingAccount(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSettings();
    // Auto refresh every 4 seconds
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto font-sans">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Email Logs & Queue</h1>
          <p className="text-zinc-400 text-sm mt-1">Track the status of your batch emails and queue performance.</p>
        </div>
        <div className="flex items-center space-x-3">
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
            onClick={fetchData}
            className="flex items-center text-sm font-medium text-zinc-400 hover:text-zinc-200 transition bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {actionToast && (
        <div className="mb-6 p-3.5 rounded-xl bg-blue-950/80 border border-blue-500/40 text-blue-200 text-xs font-bold flex items-center justify-between shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
            <span>{actionToast}</span>
          </div>
          <button onClick={() => setActionToast('')} className="text-zinc-400 hover:text-zinc-200 text-sm font-black ml-2 cursor-pointer">×</button>
        </div>
      )}

      {/* SMTP Auth Error (535) Banner */}
      {queueStatus.pauseReason === 'SMTP_AUTH_ERROR' && (
        <div className="mb-8 p-4 rounded-xl bg-gradient-to-r from-red-500/20 via-orange-500/15 to-amber-500/15 border border-red-500/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
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
        <div className="mb-8 p-4 rounded-xl bg-gradient-to-r from-orange-500/20 via-amber-500/15 to-yellow-500/15 border border-orange-500/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
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
        <div className="mb-8 p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-yellow-500/15 border border-amber-500/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
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
                You reached your daily limit of <strong>{queueStatus.dailyLimit || 450} emails</strong> for <code>{queueStatus.limitAccount || 'your email account'}</code>. 
                Sending was paused so your Gmail account keeps 50 emails reserved for your <strong>important personal &amp; job emails</strong>!
                Remaining emails stay safely as <strong>Pending</strong> in the queue.
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
        <div className="mb-8 p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-red-500/15 border border-amber-500/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl backdrop-blur-md animate-in fade-in duration-300">
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
                The email that triggered this was kept in queue as <strong>Pending</strong> and sending was paused so remaining emails won't fail.
                {Boolean(queueStatus.limitFailedCount > 0) && (
                  <span className="block mt-1 text-amber-200/90 font-medium">
                    📍 <strong>{queueStatus.limitFailedCount} contacts</strong> previously failed from this daily limit. You can restore them back to <strong>Pending</strong> in 1 click!
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex items-center">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mr-4">
            <Clock className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-400">Emails in Queue</p>
            <h2 className="text-3xl font-bold text-zinc-100 mt-1">{queueStatus.pending + queueStatus.size}</h2>
            <p className="text-xs text-zinc-500 mt-1">Sending 1 email every 3 seconds to avoid spam filters.</p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex items-center">
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mr-4">
            <Mail className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-400">Total Sent / Logged</p>
            <h2 className="text-3xl font-bold text-zinc-100 mt-1">{logs.length}</h2>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-900/50 border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                <th className="p-4 font-semibold">Recipient</th>
                <th className="p-4 font-semibold">Company</th>
                <th className="p-4 font-semibold">Time</th>
                <th className="p-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-8 text-center text-zinc-500">
                    No emails have been sent yet.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id} className="hover:bg-zinc-800/50 transition">
                    <td className="p-4">
                      <div className="text-sm font-medium text-zinc-200">{log.contactId?.hrName || 'Unknown'}</div>
                      <div className="text-xs text-zinc-500">{log.contactId?.email}</div>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-zinc-300">{log.contactId?.company || 'N/A'}</span>
                    </td>
                    <td className="p-4 text-sm text-zinc-400">
                      {new Date(log.sentAt).toLocaleString()}
                    </td>
                    <td className="p-4">
                      {log.status === 'sent' || log.status === 'delivered' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Sent
                        </span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center w-fit px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Failed
                          </span>
                          {log.bounceReason && (
                            <span className="text-xs text-red-400 mt-1 max-w-xs truncate" title={log.bounceReason}>
                              {log.bounceReason}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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

export default Logs;

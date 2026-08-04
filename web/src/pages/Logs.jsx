import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Mail, Clock, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

const Logs = () => {
  const [logs, setLogs] = useState([]);
  const [queueStatus, setQueueStatus] = useState({ pending: 0, size: 0, isPaused: false });
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchData();
    // Auto refresh every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto font-sans">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Email Logs & Queue</h1>
          <p className="text-zinc-400 text-sm mt-1">Track the status of your batch emails.</p>
        </div>
        <button 
          onClick={fetchData}
          className="flex items-center text-sm font-medium text-zinc-400 hover:text-zinc-200 transition"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

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
    </div>
  );
};

export default Logs;

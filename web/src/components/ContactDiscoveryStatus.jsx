import { useEffect, useState } from 'react';
import api from '../services/api';

const labels = {
  enabled: 'Background discovery enabled', disabled: 'Background discovery off',
  paused: 'Background discovery paused', budget_exhausted: 'Daily research request budget used'
};
const time = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });

export default function ContactDiscoveryStatus() {
  const [status, setStatus] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const { data } = await api.get('/professional-discovery/background-status');
        if (!cancelled) { setStatus(data); setUnavailable(false); }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    };
    void read();
    const timer = window.setInterval(read, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  if (unavailable) return <p className="text-sm text-zinc-400">Discovery status unavailable.</p>;
  if (!status) return null;
  return <details className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-300">
    <summary className="cursor-pointer font-semibold">{labels[status.state]} · {status.newContacts} added today</summary>
    <p className="mt-2">Today (IST) · {status.checkedDomains} employer domains checked · {status.newPublishedLeads} new sourced leads</p>
    <p>{status.requestsUsed}/{status.requestLimit} research requests used. {status.autoImport ? 'Eligible contacts go into Unverified.' : 'Eligible leads stay in research until imported.'}</p>
    <p>{status.lastAttemptAt ? `Last attempt ${time.format(new Date(status.lastAttemptAt))} IST${status.lastAttemptFailed ? ' · source unavailable or scan incomplete' : ''}` : 'No background attempt recorded yet.'}</p>
  </details>;
}

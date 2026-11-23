import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import api from '../services/api';
import SavedJobPostings from './SavedJobPostings';

const panel = 'rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:p-5';
const button = 'rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:border-yellow-500 disabled:opacity-40';
const tabs = [ ['jobs', 'Career jobs'], ['notifications', 'Notifications'] ];
const jobFilters = {
  roleFamily: ['Role', { software:'Software', ai_ml:'Applied AI / ML', quant:'Quant', product:'Product' }],
  graduationFit: ['July 2027 graduation', { fits:'Fits stated batch', outside:'Outside stated batch' }],
  employmentType: ['Employment type', { internship:'Internship', full_time:'Full-time', other:'Other' }],
  locationRegion: ['Location', { India:'India', overseas:'Overseas' }],
  remoteEligibility: ['Remote eligibility', { india:'Remote from India' }],
  sponsorship: ['Sponsorship', { explicit:'Explicit', case_by_case:'Case by case', unavailable:'Unavailable' }],
};
const errorText = error => error?.response?.data?.error || error?.message || 'Request failed. Try again.';
const rowsOf = (data, key) => Array.isArray(data?.[key]) ? data[key] : [];
const display = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const regionLabel = value => String(value || '').toLowerCase() === 'india' ? 'India' : String(value || '').toLowerCase() === 'overseas' ? 'Overseas' : 'Unconfirmed';
const companyName = value => display(value) || display(value?.name) || 'Company not recorded';
function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function timestamp(value) {
  const date = new Date(value);
  return value && Number.isFinite(+date) ? date.toLocaleString() : 'Not recorded';
}
function Link({ url, children }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noreferrer" className="text-yellow-400 underline break-all">{children}</a> : <span className="text-zinc-500">Source URL unavailable</span>;
}
function eligibility(job) {
  if (job.eligibility === 'excluded') return 'Outside current preferences';
  if (job.eligible === true || job.isEligible === true || ['eligible', 'qualified', 'match'].includes(job.eligibilityStatus || job.classification || job.status)) return 'Matches recorded eligibility';
  return 'Eligibility needs review';
}

export default function JobsBoard() {
  const id = useId();
  const [tab, setTab] = useState('jobs');
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [filters, setFilters] = useState({});
  const [jobPage, setJobPage] = useState(1);
  const [jobMeta, setJobMeta] = useState({ total: 0, limit: 50 });
  const [notifications, setNotifications] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scanReport, setScanReport] = useState(null);

  const refresh = useCallback(async (requestedPage) => {
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : jobPage;
    setLoading(true);
    const query = new URLSearchParams({ ...filters, page });
    const requests = [ ['status', '/career-watch/status'], ['jobs', `/career-watch/jobs?${query}`], ['notifications', '/career-watch/notifications'] ];
    const results = await Promise.allSettled(requests.map(([, path]) => api.get(path)));
    const nextErrors = {};
    results.forEach((result, index) => {
      const key = requests[index][0];
      if (result.status === 'rejected') { nextErrors[key] = errorText(result.reason); return; }
      const data = result.value.data;
      if (key === 'status') setStatus(data);
      if (key === 'jobs') { setJobs(rowsOf(data, 'jobs')); setJobMeta({ total: Number.isInteger(data.total) ? data.total : rowsOf(data, 'jobs').length, limit: Number.isInteger(data.limit) && data.limit > 0 ? data.limit : 50 }); }
      if (key === 'notifications') setNotifications(rowsOf(data, 'notifications'));

    });
    setErrors(previous => ({ ...previous, status: null, jobs: null, notifications: null, discovery: null, ...nextErrors }));
    setLoading(false);
  }, [filters, jobPage]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.get('/career-watch/notifications').then(({ data }) => setNotifications(rowsOf(data, 'notifications'))).catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  async function run(action) {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); }
  }
  async function toggleMonitoring() {
    const enabled = !status?.config?.enabled;
    const { data } = await api.put('/career-watch/config', { enabled });
    setStatus(previous => ({ ...previous, config: data.config || data }));
    setMessage(enabled ? 'Five-hour monitoring configuration enabled. Check worker status below for backend availability.' : 'Monitoring disabled. Saved jobs and notifications are preserved.');
    await refresh();
  }
  async function toggleIndiaFocus() {
    const indiaFocus = status?.config?.indiaFocus === false;
    const { data } = await api.put('/career-watch/config', { enabled: !!status?.config?.enabled, indiaFocus });
    setStatus(previous => ({ ...previous, config: data.config || data }));
    setJobPage(1);
    setMessage(indiaFocus ? 'India focus enabled. Overseas jobs are excluded; unknown locations stay labelled for review.' : 'India focus disabled. Overseas results are available with their recorded location labels.');
    await refresh(1);
  }
  async function enqueue() {
    const { data } = await api.post('/career-watch/enqueue', {});
    setMessage(data.message || `Company queue updated${Number.isInteger(data.enqueued) ? `: ${data.enqueued} companies enqueued` : ''}. Existing records are preserved.`);
    await refresh();
  }
  async function inspectJobs() {
    const { data } = await api.post('/career-watch/run', { dryRun: true });
    setScanReport({ type: 'Career scan dry run', result: data });
    setMessage('Career dry run completed. No application was submitted. Results are shown below.');
    await refresh();
  }
  async function markRead(notification) {
    await api.post(`/career-watch/notifications/${encodeURIComponent(notification._id)}/read`, {});
    setNotifications(previous => previous.map(row => row._id === notification._id ? { ...row, readAt: new Date().toISOString(), read: true } : row));
  }
  const unread = notifications.filter(row => !row.readAt && !row.read).length;
  const config = status?.config;
  const workerEnabled = status?.workerEnabled ?? status?.schedulerEnabled;
  return <section aria-labelledby={`${id}-title`} className="space-y-4 text-zinc-100">
    <header className={panel}>
      <h2 id={`${id}-title`} className="text-xl font-bold text-yellow-400">Job postings</h2>
      <p className="mt-2 text-sm text-zinc-400">Monitor your supplied company list every five hours for FTE roles requiring less than one year of experience, or explicit six-month internships with FTE conversion. Missing experience or conversion evidence requires review.</p>
      <p className="mt-2 text-xs text-zinc-500">Salary evidence is shown separately; an opening does not verify a fixed-base offer.</p>
      <details className="mt-4"><summary className="cursor-pointer text-sm text-zinc-400">Monitoring settings</summary><div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!config?.enabled} disabled={busy || !status || !!errors.status} onChange={() => run(toggleMonitoring)} /> Enable five-hour company monitoring</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config?.indiaFocus !== false} disabled={busy || loading || !status || !!errors.status} onChange={() => run(toggleIndiaFocus)} /> Focus on India jobs</label>
        <button type="button" className={button} disabled={busy || loading} onClick={() => run(enqueue)}>Queue supplied companies</button>
        <button type="button" className={button} disabled={busy} onClick={() => run(inspectJobs)}>Run career dry scan</button>
        <button type="button" className={button} disabled={busy || loading} onClick={refresh}>Refresh monitoring</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-400">
        <span>Schedule: rolling five-hour interval</span>
        <span>Configuration: {status ? config?.enabled ? 'Enabled' : 'Disabled' : 'Unavailable'}</span>
        <span>Backend worker: {workerEnabled === true ? 'Enabled' : workerEnabled === false ? 'Disabled' : 'Not reported'}</span>
        <span>Next scan: {timestamp(status?.nextScanAt || config?.nextScanAt)}</span>
        <span>Unread notifications: {unread}</span>
        <span>Company tasks: {status?.tasks?.total ?? 0}</span>
        <span>Official portal mapping needed: {status?.tasks?.needsPortalMapping ?? 0}</span>
        <span>Failed scans: {status?.tasks?.failed ?? 0}</span>
        <span>Daily career HTTP budget: {config?.requestsUsed ?? 0}/{config?.dailyRequestLimit ?? 20000}</span>
      </div>
      </details>
    </header>

    {Object.entries(errors).filter(([key, value]) => value && key !== 'leads').map(([key, value]) => <p key={key} role="alert" className="rounded border border-red-900 p-3 text-sm text-red-300">{key}: {value}. Saved results remain visible.</p>)}
    {message && <p role="status" className="rounded border border-yellow-800 p-3 text-sm text-yellow-200">{message}</p>}
    <div role="tablist" aria-label="Company watch sections" className="flex flex-wrap gap-2">
      {tabs.map(([key, label]) => <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-controls={`${id}-content`} aria-selected={tab === key} onClick={() => setTab(key)} className={`${button} ${tab === key ? 'border-yellow-500 bg-yellow-500/10 text-yellow-300' : ''}`}>{label}{key === 'notifications' && unread ? ` (${unread})` : ''}</button>)}
    </div>

    <div role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} className={panel}>
      {tab === 'jobs' && <>
        <h3 className="font-semibold">Career portal results</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(jobFilters).map(([key, [label, options]]) => <label key={key} className="grid gap-1 text-sm">
            {label}<select className="min-w-0 rounded border border-zinc-700 bg-zinc-900 p-2" value={filters[key] || ''} onChange={event => {
              const next = { ...filters };
              if (event.target.value) next[key] = event.target.value; else delete next[key];
              setFilters(next); setJobPage(1);
            }}><option value="">Any</option>{Object.entries(options).map(([value, title]) => <option key={value} value={value}>{title}</option>)}<option value="unknown">Unknown</option></select>
          </label>)}
        </div>
        {loading && <p className="mt-3 text-sm text-zinc-400">Loading saved jobsâ€¦</p>}
        {!loading && !jobs.length && !errors.jobs && <p className="mt-3 text-sm text-zinc-400">No saved matching roles yet. Queue companies and enable monitoring. Unsupported or inaccessible portals are not reported as successfully scanned.</p>}
        <div className="mt-3 space-y-3">{jobs.map((job, index) => <article key={job._id || job.url || index} className="break-words rounded border border-zinc-800 p-3">
          <h4 className="font-semibold">{display(job.title) || 'Untitled role'}</h4>
          <p className="mt-1 text-sm text-zinc-400">{companyName(job.company || job.companyName)}{job.location ? ` Â· ${display(job.location)}` : ''}</p>
          <p className="mt-2 text-xs text-zinc-400">Location classification: {regionLabel(job.locationRegion)} Â· Company coverage: {regionLabel(job.companyRegion)}</p>
          <p className="mt-2 text-xs text-yellow-300">{eligibility(job)}</p>
          <dl className="mt-2 grid gap-x-4 text-xs text-zinc-400 sm:grid-cols-2">
            {Object.entries(jobFilters).filter(([key]) => key !== 'locationRegion').map(([key,[label,options]]) => <div key={key}><dt className="inline">{label} </dt><dd className="inline">{options[job[key]] || 'Unknown'}</dd></div>)}
            <div><dt className="inline">Compensation </dt><dd className="inline">{job.salaryEvidence ? <Link url={job.salaryEvidence.sourceUrl}>{job.salaryEvidence.currency} {job.salaryEvidence.amount ?? [job.salaryEvidence.min,job.salaryEvidence.max].join('–')} / {job.salaryEvidence.period} posted base</Link> : 'Unknown'}</dd></div>
          </dl>
          {Object.entries(job.evidence || {}).map(([key, value]) => <p key={key} className="mt-1 break-words text-xs text-zinc-400">{key} · {value}</p>)}
          {job.reason && <p className="mt-1 text-xs text-zinc-400">{display(job.reason)}</p>}
          <p className="mt-2 text-xs text-zinc-500">Observed: {timestamp(job.discoveredAt || job.firstSeenAt || job.createdAt)}</p>
          <p className="mt-2 text-sm"><Link url={job.applyUrl || job.url}>Open application</Link>{job.url && job.applyUrl && job.url !== job.applyUrl && <> · <Link url={job.url}>Posting evidence</Link></>}</p>
          {job.company && <RouterLink to="/" state={{ employer:job.company, jobUrl:safeUrl(job.applyUrl || job.url), role:job.title }} className="mt-2 inline-block text-sm text-yellow-400 underline">Find contacts for this job</RouterLink>}
        </article>)}</div>
        {jobMeta.total > jobMeta.limit && <nav aria-label="Career job pagination" className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={button} disabled={busy || loading || jobPage <= 1} onClick={() => setJobPage(page => page - 1)}>Previous job page</button>
          <span className="text-sm text-zinc-400">Job page {jobPage} of {Math.max(1, Math.ceil(jobMeta.total / jobMeta.limit))} Â· {jobMeta.total} results</span>
          <button type="button" className={button} disabled={busy || loading || jobPage >= Math.ceil(jobMeta.total / jobMeta.limit)} onClick={() => setJobPage(page => page + 1)}>Next job page</button>
        </nav>}
      </>}
      {tab === 'jobs' && <SavedJobPostings />}
      {tab === 'notifications' && <>
        <h3 className="font-semibold">Website notifications</h3>
        {!notifications.length && !errors.notifications && <p className="mt-3 text-sm text-zinc-400">No notifications yet. New qualifying jobs generate a notification after a successful scan.</p>}
        <ul className="mt-3 space-y-3">{notifications.map((notification, index) => <li key={notification._id || index} className="flex flex-col gap-3 rounded border border-zinc-800 p-3 sm:flex-row sm:justify-between">
          <div><p className="font-semibold">{display(notification.title) || display(notification.message) || 'New career result'}</p>{notification.message && notification.title && <p className="mt-1 text-sm text-zinc-400">{display(notification.message)}</p>}<p className="mt-1 text-xs text-zinc-500">{timestamp(notification.createdAt)}</p>{(notification.url || notification.jobUrl) && <p className="mt-2 text-sm"><Link url={notification.url || notification.jobUrl}>View posting</Link></p>}</div>
          {!notification.readAt && !notification.read && notification._id && <button type="button" className={`${button} self-start shrink-0`} disabled={busy} onClick={() => run(() => markRead(notification))}>Mark notification read</button>}
        </li>)}</ul>
      </>}

    </div>

    {scanReport && <details open className={panel}><summary className="cursor-pointer font-semibold">{scanReport.type} â€” actual report</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-300">{JSON.stringify(scanReport.result, null, 2)}</pre></details>}
  </section>;
}

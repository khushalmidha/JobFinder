import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const control = 'rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-yellow-400 disabled:opacity-50';
const tabs = { matching: 'Matches', applied: 'Applied', notifications: 'Notifications' };
const roleLabels = { software:'Software engineering', ai_ml:'AI / ML', quant:'Quant development' };
const date = value => value ? new Date(value).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '';
function officialUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

export default function JobsBoard() {
  const [tab, setTab] = useState('matching');
  const [type,setType] = useState('');
  const [page,setPage] = useState(1);
  const [data,setData] = useState({jobs:[],total:0,limit:50});
  const [notices,setNotices] = useState([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [change,setChange] = useState(0);
  useEffect(()=>{
    let live=true;
    const refresh = async () => {
      try {
        const {data:result}=await api.get('/career-watch/jobs',{params:{view:tab==='applied'?'applied':'matching',page,...(tab==='matching'&&type?{employmentType:type}:{})}});
        if(live){setData(result);setError('');}
      } catch (err) { if(live)setError(err.response?.data?.error || 'Could not load jobs.'); }
      finally { if(live)setLoading(false); }
    };
    setLoading(true);
    setData({jobs:[],total:0,limit:50});
    refresh();
    const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
    return()=>{live=false;clearInterval(timer);};
  },[tab,type,page,change]);
  useEffect(()=>{
    let live=true;
    const refresh=()=>api.get('/career-watch/notifications?view=matching').then(({data:result})=>{
      if(live)setNotices(result.notifications||[]);
    }).catch(()=>{});
    refresh();
    const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
    return()=>{live=false;clearInterval(timer);};
  },[change]);
  async function classifyApplication(job,applied) {
    setBusy(true);setError('');
    try {
      await api.put('/career-watch/jobs/'+job._id+'/applied',{applied});
      setPage(1);setChange(value=>value+1);
    } catch (err) { setError(err.response?.data?.error || 'Could not update application status.'); }
    finally { setBusy(false); }
  }
  async function markRead(notice) {
    try {
      await api.post('/career-watch/notifications/'+notice._id+'/read',{});
      setNotices(previous=>previous.map(row=>row._id===notice._id?{...row,readAt:new Date()}:row));
    } catch { setError('Could not mark notification read.'); }
  }
  const unread=notices.filter(row=>!row.readAt).length;
  const pages=Math.max(1,Math.ceil(data.total/data.limit));
  return <section aria-labelledby="job-board-title" className="space-y-5 text-zinc-100">
    <header className="border-b border-zinc-800 pb-5">
      <h1 id="job-board-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Jobs for your 2027 batch</h1>
      <p className="mt-2 text-sm text-zinc-400">India · Entry-level software and AI roles · Six-month internships</p>
    </header>
    <div role="tablist" aria-label="Job sections" className="flex flex-wrap gap-2">
      {Object.entries(tabs).map(([key,label])=><button key={key} type="button" role="tab" id={'job-tab-'+key}
        aria-controls="job-view" aria-selected={tab===key} onClick={()=>{setTab(key);setPage(1);}}
        className={control+' '+(tab===key?'border-yellow-500 bg-yellow-500/10 text-yellow-300':'')}>
        {label}{key==='notifications'&&unread>0?' ('+unread+')':''}
      </button>)}
    </div>
    {error&&<p role="alert" className="rounded-lg border border-red-800 p-3 text-sm text-red-300">{error}</p>}
    <section id="job-view" role="tabpanel" aria-labelledby={'job-tab-'+tab} className="space-y-3">
      {tab==='notifications' ? <>
        {!notices.length&&<p className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-400">No new matching jobs yet.</p>}
        {notices.map(notice=><article key={notice._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 p-4">
          <div><h2 className="font-medium">{notice.title}</h2><p className="text-sm text-zinc-400">{notice.company} · {date(notice.createdAt)}</p></div>
          <div className="flex flex-wrap gap-2">{officialUrl(notice.url)&&<a className={control} href={officialUrl(notice.url)} target="_blank" rel="noreferrer">View posting</a>}{!notice.readAt&&<button className={control} onClick={()=>markRead(notice)}>Mark notification read</button>}</div>
        </article>)}
      </> : <>
        {tab==='matching'&&<label className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">Employment type
          <select className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-100" value={type} onChange={event=>{setType(event.target.value);setPage(1);}}>
            <option value="">All</option><option value="full_time">Full-time</option><option value="internship">Internship</option>
          </select>
        </label>}
        {loading&&<p role="status" className="p-4 text-sm text-zinc-400">Loading jobs…</p>}
        {!loading&&!data.jobs.length&&!error&&<p className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-400">
          {tab==='applied'?'Jobs you mark as applied appear here.':'No open roles with explicit 2027 eligibility match yet. New matches appear after a scan.'}
        </p>}
        {data.jobs.map(job=>{
          const href=officialUrl(job.applyUrl||job.url);
          const evidence=job.salaryEvidence;
          return <article key={job._id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold">{job.title}</h2>
                <p className="mt-1 text-sm text-zinc-400">{[job.company,job.location||'Remote from India',roleLabels[job.roleFamily]].filter(Boolean).join(' · ')}</p>
              </div>
              <span className="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">{job.appliedAt?'Applied '+date(job.appliedAt):'2027 eligible'}</span>
            </div>
            <div className="mt-3 space-y-1 text-sm text-zinc-400">
              {job.evidence?.graduation&&<p>Employer evidence <span className="text-zinc-200">{job.evidence.graduation}</span></p>}
              {job.employmentType==='internship'&&<p>Six-month internship</p>}
              {job.validThrough&&<p>Application deadline {date(job.validThrough)}</p>}
              {evidence&&officialUrl(evidence.sourceUrl)&&<p><a className="underline" href={officialUrl(evidence.sourceUrl)} target="_blank" rel="noreferrer">{evidence.currency} {evidence.amount??[evidence.min,evidence.max].join('–')} / {evidence.period} · Posted pay</a></p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {href&&<a className="rounded-lg bg-yellow-400 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-yellow-300" href={href} target="_blank" rel="noreferrer">Open application</a>}
              <button type="button" className={control} disabled={busy} onClick={()=>classifyApplication(job,!job.appliedAt)}>{job.appliedAt?'Undo applied':'Mark applied'}</button>
              {job.company&&<Link className={control} to="/" state={{employer:job.company,jobUrl:href,role:job.title}}>Company contacts</Link>}
            </div>
          </article>;
        })}
        {pages>1&&<nav aria-label="Job pagination" className="flex flex-wrap items-center gap-2">
          <button className={control} disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>Previous</button>
          <span className="text-sm text-zinc-400">{page} / {pages}</span>
          <button className={control} disabled={loading||page===pages} onClick={()=>setPage(value=>value+1)}>Next</button>
        </nav>}
      </>}
    </section>
  </section>;
}

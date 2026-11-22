import React, { lazy, useEffect, useRef } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
const Dashboard = lazy(()=>import('./Dashboard'));
const JobHunter = lazy(()=>import('./JobHunter'));
const Logs = lazy(()=>import('./Logs'));
const Companies = lazy(()=>import('./Companies'));
const Research = lazy(()=>import('./Research'));
const OutreachCRM = lazy(()=>import('./OutreachCRM'));
const ContactIntake = lazy(()=>import('./ContactIntake'));
const Campaigns = lazy(()=>import('./Campaigns'));
const Import = lazy(()=>import('./Import'));

const groups = {
  contacts: { title: 'Mails', back: 'Back to contacts', Primary: Dashboard, tools: [
    { id: 'crm', title: 'Follow-ups, replies & referrals', Component: OutreachCRM },
    { id: 'email-checks', title: 'Email verification', Component: ContactIntake },
    { id:'queue',title:'Queue & logs',Component:Logs },
    { id:'campaigns',title:'Campaign queues & schedules',Component:Campaigns },
    { id:'import',title:'Import contacts',Component:Import },
    { id:'research',title:'Recruiter research',Component:Research },
    { id:'companies',title:'Company research',Component:Companies }
  ] },
  hiring: { title: 'Jobs', back: 'Back to job search', Primary: JobHunter, tools: [] },

};

export function Workspace({ area }) {
  const [params, setParams] = useSearchParams();
  const { title, back, Primary, tools } = groups[area];
  const active = tools.find(tool => tool.id === params.get('section'));
  const content = useRef(null);
  useEffect(() => { if (active) content.current?.scrollIntoView({ block: 'start' }); }, [active]);
  function select(id) {
    const next = new URLSearchParams(params);
    if (id) next.set('section', id); else next.delete('section');
    setParams(next);
  }
  if(!tools.length)return <Primary />;
  return <main className="min-w-0">
    <section aria-label={`${title} tools`} className="mx-auto max-w-7xl px-4 pt-4 md:px-8 md:pt-8 space-y-2">
      {active && <div className="flex flex-wrap items-center justify-between gap-3 pb-2"><h1 className="text-2xl font-bold text-zinc-100">{title}</h1><button className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" onClick={() => select(null)}>{back}</button></div>}
      {tools.length > 0 && <label className="flex flex-wrap items-center gap-3 text-sm">Mail tools<select aria-label="Mail tools" value={active?.id || ''} onChange={event=>select(event.target.value)} className="max-w-full rounded border border-zinc-700 bg-zinc-900 p-2"><option value="">Contacts</option>{tools.map(tool=><option key={tool.id} value={tool.id}>{tool.title}</option>)}</select></label>}
    </section>
    {active ? <div ref={content} id={`workspace-${active.id}`}><active.Component embedded /></div> : <Primary />}
  </main>;
}

export function LegacyWorkspaceLink({ path, section }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('section', section);
  return <Navigate replace to={{ pathname: path, search: `?${params}`, hash: location.hash }} />;
}

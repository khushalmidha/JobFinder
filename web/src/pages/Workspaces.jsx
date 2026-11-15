import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import Dashboard from './Dashboard';
import JobHunter from './JobHunter';
import Logs from './Logs';
import Companies from './Companies';
import Research from './Research';
import OutreachCRM from './OutreachCRM';
import ContactIntake from './ContactIntake';
import Campaigns from './Campaigns';

const groups = {
  contacts: { title: 'Dashboard', back: 'Back to contacts', Primary: Dashboard, tools: [
    { id: 'crm', title: 'Follow-ups, replies & referrals', Component: OutreachCRM },
    { id: 'email-checks', title: 'Email verification', Component: ContactIntake }
  ] },
  hiring: { title: 'Job Hunter & HR Sheet', back: 'Back to job search', Primary: JobHunter, tools: [
    { id: 'companies', title: 'Company directory & salary research', Component: Companies },
    { id: 'research', title: 'Recruiter research & draft preparation', Component: Research }
  ] },
  mail: { title: 'Queue & Logs', back: 'Back to email logs', Primary: Logs, tools: [
    { id: 'campaigns', title: 'Campaign queues & schedules', Component: Campaigns }
  ] }
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
  return <main className="min-w-0">
    <section aria-label={`${title} tools`} className="mx-auto max-w-7xl px-4 pt-4 md:px-8 md:pt-8 space-y-2">
      {active && <div className="flex flex-wrap items-center justify-between gap-3 pb-2"><h1 className="text-2xl font-bold text-zinc-100">{title}</h1><button className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" onClick={() => select(null)}>{back}</button></div>}
      {tools.map(tool => <button key={tool.id} type="button" aria-expanded={active?.id === tool.id} aria-controls={`workspace-${tool.id}`} className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left text-sm font-semibold hover:border-zinc-600" onClick={() => select(active?.id === tool.id ? null : tool.id)}><span>{tool.title}</span><span aria-hidden="true">{active?.id === tool.id ? '−' : '+'}</span></button>)}
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

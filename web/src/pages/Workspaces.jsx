import { lazy } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
const Dashboard = lazy(() => import('./Dashboard'));
const JobHunter = lazy(() => import('./JobHunter'));

export function Workspace({ area }) {
  return area === 'hiring' ? <JobHunter /> : <Dashboard />;
}

export function LegacyWorkspaceLink({ path, importContacts = false }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.delete('section');
  if (importContacts) params.set('import', '1');
  return <Navigate replace to={{ pathname:path, search:params.toString(), hash:location.hash }} />;
}

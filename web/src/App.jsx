import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Layout from './components/Layout';
import { Workspace, LegacyWorkspaceLink } from './pages/Workspaces';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login onLogin={() => setIsAuthenticated(true)} />} />
        
        <Route path="/" element={isAuthenticated ? <Layout onLogout={() => setIsAuthenticated(false)} /> : <Navigate to="/login" />}>
          <Route index element={<Workspace area="contacts" />} />
          <Route path="jobs" element={<Workspace area="hiring" />} />
          <Route path="research" element={<LegacyWorkspaceLink path="/" section="research" />} />
          <Route path="companies" element={<LegacyWorkspaceLink path="/" section="companies" />} />
          <Route path="campaigns" element={<LegacyWorkspaceLink path="/" section="campaigns" />} />
          <Route path="email-checks" element={<LegacyWorkspaceLink path="/" section="email-checks" />} />
          <Route path="crm" element={<LegacyWorkspaceLink path="/" section="crm" />} />
          <Route path="import" element={<LegacyWorkspaceLink path="/" section="import" />} />
          <Route path="logs" element={<LegacyWorkspaceLink path="/" section="queue" />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

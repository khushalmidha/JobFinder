import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css'; // Make sure Tailwind is applied

const Options = () => {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginStatus, setLoginStatus] = useState('');
  const [backendUrl, setBackendUrl] = useState('http://localhost:5000');

  useEffect(() => {
    chrome.storage.local.get(['token', 'backendUrl'], (result) => {
      if (result.token) setToken(result.token);
      if (result.backendUrl) setBackendUrl(result.backendUrl);
    });
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginStatus('Logging in...');
    try {
      const res = await fetch(`${backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        chrome.storage.local.set({ token: data.token, backendUrl });
        setToken(data.token);
        setLoginStatus('Success!');
      } else {
        setLoginStatus(data.error || 'Login failed');
      }
    } catch (err) {
      setLoginStatus('Error connecting to backend');
    }
  };

  const handleLogout = () => {
    chrome.storage.local.remove(['token']);
    setToken('');
    setLoginStatus('');
  };

  return (
    <div className="p-8 max-w-lg mx-auto font-sans bg-slate-50 min-h-screen">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <h1 className="text-2xl font-bold mb-6 text-slate-800">ColdMail Pilot Settings</h1>
        
        <div className="mb-6">
          <label className="block text-sm font-medium mb-1 text-slate-700">Backend URL</label>
          <input 
            type="text" 
            value={backendUrl} 
            onChange={e => setBackendUrl(e.target.value)}
            className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none" 
          />
        </div>

        {!token ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Email</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                required 
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 transition">
              Login to Backend
            </button>
            {loginStatus && <p className="text-sm mt-2 font-medium text-slate-600">{loginStatus}</p>}
          </form>
        ) : (
          <div>
            <p className="text-green-600 font-medium mb-4 flex items-center">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
              Connected to backend
            </p>
            <button onClick={handleLogout} className="w-full bg-slate-200 text-slate-800 p-2 rounded hover:bg-slate-300 transition">
              Logout
            </button>
            <p className="text-sm text-slate-500 mt-4">You can manage templates and SMTP settings from the Web Dashboard.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<Options />);

import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Save, User, Key, Mail, FileText, CheckCircle } from 'lucide-react';

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  
  const [settings, setSettings] = useState({
    name: '',
    email: '',
    resumeLink: '',
    defaultJobLink: '',
    geminiApiKey: '',
    smtpConfig: {
      host: 'smtp.gmail.com',
      port: 465,
      user: '',
      pass: ''
    },
    mailTemplate: {
      subject: '',
      body: ''
    }
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await api.get('/auth/settings');
        // Merge with defaults to prevent uncontrolled inputs
        setSettings(prev => ({
          ...prev,
          ...data,
          smtpConfig: { ...prev.smtpConfig, ...data.smtpConfig },
          mailTemplate: { ...prev.mailTemplate, ...data.mailTemplate }
        }));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setSettings(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value
        }
      }));
    } else {
      setSettings(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      await api.patch('/auth/settings', settings);
      setStatus('Settings saved successfully!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading settings...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
          <p className="text-zinc-400 text-sm mt-1">Configure your outreach preferences, API keys, and email provider.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-medium py-2 px-6 rounded-lg shadow-sm transition disabled:opacity-50 flex items-center"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {status && (
        <div className={`p-4 mb-6 rounded-lg border font-medium flex items-center ${
          status.includes('success') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {status.includes('success') && <CheckCircle className="w-5 h-5 mr-3" />}
          {status}
        </div>
      )}

      <form className="space-y-8 pb-12">
        {/* Personal Info */}
        <section className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-6">
          <h2 className="text-lg font-bold text-zinc-100 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-yellow-500" /> Personal Info
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
              <input type="text" name="name" value={settings.name} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Email</label>
              <input type="email" name="email" value={settings.email} disabled className="w-full bg-zinc-800/50 border border-zinc-800 text-zinc-500 rounded-lg p-2 text-sm cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Resume Link (Google Drive, etc.)</label>
              <input type="text" name="resumeLink" value={settings.resumeLink} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Default Job Link (Optional)</label>
              <input type="text" name="defaultJobLink" value={settings.defaultJobLink} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
            </div>
          </div>
        </section>

        {/* API Keys & Credentials */}
        <section className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-6">
          <h2 className="text-lg font-bold text-zinc-100 mb-4 flex items-center">
            <Key className="w-5 h-5 mr-2 text-yellow-500" /> Keys & Credentials
          </h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Gemini API Key</label>
              <p className="text-xs text-zinc-500 mb-2">Used for extracting contact info from Excel/CSV uploads.</p>
              <input type="password" name="geminiApiKey" value={settings.geminiApiKey} onChange={handleChange} placeholder="AIzaSy..." className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
            </div>
            
            <div className="pt-4 border-t border-zinc-800">
              <h3 className="font-semibold text-zinc-100 mb-4">SMTP Configuration (e.g. Gmail)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Host</label>
                  <input type="text" name="smtpConfig.host" value={settings.smtpConfig.host} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Port</label>
                  <input type="number" name="smtpConfig.port" value={settings.smtpConfig.port} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">SMTP Username / Email</label>
                  <input type="text" name="smtpConfig.user" value={settings.smtpConfig.user} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">SMTP Password / App Password</label>
                  <input type="password" name="smtpConfig.pass" value={settings.smtpConfig.pass} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Default Template */}
        <section className="bg-zinc-900 rounded-xl shadow-sm border border-zinc-800 p-6">
          <h2 className="text-lg font-bold text-zinc-100 mb-4 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-yellow-500" /> Default Email Template
          </h2>
          <p className="text-sm text-zinc-400 mb-4">
            Available placeholders: <code className="text-yellow-500">{"{{userName}}"}</code>, <code className="text-yellow-500">{"{{userEmail}}"}</code>, <code className="text-yellow-500">{"{{resumeLink}}"}</code>, <code className="text-yellow-500">{"{{jobLink}}"}</code>, <code className="text-yellow-500">{"{{companyName}}"}</code>, <code className="text-yellow-500">{"{{hrName}}"}</code>.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Subject</label>
              <input type="text" name="mailTemplate.subject" value={settings.mailTemplate.subject} onChange={handleChange} className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Body</label>
              <textarea name="mailTemplate.body" value={settings.mailTemplate.body} onChange={handleChange} className="w-full h-64 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-500 outline-none resize-none font-mono"></textarea>
            </div>
          </div>
        </section>
      </form>
    </div>
  );
};

export default Settings;

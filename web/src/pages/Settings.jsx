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
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 text-sm mt-1">Configure your outreach preferences, API keys, and email provider.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg shadow-sm transition disabled:opacity-50 flex items-center"
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
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-blue-500" /> Personal Info
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
              <input type="text" name="name" value={settings.name} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" name="email" value={settings.email} disabled className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-slate-100 text-slate-500 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Resume Link (Google Drive, etc.)</label>
              <input type="text" name="resumeLink" value={settings.resumeLink} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default Job Link (Optional)</label>
              <input type="text" name="defaultJobLink" value={settings.defaultJobLink} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
        </section>

        {/* API Keys & Credentials */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
            <Key className="w-5 h-5 mr-2 text-orange-500" /> Keys & Credentials
          </h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Gemini API Key</label>
              <p className="text-xs text-slate-500 mb-2">Used for extracting contact info from Excel/CSV uploads.</p>
              <input type="password" name="geminiApiKey" value={settings.geminiApiKey} onChange={handleChange} placeholder="AIzaSy..." className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            
            <div className="pt-4 border-t border-slate-100">
              <h3 className="font-semibold text-slate-800 mb-4">SMTP Configuration (e.g. Gmail)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Host</label>
                  <input type="text" name="smtpConfig.host" value={settings.smtpConfig.host} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Port</label>
                  <input type="number" name="smtpConfig.port" value={settings.smtpConfig.port} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SMTP Username / Email</label>
                  <input type="text" name="smtpConfig.user" value={settings.smtpConfig.user} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SMTP Password / App Password</label>
                  <input type="password" name="smtpConfig.pass" value={settings.smtpConfig.pass} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Default Template */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-green-500" /> Default Email Template
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            Available placeholders: <code>{"{{userName}}"}</code>, <code>{"{{userEmail}}"}</code>, <code>{"{{resumeLink}}"}</code>, <code>{"{{jobLink}}"}</code>, <code>{"{{companyName}}"}</code>, <code>{"{{hrName}}"}</code>.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
              <input type="text" name="mailTemplate.subject" value={settings.mailTemplate.subject} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
              <textarea name="mailTemplate.body" value={settings.mailTemplate.body} onChange={handleChange} className="w-full h-64 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono"></textarea>
            </div>
          </div>
        </section>
      </form>
    </div>
  );
};

export default Settings;

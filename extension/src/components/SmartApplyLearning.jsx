import React, { useEffect, useState } from 'react';
import { draftSettingsKey } from '../utils/fieldDraftProviders.js';
import { submissionPreference, submissionPrefix } from '../utils/submissionMemory.js';

export default function SmartApplyLearning() {
  const [settings, setSettings] = useState({ enabled: false, primary: 'gemini', gemini: '', groq: '' });
  const [learning, setLearning] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    chrome.storage.local.get([draftSettingsKey, submissionPreference]).then(data => {
      if (data[draftSettingsKey]) setSettings(current => ({ ...current, ...data[draftSettingsKey] }));
      setLearning(data[submissionPreference] !== false);
    });
  }, []);
  async function save(event) {
    event.preventDefault();
    await chrome.storage.local.set({ [draftSettingsKey]: settings, [submissionPreference]: learning });
    setMessage('Saved locally.');
  }
  async function forget() {
    const data = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(data).filter(key => key.startsWith(submissionPrefix)));
    setMessage('Submitted answers cleared on this device.');
  }
  return <details className="space-y-2"><summary>AI drafts and submitted answers</summary>
    <form className="space-y-2" onSubmit={save}>
      <label className="block"><input type="checkbox" checked={learning} onChange={e => setLearning(e.target.checked)} /> Learn answers when I submit a form</label>
      <button type="button" className="underline" onClick={forget}>Clear learned submitted answers</button>
      <label className="block"><input type="checkbox" checked={settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /> Use AI to draft unanswered professional questions</label>
      <p className="text-xs">Use keys from free-tier projects. The chosen provider receives the question and selected resume facts. Drafts appear in the form for review.</p>
      <label className="block">First provider <select className="bg-zinc-900" value={settings.primary} onChange={e => setSettings({ ...settings, primary: e.target.value })}>
        <option value="gemini">Gemini Flash-Lite</option><option value="groq">Groq GPT-OSS 20B</option>
      </select></label>
      <label className="block">Gemini API key <input className="bg-zinc-900" type="password" autoComplete="off" value={settings.gemini} onChange={e => setSettings({ ...settings, gemini: e.target.value })} /></label>
      <label className="block">Groq API key <input className="bg-zinc-900" type="password" autoComplete="off" value={settings.groq} onChange={e => setSettings({ ...settings, groq: e.target.value })} /></label>
      <button type="submit" className="border rounded p-2">Save AI and learning settings</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}

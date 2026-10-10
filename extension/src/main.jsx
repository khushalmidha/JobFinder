import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Settings, Sparkles, Send, MailOpen, ClipboardPaste, Zap, Briefcase } from 'lucide-react';
import { AutoApplyPanel } from './components/AutoApplyPanel';

const Popup = () => {
  const [activeTab, setActiveTab] = useState('auto-apply');
  const [token, setToken] = useState('');
  const [backendUrl, setBackendUrl] = useState('https://jobfinder-backend.onrender.com');

  // ColdMail outreach states
  const [rawText, setRawText] = useState('');
  const [contacts, setContacts] = useState([]);
  const [status, setStatus] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['token', 'backendUrl'], (result) => {
      if (result.token) setToken(result.token);
      if (result.backendUrl) setBackendUrl(result.backendUrl);
    });
  }, []);

  const handleScanGmail = async () => {
    try {
      setIsScanning(true);
      setStatus('Scanning Gmail...');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url.includes('mail.google.com')) {
        setStatus('Please open a Gmail email thread first.');
        setIsScanning(false);
        return;
      }

      // Inject script to scrape current email thread
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const messages = document.querySelectorAll('.h7');
          if (messages.length === 0) return null;
          const lastMsg = messages[messages.length - 1];
          const bodyEl = lastMsg.querySelector('.a3s');
          const senderEl = lastMsg.querySelector('span[email]');
          
          return {
            bodyText: bodyEl ? bodyEl.innerText : '',
            senderEmail: senderEl ? senderEl.getAttribute('email') : ''
          };
        }
      });

      if (!result || !result.senderEmail) {
        setStatus('Could not extract email. Make sure a thread is open.');
        setIsScanning(false);
        return;
      }

      setStatus(`Found email from ${result.senderEmail}. Analyzing...`);

      const res = await fetch(`${backendUrl}/api/mail/analyze-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ emailText: result.bodyText, senderEmail: result.senderEmail })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStatus(`Analyzed! Status: ${data.contact.status}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const extractEmails = () => {
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
    const matches = rawText.match(emailRegex) || [];
    const uniqueEmails = [...new Set(matches)];
    
    const parsedContacts = uniqueEmails.map(email => {
      const domain = email.split('@')[1];
      let company = domain.split('.')[0];
      company = company.charAt(0).toUpperCase() + company.slice(1);
      
      return {
        id: crypto.randomUUID(),
        email: email.toLowerCase(),
        company,
        selected: true
      };
    });
    
    setContacts(parsedContacts);
    setRawText('');
    setStatus(`Extracted ${parsedContacts.length} emails`);
  };

  const handleSend = async () => {
    const selectedContacts = contacts.filter(c => c.selected);
    if (selectedContacts.length === 0) return setStatus('No contacts selected');
    if (!token) return setStatus('Not logged in. Open settings.');

    setStatus('Saving contacts...');
    try {
      const createRes = await fetch(`${backendUrl}/api/contacts/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ contacts: selectedContacts })
      });
      
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error);
      
      const savedContacts = createData.contacts || [];
      const contactIds = savedContacts.map(c => c._id);
      
      if (contactIds.length === 0) {
        return setStatus('All contacts were already imported.');
      }

      setStatus('Sending emails...');
      const sendRes = await fetch(`${backendUrl}/api/mail/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ contactIds })
      });
      
      const sendData = await sendRes.json();
      if (!sendRes.ok) throw new Error(sendData.error);

      setStatus(`Queued ${contactIds.length} emails!`);
      setContacts([]);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('src/options/index.html'));
    }
  };

  return (
    <div className="w-[430px] min-h-[580px] max-h-[640px] flex flex-col font-sans bg-zinc-950 text-zinc-100 shadow-2xl select-none">
      {/* Top Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-3.5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-yellow-500 to-amber-300 flex items-center justify-center font-black text-zinc-950 text-xs shadow-sm">
            <Zap className="w-4 h-4 fill-zinc-950 text-zinc-950" />
          </div>
          <div>
            <div className="font-extrabold text-sm tracking-tight text-zinc-100 flex items-center gap-1.5">
              JobFinder <span className="text-[10px] bg-yellow-500/20 text-yellow-400 font-bold px-1.5 py-0.2 rounded border border-yellow-500/30">AI PILOT</span>
            </div>
            <div className="text-[10px] text-zinc-400 font-medium">Khushal Midha Profile Active</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button 
            onClick={() => window.open('http://localhost:5173/jobs', '_blank')} 
            className="p-1.5 rounded-lg text-zinc-400 hover:text-yellow-400 hover:bg-zinc-800 transition"
            title="Open Career Portal Hunter & HR Sheet"
          >
            <Briefcase className="w-4 h-4" />
          </button>
          <button 
            onClick={openSettings} 
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
            title="Settings & Backend Config"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modern Tab Bar */}
      <div className="flex bg-zinc-950 border-b border-zinc-800/80 px-2 pt-2 gap-1">
        <button
          onClick={() => setActiveTab('auto-apply')}
          className={`flex-1 pb-2 pt-1 px-3 text-xs font-bold rounded-t-lg transition flex items-center justify-center gap-1.5 ${
            activeTab === 'auto-apply'
              ? 'bg-zinc-900 text-yellow-400 border-t-2 border-yellow-500 border-x border-zinc-800'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-yellow-400" /> Auto-Apply & CTC
        </button>
        <button
          onClick={() => setActiveTab('cold-outreach')}
          className={`flex-1 pb-2 pt-1 px-3 text-xs font-bold rounded-t-lg transition flex items-center justify-center gap-1.5 ${
            activeTab === 'cold-outreach'
              ? 'bg-zinc-900 text-yellow-400 border-t-2 border-yellow-500 border-x border-zinc-800'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Send className="w-3.5 h-3.5" /> ColdMail Outreach
        </button>
      </div>

      {/* Main Body Content */}
      <div className="flex-1 p-3.5 overflow-y-auto bg-zinc-950 space-y-3">
        {activeTab === 'auto-apply' ? (
          <AutoApplyPanel token={token} backendUrl={backendUrl} />
        ) : (
          <div className="space-y-3">
            {!token ? (
              <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-center space-y-3">
                <p className="text-xs text-zinc-400">ColdMail bulk outreach requires backend authentication.</p>
                <button 
                  onClick={openSettings} 
                  className="bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs w-full transition"
                >
                  Configure in Settings
                </button>
              </div>
            ) : contacts.length === 0 ? (
              <div className="space-y-3">
                <button 
                  onClick={handleScanGmail} 
                  disabled={isScanning}
                  className="w-full bg-zinc-900 border border-zinc-800 hover:border-yellow-500/40 text-yellow-400 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center transition disabled:opacity-50"
                >
                  <MailOpen className="w-4 h-4 mr-2"/> {isScanning ? 'Scanning...' : 'Analyze Open Gmail Thread'}
                </button>
                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-zinc-800"></div>
                  <span className="flex-shrink-0 mx-3 text-zinc-600 text-[10px] font-bold">OR</span>
                  <div className="flex-grow border-t border-zinc-800"></div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Paste Job Description / Contacts</label>
                  <textarea 
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                    rows={5}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs focus:ring-2 focus:ring-yellow-500 focus:outline-none resize-none text-zinc-200 placeholder:text-zinc-600"
                    placeholder="Paste text containing recruiter/HR emails..."
                  />
                </div>
                <button 
                  onClick={extractEmails} 
                  className="w-full bg-yellow-500 hover:bg-yellow-400 text-zinc-950 py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center transition"
                >
                  <ClipboardPaste className="w-4 h-4 mr-2"/> Extract Emails
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h2 className="font-bold text-zinc-200 text-xs">Review Contacts ({contacts.filter(c => c.selected).length})</h2>
                  <button onClick={() => setContacts([])} className="text-[11px] text-red-400 hover:underline">Clear All</button>
                </div>
                
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {contacts.map(c => (
                    <div key={c.id} className="bg-zinc-900 p-2 border border-zinc-800 rounded-lg flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        checked={c.selected} 
                        onChange={() => setContacts(contacts.map(item => item.id === c.id ? { ...item, selected: !item.selected } : item))} 
                        className="rounded border-zinc-700 text-yellow-500 focus:ring-yellow-500" 
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-zinc-400 truncate">{c.email}</p>
                        <input 
                          type="text" 
                          value={c.company} 
                          onChange={(e) => setContacts(contacts.map(item => item.id === c.id ? { ...item, company: e.target.value } : item))} 
                          className="text-xs font-semibold w-full bg-zinc-800/60 border border-transparent focus:border-yellow-500/50 rounded px-1.5 py-0.5 outline-none text-zinc-200"
                          placeholder="Company"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={handleSend} 
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center transition"
                >
                  <Send className="w-4 h-4 mr-2"/> Send Outreach to {contacts.filter(c => c.selected).length} Contacts
                </button>
              </div>
            )}

            {status && (
              <div className="p-2 bg-yellow-500/10 text-yellow-400 text-[11px] rounded-lg border border-yellow-500/20 text-center font-medium">
                {status}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<Popup />);

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Settings, Send, ClipboardPaste, MailOpen } from 'lucide-react';

const Popup = () => {
  const [token, setToken] = useState('');
  const [backendUrl, setBackendUrl] = useState('https://jobfinder-backend.onrender.com');
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

      // Inject script to scrape the current email thread
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Gmail DOM: .h7 is the message container
          const messages = document.querySelectorAll('.h7');
          if (messages.length === 0) return null;
          
          // Get the most recent message (last one usually)
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

      // Send to backend for Gemini analysis
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
    
    // Deduplicate array
    const uniqueEmails = [...new Set(matches)];
    
    const parsedContacts = uniqueEmails.map(email => {
      const domain = email.split('@')[1];
      let company = domain.split('.')[0];
      // Capitalize company
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
      // 1. Bulk create contacts
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

      // 2. Queue emails
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

  const toggleContact = (id) => {
    setContacts(contacts.map(c => c.id === id ? { ...c, selected: !c.selected } : c));
  };

  const updateCompany = (id, newCompany) => {
    setContacts(contacts.map(c => c.id === id ? { ...c, company: newCompany } : c));
  };

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('src/options/index.html'));
    }
  };

  if (!token) {
    return (
      <div className="p-4 w-80 font-sans text-center bg-zinc-950 text-zinc-100">
        <h1 className="text-xl font-bold mb-4">ColdMail Pilot</h1>
        <p className="mb-4 text-zinc-400">Please log in via settings to use the extension.</p>
        <button onClick={openSettings} className="bg-yellow-500 text-zinc-950 font-bold px-4 py-2 rounded flex items-center justify-center w-full hover:bg-yellow-400 transition-colors">
          <Settings className="w-4 h-4 mr-2" /> Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="w-[400px] h-[500px] flex flex-col font-sans bg-zinc-950 text-zinc-200 border-zinc-800 border-r border-b shadow-sm">
      <div className="bg-yellow-500 text-zinc-950 p-3 flex justify-between items-center shadow-md">
        <h1 className="font-bold text-lg flex items-center"><Send className="w-4 h-4 mr-2"/> ColdMail</h1>
        <button onClick={openSettings} className="hover:bg-yellow-400 p-1 rounded transition">
          <Settings className="w-5 h-5" />
        </button>
      </div>
      
      <div className="p-3 flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="h-full flex flex-col">
            <button 
              onClick={handleScanGmail} 
              disabled={isScanning}
              className="mb-4 bg-zinc-800 border border-zinc-700 text-yellow-500 py-2 rounded font-bold flex items-center justify-center hover:bg-zinc-700 transition disabled:opacity-50"
            >
              <MailOpen className="w-4 h-4 mr-2"/> {isScanning ? 'Scanning...' : 'Analyze Open Gmail Thread'}
            </button>
            <div className="relative flex py-2 items-center mb-4">
              <div className="flex-grow border-t border-zinc-800"></div>
              <span className="flex-shrink-0 mx-4 text-zinc-600 text-xs uppercase font-medium">OR</span>
              <div className="flex-grow border-t border-zinc-800"></div>
            </div>
            <label className="block text-sm font-semibold text-zinc-300 mb-1">Paste Job Description / Contacts</label>
            <textarea 
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              className="flex-1 w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm focus:ring-2 focus:ring-yellow-500 focus:outline-none resize-none text-zinc-200 placeholder:text-zinc-600"
              placeholder="Paste text containing HR emails here..."
            />
            <button onClick={extractEmails} className="mt-3 bg-yellow-500 text-zinc-950 py-2 rounded font-bold flex items-center justify-center hover:bg-yellow-400 transition">
              <ClipboardPaste className="w-4 h-4 mr-2"/> Extract Emails
            </button>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-zinc-100 text-sm">Review Contacts ({contacts.filter(c => c.selected).length})</h2>
              <button onClick={() => setContacts([])} className="text-xs text-red-400 hover:underline">Clear</button>
            </div>
            
            <div className="space-y-2 mb-4">
              {contacts.map(c => (
                <div key={c.id} className="bg-zinc-900 p-2 border border-zinc-800 rounded flex items-center shadow-sm">
                  <input type="checkbox" checked={c.selected} onChange={() => toggleContact(c.id)} className="mr-2 h-4 w-4 bg-zinc-800 text-yellow-500 rounded border-zinc-700 focus:ring-yellow-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-400 truncate">{c.email}</p>
                    <input 
                      type="text" 
                      value={c.company} 
                      onChange={(e) => updateCompany(c.id, e.target.value)} 
                      className="text-sm font-medium w-full bg-zinc-800/50 border border-transparent focus:border-yellow-500/50 focus:bg-zinc-800 rounded px-1 py-0.5 outline-none text-zinc-200"
                      placeholder="Company"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={handleSend} className="w-full bg-green-500 text-zinc-950 py-2 rounded font-bold flex items-center justify-center hover:bg-green-400 transition">
              <Send className="w-4 h-4 mr-2"/> Send Outreach
            </button>
          </div>
        )}
        
        {status && (
          <div className="mt-3 p-2 bg-yellow-500/10 text-yellow-500 text-xs rounded border border-yellow-500/20 text-center font-medium">
            {status}
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<Popup />);

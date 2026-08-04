import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Settings, Send, ClipboardPaste, Plus } from 'lucide-react';

const Popup = () => {
  const [token, setToken] = useState('');
  const [backendUrl, setBackendUrl] = useState('https://jobfinder-backend.onrender.com'); // default to production URL
  const [rawText, setRawText] = useState('');
  const [contacts, setContacts] = useState([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    chrome.storage.local.get(['token', 'backendUrl'], (result) => {
      if (result.token) setToken(result.token);
      if (result.backendUrl) setBackendUrl(result.backendUrl);
    });
  }, []);

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
      <div className="p-4 w-80 font-sans text-center">
        <h1 className="text-xl font-bold mb-4">ColdMail Pilot</h1>
        <p className="mb-4 text-slate-600">Please log in via settings to use the extension.</p>
        <button onClick={openSettings} className="bg-blue-600 text-white px-4 py-2 rounded flex items-center justify-center w-full">
          <Settings className="w-4 h-4 mr-2" /> Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="w-[400px] h-[500px] flex flex-col font-sans bg-slate-50 border-r border-b shadow-sm">
      <div className="bg-blue-600 text-white p-3 flex justify-between items-center shadow-md">
        <h1 className="font-bold text-lg flex items-center"><Send className="w-4 h-4 mr-2"/> ColdMail</h1>
        <button onClick={openSettings} className="hover:bg-blue-700 p-1 rounded transition">
          <Settings className="w-5 h-5" />
        </button>
      </div>
      
      <div className="p-3 flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="h-full flex flex-col">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Paste Job Description / Contacts</label>
            <textarea 
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              className="flex-1 w-full border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
              placeholder="Paste text containing HR emails here..."
            />
            <button onClick={extractEmails} className="mt-3 bg-slate-800 text-white py-2 rounded font-medium flex items-center justify-center hover:bg-slate-700 transition">
              <ClipboardPaste className="w-4 h-4 mr-2"/> Extract Emails
            </button>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-slate-800 text-sm">Review Contacts ({contacts.filter(c => c.selected).length})</h2>
              <button onClick={() => setContacts([])} className="text-xs text-red-600 hover:underline">Clear</button>
            </div>
            
            <div className="space-y-2 mb-4">
              {contacts.map(c => (
                <div key={c.id} className="bg-white p-2 border border-slate-200 rounded flex items-center shadow-sm">
                  <input type="checkbox" checked={c.selected} onChange={() => toggleContact(c.id)} className="mr-2 h-4 w-4 text-blue-600 rounded border-slate-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 truncate">{c.email}</p>
                    <input 
                      type="text" 
                      value={c.company} 
                      onChange={(e) => updateCompany(c.id, e.target.value)} 
                      className="text-sm font-medium w-full bg-slate-50 border border-transparent focus:border-blue-300 focus:bg-white rounded px-1 py-0.5 outline-none"
                      placeholder="Company"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={handleSend} className="w-full bg-green-600 text-white py-2 rounded font-medium flex items-center justify-center hover:bg-green-700 transition">
              <Send className="w-4 h-4 mr-2"/> Send Outreach
            </button>
          </div>
        )}
        
        {status && (
          <div className="mt-3 p-2 bg-blue-50 text-blue-700 text-xs rounded border border-blue-100 text-center font-medium">
            {status}
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<Popup />);

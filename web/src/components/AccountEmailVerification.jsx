import React, { useEffect, useState } from 'react';
import api from '../services/api';
export default function AccountEmailVerification() {
  const [status,setStatus] = useState(null), [code,setCode] = useState(''), [approved,setApproved] = useState(false);
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  useEffect(()=>{let active=true;api.get('/auth/email-verification').then(({data})=>{if(active)setStatus(data);}).catch(error=>{if(active)setMessage(error.response?.data?.error||'Could not load account verification.');});return()=>{active=false;};},[]);
  async function run(action) {
    setBusy(true);setMessage('');
    try {const {data}=await action();setMessage(data.message);setStatus((await api.get('/auth/email-verification')).data);setCode('');setApproved(false);}
    catch(error){setMessage(error.response?.data?.error||'Verification request failed.');}
    finally{setBusy(false);}
  }
  return <section aria-labelledby="account-email-verification" className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-3">
    <h2 id="account-email-verification" className="text-xl font-semibold text-white">Account email verification</h2>
    {status&&<><p>{status.email} · <strong>{status.verified?'Verified':'Not verified'}</strong></p><p className="text-sm text-zinc-400">{status.message}</p>
      {!status.verified&&status.available&&<>
        <label className="block text-sm"><input type="checkbox" checked={approved} onChange={event=>setApproved(event.target.checked)} disabled={busy}/> Send a verification code to my registered account email.</label>
        <button type="button" disabled={busy||!approved} className="rounded bg-yellow-500 px-4 py-2 font-semibold text-black disabled:opacity-40" onClick={()=>run(()=>api.post('/auth/email-verification/request',{approved:true}))}>Send verification code</button>
        <div className="flex flex-wrap gap-3 items-end"><label className="block">Verification code<input className="block rounded border border-zinc-600 bg-zinc-950 p-2 mt-1" autoComplete="one-time-code" maxLength={16} spellCheck={false} value={code} onChange={event=>setCode(event.target.value)} placeholder="16-character code from your inbox"/></label><button type="button" disabled={busy||!/^[a-f0-9]{16}$/i.test(code.trim())} className="rounded border border-zinc-600 px-4 py-2 disabled:opacity-40" onClick={()=>run(()=>api.post('/auth/email-verification/confirm',{code}))}>Verify account email</button></div>
        <p className="text-sm text-zinc-400">Codes expire after 10 minutes. Maximum three requests per UTC day, at least 60 seconds apart. Verification does not grant admin access, approve outreach or import companies.</p>
      </>}
    </>}
    {message&&<p role="status" className="text-sm text-yellow-300">{message}</p>}
  </section>;
}

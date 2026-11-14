import React, { useEffect, useState } from 'react';
import api from '../services/api';
export default function ContactIntake() {
  const [rows,setRows]=useState([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[approved,setApproved]=useState({}),[message,setMessage]=useState('');
  async function load(number=page){const {data}=await api.get('/contact-intake',{params:{page:number}});setRows(data.rows);setTotal(data.total);setPage(number);}
  useEffect(()=>{load(1).catch(e=>setError(e.response?.data?.error||e.message));},[]);
  async function navigate(number){setBusy(true);setError('');try{await load(number);}catch(e){setError(e.response?.data?.error||e.message);}finally{setBusy(false);}}
  async function run(fn){setBusy(true);setError('');setMessage('');try{const {data}=await fn();setMessage(`Added ${data.added||0}; updated ${data.updated||0}; pending ${data.staged||0}; rejected ${data.rejected||0}.`);setApproved({});await load();}catch(e){setError(e.response?.data?.error||e.message);}finally{setBusy(false);}}
  return <main className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
    <h1 className="text-2xl text-zinc-100 font-bold">Email verification queue</h1>
    <p>New addresses stay here until a fresh trusted verifier result is available. A public listing, MX record or SMTP connection does not prove an individual mailbox exists. Existing contacts also need a current proof before sending.</p>
    <p>Domain checks are free. Hunter verification reserves one credit only after your explicit approval and configured Research credit budget. No paid verification runs automatically. Provider verification is an assertion at a point in time, not a delivery guarantee.</p>
    {error&&<p role="alert" className="text-red-300">{error}</p>}{message&&<p role="status" className="text-green-300">{message}</p>}
    <p>{total} candidate records</p>
    {rows.map(row=><article key={row._id} className="p-4 border border-zinc-700 rounded space-y-2 break-words">
      <h2 className="font-semibold text-zinc-100">{row.company} — {row.email}</h2><p>{row.state}: {row.reason}</p>
      <button disabled={busy} className="border border-zinc-600 rounded px-3 py-2 disabled:opacity-40" onClick={()=>run(()=>api.post(`/contact-intake/${row._id}/recheck`))}>Recheck domain / existing proof</button>
      {!['confirmed_invalid','suppressed','promoted'].includes(row.state)&&<div className="space-y-2">
        <label className="block"><input type="checkbox" checked={!!approved[row._id]} onChange={e=>setApproved(previous=>({...previous,[row._id]:e.target.checked}))}/> I approve one Hunter verification credit for {row.email}.</label>
        <button disabled={busy||!approved[row._id]} className="border border-yellow-600 rounded px-3 py-2 disabled:opacity-40" onClick={()=>run(()=>api.post(`/contact-intake/${row._id}/verify`,{approved:true}))}>Verify with Hunter</button>
      </div>}
    </article>)}
    {!rows.length&&<p>No candidates in this page.</p>}
    <div className="flex gap-3 items-center"><button disabled={busy||page<=1} onClick={()=>navigate(page-1)}>Previous</button><span>Page {page}</span><button disabled={busy||page*50>=total} onClick={()=>navigate(page+1)}>Next</button></div>
  </main>;
}

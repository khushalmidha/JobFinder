const dns = require('node:dns').promises;
const net = require('node:net');
const { isPublicIP } = require('./safePublicFetch');

async function withTimeout(promise, timeoutMs) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer=setTimeout(()=>reject(Object.assign(new Error('DNS timeout'),{code:'ETIMEOUT'})),timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
async function resolveAuditDomain(domain, {resolver=dns, timeoutMs=3000}={}) {
  try {
    const records=await withTimeout(resolver.resolveMx(domain),timeoutMs);
    // Only a sole preference-0 root record is an explicit RFC 7505 Null MX.
    if(records.length===1 && records[0].priority===0 && ['', '.'].includes(records[0].exchange))return {status:'null_mx',hosts:[],reason:'Domain explicitly declares that it accepts no mail'};
    if(records.some(r=>!r.exchange || r.exchange==='.' || !/^[a-z0-9.-]+$/i.test(r.exchange)))return {status:'unknown',hosts:[],reason:'Inconsistent or unsupported MX records'};
    if(records.length)return {status:'mx_found',hosts:[...new Set(records.sort((a,b)=>a.priority-b.priority).map(r=>r.exchange.toLowerCase().replace(/\.$/,'')))]};
  }catch(error){
    if(!['ENODATA','NODATA'].includes(error.code))return {status:error.code==='ENOTFOUND'?'dns_not_found':'dns_inconclusive',hosts:[],reason:'DNS failure is not mailbox-invalid proof',errorCode:error.code||'UNKNOWN'};
  }
  // SMTP implicit MX fallback: absence of MX alone never makes mail invalid.
  try {
    const records=await withTimeout(resolver.lookup(domain,{all:true,family:4}),timeoutMs);
    if(records.length && records.every(r=>isPublicIP(r.address)))return {status:'implicit_mx',hosts:[domain],reason:'No explicit MX; public address fallback'};
  }catch{}
  return {status:'unknown',hosts:[],reason:'No usable mail route established; preserve for review'};
}

async function probeSmtpServer(host,{timeoutMs=2500,resolver=dns,connect=net.createConnection}={}){
  const started=Date.now();
  if(typeof host!=='string' || !/^[a-z0-9.-]+$/i.test(host))return {status:'unknown',attempted:false,reason:'Invalid MX hostname',mailboxVerified:false};
  let records;
  try{records=await withTimeout(resolver.lookup(host,{all:true,family:4}),timeoutMs);}
  catch(error){return{status:'dns_inconclusive',attempted:false,errorCode:error.code||'UNKNOWN',mailboxVerified:false};}
  if(!records.length || records.some(r=>!isPublicIP(r.address)))return{status:'blocked_destination',attempted:false,reason:'Private/reserved or unsupported destination',mailboxVerified:false};
  const address=records[0].address;
  return new Promise(resolve=>{
    let socket,timer,finished=false,connected=false,phase='greeting',buffer='',bytes=0;
    function finish(status,extra={}){
      if(finished)return;finished=true;clearTimeout(timer);
      socket?.removeAllListeners();socket?.on('error',()=>{});socket?.destroy();
      resolve({status,attempted:true,tcpConnected:connected,mailboxVerified:false,durationMs:Date.now()-started,...extra});
    }
    timer=setTimeout(()=>finish(connected?'smtp_inconclusive':'unreachable',{errorCode:'ETIMEOUT'}),Math.max(1,timeoutMs-(Date.now()-started)));
    try{
      socket=connect({host:address,port:25});
      socket.on('connect',()=>{connected=true;});
      socket.on('error',error=>finish('unreachable',{errorCode:error.code||'UNKNOWN'}));
      socket.on('end',()=>finish('smtp_inconclusive'));
      socket.on('data',chunk=>{
        bytes+=chunk.length;if(bytes>16384)return finish('smtp_inconclusive',{reason:'SMTP response exceeded limit'});
        buffer+=chunk.toString('utf8');let newline;
        while((newline=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);
          const reply=line.match(/^(\d{3}) /);if(!reply)continue;const code=Number(reply[1]);
          if(phase==='greeting' && code===220){phase='ehlo';socket.write('EHLO audit.jobfinder.invalid\r\n');}
          else if(phase==='ehlo' && code===250){socket.write('QUIT\r\n');finish('smtp_reachable',{replyCode:code});return;}
          else if(phase==='ehlo' && [500,502,504].includes(code)){socket.write('QUIT\r\n');finish('smtp_greeting_received',{replyCode:code});return;}
          else {finish(code>=400 && code<500?'temporary_rejection':'smtp_inconclusive',{replyCode:code});return;}
        }
      });
    }catch(error){finish('smtp_inconclusive',{errorCode:error.code||'UNKNOWN'});}
  });
}

function syntaxDisposition(value){
  const {isValidEmailSyntax}=require('./emailDeliverabilityService');
  const email=String(value||'').trim();
  if(isValidEmailSyntax(email))return 'supported';
  // Quoted local-parts, address literals and SMTPUTF8 need a richer parser.
  // Not supporting those formats is not evidence that their mailboxes are invalid.
  if(/["\[\]\\]|[^\x00-\x7f]/.test(email))return 'unsupported';
  const parts=email.split('@');
  if(parts.length!==2 || !parts[0] || !parts[1] || /\s|[\x00-\x1f\x7f]/.test(email))return 'invalid';
  if(parts[0].startsWith('.') || parts[0].endsWith('.') || email.includes('..') || parts[1].startsWith('.') || parts[1].endsWith('.'))return 'invalid';
  return 'unsupported';
}
function confirmedInvalidReason(contact,domainResult,recipientLogs=[]){
  const email=String(contact.email||'').trim().toLowerCase();
  const syntax=syntaxDisposition(email);
  if(syntax==='invalid')return 'invalid_syntax';
  if(syntax==='unsupported')return null;
  if(domainResult?.status==='null_mx')return 'explicit_null_mx';
  // Only trusted, structured recipient DSNs count, never arbitrary error text.
  const logs=recipientLogs.filter(log=>String(log.userId)===String(contact.userId) && String(log.recipientEmail||'').trim().toLowerCase()===email);
  const failures=logs.filter(log=>['bounced','failed'].includes(log.status) && log.deliveryEvidence?.trusted===true && /^5\.1\.(1|2|3|10)$/.test(log.deliveryEvidence.enhancedStatus||'') && Number.isFinite(new Date(log.sentAt).getTime()));
  if(failures.some(log=>!logs.some(other=>['sent','delivered'].includes(other.status) && new Date(other.sentAt)>=new Date(log.sentAt))))return 'recipient_permanent_failure';
  return null;
}
module.exports={resolveAuditDomain,probeSmtpServer,confirmedInvalidReason,syntaxDisposition,withTimeout};

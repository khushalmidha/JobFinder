const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {EventEmitter}=require('node:events');
const {resolveAuditDomain,probeSmtpServer,confirmedInvalidReason}=require('../services/smtpConnectivityService');
const publicLookup={lookup:async()=>[{address:'8.8.8.8',family:4}]};
test('real SMTP fixture receives only EHLO and QUIT, never recipient/address enumeration or mail',async()=>{
  const commands=[];
  const server=net.createServer(socket=>{socket.write('220-fixture\r\n220 SMTP ready\r\n');socket.on('data',chunk=>{commands.push(...chunk.toString().trim().split('\r\n'));if(chunk.toString().startsWith('EHLO '))socket.write('250-fixture\r\n250 SIZE 1024\r\n');});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const result=await probeSmtpServer('mx.employer.example',{resolver:publicLookup,connect:()=>net.createConnection({host:'127.0.0.1',port:server.address().port}),timeoutMs:1000});
    assert.equal(result.status,'smtp_reachable');assert.equal(result.mailboxVerified,false);assert.equal(result.attempted,true);
    await new Promise(resolve=>setTimeout(resolve,20));assert.ok(commands.includes('EHLO audit.jobfinder.invalid'));assert.ok(commands.includes('QUIT'));
    assert.ok(commands.every(c=>/^EHLO |^QUIT$/.test(c)));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('blocked/private MX, timeout, SMTP 421 and TCP refusal never imply invalid mailbox',async()=>{
  let connections=0;
  const blocked=await probeSmtpServer('mx.employer.example',{resolver:{lookup:async()=>[{address:'127.0.0.1',family:4}]},connect:()=>{connections++;}});
  assert.equal(blocked.status,'blocked_destination');assert.equal(connections,0);
  for(const kind of ['timeout','refusal','421']){
    const result=await probeSmtpServer('mx.employer.example',{resolver:publicLookup,timeoutMs:30,connect:()=>{
      const socket=new EventEmitter();socket.destroy=()=>{};socket.write=()=>{};
      setTimeout(()=>{if(kind==='refusal')socket.emit('error',Object.assign(new Error(),{code:'ECONNREFUSED'}));else{socket.emit('connect');if(kind==='421')socket.emit('data',Buffer.from('421 Service temporarily unavailable\r\n'));}},1);
      return socket;
    }});
    assert.equal(result.mailboxVerified,false);assert.ok(['unreachable','smtp_inconclusive','temporary_rejection'].includes(result.status));
  }
});
test('Null MX is definitive only when sole preference-zero record; absent MX falls back to A',async()=>{
  assert.equal((await resolveAuditDomain('employer.example',{resolver:{resolveMx:async()=>[{priority:0,exchange:'.'}]}})).status,'null_mx');
  assert.equal((await resolveAuditDomain('employer.example',{resolver:{resolveMx:async()=>[{priority:0,exchange:'.'},{priority:10,exchange:'mx.employer.example'}]}})).status,'unknown');
  assert.equal((await resolveAuditDomain('employer.example',{resolver:{resolveMx:async()=>{throw Object.assign(new Error(),{code:'ENODATA'});},lookup:publicLookup.lookup}})).status,'implicit_mx');
  assert.equal((await resolveAuditDomain('employer.example',{resolver:{resolveMx:async()=>{throw Object.assign(new Error(),{code:'ENOTFOUND'});}}})).status,'dns_not_found');
});
test('suppression requires exact permanent evidence; transient/legacy flags and other-owner logs stay preserved',()=>{
  const contact={email:'jobs@employer.example',userId:'owner',status:'bounced'};
  assert.equal(confirmedInvalidReason(contact,{status:'dns_not_found'}),null);
  assert.equal(confirmedInvalidReason(contact,{status:'mx_found',smtp:{status:'unreachable'}}),null);
  assert.equal(confirmedInvalidReason(contact,{status:'null_mx'}),'explicit_null_mx');
  assert.equal(confirmedInvalidReason({...contact,email:'bad email@domain'}), 'invalid_syntax');
  const log={userId:'owner',recipientEmail:contact.email,status:'bounced',sentAt:'2026-11-06',deliveryEvidence:{trusted:true,enhancedStatus:'5.1.1'}};
  assert.equal(confirmedInvalidReason(contact,null,[log]),'recipient_permanent_failure');
  for(const patch of [{recipientEmail:'someone@employer.example'},{userId:'other'},{deliveryEvidence:{trusted:true,enhancedStatus:'5.7.1'}},{deliveryEvidence:{trusted:false,enhancedStatus:'5.1.1'}},{recipientEmail:''},{deliveryEvidence:undefined,bounceReason:'550 5.1.1 No such user'}])assert.equal(confirmedInvalidReason(contact,null,[{...log,...patch}]),null);
  assert.equal(confirmedInvalidReason(contact,null,[log,{...log,status:'delivered',sentAt:'2026-11-07'}]),null);
  for(const email of ['"john.doe"@example.com','δοκιμή@example.com','mail@[192.0.2.1]'])assert.equal(confirmedInvalidReason({...contact,email}),null);
});

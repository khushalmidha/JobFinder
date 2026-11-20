const {test}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {dkimSign}=require('mailauth/lib/dkim/sign');
const {inspectProviderDsn}=require('../services/providerDsnService');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const dnsKey='v=DKIM1; k=rsa; p='+publicKey.export({type:'spki',format:'der'}).toString('base64');
const resolver=async()=>[[dnsKey]];
async function message({status='5.1.1',date=new Date(),domain='googlemail.com',maxBodyLength,conflictingId=false}={}){
  const text=[
    'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
    'To: sender@example.org','Date: '+date.toUTCString(),'Subject: Delivery Status Notification (Failure)',
    'Message-ID: <dsn-fixture@googlemail.com>','MIME-Version: 1.0',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="dsn-fixture"','',
    '--dsn-fixture','Content-Type: text/plain','','Address not found. Arbitrary mention attacker@example.org.',
    '--dsn-fixture','Content-Type: message/delivery-status','',
    'Reporting-MTA: dns; googlemail.com','X-Original-Message-ID: <owned-fixture@jobfinder.invalid>','',
    'Final-Recipient: rfc822; careers@employer.example','Action: failed','Status: '+status,
    'Diagnostic-Code: smtp; 550 recipient diagnostic','',
    '--dsn-fixture','Content-Type: text/rfc822-headers','',
    'Message-ID: <'+(conflictingId?'different':'owned-fixture')+'@jobfinder.invalid>',
    'From: sender@example.org','To: careers@employer.example','','--dsn-fixture--',''
  ].join('\r\n');
  const raw=Buffer.from(text.replaceAll('\\r\\n','\r\n'));
  const signed=await dkimSign(raw,{signTime:date,expires:new Date(+date+7*86400000),headerList:['From','To','Date','Subject','Message-ID','MIME-Version','Content-Type'],signatureData:[{signingDomain:domain,selector:'fixture',privateKey:privateKey.export({type:'pkcs8',format:'pem'}),...(maxBodyLength!==undefined?{maxBodyLength}:{})}]});
  assert.equal(signed.errors.length,0);return Buffer.concat([Buffer.from(signed.signatures),raw]);
}
test('real DKIM verification authenticates exact Google DSNs, including signed historical date and X-Original-Message-ID',async()=>{
  for(const date of [new Date(),new Date(Date.now()-30*86400000)]){
    const result=await inspectProviderDsn(await message({date}),{resolver});assert.equal(result.trusted,true);
    assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].recipientEmail,'careers@employer.example');assert.equal(result.evidence[0].messageId,'<owned-fixture@jobfinder.invalid>');
  }
});
test('unsigned, body/header tampering, wrong signing domain and partial-body signatures cannot authenticate a failure',async()=>{
  const raw=await message();
  const variants=[Buffer.from(raw.toString().replace('Status: 5.1.1','Status: 5.7.1')),Buffer.from(raw.toString().replace('Date: ','Date: Mon, 01 Jan 2024 00:00:00 GMT\r\nX-Forged-Date: ')),await message({domain:'attacker.example'}),await message({maxBodyLength:10}),Buffer.from('From: mailer-daemon@googlemail.com\r\nSubject: Address not found\r\n\r\ncareers@employer.example')];
  for(const input of variants)assert.equal((await inspectProviderDsn(input,{resolver})).trusted,false);
});
test('conflicting original message IDs cannot correlate; temporary, quota and policy codes remain distinct',async()=>{
  const conflict=await inspectProviderDsn(await message({conflictingId:true}),{resolver});assert.equal(conflict.trusted,true);assert.equal(conflict.evidence.length,0);
  for(const status of ['5.1.3','4.2.2','5.7.1','5.4.1']){
    const result=await inspectProviderDsn(await message({status}),{resolver});assert.equal(result.trusted,true);assert.equal(result.evidence[0].enhancedStatus,status);
  }
});

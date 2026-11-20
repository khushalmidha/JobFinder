const crypto=require('node:crypto');
const dns=require('node:dns').promises;
const {simpleParser}=require('mailparser');
const {dkimVerify}=require('mailauth/lib/dkim/verify');
const {parseDeliveryStatus}=require('./deliveryStatusParser');
const {createMailbox}=require('./secureMailboxService');
const User=require('../models/User'),MailLog=require('../models/MailLog'),Ledger=require('../models/DeliveryLedger');
const delivery=require('./signedDeliveryEventService');
const normalize=value=>String(value||'').trim().toLowerCase();
const cache=new Map();
async function resolveKey(name,type){
  if(type!=='TXT'||!/^([a-z0-9_-]+[.])*_domainkey[.]googlemail[.]com[.]?$/i.test(name))throw new Error('Unsupported DSN signing domain');
  const key=type+':'+name,old=cache.get(key);if(old&&old.expires>Date.now())return old.promise;
  if(cache.size>100)cache.clear();
  let timer;const promise=Promise.race([dns.resolve(name,type),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DKIM DNS timeout')),5000);})]).finally(()=>clearTimeout(timer));
  cache.set(key,{expires:Date.now()+300000,promise});return promise;
}
async function inspectProviderDsn(raw,{verify=dkimVerify,resolver=resolveKey}={}){
  if(!Buffer.isBuffer(raw)||raw.length>2*1024*1024)return {trusted:false,reason:'Unsupported message size',evidence:[]};
  const mail=await simpleParser(raw,{keepDeliveryStatus:true});
  const from=mail.from?.value||[],type=mail.headers.get('content-type');
  if(from.length!==1||normalize(from[0].address)!=='mailer-daemon@googlemail.com'||type?.value!=='multipart/report'||type.params?.['report-type']!=='delivery-status'||mail.headerLines.filter(h=>h.key==='from').length!==1||mail.headerLines.filter(h=>h.key==='content-type').length!==1||!mail.date||!Number.isFinite(+mail.date)||+mail.date>Date.now()+300000||mail.headerLines.filter(h=>h.key==='date').length!==1)return {trusted:false,reason:'Not a supported provider DSN',evidence:[]};
  let verified;
  try{verified=await verify(raw,{resolver,strict:true,rejectRsaSha1:true,minBitLength:2048,curTime:new Date(+mail.date+60000)});}
  catch{return {trusted:false,reason:'Provider signature inconclusive',evidence:[]};}
  const signature=verified.results?.find(r=>{
    const headers=String(r.signingHeaders?.keys||'').toLowerCase().split(/[: ,]+/);
    return normalize(r.signingDomain)==='googlemail.com'&&r.status?.result==='pass'&&!r.status.testing&&r.signatureTimeValid!==false&&r.canonBodyLengthLimited===false&&headers.includes('from')&&headers.includes('content-type')&&headers.includes('date');
  });
  if(!signature)return {trusted:false,reason:'No complete trusted provider DKIM signature',evidence:[]};
  const originalIds=new Set();
  for(const attachment of mail.attachments||[]){
    if(attachment.contentType==='message/rfc822'){
      const original=await simpleParser(attachment.content);if(original.messageId)originalIds.add(original.messageId);
    }else if(attachment.contentType==='text/rfc822-headers'){
      const id=attachment.content.toString('utf8').match(/^Message-ID:[ \t]*(<[^\r\n>]+>)/im)?.[1];if(id)originalIds.add(id);
    }
  }
  const evidence=[];
  for(const part of (mail.attachments||[]).filter(a=>a.contentType==='message/delivery-status'))for(const row of parseDeliveryStatus(part.content.toString('utf8'))){
    const ids=new Set([...originalIds,...(row.messageId?[row.messageId]:[])]);
    if(ids.size!==1)continue;
    evidence.push({...row,messageId:[...ids][0]});
  }
  return {trusted:true,reason:'Cryptographically verified Google DSN',signingDomain:'googlemail.com',reportedAt:mail.date.toISOString(),signatureId:signature.id,rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),evidence};
}
async function applyProviderDsn(userId,raw,{apply=true,inspect=inspectProviderDsn}={}){
  const parsed=await inspect(raw);const report={trusted:parsed.trusted,confirmed:[],inconclusive:0,unmatched:0,duplicates:0};
  if(!parsed.trusted){report.inconclusive=1;return report;}
  for(const row of parsed.evidence){
    if(row.action!=='failed'||!['5.1.1','5.1.3'].includes(row.enhancedStatus)){report.inconclusive++;continue;}
    const [logs,ledger]=await Promise.all([MailLog.find({userId,providerMessageId:row.messageId,recipientEmail:row.recipientEmail}).limit(2).lean(),Ledger.find({userId,providerMessageId:row.messageId,recipientEmail:row.recipientEmail}).limit(2).lean()]);
    const unique=new Set([...logs.map(l=>String(l._id)),...ledger.map(l=>l.originalMailLogId?String(l.originalMailLogId):'ledger:'+l._id)]);
    if(unique.size!==1){report.unmatched++;continue;}
    const eventId='dkim-dsn:'+crypto.createHash('sha256').update([String(userId),parsed.rawSha256,row.messageId,row.recipientEmail].join(':')).digest('hex');
    const event={eventId,messageId:row.messageId,recipientEmail:row.recipientEmail,eventType:'permanent_failure',enhancedStatus:row.enhancedStatus};
    if(apply){
      const result=await delivery.applyEvent({event,userId,digest:crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex'),authentication:{source:'provider_dkim',signingDomain:parsed.signingDomain,signatureId:parsed.signatureId,rawSha256:parsed.rawSha256,reportedAt:parsed.reportedAt}});
      if(result.duplicate)report.duplicates++;
    }
    report.confirmed.push(row.recipientEmail);
  }
  return report;
}
async function scanProviderBounces(userId,{apply=true,maxMessages=200,cursors={},mailboxFactory=createMailbox,applyMessage=applyProviderDsn}={}){
  if(!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>500)throw new Error('Use 1 to 500 DSNs per mailbox page');
  const user=await User.findById(userId);if(!user)throw new Error('Owner not found');
  const svc=require('./campaignService'),seen=new Set(),accounts=svc.senderOptions(user).filter(s=>{const k=require('./senderQuotaService').senderQuotaKey(s.email);if(seen.has(k))return false;seen.add(k);return true;});
  const report={scanned:0,bouncedCount:0,emails:[],inconclusive:0,unmatched:0,duplicates:0,mailboxes:[],nextCursors:{},truncated:false};
  for(const account of accounts){
    let client,lock;const row={senderId:account.id,scanned:0,matched:0};
    try{
      client=await mailboxFactory(svc.resolveSender(user,account.id).config);await client.connect();
      const folders=await client.list();const paths=[folders.find(f=>f.specialUse==='\\All')||folders.find(f=>f.path==='INBOX'),folders.find(f=>f.specialUse==='\\Junk'),folders.find(f=>f.specialUse==='\\Trash')].filter(Boolean);
      for(const folder of paths){
        lock=await client.getMailboxLock(folder.path,{readOnly:true});const key=account.id+':'+folder.path,validity=String(client.mailbox.uidValidity),cursor=cursors[key];
        const ids=await client.search({or:[{from:'mailer-daemon'},{from:'postmaster'},{subject:'Delivery Status Notification'},{subject:'Undeliverable'}]},{uid:true});
        const remaining=ids.filter(id=>!cursor||cursor.uidValidity!==validity||id<cursor.beforeUid).sort((a,b)=>b-a);row.matched+=remaining.length;
        const page=remaining.slice(0,maxMessages);const more=remaining.length>page.length;
        if(page.length)for await(const item of client.fetch(page,{source:true},{uid:true})){
          if(!item.source||item.source.length>2*1024*1024){report.inconclusive++;continue;}
          const result=await applyMessage(userId,item.source,{apply});row.scanned++;report.scanned++;
          report.emails.push(...result.confirmed);report.inconclusive+=result.inconclusive;report.unmatched+=result.unmatched;report.duplicates+=result.duplicates;
        }
        if(page.length)report.nextCursors[key]={uidValidity:validity,beforeUid:Math.min(...page)};
        else if(cursor)report.nextCursors[key]=cursor;
        if(more)report.truncated=true;
        lock.release();lock=null;
      }
    }catch{row.error='Mailbox scan incomplete; resume from last completed page';report.truncated=true;}
    finally{lock?.release();if(client)await client.logout().catch(()=>client.close());}
    report.mailboxes.push(row);
  }
  report.emails=[...new Set(report.emails)];report.bouncedCount=report.emails.length;
  return report;
}
module.exports={inspectProviderDsn,applyProviderDsn,scanProviderBounces};

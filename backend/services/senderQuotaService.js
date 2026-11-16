const Dispatch=require('../models/OutreachDispatch');
const MailLog=require('../models/MailLog');
const Ledger=require('../models/DeliveryLedger');
const normalize=value=>String(value||'').trim().toLowerCase();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function senderQuotaKey(email){
  const value=normalize(email),[local,domain]=value.split('@');
  // Consumer Gmail aliases share a sending budget. Do not strip dots or tags
  // from custom/workspace domains, where they can identify different accounts.
  return ['gmail.com','googlemail.com'].includes(domain)?`${local.split('+')[0].replace(/\./g,'')}@gmail.com`:value;
}
function senderFilter(email){
  const key=senderQuotaKey(email);
  if(key.endsWith('@gmail.com')){
    const local=key.slice(0,-10).split('').map(escape).join('\\.?');
    return {senderEmail:{$regex:`^${local}(?:\\+[^@]*)?@(?:gmail|googlemail)\\.com$`,$options:'i'}};
  }
  return {senderEmail:{$regex:`^${escape(key)}$`,$options:'i'}};
}
const dayStart=now=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
async function dailyUsage({userId,campaignId,emails=[],now=new Date()}){
  const start=dayStart(now),end=new Date(+start+86400000),attempted={startedAt:{$gte:start,$lt:end}},legacy={sentAt:{$gte:start,$lt:end},status:{$in:['sent','delivered','bounced']},dispatchId:{$exists:false}};
  const logIds=await MailLog.distinct('_id',legacy),ledger={...legacy,originalMailLogId:{$nin:logIds}};
  const count=async scope=>{
    const [attempts,logs,archived]=await Promise.all([Dispatch.countDocuments({...attempted,...scope}),MailLog.countDocuments({...legacy,...scope}),Ledger.countDocuments({...ledger,...scope})]);
    return attempts+logs+archived;
  };
  const keys=[...new Set(emails.map(senderQuotaKey))];
  const [global,owner,campaign,senders]=await Promise.all([count({}),count({userId}),campaignId?Dispatch.countDocuments({...attempted,campaignId}):0,Promise.all(keys.map(async key=>[key,await count(senderFilter(key))]))]);
  return {global,owner,campaign,senders:Object.fromEntries(senders),start,nextReset:new Date(+start+86400000)};
}
module.exports={senderQuotaKey,senderFilter,dailyUsage,dayStart};

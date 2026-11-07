const dns=require('node:dns').promises;
const nodemailer=require('nodemailer');
const {isPublicIP}=require('./safePublicFetch');
const {normalizeEmail}=require('./campaignService');
async function sendScheduledMessage(sender,dispatch) {
  // Called only beyond the persisted send boundary and both feature gates.
  if(process.env.OUTREACH_SENDING_ENABLED!=='true'||process.env.OUTREACH_WORKER_ENABLED!=='true')throw new Error('Real scheduled sending disabled');
  if(![465,587].includes(sender.port))throw new Error('Scheduled SMTP requires TLS port 465 or STARTTLS port 587');
  const records=await dns.lookup(sender.host,{all:true,family:4});
  if(!records.length||records.some(r=>!isPublicIP(r.address)))throw new Error('SMTP sender resolves to unsupported/private destination');
  const address=records[0].address;
  const transport=nodemailer.createTransport({host:sender.host,port:sender.port,secure:sender.port===465,requireTLS:true,
    auth:{user:sender.config.user,pass:sender.config.pass},tls:{rejectUnauthorized:true,servername:sender.host},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,
    lookup:(_host,options,callback)=>callback(null,options?.all?[{address,family:4}]:address,options?.all?undefined:4)});
  try{
    const info=await transport.sendMail({from:{name:sender.name,address:sender.email},to:dispatch.recipientEmail,subject:dispatch.subject,text:dispatch.body,
      messageId:`<${dispatch.providerIdempotencyKey}@jobfinder.invalid>`,disableFileAccess:true,disableUrlAccess:true});
    if(!info.accepted?.some(a=>normalizeEmail(a)===dispatch.recipientEmail))throw new Error('Provider did not confirm recipient acceptance');
    return {providerMessageId:info.messageId};
  }finally{transport.close();}
}
module.exports={sendScheduledMessage};

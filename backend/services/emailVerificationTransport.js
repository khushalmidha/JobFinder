const dns = require('node:dns').promises;
const nodemailer = require('nodemailer');
const {isPublicIP} = require('./safePublicFetch');
async function sendVerificationCode(config, {recipient,code}) {
  if(!config.enabled || !config.configured)throw new Error('Trusted email verification disabled');
  let timer;
  const records = await Promise.race([dns.lookup(config.host,{all:true,family:4}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),5000);})]).finally(()=>clearTimeout(timer));
  if(!records.length || records.some(r=>!isPublicIP(r.address)))throw new Error('Unsupported verification sender destination');
  const address = records[0].address;
  const transport = nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:true,
    auth:{user:config.username,pass:config.password},tls:{rejectUnauthorized:true,servername:config.host},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
    lookup:(_host,options,callback)=>callback(null,options?.all?[{address,family:4}]:address,options?.all?undefined:4)});
  try {
    const result = await transport.sendMail({from:config.from,to:recipient,subject:'Verify your JobFinder account email',
      text:`Your JobFinder verification code is:\n\n${code}\n\nIt expires in 10 minutes. Enter it in Settings while signed in.\n\nIf you did not request this code, ignore this message. This code does not approve outreach, change your role or import companies.`,
      disableFileAccess:true,disableUrlAccess:true});
    if(!result.accepted?.some(email=>String(email).toLowerCase()===recipient.toLowerCase()))throw new Error('Sender did not accept verification recipient');
  } finally {transport.close();}
}
module.exports = {sendVerificationCode};

const dns = require('node:dns').promises;
const { ImapFlow } = require('imapflow');
const { isPublicIP } = require('./safePublicFetch');
const supported = {
  'smtp.gmail.com': 'imap.gmail.com', 'imap.gmail.com': 'imap.gmail.com',
  'smtp.office365.com': 'outlook.office365.com', 'outlook.office365.com': 'outlook.office365.com',
  'smtp-mail.outlook.com': 'outlook.office365.com'
};
async function mailboxOptions(config, resolve = dns.lookup) {
  const host = supported[String(config?.host || 'smtp.gmail.com').toLowerCase()];
  if (!host || !config?.user || !config?.pass) throw new Error('A supported Gmail or Microsoft mailbox and app password are required');
  let timer;
  const records = await Promise.race([resolve(host, { all: true, family: 4 }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Mailbox DNS timeout')), 5000); })]).finally(() => clearTimeout(timer));
  if (!records.length || records.some(r => !isPublicIP(r.address))) throw new Error('Private or unsupported mailbox destination');
  return { host: records[0].address, servername: host, port: 993, secure: true,
    auth: { user: config.user, pass: config.pass }, logger: false,
    tls: { rejectUnauthorized: true, servername: host },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    maxResponseSize: 2 * 1024 * 1024 };
}
async function createMailbox(config) { return new ImapFlow(await mailboxOptions(config)); }
module.exports = { createMailbox, mailboxOptions };

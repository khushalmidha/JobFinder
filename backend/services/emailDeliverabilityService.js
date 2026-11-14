const dns = require('node:dns').promises;
const mxCache = new Map();
const TTL = 60 * 60 * 1000;
function isValidEmailSyntax(email) {
  if (typeof email !== 'string' || email.length > 254) return false;
  const [local, domain, extra] = email.trim().split('@');
  return !extra && !!local && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) && !!domain && domain.split('.').length > 1 &&
    domain.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}
async function resolveDomainMx(domain, resolver = dns) {
  const key = String(domain || '').trim().toLowerCase();
  if (resolver === dns && mxCache.get(key)?.expires > Date.now()) return mxCache.get(key).result;
  const result = await require('./smtpConnectivityService').resolveAuditDomain(key,{resolver,timeoutMs:3000});
  if(result.status==='null_mx')return {valid:false,status:'invalid',error:'Domain explicitly declines email (Null MX)'};
  if(['mx_found','implicit_mx'].includes(result.status)) {
    const answer={valid:true,status:'domain_mail_capable',exchange:result.hosts[0],allExchanges:result.hosts};
    if(resolver===dns){if(mxCache.size>=2000)mxCache.delete(mxCache.keys().next().value);mxCache.set(key,{expires:Date.now()+TTL,result:answer});}
    return answer;
  }
  return {valid:false,status:'unknown',error:'Domain mail capability inconclusive; no mailbox check performed'};
}
async function validateEmail(email, { resolver = dns } = {}) {
  const clean = String(email || '').trim().toLowerCase();
  if (!isValidEmailSyntax(clean)) return { email: clean, isValid: false, status: 'invalid', reason: 'Invalid email syntax', mxHost: null };
  const mx = await resolveDomainMx(clean.split('@')[1], resolver);
  return { email: clean, isValid: mx.status === 'invalid' ? false : null, status: mx.status,
    reason: mx.valid ? 'Domain mail records found; individual mailbox existence is unknown' : mx.error,
    mxHost: mx.exchange || null };
}
async function testSmtpHandshake() {
  return { ok: false, status: 'unknown', note: 'Mailbox probing disabled. SMTP connectivity does not establish mailbox existence.' };
}
async function batchValidate(contacts, concurrency = 5) {
  const size = Math.max(1, Math.min(10, Math.floor(Number(concurrency) || 5)));
  const results = [];
  for (let i = 0; i < contacts.length; i += size) {
    results.push(...await Promise.all(contacts.slice(i, i + size).map(async c => ({ contactId: c._id, company: c.company, ...await validateEmail(c.email) }))));
  }
  return results;
}
module.exports = { validateEmail, resolveDomainMx, testSmtpHandshake, batchValidate, isValidEmailSyntax };

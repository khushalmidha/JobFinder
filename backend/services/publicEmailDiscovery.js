const dns = require('node:dns').promises;
const net = require('node:net');

const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ignored = /^(no-?reply|donotreply|postmaster|abuse|security|privacy|support|unsubscribe|billing|info)@/i;
const hiring = /\b(recruit|talent|careers?|jobs?|hiring|campus|staffing|hr)\b/i;
const maxBytes = 400000;
function normalizeDomain(domain) {
  const text = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split(':')[0];
  return /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) && !text.endsWith('.local') ? text : null;
}
function isPublicIP(ip) {
  if (net.isIP(ip) === 4) {
    const x=ip.split('.').map(Number);
    return !(x[0]===0 || x[0]===10 || x[0]===127 || x[0]>=224 ||
      (x[0]===100 && x[1]>=64 && x[1]<=127) ||
      (x[0]===169 && x[1]===254) ||
      (x[0]===172 && x[1]>=16 && x[1]<=31) ||
      (x[0]===192 && [0,168].includes(x[1])) ||
      (x[0]===198 && [18,19].includes(x[1])) ||
      (x[0]===198 && x[1]===51 && x[2]===100) ||
      (x[0]===203 && x[1]===0 && x[2]===113));
  }
  if (net.isIP(ip) === 6) {
    const v=ip.toLowerCase();
    return !(v==='::1'||v==='::'||v.startsWith('fe80:')||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('ff')||v.startsWith('2001:db8:')||v.startsWith('::ffff:'));
  }
  return false;
}
async function safeHost(host) {
  const found=await dns.lookup(host,{all:true});
  return found.length > 0 && found.every(({address}) => isPublicIP(address));
}
function extractEmails(html,url,domain) {
  const results=[];
  const plain=String(html||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&')
    .replace(/&#64;|&commat;/gi,'@').replace(/&nbsp;/gi,' ');
  const mailtos=[...String(html||'').matchAll(/mailto:([^"'?\s<>]+)/gi)].map(m=>decodeURIComponent(m[1]));
  const values=[...plain.matchAll(emailRe)].map(m=>m[0]).concat(mailtos);
  for(const raw of values) {
    const email=String(raw).trim().toLowerCase().replace(/[.,;:]$/,'');
    const host=email.split('@')[1];
    if(!host || !(host===domain || host.endsWith('.'+domain)) || ignored.test(email)) continue;
    const score=hiring.test(email.split('@')[0])?85:hiring.test(plain)?55:25;
    if(score<50) continue;
    if(!results.some(x=>x.email===email)) results.push({email,score,sourceUrl:url,verification:'publicly_listed_not_mailbox_verified'});
  }
  return results;
}
async function fetchCompanyEmails(domain,{timeout=6500}={}) {
  domain=normalizeDomain(domain);
  if(!domain) return {emails:[],reason:'Provide a valid company domain'};
  const hosts=[domain,'www.'+domain];
  const found=new Map();
  for(const host of hosts) {
    if(!(await safeHost(host).catch(()=>false))) continue;
    for(const route of ['/careers','/jobs','/contact','/']) {
      const url='https://'+host+route;
      try {
        // No redirects, credentials, arbitrary URLs, or cross-domain crawling.
        const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{'Accept':'text/html'}});
        if(!response.ok || !String(response.headers.get('content-type')||'').includes('text/html')) continue;
        const length=Number(response.headers.get('content-length')||0);
        if(length>maxBytes) continue;
        const html=(await response.text()).slice(0,maxBytes);
        for(const item of extractEmails(html,url,domain)) {
          const prev=found.get(item.email);
          if(!prev||prev.score<item.score) found.set(item.email,item);
        }
      } catch (_) { /* Unavailable page, retain other sources. */ }
    }
  }
  return {emails:[...found.values()].sort((a,b)=>b.score-a.score).slice(0,30)};
}
module.exports={normalizeDomain,extractEmails,fetchCompanyEmails,isPublicIP};

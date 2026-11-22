const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
function isPublicIP(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && [0,168].includes(b)) ||
      (a===198 && [18,19].includes(b)) || (a===198 && b===51 && c===100) || (a===203 && b===0 && c===113));
  }
  // IPv6 destinations are conservatively unsupported, including mapped IPv4.
  return false;
}
async function fetchPublicPage(url, { timeout = 5000, maxBytes = 400000, accept = 'text/html,text/plain' } = {}) {
  const started = Date.now();
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) throw new Error('Only public HTTPS pages supported');
  let dnsTimer;
  const records = await Promise.race([
    dns.lookup(target.hostname, { all: true, family: 4 }),
    new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS lookup timeout')), timeout); })
  ]).finally(() => clearTimeout(dnsTimer));
  if (!records.length || records.some(r => !isPublicIP(r.address))) throw new Error('Private/reserved network destination blocked');
  const address = records[0].address;
  return new Promise((resolve, reject) => {
    const request = https.get(target, { agent: false,
      headers: { 'User-Agent': 'JobFinderResearch/1.0', Accept: accept },
      lookup: (_host, options, callback) => callback(null, options?.all ? [{ address, family: 4 }] : address, options?.all ? undefined : 4)
    }, response => {
      let bytes = 0; const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(new Error('Response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, contentType: response.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8'),...(response.headers.location?{location:response.headers.location}:{}) }));
    });
    const timer = setTimeout(() => request.destroy(new Error('Request timeout')), Math.max(1, timeout - (Date.now() - started)));
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}
// Apply only the matching product-token group (or * fallback), using the
// longest path rule; equally specific Allow wins (RFC 9309, section 2.2).
// A headerless Disallow is still honored conservatively for malformed files.
function robotsAllows(body, path, productToken = 'JobFinderResearch') {
  const groups=[];let group={agents:[],rules:[]},hasRules=false;
  for(const raw of String(body||'').split(/\r?\n/)) {
    const match=raw.replace(/#.*/, '').match(/^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/i);
    if(!match)continue;const key=match[1].toLowerCase(),value=match[2];
    if(key==='user-agent') {
      if(hasRules){groups.push(group);group={agents:[],rules:[]};hasRules=false;}
      group.agents.push(value.toLowerCase());
    } else if(value){group.rules.push({allow:key==='allow',value});hasRules=true;}
  }
  groups.push(group);
  const token=productToken.toLowerCase(),specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&token.includes(a)));
  const selected=specific.length?specific:groups.filter(g=>!g.agents.length||g.agents.includes('*'));
  const normalize=value=>String(value).replace(/%([0-9a-f]{2})/gi,(raw,hex)=>/[a-z0-9._~-]/i.test(String.fromCharCode(parseInt(hex,16)))?String.fromCharCode(parseInt(hex,16)):raw.toUpperCase()).replace(/[^\x00-\x7F]/g,char=>encodeURIComponent(char));
  path=normalize(path);
  // Greedy wildcard matching is linear and cannot backtrack exponentially on
  // an untrusted robots pattern. Non-terminal rules implicitly match prefixes.
  const matchesRule=(raw,value)=>{
    let pattern=normalize(raw),anchored=pattern.endsWith('$');if(anchored)pattern=pattern.slice(0,-1);else pattern+='*';
    let i=0,j=0,star=-1,mark=0;
    while(i<value.length){if(j<pattern.length&&pattern[j]===value[i]){i++;j++;}else if(pattern[j]==='*'){star=j++;mark=i;}else if(star!==-1){j=star+1;i=++mark;}else return false;}
    while(pattern[j]==='*')j++;return j===pattern.length;
  };
  let best=-1,allowed=true;
  for(const rule of selected.flatMap(g=>g.rules)) {
    const matches=matchesRule(rule.value,path);
    const length=Buffer.byteLength(rule.value.replace(/[*$]/g,''));
    if(matches&&(length>best||(length===best&&rule.allow))){best=length;allowed=rule.allow;}
  }
  return allowed;
}
module.exports = { isPublicIP, fetchPublicPage, robotsAllows };

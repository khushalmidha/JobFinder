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
async function fetchPublicPage(url, { timeout = 5000, maxBytes = 400000 } = {}) {
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
      headers: { 'User-Agent': 'JobFinderResearch/1.0', Accept: 'text/html,text/plain' },
      lookup: (_host, options, callback) => callback(null, options?.all ? [{ address, family: 4 }] : address, options?.all ? undefined : 4)
    }, response => {
      let bytes = 0; const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(new Error('Response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, contentType: response.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8') }));
    });
    const timer = setTimeout(() => request.destroy(new Error('Request timeout')), Math.max(1, timeout - (Date.now() - started)));
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}
// Conservative robots handling: honor every Disallow, including unsupported
// wildcard directives. Never infer permission from an unreachable robots file.
function robotsAllows(body, path) {
  for (const line of body.split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').match(/^\s*disallow\s*:\s*(\S+)/i);
    if (!match) continue;
    const rule = match[1];
    if (rule.includes('*') || rule.includes('$') || path.startsWith(rule)) return false;
  }
  return true;
}
module.exports = { isPublicIP, fetchPublicPage, robotsAllows };

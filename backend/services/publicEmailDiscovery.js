const { fetchPublicPage, robotsAllows, isPublicIP: publicAddress } = require('./safePublicFetch');

const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ignored = /^(no-?reply|donotreply|postmaster|abuse|security|privacy|support|unsubscribe|billing|info)@/i;
const hiring = /(^|[._-])(recruit(?:ing|ment|er)?|talent|careers?|jobs?|hiring|campus|staffing|hr)([._-]|$)/i;
const maxBytes = 400000;
function normalizeDomain(domain) {
  const text = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split(':')[0];
  return /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) && !text.endsWith('.local') ? text : null;
}
function extractEmails(html,url,domain) {
  const results=[];
  const plain=String(html||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&')
    .replace(/&#64;|&commat;/gi,'@').replace(/&nbsp;/gi,' ');
  const mailtos=[...String(html||'').matchAll(/mailto:([^"'?\s<>]+)/gi)].flatMap(m=> { try { return [decodeURIComponent(m[1])]; } catch { return []; } });
  const values=[...plain.matchAll(emailRe)].map(m=>m[0]).concat(mailtos);
  for(const raw of values) {
    const email=String(raw).trim().toLowerCase().replace(/[.,;:]$/,'');
    const host=email.split('@')[1];
    if(!host || !(host===domain || host.endsWith('.'+domain)) || ignored.test(email)) continue;
    // Page-wide hiring words do not establish that an arbitrary person's
    // address is a recruiting contact. Generic professional inboxes only.
    const score=hiring.test(email.split('@')[0])?85:25;
    if(score<50) continue;
    if(!results.some(x=>x.email===email)) results.push({email,score,sourceUrl:url,verification:'publicly_listed_not_mailbox_verified'});
  }
  return results;
}

const cache = new Map();
async function fetchCompanyEmails(domain, { timeout = 5000, fetchPage = fetchPublicPage, maxRequests = 5, maxRuntimeSeconds = 30, shouldStop = () => process.env.RESEARCH_STOP === 'true' } = {}) {
  domain = normalizeDomain(domain);
  if (!domain) return { emails: [], reason: 'Provide a valid company domain', requestsUsed: 0 };
  if (await shouldStop()) return { emails: [], reason: 'Research is stopped', requestsUsed: 0 };
  const previous = cache.get(domain);
  if (fetchPage === fetchPublicPage && previous?.expires > Date.now()) return { ...previous.result, cached: true, requestsUsed: 0 };
  let requestsUsed = 0; const found = new Map(); const errors = [];
  const started = Date.now();
  maxRequests = Math.max(1, Math.min(5, Number(maxRequests) || 5));
  async function get(path) {
    const remaining = Math.max(0, Math.min(120, Number(maxRuntimeSeconds) || 30) * 1000 - (Date.now() - started));
    if (await shouldStop() || requestsUsed >= maxRequests || remaining <= 0) throw new Error('Run request/runtime limit or stop reached');
    requestsUsed++;
    return fetchPage(`https://${domain}${path}`, { timeout: Math.min(timeout, remaining), maxBytes });
  }
  let robots;
  try {
    robots = await get('/robots.txt');
    if (robots.status !== 404 && robots.status !== 200) throw new Error('Robots permission unavailable');
  } catch (error) { return { emails: [], reason: error.message, requestsUsed }; }
  for (const path of ['/careers', '/jobs', '/contact', '/']) {
    if (robots.status === 200 && !robotsAllows(robots.text, path)) continue;
    try {
      const response = await get(path);
      if (response.status !== 200 || !response.contentType.includes('text/html')) continue;
      for (const item of extractEmails(response.text, `https://${domain}${path}`, domain)) found.set(item.email, item);
    } catch (error) { errors.push(error.message); }
    if (fetchPage === fetchPublicPage) await new Promise(resolve => setTimeout(resolve, 250));
  }
  const result = { emails: [...found.values()].slice(0, 30), requestsUsed, reason: errors.length ? errors.join('; ') : found.size ? null : 'No public recruiting inbox found in checked pages' };
  if (fetchPage === fetchPublicPage) {
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(domain, { expires: Date.now() + 86400000, result });
  }
  return result;
}
module.exports = { normalizeDomain, extractEmails, fetchCompanyEmails, isPublicIP: publicAddress };

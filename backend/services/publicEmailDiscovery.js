const { fetchPublicPage, robotsAllows, isPublicIP: publicAddress } = require('./safePublicFetch');
const { linkedBoards, extractPostingContacts, isEmployerPage } = require('./publishedAtsContacts');

const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ignored = /^(no-?reply|donotreply|postmaster|abuse|security|privacy|support|unsubscribe|billing|info)@/i;
const hiring = /(^|[._-])(recruit(?:ing|ment|er)?|talent|careers?|jobs?|hiring|campus|staffing|hr|hrconnect|humancapital)([._-]|$)/i;
const maxBytes = 1500000; // Bounded modern company pages often exceed 400KB.
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

const forbiddenHosts=['linkedin.com','apollo.io','hunter.io','getprospect.com','snov.io','rocketreach.co','contactout.com','lusha.com','zoominfo.com'];
const personalDomains = new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.in','hotmail.com','outlook.com','proton.me','protonmail.com','pm.me','icloud.com','me.com','mac.com','aol.com','msn.com','live.com','rediffmail.com','gmx.com','gmx.net','ymail.com','rocketmail.com','mail.com','yandex.com','tutanota.com','tuta.com','fastmail.com','outlook.in']);
function allowedDiscoveryDomain(domain){return !!domain&&!forbiddenHosts.some(host=>domain===host||domain.endsWith('.'+host))&&![...personalDomains].some(host=>domain===host||domain.endsWith('.'+host));}
function extractProfessionalEmails(html,url,domain){
  const found=new Map(extractEmails(html,url,domain).map(row=>[row.email,{...row,kind:'role_inbox',name:'',title:'Public recruiting inbox',confidence:'published'}]));
  const blocks=String(html||'').match(/<(?:p|li|article)\b[^>]*>[\s\S]*?<\/(?:p|li|article)>/gi)||[];
  for(const block of blocks){
    const text=block.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#64;|&commat;/g,'@').replace(/\s+/g,' ');
    const values=[...text.matchAll(emailRe)].map(m=>m[0]).concat([...block.matchAll(/mailto:([^"'?\s<>]+)/gi)].map(m=>{try{return decodeURIComponent(m[1]);}catch{return '';}}));
    // Multiple distinct addresses in one paragraph make person/title attribution
    // ambiguous; generic recruiting inboxes were already extracted separately.
    if(new Set(values.map(value=>value.trim().toLowerCase())).size!==1)continue;
    for(const value of values){
      const email=value.toLowerCase(),host=email.split('@')[1];
      if(!host||personalDomains.has(host)||!(host===domain||host.endsWith('.'+domain))||ignored.test(email)||hiring.test(email.split('@')[0]))continue;
      const index=text.toLowerCase().indexOf(email);const nearby=index>=0?text.slice(Math.max(0,index-160),index+email.length+100):text.length<=250?text:'';
      const title=nearby.match(/\b(?:technical recruiter|university recruiter|campus recruiter|talent acquisition(?: specialist| partner| manager)?|recruiting manager|recruiter|hiring manager|engineering manager.{0,35}hiring|software engineer|software developer|sde|backend engineer|frontend engineer)\b/i)?.[0];
      if(!title)continue;
      const name=nearby.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})\s*(?:[,|—-]\s*)?(?:Technical Recruiter|University Recruiter|Campus Recruiter|Talent Acquisition|Recruiting Manager|Hiring Manager|Software Engineer|Software Developer|SDE|Backend Engineer|Frontend Engineer)\b/)?.[1]||'';
      found.set(email,{email,sourceUrl:url,kind:require('./professionalPatternService').kindForTitle(title)||'recruiter',name,title,confidence:'published_context',score:80,verification:'publicly_listed_not_mailbox_verified'});
    }
  }
  return [...found.values()];
}
function linkedPages(html,base,domain,{fallback=false}={}){
  const links=[];
  for(const match of String(html||'').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const target=new URL(match[1],base);if(target.protocol!=='https:'||!isEmployerPage(target.hostname,domain)||target.port||target.username||target.password||target.search)continue;
      target.hash='';if((fallback?/career|jobs?|contact|vacanc|work.with.us|join.us/i:/career|jobs?|contact|talent|recruit|hiring|vacanc|team|people|about|engineering/i).test(target.pathname+' '+match[2]))links.push(target.href);
    }catch{}
  }
  const priority=value=>/career|jobs?|vacanc/i.test(new URL(value).host+new URL(value).pathname)?0:/recruit|talent|hiring|team/i.test(new URL(value).pathname)?1:2;
  return [...new Set(links)].sort((a,b)=>priority(a)-priority(b));
}
const cache=new Map();
async function fetchCompanyEmails(domain,{timeout=5000,fetchPage=fetchPublicPage,preferredUrl,maxRequests=5,maxRuntimeSeconds=30,shouldStop=()=>process.env.RESEARCH_STOP==='true'}={}){
  domain=normalizeDomain(domain);
  if(!allowedDiscoveryDomain(domain))return {emails:[],reason:'Provide a professional employer domain',requestsUsed:0};
  if(await shouldStop())return {emails:[],reason:'Research is stopped',requestsUsed:0};
  maxRequests=Math.max(1,Math.min(20,Number(maxRequests)||5));
  let preferred;
  try {
    const url=new URL(preferredUrl);
    if(isEmployerPage(url.hostname,domain) && url.protocol==='https:' && !url.port && !url.username && !url.password &&
      /career|jobs?|hiring|join|recruit|contact/i.test(url.pathname)) {
      url.hash='';
      preferred=url.href;
    }
  } catch { /* No mapped public careers page. */ }
  const cacheKey=JSON.stringify([domain,maxRequests,preferred]),previous=cache.get(cacheKey);
  if(fetchPage===fetchPublicPage&&previous?.expires>Date.now())return {...previous.result,cached:true,requestsUsed:0};
  let requestsUsed=0;const errors=[],found=new Map(),people=new Map(),visited=new Set(),started=Date.now(),permissions=new Map(),boardsChecked=new Set();
  const approvedUrl=value=>{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!isEmployerPage(url.hostname,domain)||/\/(?:login|signin|auth|captcha)(?:\/|$)/i.test(url.pathname))throw Error('Unsupported redirect destination');
    url.hash='';return url;
  };
  async function raw(url,accept){
    if(await shouldStop()||requestsUsed>=maxRequests)throw Error('Run request limit or stop reached');
    const remaining=Math.min(120,Number(maxRuntimeSeconds)||30)*1000-(Date.now()-started);if(remaining<=0)throw Error('Runtime limit reached');
    requestsUsed++;return fetchPage(url.href,{timeout:Math.min(timeout,remaining),maxBytes,accept});
  }
  async function permission(host){
    if(permissions.has(host))return permissions.get(host);
    const seenHosts=[host];let url=approvedUrl(`https://${host}/robots.txt`),body=null;
    try{
      for(let redirects=0;redirects<=2;redirects++){
        const response=await raw(url);
        if([301,302,303,307,308].includes(response.status)){
          if(!response.location||redirects===2)throw Error('Robots redirect limit');
          url=approvedUrl(new URL(response.location,url));if(url.pathname!=='/robots.txt')throw Error('Robots redirected outside robots path');seenHosts.push(url.hostname);continue;
        }
        if(response.status===200&&!String(response.contentType).includes('text/html'))body=response.text;
        break;
      }
    }catch(error){errors.push(error.message);}
    for(const name of seenHosts)permissions.set(name,body);return body;
  }
  async function page(url){
    for(let redirects=0;redirects<=2;redirects++){
      const robots=await permission(url.hostname);
      if(robots!==null&&!robotsAllows(robots,url.pathname+url.search))throw Error('Robots disallows redirect destination');
      const response=await raw(url);
      if(![301,302,303,307,308].includes(response.status))return {...response,url:url.href};
      if(!response.location||redirects===2)throw Error('Page redirect limit reached');
      url=approvedUrl(new URL(response.location,url));
    }
  }
  const robots=await permission(domain),limited=robots===null,queue=[`https://${domain}/`];let linkedFallback=false,pagesRead=0;
  if(preferred && robots!==null){
    const hint=new URL(preferred);
    if(hint.hostname===domain || await permission(hint.hostname)!==null)queue.unshift(preferred);
  }
  if(queue.length===1&&robots!==null&&!robotsAllows(robots,'/'))return {emails:[],reason:'Robots disallows discovery',pagesRead:0,requestsUsed};
  while(queue.length&&requestsUsed<maxRequests){
    const address=queue.shift();if(visited.has(address))continue;visited.add(address);
    try{
      const response=await page(approvedUrl(address));if(response.status!==200)continue;
      const finalUrl=new URL(response.url);
      if(response.contentType.includes('text/html')){
        pagesRead++;
        for(const row of extractProfessionalEmails(response.text,response.url,domain))if(!found.has(row.email))found.set(row.email,row);
        for(const person of require('./professionalPatternService').extractPeople(response.text,response.url,domain)){people.set(person.name,person);if(person.email)found.set(person.email,{...person,confidence:'published_context',verification:'publicly_listed_not_mailbox_verified'});}
        for (const board of !limited ? linkedBoards(response.text, response.url) : []) {
          if (boardsChecked.size >= 2 || requestsUsed >= maxRequests) break;
          if (boardsChecked.has(board.endpoint.url)) continue;
          boardsChecked.add(board.endpoint.url);
          try {
            const feed = await raw(new URL(board.endpoint.url), 'application/json');
            if (feed.status === 200) for (const contact of extractPostingContacts(feed, board, domain, extractProfessionalEmails)) {
              if (!found.has(contact.email)) found.set(contact.email, contact);
            }
          } catch (error) { errors.push(error.message); }
        }
        const links=linkedPages(response.text,response.url,domain,{fallback:limited});
        if(limited){if(visited.size===1&&!linkedFallback&&links.length){queue.push(links.includes(preferred)?preferred:links[0]);linkedFallback=true;}}
        else queue.push(...links);
      }else if(!limited&&/xml|text/.test(response.contentType)&&/sitemap/.test(finalUrl.pathname)){
        for(const match of response.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)){
          try{const target=approvedUrl(match[1]);if(!target.search&&/career|jobs?|contact|talent|recruit|hiring/i.test(target.pathname))queue.unshift(target.href);}catch{}
        }
      }
      if(!limited&&finalUrl.pathname==='/'&&address===`https://${domain}/`)queue.push(...['/sitemap.xml','/careers','/jobs','/contact'].map(path=>new URL(path,finalUrl.origin).href));
    }catch(error){errors.push(error.message);}
    if(fetchPage===fetchPublicPage&&queue.length&&requestsUsed<maxRequests)await new Promise(resolve=>setTimeout(resolve,500));
  }
  const inferred=require('./professionalPatternService').inferCandidates({people:[...people.values()],published:[...found.values()],domain});
  const result={pagesRead,people:[...people.values()].filter(person=>!person.email).slice(0,100),emails:[...found.values(),...inferred].slice(0,100),requestsUsed,limitedByRobots:limited,pagesVisited:[...visited],reason:errors.length?errors.join('; '):found.size?null:'No published professional recruiting contacts found in checked pages'};
  if(fetchPage===fetchPublicPage){if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(cacheKey,{expires:Date.now()+86400000,result});}
  return result;
}
module.exports={allowedDiscoveryDomain,normalizeDomain,extractEmails,extractProfessionalEmails,linkedPages,fetchCompanyEmails,isPublicIP:publicAddress};

const { postingEvidence } = require('./jobPostingEvidence');
const crypto=require('node:crypto');
const Task=require('../models/CareerWatchTask'),Config=require('../models/CareerWatchConfig'),Job=require('../models/CareerWatchJob'),Notification=require('../models/CareerWatchNotification');
const {fetchPublicPage,robotsAllows}=require('./safePublicFetch');
const INTERVAL_MS=5*3600000;
function clean(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
function publicUrl(value,base){try{const u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||/(^|\.)linkedin\.com$/i.test(u.hostname))return null;u.hash='';return u.href;}catch{return null;}}
function classifyRole(title='',description=''){
 const t=clean(title).toLowerCase(),text=clean(title+' '+description).toLowerCase();
 if(!/software|developer|\bsde\b|backend|front.?end|full.?stack|machine learning|\bai\b|\bml\b|data scientist|data engineer|quant|product manager|\bapm\b|applied scientist/.test(t))return {eligibility:'excluded',eligibilityReason:'Not a target software/AI/ML role',track:'other'};
 if(/\b(senior|sr\.?|staff|principal|director|manager|architect|lead)\b/.test(t))return {eligibility:'excluded',eligibilityReason:'Senior role',track:'fte'};
 const ranges=[...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:-|\u2013|\u2014|to)\s*(\d+(?:\.\d+)?)\s*years?\b/g)],range=ranges[0];
 const minima=[...text.matchAll(/(?:at least|minimum(?: of)?|min\.?|requires?)\s*(\d+(?:\.\d+)?)\s*(?:\+\s*)?years?\b|\b(\d+(?:\.\d+)?)\s*\+\s*years?\b/g)],minimum=minima[0];
 const bareMatches=[...text.matchAll(/\b(\d+(?:\.\d+)?)\s*years?\s+(?:of\s+)?(?:(?:relevant|professional|work)\s+)*experience/g)].filter(match=>{
  // Range upper bounds and explicit upper limits are not required minima.
  if(ranges.some(r=>match.index>=r.index&&match.index<r.index+r[0].length))return false;
  return !/(?:less than|under|up to|at most)\s*$/.test(text.slice(Math.max(0,match.index-20),match.index));
 }),bare=bareMatches[0];
 const evidence=[...ranges.map(m=>({years:Number(m[1]),text:m[0]})),...minima.map(m=>({years:Number(m[1]||m[2]),text:m[0]})),...bareMatches.map(m=>({years:Number(m[1]),text:m[0]}))].filter(m=>m.years<=60).sort((a,b)=>b.years-a.years);
 if(evidence.length&&evidence[0].years>=1)return {eligibility:'excluded',eligibilityReason:'Requires at least one year of experience',track:'fte',experienceEvidence:evidence[0].text};
 const intern=/\bintern(?:ship)?\b/.test(text);
 if(intern){
  const six=/(?:\b6|\bsix)\s*[- ]?\s*months?\b/.test(text);
  const conversion=/\b(?:conversion|convert(?:ed)?|ppo|pre.?placement offer)\b/.test(text)&&(/full.?time|\bfte\b|\bppo\b|pre.?placement offer/.test(text))||/\bintern(?:ship)?\b.{0,80}\+.{0,25}(?:\bfte\b|full.?time)/.test(text);
  const negatedConversion=/\b(?:no|not|without|never|cannot|can't|won't)\b[^.;]{0,55}\b(?:ppo|conversion|convert(?:ed)?|pre.?placement offer|full.?time|fte)\b|\b(?:ppo|conversion|pre.?placement offer)\b[^.;]{0,25}\b(?:unavailable|not offered|not available|not guaranteed)\b/.test(text);
  const eligible=six&&conversion&&!negatedConversion;
  return {eligibility:eligible?'eligible':'needs_review',eligibilityReason:eligible?'Explicit six-month internship with FTE/PPO conversion':negatedConversion?'FTE/PPO conversion is negated or not confirmed':'Internship duration or FTE conversion not explicit',track:'internship_fte',experienceEvidence:(range||minimum||bare)?.[0]||''};
 }
 if(/\bpart.?time\b|\bcontract(?:or)? role\b|\btemporary (?:position|role)\b/.test(text))return {eligibility:'needs_review',eligibilityReason:'Full-time employment not confirmed',track:'fte'};
 const fresher=/\bfresher|\bnew.?grad|\bgraduate (?:software|engineer|program|role)|\bno (?:prior )?(?:work )?experience|\b0\s*years?\b/.test(text);
 if(fresher||(range&&Number(range[1])===0&&Number(range[2])<=1)||/less than (?:one|1) year|under (?:one|1) year|0\s*[-\u2013\u2014]\s*11\s*months?/.test(text))return {eligibility:'eligible',eligibilityReason:'Explicit fresher or under-one-year eligibility',track:'fte',experienceEvidence:(range||minimum||bare)?.[0]||'Explicit fresher language'};
 return {eligibility:'needs_review',eligibilityReason:'Entry experience requirement not sufficiently explicit',track:'fte',experienceEvidence:(range||minimum||bare)?.[0]||''};
}
const INDIA_LOCATION = /\bindia\b|\b(?:bengaluru|bangalore|hyderabad|pune|mumbai|chennai|noida|gurugram|gurgaon|delhi|kolkata|ahmedabad|kochi|coimbatore|indore|jaipur|chandigarh|trivandrum|thiruvananthapuram|mysore)\b|^IN$/i;
function locationRegion(location){
 const text=String(location||'').trim();
 if(INDIA_LOCATION.test(text))return 'India';
 if(/\b(?:united states|united kingdom|usa|uk|canada|germany|singapore|japan|australia|france|amsterdam|london|san francisco|new york|seattle|toronto|berlin|munich|tokyo|sydney|dublin|zurich|dubai|emea)\b/i.test(text))return 'overseas';
 return 'unknown';
}
function jobLocation(value,depth=0){
 if(depth>8||!value)return '';if(typeof value==='string')return value;if(Array.isArray(value))return value.map(v=>jobLocation(v,depth+1)).filter(Boolean).join('; ');
 if(value.address)return jobLocation(value.address,depth+1);
 return [value.addressLocality,value.addressRegion,typeof value.addressCountry==='object'?value.addressCountry.name:value.addressCountry].filter(Boolean).join(', ');
}
function links(html,base){return [...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>publicUrl(m[1].replace(/&amp;/g,'&'),base)).filter(Boolean);}
function atsEndpoint(url){
 const u=new URL(url),parts=u.pathname.split('/').filter(Boolean),token=parts[0];if(!token||!/^[-a-z0-9_]+$/i.test(token))return null;
 if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(u.hostname))return {type:'greenhouse',url:'https://boards-api.greenhouse.io/v1/boards/'+token+'/jobs?content=true'};
 if(['jobs.lever.co','jobs.eu.lever.co'].includes(u.hostname))return {type:'lever',url:'https://'+(u.hostname==='jobs.eu.lever.co'?'api.eu.lever.co':'api.lever.co')+'/v0/postings/'+token+'?mode=json'};
 if(u.hostname==='jobs.ashbyhq.com')return {type:'ashby',url:'https://api.ashbyhq.com/posting-api/job-board/'+token};
 return null;
}
function requisitionFromUrl(value) {
 const publicAddress = publicUrl(value);
 if (!publicAddress) return null;
 const url = new URL(publicAddress);
 const host = url.hostname;
 const greenhouse = ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host);
 const lever = ['jobs.lever.co','jobs.eu.lever.co'].includes(host);
 const match = greenhouse ? url.pathname.match(/^\/([a-z0-9_-]+)\/jobs\/(\d+)\/?$/i)
   : lever ? url.pathname.match(/^\/([a-z0-9_-]+)\/([a-f0-9-]{36})(?:\/apply)?\/?$/i) : null;
 if (!match) return null;
 return { key: [greenhouse ? 'greenhouse' : host, match[1].toLowerCase(), match[2].toLowerCase()].join(':'), id: match[2] };
}
async function saveCareerJob(userId, values, now) {
 const { url } = values;
 const requisition = requisitionFromUrl(url);
 let filter = {userId,url};
 if (requisition) {
  const existing = await Job.findOne({userId,requisitionKey:requisition.key}).select('_id').lean();
  // Adopt an older URL-only row if the stable identity can be recovered from its URL.
  const legacy = existing ? [] : await Job.find({
   userId, requisitionKey:{$exists:false}, url:{$regex:'/'+requisition.id+'(?:/|[?#]|$)',$options:'i'}
  }).sort({firstSeenAt:1,_id:1}).select('url').lean();
  const match = existing || legacy.find(row=>requisitionFromUrl(row.url)?.key===requisition.key);
  filter = match ? {userId,_id:match._id} : {userId,requisitionKey:requisition.key};
  values.requisitionKey = requisition.key;
 }
 if (requisition && filter._id && await Job.exists({userId,url,_id:{$ne:filter._id}})) {
  values.applyUrl ||= url;
  delete values.url;
 }
 const update = {$set:values,$setOnInsert:{firstSeenAt:now}};
 try {
  return await Job.findOneAndUpdate(filter,update,{upsert:!filter._id,returnDocument:'after'});
 } catch(error) {
  if (!requisition || error.code!==11000) throw error;
  const winner = await Job.findOneAndUpdate({userId,requisitionKey:requisition.key},update,{returnDocument:'after'});
  if (!winner) throw error;
  return winner;
 }
}
function postingExpiry(value) {
 const isoDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? new Date(value) : null;
 return Number.isFinite(isoDate?.getTime()) ? isoDate : undefined;
}
function parseJobs(response,url,type){
 const out=[];
 if(type){let data;try{data=JSON.parse(response.text);}catch{return out;}
  for(const row of (Array.isArray(data)?data:data.jobs||[])){
   const jobUrl=publicUrl(row.absolute_url||row.hostedUrl||row.jobUrl||row.url,url);if(!jobUrl)continue;
   out.push({url:jobUrl,title:clean(row.title||row.text),description:clean(row.content||row.descriptionPlain||row.descriptionHtml||row.description||'')+' '+clean(row.employmentType||row.categories?.commitment||'').replaceAll('_',' '),location:clean(row.location?.name||row.categories?.location||row.location||''),sourceType:type,applyUrl:publicUrl(row.applyUrl||jobUrl,url),employmentType:row.employmentType||row.categories?.commitment,leverRange:type==='lever'?row.salaryRange:undefined});
  }
 }else{
  const walk=value=>{if(Array.isArray(value)){value.forEach(walk);return;}if(!value||typeof value!=='object')return;
   if([].concat(value['@type']||[]).includes('JobPosting')){const jobUrl=publicUrl(value.url||value['@id']||url,url);if(jobUrl)out.push({url:jobUrl,title:clean(value.title),description:clean(value.description)+' '+clean(value.employmentType).replaceAll('_',' '),location:clean(jobLocation(value.jobLocation)||value.jobLocationType||''),sourceType:'official_jsonld',employmentType:[].concat(value.employmentType||[]).join(' '),baseSalary:value.baseSalary,validThrough:postingExpiry(value.validThrough)});}
   if(value['@graph'])walk(value['@graph']);
  };
  for(const match of String(response.text).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{walk(JSON.parse(match[1]));}catch{}
 }
 return out.map(({baseSalary,leverRange,...job})=>({...job,...postingEvidence({...job,baseSalary,leverRange})}));
}
// The official Greenhouse endpoint returns all published posts with a total.
function fullGreenhouseBoard(response, url) {
 const board = new URL(url).pathname.match(/^\/v1\/boards\/([a-z0-9_-]+)\/jobs$/i)?.[1];
 if (!board || new URL(url).hostname!=='boards-api.greenhouse.io') return null;
 let data;
 try { data=JSON.parse(response.text); } catch { return null; }
 if (!Array.isArray(data?.jobs) || data.meta?.total!==data.jobs.length) return null;
 const scope='greenhouse:'+board.toLowerCase()+':';
 const keys = data.jobs.map(row=>Number.isSafeInteger(row?.id)&&row.id>0 ? scope+row.id : null);
 return keys.includes(null)||new Set(keys).size!==keys.length ? null : {scope,keys};
}
async function reconcileGreenhouseBoard(userId, board, now) {
 const scope = {userId,requisitionKey:{$regex:'^'+board.scope}};
 await Job.updateMany({...scope,requisitionKey:{$in:board.keys,$regex:'^'+board.scope}},
  {$unset:{boardMissingSince:1,closedAt:1}});
 const missing={...scope,requisitionKey:{$nin:board.keys,$regex:'^'+board.scope},closedAt:null};
 await Job.updateMany({...missing,boardMissingSince:{$lte:new Date(+now-INTERVAL_MS)}},{$set:{closedAt:now}});
 await Job.updateMany({...missing,boardMissingSince:null},{$set:{boardMissingSince:now}});
}
async function collectCompanyJobs(task,{fetchPage=fetchPublicPage,maxRequests=12,maxRuntimeSeconds=30,shouldStop=()=>process.env.RESEARCH_STOP==='true',delayMs=fetchPage===fetchPublicPage?250:0}={}){
 const start=Date.now(),robots=new Map(),seen=new Set(),jobs=new Map(),errors=[],completeBoards=[];let requestsUsed=0;
 if(task.portalStatus==='needs_portal_mapping')return {jobs:[],requestsUsed:0,errors:['Official careers portal mapping required'],status:'needs_portal_mapping',unsupported:true};
 const initial=publicUrl(task.careersUrl||'https://'+task.domain+'/');if(!initial)return {jobs:[],requestsUsed:0,errors:['Invalid careers URL'],status:'unsupported'};
 const root=new URL(initial).hostname;
 const raw=async url=>{if(await shouldStop()||requestsUsed>=maxRequests||Date.now()-start>=maxRuntimeSeconds*1000)throw Error('Request/runtime budget or stop reached');requestsUsed++;if(delayMs)await new Promise(r=>setTimeout(r,delayMs));return fetchPage(url,{timeout:Math.min(5000,Math.max(1,maxRuntimeSeconds*1000-(Date.now()-start))),maxBytes:1500000});};
 const get=async(url,{api=false}={})=>{
  const u=new URL(url);let permission=robots.get(u.origin);
  if(!permission){try{const r=await raw(u.origin+'/robots.txt');permission=r.status===200&&!String(r.contentType).includes('text/html')?{text:r.text}:{unknown:true};}catch{permission={unknown:true};}robots.set(u.origin,permission);}
  if(permission.text!==undefined&&!robotsAllows(permission.text,u.pathname+u.search))throw Error('robots.txt disallows '+u.pathname);
  if(permission.unknown){
    if(api||u.hostname!==root)throw Error('Robots unavailable: external/API access skipped');
    if(u.pathname!=='/'){
      if(!permission.links){const home=await raw(u.origin+'/');permission.links=home.status===200?links(home.text,u.origin+'/').filter(link=>new URL(link).hostname===root&&/careers?|jobs?|contact/i.test(new URL(link).pathname)):[];}
      if(!permission.links.some(link=>link.replace(/\/$/,'')===url.replace(/\/$/,'')))throw Error('Robots unavailable: careers/contact URL is not linked from homepage');
      if(permission.fallbackPage&&permission.fallbackPage!==url)throw Error('Robots unavailable: only one linked careers/contact page allowed');permission.fallbackPage=url;
    }
  }
  return raw(url);
 };
 const queue=[{url:initial}];
 while(queue.length&&requestsUsed<maxRequests&&!(await shouldStop())&&Date.now()-start<maxRuntimeSeconds*1000){
  const item=queue.shift();if(seen.has(item.url))continue;seen.add(item.url);
  try{
   const response=await get(item.url,{api:!!item.type});
   if([301,302,303,307,308].includes(response.status)){const next=publicUrl(response.location,item.url);const host=next?new URL(next).hostname:'';if(next&&(item.redirects||0)<2&&(host.replace(/^www\./,'')===root.replace(/^www\./,'')||atsEndpoint(next))){queue.unshift({url:next,redirects:(item.redirects||0)+1});}else errors.push('Unsupported redirect target');continue;}
   if(response.status!==200){errors.push('HTTP '+response.status+' at '+item.url);continue;}
   if(item.type==='greenhouse'){
    const board=fullGreenhouseBoard(response,item.url);
    if(board)completeBoards.push(board);
   }
   for(const job of parseJobs(response,item.url,item.type))jobs.set(requisitionFromUrl(job.url)?.key || job.url,{...job,...classifyRole(job.title,job.description)});
   if(item.type)continue;
   for(const link of links(response.text,item.url)){
    const endpoint=atsEndpoint(link);if(endpoint){queue.push(endpoint);continue;}
    const u=new URL(link);if(u.hostname===root&&/career|jobs?|openings|vacanc|position/i.test(u.pathname)&&!seen.has(link))queue.push({url:link});
   }
   const direct=atsEndpoint(item.url);if(direct)queue.unshift(direct);
  }catch(error){errors.push(error.message);}
 }
 return {jobs:[...jobs.values()],completeBoards,requestsUsed,errors,status:jobs.size?'ok':errors.length?'restricted_or_error':'no_jobs_or_unsupported',unsupported:!jobs.size};
}
async function enqueueWatchCompanies(userId,{companyIds}={}){
 const Company=require('../models/Company'),Prospect=require('../models/CompanyProspect');
 const companies=await Company.find().lean(),byId=new Map(companies.map(c=>[String(c._id),c]));
 const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const byName=new Map();for(const c of companies)for(const name of [c.name,...(c.aliases||[])]){const key=normalize(name),matches=byName.get(key)||[];if(!matches.some(m=>String(m._id)===String(c._id)))matches.push(c);byName.set(key,matches);}
 const sharedHost=host=>/(^|\.)(?:hiretik\.com|ycombinator\.com|linkedin\.com)$/.test(host);
 const atsHost=host=>/(^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|myworkdayjobs\.com|smartrecruiters\.com|recruitee\.com|workday\.com|bamboohr\.com|teamtailor\.com)$/.test(host);
 const officialUrl=value=>{const url=publicUrl(value);return url&&!sharedHost(new URL(url).hostname)?url:null;};
 const rows=[];
 if(companyIds!==undefined){
  if(!Array.isArray(companyIds)||!companyIds.length||companyIds.length>1000||companyIds.some(id=>!require('mongoose').isValidObjectId(id)))throw Error('Valid company IDs required');
  const requested=new Set(companyIds.map(String));for(const c of companies.filter(c=>requested.has(String(c._id))))rows.push({company:c.name,companyId:c._id,careersUrl:c.careersUrl,region:c.isIndia?'India':'Overseas',priority:0});
 }else{
  const prospects=await Prospect.find().lean();
  for(const c of prospects)rows.push({company:c.companyName,companyId:c.companyId,careersUrl:c.raw?.careersUrl,region:c.regionGroup,priority:c.raw?.reportedBaseLowLPA?10:0,identityConflict:c.identityStatus==='conflict'});
  // Partial imports must not silently shrink the supplied 733-company watch.
  const importedKeys=new Set(rows.map(row=>normalize(row.company)+'|'+String(row.careersUrl||'')));
  for(const c of require('../data/company_research_staging_733.json').companies){
   const key=normalize(c.companyName)+'|'+String(c.careersUrl||'');
   if(!importedKeys.has(key))rows.push({company:c.companyName,careersUrl:c.careersUrl,region:c.regionGroup,priority:c.reportedBaseLowLPA?10:0});
  }
 }
 let queued=0,updated=0,skipped=0,needsPortalMapping=0,identityConflicts=0;const seen=new Set(),writes=[];
 const existingTasks=new Map((await Task.find({userId}).lean()).map(task=>[task.identityKey,task]));
 for(const source of rows){
  const candidates=byName.get(normalize(source.company))||[];
  const existing=source.identityConflict?null:byId.get(String(source.companyId))||(candidates.length===1?candidates[0]:null);
  let url=officialUrl(source.careersUrl);
  if(!url&&existing){url=officialUrl(existing.careersUrl);if(!url&&existing.domain)url=officialUrl('https://'+existing.domain+'/');}
  if(source.identityConflict){url=null;identityConflicts++;}
  const identityKey=crypto.createHash('sha256').update(normalize(source.company)+'|'+String(source.careersUrl||'')).digest('hex');
  if(seen.has(identityKey)){skipped++;continue;}seen.add(identityKey);
  const portalStatus=url?'mapped':'needs_portal_mapping';if(!url){needsPortalMapping++;url='https://unmapped-'+identityKey.slice(0,16)+'.invalid/';}
  const domain=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
  let employerDomain=portalStatus==='mapped'&&!atsHost(domain)?domain:null;
  if(existing?.domain){const root=officialUrl('https://'+existing.domain+'/');if(root&&!atsHost(new URL(root).hostname))employerDomain=new URL(root).hostname.replace(/^www\./,'');}
  const priority=existing&&require('./salaryEvidenceService').qualifyCompany(existing).qualificationStatus==='qualified'?100:source.priority;
  const metadata={company:source.company,domain,employerDomain,careersUrl:url,region:source.region,regionPriority:/^india$/i.test(source.region)?1:0,portalStatus,priority};
  const previous=existingTasks.get(identityKey);
  if(!previous)writes.push({updateOne:{filter:{userId,identityKey},update:{$setOnInsert:{...metadata,userId,identityKey,nextScanAt:new Date(),state:'queued'}},upsert:true}});
  else if(previous.state!=='running'&&!(previous.portalStatus==='mapped'&&portalStatus==='needs_portal_mapping')){
   const changes=Object.fromEntries(Object.entries(metadata).filter(([key,value])=>previous[key]!==value));
   if(Object.keys(changes).length){
    if(changes.careersUrl)changes.nextScanAt=new Date();
    const update={$set:changes};if('employerDomain' in changes)update.$unset={lastContactScanAt:1};
    writes.push({updateOne:{filter:{_id:previous._id,userId,state:{$ne:'running'}},update}});
   }
  }
 }
 if(writes.length){const result=await Task.bulkWrite(writes,{ordered:false});queued=result.upsertedCount||0;updated=result.modifiedCount||0;}
 await Config.updateOne({userId},{$setOnInsert:{enabled:false}},{upsert:true});return {queued,updated,skipped,duplicateSourceRows:skipped,sourceRows:rows.length,needsPortalMapping,identityConflicts};
}
async function runCareerWatchOnce({userId,dryRun=true,maxCompanies=1,maxRequests=12,maxRuntimeSeconds=30,fetchPage=fetchPublicPage,clock=()=>new Date(),contactDiscover=null}={}){
 if(process.env.RESEARCH_STOP==='true')return {status:'stopped',requestsUsed:0,companies:[]};
 if(!Number.isFinite(maxRuntimeSeconds)||maxRuntimeSeconds<1||maxRuntimeSeconds>120)throw Error('Use a runtime between 1 and 120 seconds');
 if(!Number.isInteger(maxCompanies)||maxCompanies<1||maxCompanies>20||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>100)throw Error('Bound company/request limits required');
 const config=await Config.findOne({userId}).lean();if(!dryRun&&!config?.enabled)return {status:'disabled',requestsUsed:0,companies:[]};
 const result={status:'complete',dryRun,requestsUsed:0,jobsFound:0,newJobs:0,companies:[]};const started=Date.now(),visited=[];
 // Manual dry scans consume the same free HTTP budget even though jobs,
 // notifications and task progress are not changed.
 let dryDay;
 if(dryRun){
  await Config.updateOne({userId},{$setOnInsert:{enabled:false}},{upsert:true});
  dryDay=clock().toISOString().slice(0,10);
  await Config.updateOne({userId,$or:[{requestsDay:{$exists:false}},{requestsDay:{$lt:dryDay}}]},{$set:{requestsDay:dryDay,requestsUsed:0}});
  const reserved=await Config.updateOne({userId,requestsDay:dryDay,$expr:{$lte:[{$add:['$requestsUsed',maxRequests]},'$dailyRequestLimit']}},{$inc:{requestsUsed:maxRequests}});
  if(!reserved.modifiedCount)return {...result,status:'budget_exhausted'};
 }

 for(let i=0;i<maxCompanies&&result.requestsUsed<maxRequests&&Date.now()-started<maxRuntimeSeconds*1000;i++){
  let task,token,reserved=0,requestDay;const claimedAt=clock();
  const order={regionPriority:-1,priority:-1,nextScanAt:1};
  const query={userId,portalStatus:{$ne:'needs_portal_mapping'},_id:{$nin:visited},nextScanAt:{$lte:claimedAt},$or:[{state:{$ne:'running'}},{leaseUntil:{$lte:claimedAt}}]};
  if(dryRun)task=await Task.findOne(query).sort(order).lean();
  else{
   const due=await Task.findOne(query).sort(order).lean();if(!due)break;
   query._id={...query._id,$eq:due._id};
   const day=claimedAt.toISOString().slice(0,10);await Config.updateOne({userId,$or:[{requestsDay:{$exists:false}},{requestsDay:{$lt:day}}]},{$set:{requestsDay:day,requestsUsed:0}});
   const reserve=Math.min(12,maxRequests-result.requestsUsed);
   const budget=await Config.updateOne({userId,enabled:true,requestsDay:day,$expr:{$lte:[{$add:['$requestsUsed',reserve]},'$dailyRequestLimit']}},{$inc:{requestsUsed:reserve}});if(!budget.modifiedCount){result.status='budget_exhausted';break;}
   reserved=reserve;requestDay=day;
   token=crypto.randomUUID();task=await Task.findOneAndUpdate(query,{$set:{state:'running',leaseToken:token,leaseUntil:new Date(+claimedAt+120000)}},{sort:order,returnDocument:'after'}).lean();
  }
  if(!task){if(reserved)await Config.updateOne({userId,requestsDay:requestDay},{$inc:{requestsUsed:-reserved}});break;}visited.push(task._id);
  const report=await collectCompanyJobs(task,{fetchPage,maxRequests:Math.min(12,maxRequests-result.requestsUsed),maxRuntimeSeconds:Math.max(1,maxRuntimeSeconds-(Date.now()-started)/1000),shouldStop:async()=>process.env.RESEARCH_STOP==='true'||(!dryRun&&!await Config.exists({userId,enabled:true}))});
  if(!dryRun&&reserved>report.requestsUsed)await Config.updateOne({userId,requestsDay:requestDay},{$inc:{requestsUsed:-(reserved-report.requestsUsed)}});
  result.requestsUsed+=report.requestsUsed;result.jobsFound+=report.jobs.length;result.companies.push({company:task.company,domain:task.domain,requestsUsed:report.requestsUsed,jobsFound:report.jobs.length,status:report.status,errors:report.errors});
  if(dryRun)continue;
  const owned=()=>({_id:task._id,leaseToken:token,leaseUntil:{$gt:clock()}});
  if(process.env.RESEARCH_STOP==='true'||!await Config.exists({userId,enabled:true})){await Task.updateOne(owned(),{$set:{state:'queued'},$unset:{leaseToken:1,leaseUntil:1}});result.status='stopped';break;}
  if(!await Task.exists(owned())){result.status='lease_lost';break;}
  if(report.jobs.filter(j=>j.eligibility!=='excluded').length>200)report.errors.push('More than 200 eligible/review rows: manual pagination review required');
  for(const row of report.jobs.filter(j=>j.eligibility!=='excluded').slice(0,200)){
   if(process.env.RESEARCH_STOP==='true'||!await Config.exists({userId,enabled:true})){result.status='stopped';break;}
   const renewal=await Task.updateOne(owned(),{$set:{leaseUntil:new Date(+clock()+120000)}});
   if(!renewal.matchedCount){result.status='lease_lost';break;}
   const region=locationRegion(row.location),locationPriority=region==='India'?2:region==='unknown'?1:0;
   const updated=await saveCareerJob(userId,{...row,description:row.description.slice(0,20000),company:task.company,domain:task.domain,companyRegion:task.region,locationRegion:region,locationPriority,lastSeenAt:clock(),salaryStatus:'unverified'},clock());
   if(updated && (!updated.validThrough || updated.validThrough > clock()) && row.eligibility==='eligible'&&(region==='India'||row.remoteEligibility==='india')){
    const note=await Notification.updateOne({userId,jobId:updated._id},{$setOnInsert:{title:row.title,company:task.company,url:row.url}},{upsert:true});result.newJobs+=note.upsertedCount||0;
   }
  }
  if(['stopped','lease_lost'].includes(result.status)){await Task.updateOne(owned(),{$set:{state:'queued'},$unset:{leaseToken:1,leaseUntil:1}});break;}
  if (report.completeBoards?.length && await Task.exists(owned()) && process.env.RESEARCH_STOP!=='true' &&
    await Config.exists({userId,enabled:true})) {
   for (const board of report.completeBoards) await reconcileGreenhouseBoard(userId,board,clock());
  }
  // Free contact research has an independent, conservative HTTP budget. A weekly
  // refresh avoids spending it repeatedly on the first companies in the queue.
  if(task.employerDomain&&config.discoverContacts!==false&&contactDiscover&&(!task.lastContactScanAt||+clock()-+task.lastContactScanAt>=7*24*3600000)){
   try{
    const renewed=await Task.updateOne(owned(),{$set:{leaseUntil:new Date(+clock()+120000)}});if(!renewed.matchedCount)throw Error('Contact scan lease lost');
    const contacts=await contactDiscover({userId,domains:[task.employerDomain],companyContext:{company:task.company,region:task.region},saveToContacts:config.autoImportContacts===true,dryRun:false,maxRequests:5});
    const stopped=contacts.companies?.some(c=>c.status==='stopped');
    await Task.updateOne(owned(),{$set:stopped?{contactLastError:'Contact research stopped'}:{lastContactScanAt:clock(),contactLastError:''}});
   }catch(error){await Task.updateOne(owned(),{$set:{contactLastError:String(error.message).slice(0,500)}});}
  }
  const finished=clock();const completion=await Task.updateOne(owned(),{$set:{state:report.errors.length&&!report.jobs.length?'failed':'complete',lastScannedAt:finished,nextScanAt:new Date(+finished+INTERVAL_MS),lastRequests:report.requestsUsed,lastFound:report.jobs.length,lastError:report.errors.join('; ').slice(0,1500)},$unset:{leaseToken:1,leaseUntil:1}});if(!completion.matchedCount)result.status='lease_lost';
 }
 if(dryRun&&maxRequests>result.requestsUsed)await Config.updateOne({userId,requestsDay:dryDay},{$inc:{requestsUsed:-(maxRequests-result.requestsUsed)}});
 if(!dryRun)await Config.updateOne({userId},{$set:{lastRunAt:new Date(),lastError:result.status==='complete'?'':result.status}});
 return result;
}
function initCareerWatchScheduler(){
 if(process.env.CAREER_WATCH_ENABLED!=='true')return;
 let busy=false;const tick=async()=>{if(busy||process.env.RESEARCH_STOP==='true')return;busy=true;try{for(const config of await Config.find({enabled:true}).lean())await runCareerWatchOnce({userId:config.userId,dryRun:false,maxCompanies:5,maxRequests:30,maxRuntimeSeconds:45,contactDiscover:process.env.PROFESSIONAL_DISCOVERY_BACKGROUND_ENABLED==='true'?require('./professionalDiscoveryService').runDiscovery:null});}catch(error){console.error('Career watch:',error.message);}finally{busy=false;}};
 tick();const timer=setInterval(tick,10000);timer.unref?.();return {stop:()=>clearInterval(timer)};
}
module.exports={INTERVAL_MS,INDIA_LOCATION,publicUrl,classifyRole,locationRegion,atsEndpoint,parseJobs,collectCompanyJobs,enqueueWatchCompanies,runCareerWatchOnce,initCareerWatchScheduler};

const mongoose=require('mongoose');
const Lead=require('../models/ProfessionalLead'),Suppression=require('../models/RecipientSuppression'),Contact=require('../models/Contact'),Company=require('../models/Company');
const {fetchCompanyEmails,normalizeDomain,allowedDiscoveryDomain}=require('./publicEmailDiscovery');
const {reserveResearch,policyFor,releaseUnusedRequests}=require('./researchBudgetService');
async function runDiscovery({userId,domains,dryRun=true,maxRequests=25,companyContext=null,saveToContacts=false,allowPublicUnverified=false,discover=fetchCompanyEmails,reserve=reserveResearch}={}){
  if(!mongoose.isValidObjectId(userId))throw Error('Owned discovery login required');
  if(!Array.isArray(domains)||!domains.length||domains.length>100||domains.some(d=>typeof d!=='string'||!allowedDiscoveryDomain(normalizeDomain(d))))throw Error('Provide 1 to 100 employer domains');
  if(typeof dryRun!=='boolean'||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>500)throw Error('Use boolean dryRun and 1 to 500 total requests');
  const owner=await require('../models/User').findById(userId).select('blockedCompanies').lean();if(!owner)throw Error('Discovery owner not found');
  const companyKey=require('./companyIdentityService').companyKey,blockedCompanies=new Set((owner.blockedCompanies||[]).map(companyKey));
  const selected=[...new Set(domains.map(normalizeDomain))];
  const reservedAt=new Date();
  const policy=await reserve(userId,{requests:maxRequests,credits:0,now:reservedAt});
  const companies=await Company.find({domain:{$in:selected}}).select('domain name regionGroups').lean();const names=new Map(companies.map(c=>[c.domain,c.name]));const regions=new Map(companies.map(c=>[c.domain,c.regionGroups?.includes('India')?'India':c.regionGroups?.includes('Overseas')?'Overseas':'Unknown']));
  const report={dryRun,providerCreditsUsed:0,requestsUsed:0,emailsFound:0,newLeads:0,existingLeads:0,suppressed:0,sourceTypes:{official_public_page:0,official_corporate_repository:0,pattern_inference:0},companies:[],leads:[],peopleFound:0};
  for(let index=0;index<selected.length;index++){
    const domain=selected[index],remaining=maxRequests-report.requestsUsed;
    if(blockedCompanies.has(companyKey(companyContext?.company||names.get(domain)||domain))){report.companies.push({domain,requestsUsed:0,emailsFound:0,status:'company_blocked'});continue;}
    if(process.env.RESEARCH_STOP==='true'||(await policyFor(userId)).stopped){report.companies.push({domain,requestsUsed:0,emailsFound:0,status:'stopped'});continue;}
    if(remaining<2){report.companies.push({domain,requestsUsed:0,emailsFound:0,status:'budget_exhausted'});continue;}
    const allowance=Math.min(20,remaining,Math.max(2,Math.floor(remaining/(selected.length-index))));
    const repository=require('./corporateRepositoryDiscovery'),repoSource=repository.sourceFor(domain),withRepository=!!repoSource&&allowance>=3&&discover===fetchCompanyEmails;
    const result=await discover(domain,{maxRequests:allowance-(withRepository?1:0),maxRuntimeSeconds:policy?.maxRuntimeSeconds||30,shouldStop:async()=>process.env.RESEARCH_STOP==='true'||(await policyFor(userId)).stopped});
    if(withRepository&&process.env.RESEARCH_STOP!=='true'&&!(await policyFor(userId)).stopped){const extra=await repository.discoverCorporateRepository(domain);result.emails=[...(result.emails||[]),...extra.emails];result.requestsUsed=(result.requestsUsed||0)+extra.requestsUsed;}
    report.requestsUsed+=result.requestsUsed||0;let count=0;
    for (const person of result.people || []) {
      const company = companyContext?.company || names.get(domain) || domain;
      const identity = JSON.stringify([domain, person.name.toLowerCase(), person.title.toLowerCase()]);
      report.peopleFound++;
      if (!dryRun) await require('../models/ProfessionalResearchPerson').updateOne(
        { userId, identity }, { $set: { company, domain, name: person.name, title: person.title, kind: person.kind, sourceUrl: person.sourceUrl, observedAt: new Date() } },
        { upsert: true }
      );
    }
    for(const row of result.emails||[]){
      if (allowPublicUnverified) {
        if (/fraud|scam|recruitment.?agency|accessibility/i.test(row.sourceUrl || '')) continue;
        if ((!row.kind || row.kind === 'role_inbox') &&
          !/^(?:careers?|jobs?|recruit(?:ing|ment)?|talent|hiring|hr|campus)(?:[._-](?:india|in|careers?|jobs?))?@/i.test(row.email || '')) continue;
      }
      const email=String(row.email||'').trim().toLowerCase(),host=email.split('@')[1];
      const corporate=row._repoVerified===true&&repoSource?.domains.includes(host)&&row.sourceUrl?.startsWith('https://github.com/'+repoSource.repository+'/commit/');
      if(!email||(!corporate&&!(host===domain||host?.endsWith('.'+domain)))||!row.sourceUrl)continue;
      const source=new URL(row.sourceUrl);if(source.protocol!=='https:'||(!corporate&&!(source.hostname===domain||source.hostname==='www.'+domain)))continue;
      const [suppressed,duplicates]=await Promise.all([Suppression.exists({userId,email}),Contact.find({userId,email:{$regex:'^'+email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',$options:'i'}}).lean()]);
      if(suppressed||duplicates.some(c=>c.suppressedAt||c.optOutAt||c.deliverabilityStatus==='invalid'||c.verificationStatus==='invalid'||['bounced','removed','replied','reply_received','positive_response','negative_response'].includes(c.status))){report.suppressed++;continue;}
      const lead={userId,email,domain,company:companyContext?.company||names.get(domain)||domain,companyRegion:companyContext?.region||regions.get(domain)||'Unknown',regionPriority:(companyContext?.region||regions.get(domain))==='India'?1:0,name:row.name||'',title:row.title||'Public recruiting inbox',kind:['recruiter','hiring_manager','role_inbox','engineer'].includes(row.kind)?row.kind:'role_inbox',sourceUrl:row.sourceUrl,observedAt:new Date(),publishedAt:row.publishedAt,inferenceFlag:row.inferenceFlag===true,pattern:row.pattern,patternEvidence:row.patternEvidence||[],verificationStatus:row.inferenceFlag===true?'inferred_unverified':'publicly_listed_not_mailbox_verified',confidence:row.confidence||'published',sourceType:corporate?'official_corporate_repository':row.inferenceFlag===true?'pattern_inference':'official_public_page'};
      const existing=await Lead.exists({userId,email});if(existing)report.existingLeads++;else report.newLeads++;
      if(!dryRun){
        if(existing && lead.sourceType==='official_public_page') {
          await Lead.updateOne({userId,email},{$set:{...lead,provenance:[{url:lead.sourceUrl,observedAt:lead.observedAt}]}},{runValidators:true});
        } else {
          await Lead.updateOne({userId,email},{$setOnInsert:{...lead,provenance:[{url:lead.sourceUrl,observedAt:lead.observedAt}]}},{upsert:true,runValidators:true});
        }
      }
      report.leads.push(lead);count++;report.sourceTypes[lead.sourceType]++;
    }
    report.emailsFound+=count;
    report.companies.push({domain,requestsUsed:result.requestsUsed||0,emailsFound:count,status:result.pagesRead===0 && !count ? 'source_unavailable' : 'complete',limitedByRobots:result.limitedByRobots===true,reason:result.reason||null});
  }
  if(reserve===reserveResearch)await releaseUnusedRequests(userId,maxRequests,report.requestsUsed,reservedAt);
  if(!dryRun&&saveToContacts&&report.leads.length){
    const eligible=report.leads.filter(row=>!row.inferenceFlag);
    const ids=[];
    const limits = {hiring_manager:10,engineer:3};
    const counts = new Map();
    for (const row of eligible) {
      if (allowPublicUnverified && limits[row.kind] && !await Contact.exists({userId,email:row.email})) {
        const key = companyKey(row.company)+':'+row.kind;
        if (!counts.has(key)) counts.set(key,await Contact.countDocuments({
          userId,company:require('./companyIdentityService').canonicalCompany(row.company),contactKind:row.kind
        }));
        if (counts.get(key)>=limits[row.kind]) continue;
        counts.set(key,counts.get(key)+1);
      }
      ids.push(row.email);
    }
    const leadIds=await Lead.find({userId,email:{$in:ids},inferenceFlag:{$ne:true}}).distinct('_id');report.sheet={added:0,duplicates:0,excluded:0,staged:0,mailboxesVerified:0,providerCreditsUsed:0};
    for(let start=0;start<leadIds.length;start+=100){const part=await require('./professionalSheetService').importLeads({userId,leadIds:leadIds.slice(start,start+100),allowPublicUnverified});for(const key of ['added','duplicates','excluded','staged'])report.sheet[key]+=part[key];}
  }
  return report;
}
module.exports={runDiscovery};

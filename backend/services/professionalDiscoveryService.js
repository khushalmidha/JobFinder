const mongoose=require('mongoose');
const Lead=require('../models/ProfessionalLead'),Suppression=require('../models/RecipientSuppression'),Contact=require('../models/Contact'),Company=require('../models/Company');
const {fetchCompanyEmails,normalizeDomain,allowedDiscoveryDomain}=require('./publicEmailDiscovery');
const {reserveResearch,policyFor}=require('./researchBudgetService');
async function runDiscovery({userId,domains,dryRun=true,maxRequests=25,companyContext=null,discover=fetchCompanyEmails,reserve=reserveResearch}={}){
  if(!mongoose.isValidObjectId(userId))throw Error('Owned discovery login required');
  if(!Array.isArray(domains)||!domains.length||domains.length>100||domains.some(d=>typeof d!=='string'||!allowedDiscoveryDomain(normalizeDomain(d))))throw Error('Provide 1 to 100 employer domains');
  if(typeof dryRun!=='boolean'||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>500)throw Error('Use boolean dryRun and 1 to 500 total requests');
  const owner=await require('../models/User').findById(userId).select('blockedCompanies').lean();if(!owner)throw Error('Discovery owner not found');
  const companyKey=require('./companyIdentityService').companyKey,blockedCompanies=new Set((owner.blockedCompanies||[]).map(companyKey));
  const selected=[...new Set(domains.map(normalizeDomain))];
  const policy=await reserve(userId,{requests:maxRequests,credits:0});
  const companies=await Company.find({domain:{$in:selected}}).select('domain name regionGroups').lean();const names=new Map(companies.map(c=>[c.domain,c.name]));const regions=new Map(companies.map(c=>[c.domain,c.regionGroups?.includes('India')?'India':c.regionGroups?.includes('Overseas')?'Overseas':'Unknown']));
  const report={dryRun,providerCreditsUsed:0,requestsUsed:0,emailsFound:0,newLeads:0,existingLeads:0,suppressed:0,sourceTypes:{official_public_page:0},companies:[],leads:[]};
  for(let index=0;index<selected.length;index++){
    const domain=selected[index],remaining=maxRequests-report.requestsUsed;
    if(blockedCompanies.has(companyKey(companyContext?.company||names.get(domain)||domain))){report.companies.push({domain,requestsUsed:0,emailsFound:0,status:'company_blocked'});continue;}
    if(process.env.RESEARCH_STOP==='true'||(await policyFor(userId)).stopped){report.companies.push({domain,requestsUsed:0,emailsFound:0,status:'stopped'});continue;}
    if(remaining<2){report.companies.push({domain,requestsUsed:0,emailsFound:0,status:'budget_exhausted'});continue;}
    const allowance=Math.min(20,remaining,Math.max(2,Math.floor(remaining/(selected.length-index))));
    const result=await discover(domain,{maxRequests:allowance,maxRuntimeSeconds:policy?.maxRuntimeSeconds||30,shouldStop:async()=>process.env.RESEARCH_STOP==='true'||(await policyFor(userId)).stopped});
    report.requestsUsed+=result.requestsUsed||0;let count=0;
    for(const row of result.emails||[]){
      const email=String(row.email||'').trim().toLowerCase(),host=email.split('@')[1];
      if(!email||!(host===domain||host?.endsWith('.'+domain))||!row.sourceUrl)continue;
      const source=new URL(row.sourceUrl);if(source.protocol!=='https:'||!(source.hostname===domain||source.hostname==='www.'+domain))continue;
      const [suppressed,duplicates]=await Promise.all([Suppression.exists({userId,email}),Contact.find({userId,email:{$regex:'^'+email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',$options:'i'}}).lean()]);
      if(suppressed||duplicates.some(c=>c.suppressedAt||c.optOutAt||c.deliverabilityStatus==='invalid'||c.verificationStatus==='invalid'||['bounced','removed','replied','reply_received','positive_response','negative_response'].includes(c.status))){report.suppressed++;continue;}
      const lead={userId,email,domain,company:companyContext?.company||names.get(domain)||domain,companyRegion:companyContext?.region||regions.get(domain)||'Unknown',regionPriority:(companyContext?.region||regions.get(domain))==='India'?1:0,name:row.name||'',title:row.title||'Public recruiting inbox',kind:['recruiter','hiring_manager','role_inbox'].includes(row.kind)?row.kind:'role_inbox',sourceUrl:row.sourceUrl,observedAt:new Date(),verificationStatus:'publicly_listed_not_mailbox_verified',confidence:row.confidence||'published',sourceType:'official_public_page'};
      const existing=await Lead.exists({userId,email});if(existing)report.existingLeads++;else report.newLeads++;
      if(!dryRun)await Lead.updateOne({userId,email},{$setOnInsert:{...lead,provenance:[{url:lead.sourceUrl,observedAt:lead.observedAt}]}},{upsert:true,runValidators:true});
      report.leads.push(lead);count++;
    }
    report.emailsFound+=count;report.sourceTypes.official_public_page+=count;
    report.companies.push({domain,requestsUsed:result.requestsUsed||0,emailsFound:count,status:'complete',limitedByRobots:result.limitedByRobots===true,reason:result.reason||null});
  }
  return report;
}
module.exports={runDiscovery};

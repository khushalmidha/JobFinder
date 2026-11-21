// Free-only measured public-network pilot; no database writes or provider credits.
const fs=require('node:fs');
const companies=require('../data/career_watch_pilot_20.json');
const {fetchCompanyEmails}=require('../services/publicEmailDiscovery');
const {collectCompanyJobs}=require('../services/careerWatchService');
(async()=>{
 const rows=[];let index=0;
 async function worker(){while(index<companies.length){const company=companies[index++];
   const started=Date.now();let contact,jobs;
   try{contact=await fetchCompanyEmails(company.domain,{maxRequests:4,maxRuntimeSeconds:20,timeout:4000});}catch(error){contact={emails:[],requestsUsed:0,reason:error.message};}
   try{jobs=await collectCompanyJobs(company,{maxRequests:6,maxRuntimeSeconds:20});}catch(error){jobs={jobs:[],requestsUsed:0,errors:[error.message]};}
   const row={...company,requestsUsed:(contact.requestsUsed||0)+(jobs.requestsUsed||0),contactRequests:contact.requestsUsed||0,jobRequests:jobs.requestsUsed||0,emails:contact.emails||[],emailsFound:contact.emails?.length||0,jobPostings:jobs.jobs?.length||0,eligibleJobs:jobs.jobs?.filter(j=>j.eligibility==='eligible').length||0,needsReviewJobs:jobs.jobs?.filter(j=>j.eligibility==='needs_review').length||0,contactReason:contact.reason||null,jobErrors:jobs.errors||[],elapsedMs:Date.now()-started};rows.push(row);console.log(JSON.stringify({company:row.company,requestsUsed:row.requestsUsed,emailsFound:row.emailsFound,jobPostings:row.jobPostings}));
 }}
 await Promise.all([worker(),worker()]);const report={executedAtUtc:new Date().toISOString(),dryRun:true,companyCount:rows.length,maxRequests:200,requestsUsed:rows.reduce((a,r)=>a+r.requestsUsed,0),emailsFound:rows.reduce((a,r)=>a+r.emailsFound,0),mailboxesVerified:0,providerCreditsUsed:0,sourceTypes:['official_company_pages','official_public_job_postings'],companies:rows};fs.writeFileSync('artifacts-career-watch-pilot-20.json',JSON.stringify(report,null,2));console.log(JSON.stringify({companyCount:report.companyCount,requestsUsed:report.requestsUsed,emailsFound:report.emailsFound,providerCreditsUsed:0}));process.exit(0);
})().catch(error=>{console.error(error.message);process.exit(1)});

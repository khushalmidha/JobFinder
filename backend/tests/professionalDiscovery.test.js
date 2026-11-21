const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Lead=require('../models/ProfessionalLead'),Suppression=require('../models/RecipientSuppression'),Contact=require('../models/Contact'),Policy=require('../models/ResearchPolicy'),Usage=require('../models/ResearchUsage');
const {fetchCompanyEmails,extractProfessionalEmails}=require('../services/publicEmailDiscovery');
const {runDiscovery}=require('../services/professionalDiscoveryService');
let mongo,owner,other,server,base;
before(async()=>{process.env.JWT_SECRET='professional-discovery-fixture';process.env.CONTACT_ADMISSION_ENABLED='false';mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all([User,Lead,Suppression,Contact,Policy,Usage].map(M=>M.init()));const app=express();app.use(express.json());app.use('/discovery',require('../routes/professionalDiscovery'));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;},{timeout:300000});
after(async()=>{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{process.env.RESEARCH_STOP='false';await Promise.all([User,Lead,Suppression,Contact,Policy,Usage].map(M=>M.deleteMany({})));owner=await User.create({name:'Owner',email:'owner@example.org',passwordHash:'fixture'});other=await User.create({name:'Other',email:'other@example.org',passwordHash:'fixture'});});
const page=text=>({status:200,text,contentType:'text/html'});
test('crawler follows real careers links and sitemaps within budget; missing robots only homepage plus one linked page',async()=>{
 const calls=[];const fetchPage=async url=>{calls.push(new URL(url).pathname);if(url.endsWith('robots.txt'))throw Error('Unavailable');return url.endsWith('/')?page('<a href="/work-with-us">Careers</a><a href="https://linkedin.com/in/person">Recruiter</a>'):page('<p>jobs@employer.example</p><a href="/staff">More</a>');};
 const result=await fetchCompanyEmails('employer.example',{fetchPage,maxRequests:10});assert.deepEqual(calls,['/robots.txt','/','/work-with-us']);assert.equal(result.emails[0].email,'jobs@employer.example');assert.equal(result.limitedByRobots,true);
 const sitemapCalls=[];await fetchCompanyEmails('employer.example',{maxRequests:6,fetchPage:async url=>{const p=new URL(url).pathname;sitemapCalls.push(p);if(p==='/robots.txt')return {status:200,text:'User-agent: *',contentType:'text/plain'};if(p==='/sitemap.xml')return {status:200,text:'<urlset><loc>https://employer.example/contact-team</loc></urlset>',contentType:'application/xml'};return page('');}});assert.ok(sitemapCalls.includes('/contact-team'));assert.ok(sitemapCalls.length<=6);
});
test('named work addresses require nearby explicit role; engineer without hiring evidence and personal/unrelated mail excluded',()=>{
 const html='<p>Jane Doe - Technical Recruiter jane@employer.example</p><p>Alex Brown - Hiring Manager alex@employer.example</p><p>Sam Foo - Engineer sam@employer.example</p><p>Talent Acquisition spare@gmail.com</p>';
 const result=extractProfessionalEmails(html,'https://employer.example/careers','employer.example');assert.deepEqual(result.map(r=>[r.email,r.kind]),[['jane@employer.example','recruiter'],['alex@employer.example','hiring_manager']]);assert.equal(result[0].name,'Jane Doe');
 assert.deepEqual(extractProfessionalEmails('<p>Jane Doe Technical Recruiter jane@employer.example; Bob Smith Engineer bob@employer.example</p>','https://employer.example/careers','employer.example'),[]);
});
test('dry-run has no lead/contact writes; apply dedupes, honours owner suppression, retains unverified labels and zero credits',async()=>{
 await Suppression.create({userId:owner._id,email:'blocked@employer.example',source:'owner_block',reason:'Do not contact'});
 const discover=async()=>({requestsUsed:2,emails:[{email:'recruiting@employer.example',kind:'role_inbox',sourceUrl:'https://employer.example/careers'},{email:'blocked@employer.example',sourceUrl:'https://employer.example/careers'}]});
 const data={userId:owner._id,domains:['employer.example'],maxRequests:5,discover};
 const dry=await runDiscovery(data);assert.equal(dry.dryRun,true);assert.equal(dry.providerCreditsUsed,0);assert.equal(dry.suppressed,1);assert.equal(await Lead.countDocuments(),0);
 await runDiscovery({...data,dryRun:false});const repeated=await runDiscovery({...data,dryRun:false});assert.equal(repeated.existingLeads,1);assert.equal(await Lead.countDocuments(),1);assert.equal(await Contact.countDocuments(),0);assert.equal((await Lead.findOne()).verificationStatus,'publicly_listed_not_mailbox_verified');
 await runDiscovery({...data,userId:other._id,dryRun:false});assert.equal(await Lead.countDocuments(),3);
 await assert.rejects(runDiscovery({...data,maxRequests:500}),/budget/);
});
test('lead API and CSV/XLSX exports are owner scoped and suppress newly blocked addresses',async()=>{
 const record={email:'hiring@employer.example',domain:'employer.example',company:'Employer',kind:'hiring_manager',name:'=FORMULA()',title:'Hiring Manager',sourceUrl:'https://employer.example/careers',observedAt:new Date()};
 await Lead.create({...record,userId:owner._id});await Lead.create({...record,email:'foreign@employer.example',userId:other._id});
 const headers={Authorization:'Bearer '+jwt.sign({_id:String(owner._id)},process.env.JWT_SECRET)};
 assert.equal((await fetch(base+'/discovery/leads')).status,401);
 const rows=await (await fetch(base+'/discovery/leads?kind=hiring_manager',{headers})).json();assert.equal(rows.leads.length,1);
 const csv=await(await fetch(base+'/discovery/export?format=csv',{headers})).text();assert.ok(csv.includes("'=FORMULA()"));assert.ok(!csv.includes('foreign@'));
 const xlsx=await fetch(base+'/discovery/export?format=xlsx',{headers});assert.equal(xlsx.status,200);assert.match(xlsx.headers.get('content-type'),/spreadsheetml/);
 await Suppression.create({userId:owner._id,email:record.email,source:'owner_block',reason:'Blocked later'});assert.equal((await(await fetch(base+'/discovery/leads',{headers})).json()).leads.length,0);
});

test('LinkedIn, personal webmail and data broker domains are never fetched',async()=>{
 for(const domain of ['linkedin.com','careers.linkedin.com','gmail.com','icloud.com','rediffmail.com','live.com','apollo.io','sub.hunter.io']){let calls=0;const result=await fetchCompanyEmails(domain,{fetchPage:async()=>{calls++;return page('');}});assert.equal(calls,0);assert.equal(result.requestsUsed,0);}
});

test('same-company www redirects count every request and recheck robots; outside hosts and blocked destinations stop',async()=>{
 const calls=[];const response=await fetchCompanyEmails('employer.example',{maxRequests:8,fetchPage:async url=>{
  const u=new URL(url);calls.push(url);
  if(u.pathname==='/robots.txt')return {status:200,text:'User-agent: *',contentType:'text/plain'};
  if(u.hostname==='employer.example')return {status:301,location:'https://www.employer.example/',text:'',contentType:'text/html'};
  return page('<p>careers@employer.example</p>');
 }});
 assert.equal(response.requestsUsed,calls.length);assert.ok(calls.includes('https://www.employer.example/robots.txt'));assert.ok(response.emails[0].sourceUrl.startsWith('https://www.employer.example/'));
 let externalCalls=0;const denied=await fetchCompanyEmails('employer.example',{maxRequests:5,fetchPage:async url=>{externalCalls++;return url.endsWith('robots.txt')?{status:200,text:'User-agent: *',contentType:'text/plain'}:{status:302,location:'https://linkedin.com/in/person',contentType:'text/html',text:''};}});assert.equal(denied.emails.length,0);assert.equal(externalCalls,2);
 const blocked=[];await fetchCompanyEmails('employer.example',{maxRequests:8,fetchPage:async url=>{blocked.push(url);if(url==='https://employer.example/robots.txt')return {status:200,text:'User-agent: *',contentType:'text/plain'};if(url==='https://employer.example/')return {status:302,location:'https://www.employer.example/private',text:'',contentType:'text/html'};if(url==='https://www.employer.example/robots.txt')return {status:200,text:'Disallow: /private',contentType:'text/plain'};throw Error('Forbidden destination was fetched');}});assert.ok(!blocked.includes('https://www.employer.example/private'));
});


test('company blocks suppress new professional discovery and existing lead exports',async()=>{
 await User.updateOne({_id:owner._id},{$set:{blockedCompanies:['Blocked Employer']}});
 await Lead.create({userId:owner._id,email:'careers@blocked.example',domain:'blocked.example',company:'Blocked Employer',kind:'role_inbox',sourceUrl:'https://blocked.example/careers',observedAt:new Date()});
 let calls=0;const result=await runDiscovery({userId:owner._id,domains:['blocked.example'],maxRequests:5,companyContext:{company:'Blocked Employer',region:'India'},discover:async()=>{calls++;return {requestsUsed:1,emails:[]};}});
 assert.equal(calls,0);assert.equal(result.companies[0].status,'company_blocked');
 const headers={Authorization:'Bearer '+jwt.sign({_id:String(owner._id)},process.env.JWT_SECRET)};
 const response=await(await fetch(base+'/discovery/leads',{headers})).json();assert.equal(response.leads.length,0);
});

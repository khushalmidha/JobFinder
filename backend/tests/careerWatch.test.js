const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {MongoMemoryServer}=require('mongodb-memory-server');
const Config=require('../models/CareerWatchConfig'),Task=require('../models/CareerWatchTask'),Job=require('../models/CareerWatchJob'),Notification=require('../models/CareerWatchNotification');
const service=require('../services/careerWatchService');
let mongo,server,base,owner,other;
const Company=require('../models/Company'),Prospect=require('../models/CompanyProspect');
const models=[Config,Task,Job,Notification,Company,Prospect];
const fixture=async url=>({status:200,contentType:url.endsWith('/robots.txt')?'text/plain':'text/html',text:url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Software Engineer',description:'New graduate role. 0-1 years experience.',url:'https://fixture.example/jobs/swe',jobLocation:{address:{addressLocality:'Bengaluru'}}})}</script>`});
before(async()=>{process.env.JWT_SECRET='career-watch-fixture';mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all(models.map(M=>M.init()));const app=express();app.use(express.json());app.use('/watch',require('../routes/careerWatch'));await new Promise(resolve=>server=app.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/watch';},{timeout:300000});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{process.env.RESEARCH_STOP='false';await Promise.all(models.map(M=>M.deleteMany({})));owner=new mongoose.Types.ObjectId();other=new mongoose.Types.ObjectId();});
async function request(path,method='GET',body,userId=owner){const r=await fetch(base+path,{method,headers:{...(userId?{Authorization:'Bearer '+jwt.sign({_id:String(userId)},process.env.JWT_SECRET)}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function seed(){await Config.create({userId:owner,enabled:true,dailyRequestLimit:100});return Task.create({userId:owner,company:'Fixture',domain:'fixture.example',careersUrl:'https://fixture.example/careers',nextScanAt:new Date(0)});}

test('eligibility requires explicit under-one-year FTE or six-month plus conversion; senior and one-year minimums excluded',()=>{
 for(const description of ['0-1 years experience','0\u20131 years experience','0\u20141 years experience','New graduate role, no prior work experience','less than 1 year of experience'])assert.equal(service.classifyRole('Software Engineer',description).eligibility,'eligible');
 for(const description of ['1+ years','Minimum 1 year','2 years experience','1-3 years experience'])assert.equal(service.classifyRole('Software Engineer',description).eligibility,'excluded');
 assert.equal(service.classifyRole('Senior Software Engineer','0 years').eligibility,'excluded');
 assert.equal(service.classifyRole('Software Engineer','0-2 years experience').eligibility,'needs_review');
 assert.equal(service.classifyRole('Software Engineer','Competitive salary').eligibility,'needs_review');
 assert.equal(service.classifyRole('SDE Intern','6 month internship + FTE').eligibility,'eligible');
 assert.equal(service.classifyRole('AI Intern','Six months internship, PPO conversion').eligibility,'eligible');
 assert.equal(service.classifyRole('AI Intern','Six months internship').eligibility,'needs_review');
 assert.equal(service.classifyRole('Recruiting Manager','Freshers').eligibility,'excluded');
});

test('bounded official-page traversal discovers a linked ATS board with robot checks and no LinkedIn access',async()=>{
 const urls=[];const report=await service.collectCompanyJobs({domain:'fixture.example',careersUrl:'https://fixture.example/careers'},{fetchPage:async url=>{urls.push(url);if(url.endsWith('/robots.txt'))return {status:200,text:'User-agent: *\nAllow: /'};if(url.includes('boards-api.greenhouse.io'))return {status:200,text:JSON.stringify({jobs:[{title:'Software Engineer',content:'0-1 years experience',absolute_url:'https://job-boards.greenhouse.io/fixture/jobs/1'}]})};return {status:200,text:'<a href="https://job-boards.greenhouse.io/fixture">Jobs</a><a href="https://linkedin.com/company/fixture">Social</a>'};}});
 assert.equal(report.jobs.length,1);assert.equal(report.jobs[0].eligibility,'eligible');assert.ok(!urls.some(u=>u.includes('linkedin')));assert.equal(report.requestsUsed,4);
 const stopped=await service.collectCompanyJobs({careersUrl:'https://fixture.example/careers'},{fetchPage:fixture,shouldStop:()=>true});assert.equal(stopped.requestsUsed,0);
 const limited=await service.collectCompanyJobs({careersUrl:'https://fixture.example/careers'},{fetchPage:fixture,maxRequests:1});assert.equal(limited.requestsUsed,1);assert.equal(limited.jobs.length,0);
});

test('robots denial and unavailable permission do not crawl unrestricted paths or ATS APIs',async()=>{
 const denied=await service.collectCompanyJobs({careersUrl:'https://fixture.example/careers'},{fetchPage:async()=>({status:200,text:'Disallow: /careers'})});assert.equal(denied.requestsUsed,1);assert.equal(denied.jobs.length,0);
 const urls=[];await service.collectCompanyJobs({careersUrl:'https://fixture.example/careers'},{fetchPage:async url=>{urls.push(url);if(url.endsWith('/robots.txt'))return {status:503,text:''};return {status:200,text:'<a href="https://boards.greenhouse.io/fixture">Jobs</a>'};}});assert.ok(!urls.some(u=>u.includes('/v1/boards/')));
 assert.equal(service.publicUrl('https://www.linkedin.com/jobs'),null);assert.equal(service.publicUrl('http://fixture.example/jobs'),null);
 const unmapped=await service.collectCompanyJobs({portalStatus:'needs_portal_mapping',careersUrl:'https://hiretik.com/visa-sponsors'},{fetchPage:async()=>{throw Error('Must not fetch');}});assert.equal(unmapped.requestsUsed,0);
});

test('dry run performs no job/notification/task mutation; durable five-hour scans dedupe notifications and preserve owner isolation',async()=>{
 const task=await seed();let report=await service.runCareerWatchOnce({userId:owner,dryRun:true,fetchPage:fixture});assert.equal(report.jobsFound,1);assert.equal(await Job.countDocuments(),0);assert.equal((await Task.findById(task._id)).state,'queued');
 report=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture});assert.equal(report.newJobs,1);assert.equal(await Notification.countDocuments(),1);
 const after=await Task.findById(task._id);assert.ok(+after.nextScanAt-+after.lastScannedAt===5*3600000);assert.equal((await Job.findOne()).salaryStatus,'unverified');
 assert.equal((await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture})).jobsFound,0);
 await Task.updateOne({_id:task._id},{$set:{nextScanAt:new Date(0)}});report=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture});assert.equal(report.newJobs,0);assert.equal(await Notification.countDocuments(),1);
 const foreign=await request('/jobs','GET',null,other);assert.equal(foreign.data.total,0);
 const note=await Notification.findOne();assert.equal((await request('/notifications/'+note._id+'/read','POST',{},other)).status,404);assert.equal((await request('/notifications/'+note._id+'/read','POST',{})).status,200);
 assert.equal((await request('/status','GET',null,null)).status,401);
});

test('disabled, stop and exhausted budgets cannot dispatch scans; leases prevent concurrent duplicate discoveries',async()=>{
 await seed();await Config.updateOne({userId:owner},{$set:{enabled:false}});assert.equal((await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture})).status,'disabled');
 await Config.updateOne({userId:owner},{$set:{enabled:true,dailyRequestLimit:0}});assert.equal((await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture})).status,'budget_exhausted');
 process.env.RESEARCH_STOP='true';assert.equal((await service.runCareerWatchOnce({userId:owner,fetchPage:fixture})).status,'stopped');process.env.RESEARCH_STOP='false';
 await Config.updateOne({userId:owner},{$set:{dailyRequestLimit:100}});
 await Promise.all([service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture}),service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture})]);assert.equal(await Job.countDocuments(),1);assert.equal(await Notification.countDocuments(),1);
});


test('unknown robots permission requires a homepage link; redirect targets and stop controls remain bounded',async()=>{
 const urls=[];const fetchPage=async url=>{urls.push(url);return url.endsWith('/robots.txt')?{status:503,text:''}:{status:200,text:url.endsWith('/')?'<a href="/careers">Careers</a>':'<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","description":"0-1 years experience","url":"https://fixture.example/jobs/1"}</script>'};};
 const linked=await service.collectCompanyJobs({careersUrl:'https://fixture.example/careers'},{fetchPage});assert.equal(linked.jobs.length,1);assert.ok(urls.includes('https://fixture.example/'));
 const unlinked=await service.collectCompanyJobs({careersUrl:'https://fixture.example/jobs/secret'},{fetchPage});assert.equal(unlinked.jobs.length,0);
 const redirected=await service.collectCompanyJobs({careersUrl:'https://fixture.example/careers'},{fetchPage:async url=>url.endsWith('/robots.txt')?{status:200,text:'Allow: /'}:url.endsWith('/careers')?{status:302,text:'',location:'https://www.linkedin.com/jobs'}:{status:200,text:''}});assert.equal(redirected.jobs.length,0);assert.ok(redirected.errors.some(e=>e.includes('redirect')));
 await seed();const stopped=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:async url=>{await Config.updateOne({userId:owner},{$set:{enabled:false}});return fixture(url);}});assert.equal(stopped.status,'stopped');assert.equal(await Job.countDocuments(),0);
});


test('all 733 source rows are accounted for without collapsing distinct employers on shared ATS hosts',async()=>{
 const report=await service.enqueueWatchCompanies(owner);
 assert.equal(report.sourceRows,733);assert.equal(report.queued+report.duplicateSourceRows,733);
 assert.equal(await Task.countDocuments({userId:owner}),729);
 assert.equal(await Task.countDocuments({userId:owner,domain:'jobs.lever.co'}),10);
 assert.equal(await Task.countDocuments({userId:owner,domain:'boards.greenhouse.io'}),4);
 assert.equal(await Task.countDocuments({userId:owner,domain:/ycombinator|hiretik/}),0);
 assert.equal(await Task.countDocuments({userId:owner,domain:'jobs.lever.co',employerDomain:{$ne:null}}),0);
 assert.ok(report.needsPortalMapping>=400);
 const again=await service.enqueueWatchCompanies(owner);assert.equal(again.queued,0);assert.equal(await Task.countDocuments({userId:owner}),729);
});

test('company mapping resolves linked records and unambiguous names while preserving two ATS tenants',async()=>{
 const a=await Company.create({name:'Employer Alpha',domain:'alpha.example',careersUrl:'https://jobs.lever.co/alpha'});
 await Company.create({name:'Employer Beta',domain:'beta.example',careersUrl:'https://jobs.lever.co/beta'});
 const run=new mongoose.Types.ObjectId();
 await Prospect.create([
  {sourceRecordKey:'alpha',source:'fixture',companyName:'Different spreadsheet alias',companyId:a._id,regionGroup:'India',raw:{},contentHash:'a',importRunId:run},
  {sourceRecordKey:'beta',source:'fixture',companyName:'Employer Beta',regionGroup:'India',raw:{careersUrl:'https://hiretik.com/visa-sponsors'},contentHash:'b',importRunId:run},
  {sourceRecordKey:'unknown',source:'fixture',companyName:'Unmapped Employer',regionGroup:'Overseas',raw:{careersUrl:'https://www.ycombinator.com/companies/x/jobs'},contentHash:'c',importRunId:run},
  {sourceRecordKey:'conflict',source:'fixture',companyName:'Conflict Employer',identityStatus:'conflict',regionGroup:'India',raw:{careersUrl:'https://conflict.example/careers'},contentHash:'d',importRunId:run}
 ]);
 const report=await service.enqueueWatchCompanies(owner);assert.equal(report.queued,733);assert.equal(report.sourceRows,737);assert.equal(report.identityConflicts,1);
 const ats=await Task.find({userId:owner,domain:'jobs.lever.co',company:{$in:['Different spreadsheet alias','Employer Beta']}}).lean();assert.equal(ats.length,2);
 assert.deepEqual(ats.map(t=>t.employerDomain).sort(),['alpha.example','beta.example']);
 assert.equal(await Task.countDocuments({userId:owner,portalStatus:'needs_portal_mapping',company:{$in:['Unmapped Employer','Conflict Employer']}}),2);
});


test('conflicting experience statements use the strictest minimum and conversion negations fail closed',()=>{
 for(const description of ['0-1 years coding. Minimum 3 years professional experience required.','Freshers welcome, requires 2 years relevant work experience.','0-1 years experience with Java and 2-4 years experience in Python.']){
  const result=service.classifyRole('Software Engineer',description);assert.equal(result.eligibility,'excluded',description);
 }
 for(const description of ['2026 graduates; 0-1 years experience','Less than 1 year of experience','0-1 years relevant work experience'])assert.equal(service.classifyRole('Software Engineer',description).eligibility,'eligible',description);
 for(const description of ['Six month internship with no PPO or full-time conversion.','6 months internship without full-time conversion','Six months internship; PPO not available.','6 months internship, no guaranteed PPO'])assert.equal(service.classifyRole('AI Intern',description).eligibility,'needs_review',description);
 assert.equal(service.classifyRole('AI Intern','Six month internship with PPO conversion based on performance.').eligibility,'eligible');
});


test('daily research reservations cannot regress an already newer UTC day',async()=>{
 await seed();await Config.updateOne({userId:owner},{$set:{requestsDay:'2030-01-02',requestsUsed:50}});
 let report=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture,clock:()=>new Date('2030-01-01T23:59:59Z')});
 assert.equal(report.status,'budget_exhausted');let config=await Config.findOne({userId:owner});assert.equal(config.requestsDay,'2030-01-02');assert.equal(config.requestsUsed,50);
 report=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture,clock:()=>new Date('2030-01-03T00:00:00Z')});
 config=await Config.findOne({userId:owner});assert.equal(config.requestsDay,'2030-01-03');assert.equal(config.requestsUsed,report.requestsUsed);assert.equal(report.newJobs,1);
});

test('weekly contact refresh uses employer domain and expired leases cannot finalize a task',async()=>{
 const task=await seed();await Task.updateOne({_id:task._id},{$set:{employerDomain:'fixture.example'}});
 let calls=0;const contactDiscover=async args=>{calls++;assert.deepEqual(args.domains,['fixture.example']);assert.equal(args.dryRun,false);assert.equal(args.maxRequests,5);return {companies:[]};};
 await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture,contactDiscover});
 await Task.updateOne({_id:task._id},{$set:{nextScanAt:new Date(0)}});
 await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture,contactDiscover});assert.equal(calls,1);
 await Task.updateOne({_id:task._id},{$set:{nextScanAt:new Date(0)},$unset:{lastContactScanAt:1}});
 let current=new Date('2031-01-01T00:00:00Z');
 const report=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage:fixture,clock:()=>current,contactDiscover:async()=>{current=new Date(+current+121000);return {companies:[]};}});
 assert.equal(report.status,'lease_lost');assert.equal((await Task.findById(task._id)).state,'running');
});


test('India focus prioritizes Indian company scans and alerts only for evidenced Indian locations',async()=>{
 await seed();await Task.updateOne({userId:owner},{$set:{region:'India',regionPriority:1}});
 await Task.create({userId:owner,company:'Overseas first alphabetically',domain:'overseas.example',careersUrl:'https://overseas.example/careers',region:'Overseas',regionPriority:0,priority:100,nextScanAt:new Date(0)});
 const postings=[['India role',{address:{addressLocality:'Bengaluru',addressCountry:'IN'}}],['US role',{address:{addressLocality:'Seattle',addressCountry:'US'}}],['Unknown remote role',null]].map(([suffix,jobLocation],index)=>({'@type':'JobPosting',title:'Software Engineer '+suffix,description:'New graduate, 0-1 years experience',url:'https://fixture.example/jobs/'+index,jobLocation:jobLocation?[jobLocation]:undefined}));
 const fetchPage=async url=>url.endsWith('robots.txt')?{status:200,text:'User-agent: *\nAllow: /',contentType:'text/plain'}:{status:200,contentType:'text/html',text:'<script type="application/ld+json">'+JSON.stringify(postings)+'</script>'};
 const report=await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage});assert.equal(report.companies[0].company,'Fixture');assert.equal(report.newJobs,1);
 assert.equal(await Job.countDocuments(),3);assert.equal((await Job.findOne({locationRegion:'India'})).location,'Bengaluru, IN');
 const response=await request('/jobs');assert.equal(response.data.total,1);assert.equal(response.data.jobs[0].locationRegion,'India');
 assert.equal(service.locationRegion('Remote worldwide'),'unknown');assert.equal(service.locationRegion('Singapore'),'overseas');
 assert.equal(service.locationRegion('Hyderabad, India'),'India');
 const bad=await request('/config','PUT',{enabled:true,indiaFocus:'false'});assert.equal(bad.status,400);
 const good=await request('/config','PUT',{enabled:true,indiaFocus:false});assert.equal(good.status,200);assert.equal(good.data.config.indiaFocus,true);assert.equal((await request('/jobs?locationRegion=overseas')).data.total,1);
});


test('careers subdomains use known employer root domains and idempotent refresh repairs metadata without resetting progress',async()=>{
 const company=await Company.create({name:'Root Employer',domain:'employer.example',careersUrl:'https://careers.employer.example/jobs',isIndia:true});
 const first=await service.enqueueWatchCompanies(owner,{companyIds:[company._id]});assert.equal(first.queued,1);
 let task=await Task.findOne({userId:owner});assert.equal(task.domain,'careers.employer.example');assert.equal(task.employerDomain,'employer.example');
 await Task.updateOne({_id:task._id},{$set:{state:'complete',employerDomain:'careers.employer.example',lastContactScanAt:new Date(),nextScanAt:new Date('2032-01-01T00:00:00Z')}});
 const second=await service.enqueueWatchCompanies(owner,{companyIds:[company._id]});assert.equal(second.queued,0);assert.equal(second.updated,1);
 task=await Task.findById(task._id);assert.equal(task.employerDomain,'employer.example');assert.equal(task.lastContactScanAt,undefined);assert.equal(task.state,'complete');assert.equal(task.nextScanAt.toISOString(),'2032-01-01T00:00:00.000Z');
 const third=await service.enqueueWatchCompanies(owner,{companyIds:[company._id]});assert.equal(third.queued,0);assert.equal(third.updated,0);
});

test('Greenhouse URL changes adopt the legacy row and retain its history across scans',async()=>{
 const task=await seed();
 await Task.updateOne({_id:task._id},{$set:{careersUrl:'https://boards.greenhouse.io/fixture'}});
 const old=await Job.create({userId:owner,url:'https://boards.greenhouse.io/fixture/jobs/42',firstSeenAt:new Date('2020-01-01')});
 await Notification.create({userId:owner,jobId:old._id,title:'Earlier notification'});
 let url='https://job-boards.greenhouse.io/fixture/jobs/42?source=career';
 const fetchPage=async address=>({status:200,text:address.endsWith('/robots.txt')?'User-agent: *\nAllow: /':address.includes('/v1/boards/')?
   JSON.stringify({jobs:[{title:'Software Engineer',content:'0-1 years experience',absolute_url:url,location:{name:'India'}}]}):''});
 for (const suffix of ['','&updated=1']) {
  url+=suffix;
  await Task.updateOne({_id:task._id},{$set:{nextScanAt:new Date(0)}});
  await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage});
  const row=await Job.findById(old._id);
  assert.equal(row.url,url);
  assert.equal(row.requisitionKey,'greenhouse:fixture:42');
  assert.equal(row.firstSeenAt.toISOString(),'2020-01-01T00:00:00.000Z');
 }
 assert.equal(await Job.countDocuments(),1);
 assert.equal(await Notification.countDocuments(),1);
});
test('explicit source deadline can expire and reopen without changing job identity',async()=>{
 const task=await seed();
 let validThrough='2000-01-01T00:00:00Z';
 const fetchPage=async url=>({status:200,text:url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':
  '<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'Backend Engineer',description:'New graduate role',
    url:'https://fixture.example/jobs/deadline',jobLocation:'India',validThrough})+'</script>'});
 await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage});
 const first=await Job.findOne({userId:owner});
 assert.equal((await request('/jobs')).data.total,0);
 assert.equal(first.validThrough.toISOString(),'2000-01-01T00:00:00.000Z');
 assert.equal(await Notification.countDocuments(),0);
 validThrough='2099-01-01T00:00:00Z';
 await Task.updateOne({_id:task._id},{$set:{nextScanAt:new Date(0)}});
 await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage});
 const reopened=(await request('/jobs')).data.jobs[0];
 assert.equal(reopened._id,String(first._id));
 assert.equal(reopened.postingStatus,'published_deadline_active');
 assert.equal(await Notification.countDocuments(),1);
});

test('Lever structured pay remains a sourced range and preserves currency and period',()=>{
 const url='https://jobs.eu.lever.co/fixture/12345678-1234-1234-1234-123456789abc';
 const [job]=service.parseJobs({text:JSON.stringify([{hostedUrl:url,text:'Software Engineer',salaryRange:{currency:'EUR',interval:'per year',min:60000,max:70000}}])},url,'lever');
 assert.deepEqual(job.salaryEvidence,{currency:'EUR',period:'per year',amount:undefined,min:60000,max:70000,kind:'posted_salary_range',sourceUrl:url});
});

test('two complete Greenhouse misses hide the job and a returning listing restores the same record',async()=>{
 const task=await seed();
 await Task.updateOne({_id:task._id},{$set:{careersUrl:'https://boards.greenhouse.io/fixture'}});
 let now=new Date(), payload={jobs:[],meta:{total:0}}, failed=false;
 const fetchPage=async address=>{
  if(address.endsWith('/robots.txt'))return {status:200,text:'User-agent: *\nAllow: /'};
  if(address.includes('/v1/boards/'))return {status:failed?503:200,text:JSON.stringify(payload)};
  return {status:200,text:''};
 };
 async function scan(){
  await service.runCareerWatchOnce({userId:owner,dryRun:false,fetchPage,clock:()=>now});
  now=new Date(+now+service.INTERVAL_MS);
 }
 const jobs=[{id:42,title:'Software Engineer',content:'0-1 years experience',
  absolute_url:'https://boards.greenhouse.io/fixture/jobs/42',location:{name:'India'}}];
 payload={jobs,meta:{total:1}};
 await scan();
 const saved=await Job.findOne({userId:owner});
 assert.equal((await request('/jobs')).data.total,1);
 payload={jobs:[],meta:{total:0}};
 await scan();
 assert.equal((await request('/jobs')).data.total,1);
 failed=true;
 await scan();
 failed=false;
 payload.meta.total=1;
 await scan();
 assert.equal((await request('/jobs')).data.total,1);
 payload.meta.total=0;
 await scan();
 assert.equal((await request('/jobs')).data.total,0);
 assert.equal((await request('/notifications')).data.unread,0);
 assert.ok((await Job.findById(saved._id)).closedAt);
 payload={jobs,meta:{total:1}};
 await scan();
 assert.equal((await request('/jobs')).data.jobs[0]._id,String(saved._id));
 assert.equal(await Notification.countDocuments({userId:owner}),1);
});

test('background contact discovery runs independently of job portal mapping under a durable lease',async()=>{
 const task=await seed();
 await Task.updateOne({_id:task._id},{$set:{employerDomain:'fixture.example',portalStatus:'needs_portal_mapping'}});
 const config={userId:owner,autoImportContacts:true};
 let calls=0;
 const discover=async options=>{
  calls++;assert.equal(options.allowPublicUnverified,true);assert.equal(options.saveToContacts,true);
  assert.equal(options.maxRequests,3);
  assert.deepEqual(options.domains,['fixture.example']);return {companies:[{status:'complete'}]};
 };
 const budgetFor=async()=>({remaining:3});
 await Promise.all([service.scanDueContacts(config,{discover,budgetFor}),service.scanDueContacts(config,{discover,budgetFor})]);
 assert.equal(calls,1);assert.ok((await Task.findById(task._id)).lastContactScanAt);
 assert.ok((await Task.findById(task._id)).lastContactAttemptAt);
 assert.deepEqual(await service.scanDueContacts(config,{discover,budgetFor:async()=>({remaining:1})}),{status:'budget_exhausted'});
});

test('2027 profile selection rejects unknown batches, senior roles and untargeted fields',()=>{
 const {postingEvidence}=require('../services/jobPostingEvidence');
 const match = (title,description)=>service.matchesJuly2027Profile({
  title,description,...postingEvidence({title,description}),...service.classifyRole(title,description)
 });
 assert.equal(match('Software Engineer','New graduate hire. 2027 batch eligible.'),true);
 assert.equal(match('Machine Learning Intern','Six month internship. Class of 2027.'),true);
 assert.equal(match('Software Engineer','New graduate hire.'),false);
 assert.equal(match('Senior Software Engineer','Class of 2027. Requires 3+ years.'),false);
 assert.equal(match('Domain Advisor Expert (AI Expertise)','Fresher. Class of 2027.'),false);
 assert.equal(match('Software Engineer','New graduate hire. 2027 batch not eligible.'),false);
 assert.equal(match('Software Engineer','New graduate hire. Graduating by June 2027.'),false);
 assert.equal(match('Software Engineer','New graduate hire. Graduating July 2027.'),true);
});

test('Amazon exact posting requires a live application link and uses explicit graduation evidence',()=>{
 const url='https://www.amazon.jobs/en/jobs/10508052/fixture';
 const text='<h1>SDE I Intern</h1><a id="apply-button" href="https://www.amazon.jobs/applicant/jobs/10508052/apply">Apply now</a>'+
  '<div id="job-detail-body">Software Development Engineer 6 months Internship. We hire in India. Location IND, KA, Bengaluru. Year of Graduation 2027.</div>';
 const [row]=service.parseJobs({text},url);
 assert.equal(row.location,'India');
 assert.equal(row.graduationFit,'fits');
 assert.equal(service.matchesJuly2027Profile({...row,...service.classifyRole(row.title,row.description)}),true);
 assert.deepEqual(service.parseJobs({text:text.replace('10508052/apply','99/apply')},url),[]);
});

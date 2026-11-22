const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Lead=require('../models/ProfessionalLead'),Contact=require('../models/Contact'),Suppression=require('../models/RecipientSuppression'),Proof=require('../models/MailboxProof'),Candidate=require('../models/ContactCandidate');
const {importLeads}=require('../services/professionalSheetService'),{inferCandidates,extractPeople}=require('../services/professionalPatternService');
let mongo,owner,other;const Company=require('../models/Company');const models=[User,Lead,Contact,Suppression,Proof,Candidate,Company];
before(async()=>{mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all(models.map(m=>m.init()));});
after(async()=>{await mongoose.disconnect();await mongo.stop();});
beforeEach(async()=>{process.env.CONTACT_ADMISSION_ENABLED='false';await Promise.all(models.map(m=>m.deleteMany({})));owner=await User.create({name:'Owner',email:'owner@example.org',passwordHash:'fake'});other=await User.create({name:'Other',email:'other@example.org',passwordHash:'fake'});});
const lead=(extra={})=>({userId:owner._id,company:'Employer',domain:'employer.example',email:'careers@employer.example',kind:'role_inbox',title:'Recruiting inbox',sourceUrl:'https://employer.example/careers',observedAt:new Date(),...extra});
const deps={domainCheck:async()=>({status:'mx_found',hosts:['mx.employer.example']}),probe:async()=>({status:'smtp_reachable',mailboxVerified:false}),reserve:async(_id,args)=>{assert.equal(args.credits,0);}};
test('direct main-sheet import is idempotent, owner-scoped and SMTP connectivity never becomes mailbox verification',async()=>{
 const company=await Company.create({name:'Employer',domain:'employer.example'});
 const rows=await Lead.create([lead(),lead({email:'jane@employer.example',name:'Jane Doe',title:'Software Engineer',kind:'engineer'})]);let probes=0;
 const options={userId:owner._id,leadIds:rows.map(r=>r._id),...deps,probe:async()=>{probes++;return {status:'smtp_reachable',mailboxVerified:false};}};
 const result=await importLeads(options);assert.equal(result.added,2);assert.equal(probes,1);assert.equal(result.mailboxesVerified,0);
 for(const c of await Contact.find()){assert.equal(c.deliverabilityStatus,'unverified');assert.equal(c.smtpConnectivity.mailboxVerified,false);assert.equal(c.verificationStatus,'publicly_sourced');assert.equal(String(c.companyId),String(company._id));}
 assert.equal((await Contact.findOne({email:'jane@employer.example'})).contactKind,'engineer');assert.equal((await importLeads(options)).duplicates,2);assert.equal(await Contact.countDocuments(),2);
 const foreign=await importLeads({...options,userId:other._id});assert.equal(foreign.added,0);assert.equal(foreign.excluded,2);assert.equal(foreign.results.length,0);
});
test('blocks, invalid evidence and existing history survive research imports',async()=>{
 const rows=await Lead.create([lead(),lead({email:'invalid@employer.example'}),lead({email:'old@employer.example'})]);
 await Suppression.create({userId:owner._id,email:rows[0].email,source:'owner_block',reason:'Blocked'});
 await Contact.create({userId:owner._id,company:'Employer',email:rows[1].email,verificationStatus:'invalid',deliverabilityStatus:'invalid'});
 const old=await Contact.create({userId:owner._id,company:'Employer',email:rows[2].email,status:'sent',lastMailedAt:new Date('2026-11-01'),notes:'Keep my notes'});
 const result=await importLeads({userId:owner._id,leadIds:rows.map(r=>r._id),...deps});assert.equal(result.excluded,2);assert.equal(result.duplicates,1);
 const after=await Contact.findById(old._id);assert.equal(after.notes,'Keep my notes');assert.equal(after.status,'sent');assert.equal(after.lastMailedAt.toISOString(),'2026-11-01T00:00:00.000Z');assert.equal(await Contact.countDocuments(),2);
});
test('null MX rejected, temporary DNS staged, unreachable SMTP remains unverified and admission gate is respected',async()=>{
 const row=await Lead.create(lead());let result=await importLeads({userId:owner._id,leadIds:[row._id],...deps,domainCheck:async()=>({status:'null_mx',hosts:[]})});assert.equal(result.excluded,1);assert.equal(await Contact.countDocuments(),0);
 result=await importLeads({userId:owner._id,leadIds:[row._id],...deps,domainCheck:async()=>({status:'dns_inconclusive',hosts:[]})});assert.equal(result.staged,1);assert.equal(await Contact.countDocuments(),0);
 process.env.CONTACT_ADMISSION_ENABLED='true';result=await importLeads({userId:owner._id,leadIds:[row._id],...deps});assert.equal(result.staged,1);assert.equal(await Contact.countDocuments(),0);
 process.env.CONTACT_ADMISSION_ENABLED='false';result=await importLeads({userId:owner._id,leadIds:[row._id],...deps,probe:async()=>({status:'unreachable',mailboxVerified:false})});assert.equal(result.added,1);assert.equal((await Contact.findOne()).deliverabilityStatus,'unverified');assert.equal((await Contact.findOne()).smtpConnectivity.smtpStatus,'unreachable');
});
test('named candidates require explicit professional role and two observed pattern examples; no blind dot/underscore expansion',()=>{
 const published=[{name:'Jane Doe',email:'jane.doe@employer.example',sourceUrl:'https://employer.example/team'},{name:'Arjun Patel',email:'arjun.patel@employer.example',sourceUrl:'https://employer.example/team'}];
 const people=[{name:'Riya Sharma',title:'Software Engineer',sourceUrl:'https://employer.example/team'},{name:'Random Visitor',title:'Customer',sourceUrl:'https://employer.example/team'}];
 assert.deepEqual(inferCandidates({domain:'employer.example',people,published:published.slice(0,1)}),[]);
 const found=inferCandidates({domain:'employer.example',people,published});assert.equal(found.length,1);assert.equal(found[0].email,'riya.sharma@employer.example');assert.equal(found[0].inferenceFlag,true);assert.equal(found[0].verification,'inferred_unverified');assert.equal(found[0].patternEvidence.length,2);
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Person',name:'Riya Sharma',jobTitle:'Software Engineer',worksFor:{url:'https://employer.example'}})+'</script>';
 assert.equal(extractPeople(html,'https://employer.example/team','employer.example').length,1);assert.equal(extractPeople(html,'https://employer.example/team','different.example').length,0);
});


test('bounded public discovery combines professional team evidence with observed patterns and labels guesses',async()=>{
 const {fetchCompanyEmails}=require('../services/publicEmailDiscovery');const people=[{name:'Jane Doe',jobTitle:'Software Engineer',email:'jane.doe@employer.example'},{name:'Arjun Patel',jobTitle:'Hiring Manager',email:'arjun.patel@employer.example'},{name:'Riya Sharma',jobTitle:'Software Engineer'}].map(row=>({'@type':'Person',worksFor:{url:'https://employer.example'},...row}));
 const result=await fetchCompanyEmails('employer.example',{maxRequests:3,fetchPage:async url=>url.endsWith('robots.txt')?{status:200,text:'User-agent: *\nAllow: /',contentType:'text/plain'}:{status:200,text:'<script type="application/ld+json">'+JSON.stringify(people)+'</script>',contentType:'text/html'}});
 const guessed=result.emails.find(row=>row.email==='riya.sharma@employer.example');assert.ok(guessed);assert.equal(guessed.inferenceFlag,true);assert.equal(guessed.kind,'engineer');assert.equal(result.requestsUsed,3);
});


test('corporate repository contacts exclude personal emails, bots and stale authors without claiming employment or inbox validity',()=>{
 const {parseCorporateAuthors,sourceFor}=require('../services/corporateRepositoryDiscovery');const source=sourceFor('juspay.in'),now=new Date();
 const row=(name,email,date=now)=>({sha:'a'.repeat(40),commit:{author:{name,email,date:date.toISOString()}}});
 const found=parseCorporateAuthors([row('Riya Shah','riya.shah@juspay.in'),row('Personal User','person@gmail.com'),row('Release Bot','release@juspay.in'),row('Old Author','old@juspay.in',new Date(+now-100*86400000))],source,now);
 assert.equal(found.length,1);assert.equal(found[0].kind,'engineer');assert.match(found[0].title,/employment unverified/);assert.equal(found[0].inferenceFlag,false);assert.equal(sourceFor('madeup-employer.example'),null);
});

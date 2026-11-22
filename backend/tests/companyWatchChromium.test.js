const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express'),mongoose=require('mongoose'),jwt=require('jsonwebtoken'),path=require('node:path');
const https=require('node:https');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {chromium}=require('playwright');
const User=require('../models/User'),Job=require('../models/CareerWatchJob'),Notification=require('../models/CareerWatchNotification'),Lead=require('../models/ProfessionalLead'),Config=require('../models/CareerWatchConfig');

test('Chromium company watch integrates real jobs, owner-scoped notifications and separate recruiter/hiring-manager leads without provider calls', {timeout:90000}, async()=>{
  let mongo,server,browser,actualImport;let externalRequests=0;
  const originalRequest=https.request,originalFetch=global.fetch;
  try{
    process.env.JWT_SECRET='company-watch-browser-synthetic';
    process.env.CAREER_WATCH_ENABLED='false';process.env.PROFESSIONAL_DISCOVERY_BACKGROUND_ENABLED='false';
    process.env.OUTREACH_WORKER_ENABLED='false';process.env.OUTREACH_SENDING_ENABLED='false';
    process.env.CONTACT_ADMISSION_ENABLED='false';
    mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());
    const models=[User,Job,Notification,Lead,Config,require('../models/CareerWatchTask'),require('../models/RecipientSuppression'),require('../models/Contact'),require('../models/MailLog'),require('../models/ResearchUsage')];
    await Promise.all(models.map(model=>model.init()));
    const owner=await User.create({name:'Watch Browser Owner',email:'watch-browser@example.org',passwordHash:'synthetic-only'});
    const other=await User.create({name:'Other Owner',email:'other-watch@example.org',passwordHash:'synthetic-only'});
    const job=await Job.create({userId:owner._id,title:'Software Engineer - New Graduate',company:'Synthetic Employer',domain:'employer.example',url:'https://employer.example/jobs/graduate',location:'India',locationRegion:'India',locationPriority:2,companyRegion:'India',eligibility:'eligible',eligibilityReason:'Explicit FTE and less than one year experience',track:'fte',sourceType:'official_jsonld',salaryStatus:'unverified'});
    await Job.create({userId:owner._id,title:'Software Engineer - Experience Unspecified',company:'Synthetic Employer',domain:'employer.example',url:'https://employer.example/jobs/unknown',location:'India',locationRegion:'India',locationPriority:2,companyRegion:'India',eligibility:'needs_review',eligibilityReason:'Experience requirement not published',sourceType:'official_jsonld'});
    await Job.insertMany(Array.from({length:49},(_,i)=>({userId:owner._id,title:`Older India opening ${i}`,company:'Synthetic Employer',domain:'employer.example',url:`https://employer.example/jobs/older-${i}`,location:'India',locationRegion:'India',locationPriority:2,companyRegion:'India',eligibility:'eligible',firstSeenAt:new Date('2020-01-01')})));
    await Job.create({userId:owner._id,title:'Location evidence pending',company:'Synthetic Employer',url:'https://employer.example/jobs/location-pending',locationRegion:'unknown',locationPriority:1,companyRegion:'unknown',eligibility:'needs_review',firstSeenAt:new Date('2020-01-01')});
    await Job.create({userId:owner._id,title:'Overseas engineering opening',company:'Synthetic US Employer',url:'https://employer.example/jobs/overseas',location:'United States',locationRegion:'overseas',companyRegion:'overseas',eligibility:'eligible'});
    await Job.create({userId:other._id,title:'Private other-owner job',company:'Other Private Employer',url:'https://private.example/job',eligibility:'eligible'});
    const notification=await Notification.create({userId:owner._id,jobId:job._id,title:'New graduate engineering opening',company:'Synthetic Employer',url:job.url});
    await Notification.create({userId:other._id,jobId:new mongoose.Types.ObjectId(),title:'Private other-owner notification',url:'https://private.example/job'});
    const leadBase={userId:owner._id,company:'Synthetic Employer',domain:'employer.example',observedAt:new Date(),sourceUrl:'https://employer.example/careers',verificationStatus:'publicly_listed_not_mailbox_verified',confidence:'published_context'};
    await Lead.create({...leadBase,name:'Riya Recruiter',title:'Technical Recruiter',email:'riya@employer.example',kind:'recruiter'});
    await Lead.create({...leadBase,name:'Arjun Engineering Manager',title:'Engineering Hiring Manager',email:'arjun@employer.example',kind:'hiring_manager'});
    await Lead.create({...leadBase,name:'Recruiting Team',title:'Recruiting inbox',email:'careers@employer.example',kind:'role_inbox'});
    await Lead.create({...leadBase,userId:other._id,name:'Private Other Recruiter',email:'private@employer.example',kind:'recruiter'});

    await Lead.create({...leadBase,name:'Dev Shah',title:'Software Engineer',email:'dev.shah@employer.example',kind:'engineer',inferenceFlag:true,verificationStatus:'inferred_unverified',pattern:'first_dot_last',patternEvidence:[{email:'jane.doe@employer.example',url:'https://employer.example/team'},{email:'arjun.patel@employer.example',url:'https://employer.example/team'}]});
    const sheet=require('../services/professionalSheetService');actualImport=sheet.importLeads;
    sheet.importLeads=args=>actualImport({...args,domainCheck:async()=>({status:'mx_found',hosts:['mx.employer.example']}),probe:async()=>({status:'unreachable',mailboxVerified:false}),reserve:async()=>{}});
    // Prevent accidental HTTP provider calls in this otherwise real API/Mongo test.
    https.request=(...args)=>{externalRequests++;throw new Error('Unexpected external HTTPS request in company-watch browser test');};
    global.fetch=(url,...args)=>{
      const target=new URL(typeof url==='string'?url:url.url);
      if(!['127.0.0.1','localhost'].includes(target.hostname)){externalRequests++;throw new Error('Unexpected provider fetch');}
      return originalFetch(url,...args);
    };
    const app=express();app.use(express.json());
    app.use('/api/auth',require('../routes/auth'));
    app.use('/api/contacts',require('../routes/contact'));app.use('/api/mail',require('../routes/mail'));
    app.use('/api/jobs',require('../routes/job'));
    app.use('/api/recruiters',require('../routes/recruiter'));
    app.use('/api/career-watch',require('../routes/careerWatch'));
    app.use('/api/professional-discovery',require('../routes/professionalDiscovery'));
    const webDist=path.resolve(__dirname,'../../web/dist');app.use(express.static(webDist));
    app.get('/{*splat}',(_req,res)=>res.sendFile('index.html',{root:webDist}));
    await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol))return route.continue();
      externalRequests++;return route.abort();
    });
    await context.addInitScript(token=>localStorage.setItem('token',token),jwt.sign({_id:String(owner._id)},process.env.JWT_SECRET));
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>console.log('WATCH UI ERROR:',error.message));page.on('response',response=>{if(response.url().includes('/professional-discovery/import'))console.log('SHEET IMPORT HTTP:',response.status());});await page.goto(base+'/jobs');
    const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Job postings',exact:true})}).first();
    await panel.getByText('Software Engineer - New Graduate',{exact:true}).waitFor();
    await panel.getByText('Matches recorded eligibility',{exact:true}).first().waitFor();
    await panel.getByText('Software Engineer - Experience Unspecified',{exact:true}).waitFor();
    await panel.getByText('Eligibility needs review',{exact:true}).waitFor();
    assert.equal(await panel.getByText('Private other-owner job',{exact:true}).count(),0);
    assert.equal(await panel.locator('article').filter({has:page.getByText('Software Engineer - New Graduate',{exact:true})}).getByRole('link',{name:'Official job posting',exact:true}).getAttribute('href'),job.url);

    await panel.getByText('Monitoring settings',{exact:true}).click();
    const indiaFocus=panel.getByLabel('Focus on India jobs',{exact:true});
    assert.equal(await indiaFocus.isChecked(),true);
    assert.equal(await panel.getByText('Overseas engineering opening',{exact:true}).count(),0);
    await panel.getByRole('button',{name:'Next job page',exact:true}).click();
    await panel.getByText(/Job page 2 of 2/).waitFor();
    await panel.getByText('Location evidence pending',{exact:true}).waitFor();
    await panel.getByText('Location classification: Unconfirmed · Company coverage: Unconfirmed',{exact:true}).waitFor();
    await indiaFocus.click();
    await panel.getByText(/India focus disabled. Overseas results are available/).waitFor();
    await panel.getByText(/Job page 1 of 2/).waitFor();
    assert.equal((await Config.findOne({userId:owner._id})).indiaFocus,false);
    await panel.getByRole('button',{name:'Next job page',exact:true}).click();
    await panel.getByText('Overseas engineering opening',{exact:true}).waitFor();
    await panel.getByText('Location classification: Overseas · Company coverage: Overseas',{exact:true}).waitFor();
    await indiaFocus.click();
    await panel.getByText(/India focus enabled. Overseas jobs are excluded/).waitFor();
    await panel.getByText(/Job page 1 of 2/).waitFor();
    assert.equal((await Config.findOne({userId:owner._id})).indiaFocus,true);

    const monitoring=panel.getByLabel('Enable five-hour company monitoring',{exact:true});
    assert.equal(await monitoring.isChecked(),false);await monitoring.click();
    await panel.getByText('Configuration: Enabled',{exact:true}).waitFor();
    assert.equal((await Config.findOne({userId:owner._id})).enabled,true);
    await panel.getByText('Backend worker: Disabled',{exact:true}).waitFor();
    await monitoring.click();await panel.getByText('Configuration: Disabled',{exact:true}).waitFor();
    assert.equal((await Config.findOne({userId:owner._id})).intervalHours,5);

    await panel.getByRole('tab',{name:/Notifications/}).click();
    await panel.getByText('New graduate engineering opening',{exact:true}).waitFor();
    assert.equal(await panel.getByText('Private other-owner notification',{exact:true}).count(),0);
    await panel.getByRole('button',{name:'Mark notification read',exact:true}).click();
    await panel.getByText('Unread notifications: 0',{exact:true}).waitFor();
    assert.ok((await Notification.findById(notification._id)).readAt);

    assert.equal(await panel.getByRole('tab',{name:'Recruiters',exact:true}).count(),0);
    assert.deepEqual(await page.locator('nav a').evaluateAll(links=>links.map(a=>a.textContent.trim().replace(/\d+$/,''))),['Jobs','Mails']);
    await page.getByRole('link',{name:'Mails',exact:true}).click();
    await page.getByText('Find HR, recruiters, managers & SDE contacts',{exact:true}).click();
    await page.getByRole('button',{name:'Add saved research contacts',exact:true}).click();
    await page.getByText(/Added 4; existing 0; excluded 0; awaiting checks 0/).waitFor();
    await page.getByLabel('Contact type',{exact:true}).selectOption('engineer');
    await page.getByRole('row').filter({hasText:'dev.shah@employer.example'}).waitFor();
    await page.getByText('Guessed · mailbox unverified',{exact:true}).waitFor();
    assert.equal(await page.getByRole('row').filter({hasText:'riya@employer.example'}).count(),0);
    assert.equal(await require('../models/Contact').countDocuments({userId:other._id}),0);
    for(const contact of await require('../models/Contact').find())assert.equal(contact.deliverabilityStatus,'unverified');
    assert.equal(externalRequests,0);
    assert.equal(await require('../models/Contact').countDocuments(),4);
    assert.equal(await require('../models/MailLog').countDocuments(),0);
    assert.equal(await require('../models/ResearchUsage').countDocuments(),0);
  }finally{
    https.request=originalRequest;global.fetch=originalFetch;if(actualImport)require('../services/professionalSheetService').importLeads=actualImport;
    if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();if(mongo)await mongo.stop();
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeDomain,extractEmails,isPublicIP}=require('../services/publicEmailDiscovery');
test('only sources employer-domain emails that were actually shown on a public page',()=>{
  const html='<p>Our talent team: <a href="mailto:recruiting@acme.com">Email</a>. Ignore spam@example.org</p>';
  const result=extractEmails(html,'https://acme.com/careers','acme.com');
  assert.deepEqual(result.map(x=>x.email),['recruiting@acme.com']);
  assert.equal(result[0].verification,'publicly_listed_not_mailbox_verified');
});
test('refuses to invent contacts from a name and business domain',()=>{
  assert.deepEqual(extractEmails('<p>Recruiter Jane Doe</p>','https://acme.com/jobs','acme.com'),[]);
});
test('rejects unrelated domain, no-reply, and unsupported domains',()=>{
  assert.deepEqual(extractEmails('noreply@acme.com jobs@elsewhere.com','https://acme.com','acme.com'),[]);
  assert.equal(normalizeDomain('localhost'),null);
});
test('blocks private, link-local and loopback IP ranges',()=>{
  for(const ip of ['127.0.0.1','10.2.3.4','172.16.9.8','192.168.1.1','169.254.169.254','::1'])
    assert.equal(isPublicIP(ip),false,ip);
  assert.equal(isPublicIP('8.8.8.8'),true);
});

test('checks employer-linked public job boards and filters unrelated or support addresses', async () => {
  const {fetchCompanyEmails}=require('../services/publicEmailDiscovery');
  const seen=[];
  const fetchPage=async url=>{
    seen.push(url);
    if(url.endsWith('/robots.txt'))return {status:200,contentType:'text/plain',text:'User-agent: *\nAllow: /'};
    if(url==='https://acme.com/')return {status:200,contentType:'text/html',text:'<a href="https://careers.acme.com/">Careers</a>'};
    if(url==='https://careers.acme.com/')return {status:200,contentType:'text/html',text:'<a href="https://job-boards.greenhouse.io/acme">Open roles</a>'};
    if(url==='https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true')return {status:200,contentType:'application/json',text:JSON.stringify({jobs:[
      {absolute_url:'https://job-boards.greenhouse.io/acme/jobs/1',content:'<p>For application questions contact recruiting@acme.com.</p><p>For accessibility accommodations email jobs@acme.com.</p>'},
      {absolute_url:'https://job-boards.greenhouse.io/other/jobs/2',content:'<p>Apply through hiring@acme.com.</p>'}
    ]})};
    return {status:404,contentType:'text/plain'};
  };
  const result=await fetchCompanyEmails('acme.com',{fetchPage,maxRequests:8});
  assert.deepEqual(result.emails.map(row=>row.email),['recruiting@acme.com']);
  assert.equal(result.emails[0].atsEvidence.employerPage,'https://careers.acme.com/');
  assert.equal(result.emails[0].sourceUrl,'https://job-boards.greenhouse.io/acme/jobs/1');
  assert.equal(result.requestsUsed,seen.length);
});


test('robots uses matching user-agent groups, longest path, literal query and wildcard end markers',()=>{
  const {robotsAllows:r}=require('../services/safePublicFetch');
  const rules='User-agent: OtherBot\nDisallow: /\nUser-agent: *\nDisallow: /private\nDisallow: /jobs/*?secret=1$\nAllow: /private/public';
  assert.equal(r(rules,'/careers'),true);
  assert.equal(r(rules,'/private/x'),false);
  assert.equal(r(rules,'/%70rivate/x'),false);
  assert.equal(r(rules,'/private/public/1'),true);
  assert.equal(r(rules,'/jobs/1?secret=1'),false);
  assert.equal(r(rules,'/jobs/1?secret=1&other=2'),true);
  assert.equal(r('User-agent: *\nDisallow: /\nUser-agent: JobFinderResearch\nAllow: /careers','/careers'),true);
  assert.equal(r('User-agent: *\nDisallow: /jobs\nAllow: /jobs','/jobs'),true);
  assert.equal(r('Disallow: /','/careers'),false);
});

test('mapped official careers page gets priority but respects domain and robots scope', async () => {
  const { fetchCompanyEmails } = require('../services/publicEmailDiscovery');
  const mapped = 'https://acme.com/join/team';
  const requested = [];
  const fetchPage = async (url) => {
    requested.push(url);
    if (url.endsWith('/robots.txt')) return {status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /'};
    return {status:200,contentType:'text/html',text:'<p>Apply by emailing careers@acme.com</p>'};
  };
  const denied = await fetchCompanyEmails('acme.com', { preferredUrl: mapped, fetchPage, maxRequests: 3 });
  assert.deepEqual(denied.emails, []);
  assert.deepEqual(requested, ['https://acme.com/robots.txt']);

  requested.length = 0;
  const approved = async (url) => {
    requested.push(url);
    if (url.endsWith('/robots.txt')) return {status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /\nAllow: /join/team'};
    return {status:200,contentType:'text/html',text:'<p>Apply by emailing humancapital@acme.com</p>'};
  };
  const allowed = await fetchCompanyEmails('acme.com', { preferredUrl: mapped, fetchPage: approved, maxRequests: 3 });
  assert.deepEqual(requested, ['https://acme.com/robots.txt', mapped]);
  assert.deepEqual(allowed.emails.map(row=>row.email), ['humancapital@acme.com']);
  requested.length = 0;
  await fetchCompanyEmails('acme.com', { preferredUrl: 'https://not-acme.example/careers', fetchPage: approved, maxRequests: 3 });
  assert.deepEqual(requested, ['https://acme.com/robots.txt']);
});

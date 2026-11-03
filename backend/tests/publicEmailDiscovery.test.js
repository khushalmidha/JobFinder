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

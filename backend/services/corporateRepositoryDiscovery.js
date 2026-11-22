// Public, documented API only. Corporate repository mappings are reviewed,
// never inferred from a company name. No private GitHub token is used.
const SOURCES={
 'grafana.com':{company:'Grafana Labs',repository:'grafana/grafana',domains:['grafana.com'],evidenceUrl:'https://grafana.com/oss/grafana/'},
 'supabase.com':{company:'Supabase',repository:'supabase/supabase',domains:['supabase.io','supabase.com'],evidenceUrl:'https://supabase.com/'},
 'juspay.in':{company:'Juspay',repository:'juspay/hyperswitch',domains:['juspay.in','juspay.io'],evidenceUrl:'https://hyperswitch.io/'},
 'razorpay.com':{company:'Razorpay',repository:'razorpay/razorpay-node',domains:['razorpay.com'],evidenceUrl:'https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/'}
};
function sourceFor(domain){return SOURCES[domain]||Object.values(SOURCES).find(source=>source.domains.includes(domain))||null;}
function parseCorporateAuthors(commits,source,now=new Date()){
 const found=new Map();for(const row of Array.isArray(commits)?commits.slice(0,30):[]){
  const author=row.commit?.author,email=String(author?.email||'').toLowerCase(),name=String(author?.name||'').trim(),date=new Date(author?.date);
  if(!source.domains.includes(email.split('@')[1])||!name||/bot|no.?reply|automation/i.test(name+' '+email)||row.author?.type==='Bot'||!Number.isFinite(+date)||+now-+date>90*86400000||+date>+now+300000)continue;
  if(!/^[a-f0-9]{40}$/i.test(row.sha))continue;
  found.set(email,{email,name,title:'Corporate open-source contributor; employment unverified',kind:'engineer',sourceUrl:'https://github.com/'+source.repository+'/commit/'+row.sha,sourceType:'official_corporate_repository',publishedAt:date,inferenceFlag:false,confidence:'published_corporate_address',_repoVerified:true});
 }return [...found.values()].slice(0,30);
}
async function discoverCorporateRepository(domain,{fetchPage=require('./safePublicFetch').fetchPublicPage,now=new Date()}={}){
 const source=sourceFor(domain);if(!source)return {emails:[],requestsUsed:0};
 try{const response=await fetchPage('https://api.github.com/repos/'+source.repository+'/commits?per_page=30',{accept:'application/vnd.github+json',timeout:5000,maxBytes:1500000});if(response.status!==200)return {emails:[],requestsUsed:1,reason:'Public repository API '+response.status};return {emails:parseCorporateAuthors(JSON.parse(response.text),source,now),requestsUsed:1};}catch(error){return {emails:[],requestsUsed:1,reason:error.message};}
}
module.exports={sourceFor,parseCorporateAuthors,discoverCorporateRepository};

const {URL}=require('node:url');
function kindForTitle(title=''){
 if(/talent acquisition|recruit|\bhr\b|human resources/i.test(title))return 'recruiter';
 if(/(?:engineering|software|hiring) manager|head of engineering|engineering director/i.test(title))return 'hiring_manager';
 if(/software engineer|software developer|\bsde\b|backend engineer|frontend engineer|full.?stack engineer|machine learning engineer/i.test(title))return 'engineer';
 return null;
}
function parts(name){const words=String(name||'').trim().toLowerCase().split(/\s+/);return words.length>=2&&words.every(w=>/^[a-z]+$/.test(w))?{first:words[0],last:words.at(-1)}:null;}
const formats={first_last:({first,last})=>first+'_'+last,first_dot_last:({first,last})=>first+'.'+last,firstlast:({first,last})=>first+last,first_initial_last:({first,last})=>first[0]+last,first:({first})=>first};
function extractPeople(html,sourceUrl,domain){
 const result=[];const add=person=>{const kind=kindForTitle(person.jobTitle);if(!kind||!parts(person.name))return;const org=person.worksFor||person.affiliation;let host;try{host=new URL(org?.url).hostname.replace(/^www\./,'');}catch{}if(host!==domain)return;result.push({name:person.name,title:person.jobTitle,kind,sourceUrl,...(typeof person.email==='string'&&person.email.toLowerCase().split('@')[1]===domain?{email:person.email.toLowerCase()}:{} )});};
 const walk=(value,depth=0)=>{if(depth>12||!value)return;if(Array.isArray(value)){value.slice(0,200).forEach(v=>walk(v,depth+1));return;}if(typeof value!=='object')return;if([].concat(value['@type']||[]).includes('Person'))add(value);for(const key of ['@graph','employee','member','author'])if(value[key])walk(value[key],depth+1);};
 for(const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{walk(JSON.parse(match[1]));}catch{}
 return result.slice(0,100);
}
function inferCandidates({people=[],published=[],domain}={}){
 const observed=new Map();
 for(const row of published){const p=parts(row.name);if(!p||row.inferenceFlag||!row.sourceUrl||row.email?.split('@')[1]!==domain)continue;for(const [format,render]of Object.entries(formats))if(render(p)===row.email.split('@')[0]){const examples=observed.get(format)||[];if(!examples.some(e=>e.email===row.email))examples.push(row);observed.set(format,examples);}}
 const best=[...observed].sort((a,b)=>b[1].length-a[1].length)[0];
 // Require two independently named published work addresses. One arbitrary
 // common-format guess is not enough to infer a company-wide convention.
 if(!best||best[1].length<2)return [];
 const emails=new Set(published.map(r=>r.email));const out=[];
 for(const person of people){const p=parts(person.name),kind=kindForTitle(person.title);if(!p||!kind||!person.sourceUrl)continue;const email=formats[best[0]](p)+'@'+domain;if(emails.has(email))continue;emails.add(email);out.push({...person,kind,email,inferenceFlag:true,confidence:'pattern_inferred_not_verified',verification:'inferred_unverified',pattern:best[0],patternEvidence:best[1].map(r=>({email:r.email,url:r.sourceUrl})),sourceUrl:person.sourceUrl});}
 return out.slice(0,50);
}
module.exports={kindForTitle,extractPeople,inferCandidates};

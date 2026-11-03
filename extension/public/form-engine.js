/* JobFinder form assist. Runs only when explicitly invoked from the extension.
 * One question at a time. Never submits, navigates, uploads, signs or accepts terms. */
(function () {
  'use strict';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const key = value => text(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  const unsafe = /\b(visa|sponsor|work authori[sz]|eligible to work|citizen|nationality|passport|gender|pronoun|race|ethnic|disability|veteran|birth|dob|age|salary|ctc|compensation|notice period|availability|start date|relocat|address|city|street|postal|pin code|zip code|state|province|residen|consent|agree|terms|certif|signature|attest|privacy|legal|criminal|background check|conflict of interest|referral|referred by|captcha)\b/i;
  const selector = 'input:not([type="hidden"]),textarea,select,[role="combobox"],[role="radio"],[role="checkbox"],button[aria-haspopup="listbox"],button[data-automation-id="selectWidget"]';
  let working = false;

  function visible(el) {
    if (!el || !el.isConnected || el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return false;
    const css = getComputedStyle(el);
    return css.display !== 'none' && css.visibility !== 'hidden' && el.getClientRects().length > 0;
  }
  function group(el) {
    return el.closest('[role="listitem"],[data-automation-id="formField"],[data-automation-id="formFieldContainer"],fieldset,.Qr7Oae,.form-group') || el.closest('label') || el.parentElement;
  }
  function descriptor(el) {
    const root = group(el);
    const ids = text(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    const aria = ids.map(id => document.getElementById(id)?.textContent || '').join(' ');
    const explicit = el.labels?.length ? [...el.labels].map(x => x.textContent).join(' ') : '';
    const forLabel = el.id ? [...document.querySelectorAll('label[for]')].find(x => x.htmlFor === el.id)?.textContent : '';
    const outer = root?.querySelector('legend,[data-automation-id="fieldLabel"],[data-automation-id="formLabel"],.M7eMe,[role="heading"],label')?.textContent;
    const label = text(explicit || forLabel || aria || el.getAttribute('aria-label') || outer || el.getAttribute('placeholder') || '');
    const hint = key([el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('data-automation-id'), el.getAttribute('data-testid')].filter(Boolean).join(' '));
    return {label, hint, combined:key(label + ' ' + hint), root};
  }
  function kind(el) {
    if (el.tagName === 'SELECT') return 'select';
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.matches('[role="combobox"],button[aria-haspopup="listbox"],button[data-automation-id="selectWidget"]')) return 'combobox';
    if (el.matches('[role="radio"],input[type="radio"]')) return 'radio';
    if (el.matches('[role="checkbox"],input[type="checkbox"]')) return 'checkbox';
    return el.getAttribute('type') || 'text';
  }
  function answerFor(d, p) {
    const q=key(d.label);
    const is = rx => rx.test(q) || (!q && rx.test(d.hint));
    if (is(/\b(first|given) name\b|\bfname\b/)) return {value:p.firstName};
    if (is(/\b(last|family|sur) ?name\b|\blname\b/)) return {value:p.lastName};
    if (is(/^(full name|legal name|candidate name|your name|name)$/)) return {value:p.name};
    if (is(/\b(e ?mail|email address)\b/) && !/reference|referrer|recruiter|manager/.test(q)) return {value:p.email};
    if (is(/\b(phone|mobile|cell|contact number)\b/)) return {value:p.phone};
    if (is(/linkedin/)) return {value:p.linkedin};
    if (is(/github/)) return {value:p.github};
    if (is(/portfolio|personal website|website url/)) return {value:p.portfolio};
    if (is(/leetcode/)) return {value:p.leetcode};
    if (is(/codeforces/)) return {value:p.codeforces};
    if (is(/\b(university|college|institution|school name)\b/) && !/high school|secondary|previous/.test(q)) return {value:p.education?.institution};
    if (is(/\b(degree|qualification|education level)\b/)) return {value:p.education?.degree,alternates:['bachelor of technology','bachelor','b.tech','undergraduate']};
    if (is(/\b(major|field of study|branch|speciali[sz]ation)\b/)) return {value:p.education?.major};
    if (is(/\b(cgpa|gpa)\b/)) return {value:p.education?.cgpa};
    if (is(/(graduation|graduating|passout|passing) (year|date)|expected graduation/)) return {value:p.education?.endYear};
    if (is(/most recent (employer|company)|previous employer|internship company/)) return {value:p.currentExperience?.company};
    return null;
  }
  const matches = (option, ans) => [ans.value,...(ans.alternates || [])].filter(Boolean).some(x => key(x) === key(option.value) || key(x) === key(option.textContent || option.label || option.getAttribute('aria-label')));
  function inputValue(el, value) {
    if (!visible(el)) return false;
    const proto=el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    el.focus();
    if (setter) setter.call(el, String(value));
    else el.value=String(value);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return String(el.value)===String(value);
  }
  async function chooseCombo(el, ans) {
    if (el.getAttribute('aria-expanded') === 'true') return false;
    el.click();
    await wait(250);
    const id=el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const root=(id && document.getElementById(id)) || document;
    const opts=[...root.querySelectorAll('[role="option"],[data-automation-id="promptOption"],[data-automation-id="select-item"]')].filter(visible);
    const hit=opts.filter(o=>matches(o,ans));
    if (hit.length!==1) {
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return false;
    }
    hit[0].click();
    await wait(160);
    return true;
  }
  function chooseChoice(d, type, ans) {
    if (!d.root) return false;
    const sel=type==='radio'?'input[type="radio"],[role="radio"]':'input[type="checkbox"],[role="checkbox"]';
    const opts=[...d.root.querySelectorAll(sel)].filter(visible);
    const matched=opts.filter(o => matches({value:o.value,textContent:o.getAttribute('aria-label') || o.closest('label')?.textContent || o.getAttribute('data-value') || ''},ans));
    if (matched.length!==1) return false;
    if (opts.some(o => (o.checked || o.getAttribute('aria-checked')==='true') && o!==matched[0])) return false;
    const o=matched[0];
    if (!(o.checked || o.getAttribute('aria-checked')==='true')) o.click();
    return Boolean(o.checked || o.getAttribute('aria-checked')==='true');
  }
  async function writeAnswer(el, type, ans, desc, profile) {
    if (type==='select') {
      const choices=[...el.options].filter(o=>matches(o,ans));
      if (choices.length!==1 || el.value===choices[0].value) return false;
      el.value=choices[0].value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return el.value===choices[0].value;
    }
    if (type==='combobox') return chooseCombo(el,ans);
    if (type==='radio' || type==='checkbox') return chooseChoice(desc,type,ans);
    if (!['text','email','tel','url','number','textarea','search'].includes(type) || el.value) return false;
    const val=type==='tel' && el.maxLength===10 ? profile.phoneRaw : ans.value;
    if (el.maxLength>0 && String(val).length>el.maxLength) return false;
    return inputValue(el,val);
  }
  async function fillForm({profile,company,role,resumeId,resumes}={}) {
    if (working) return {success:false,filledCount:0,filledSummary:[],error:'Fill already running'};
    working=true;
    const report={success:true,filledCount:0,filledSummary:[],needsReview:[],skipped:[]};
    const visited=new WeakSet();
    const selected=resumes?.find(r=>r.id===resumeId) || resumes?.[0] || {};
    try {
      for(let i=0;i<160;i++) {
        const el=[...document.querySelectorAll(selector)].find(e=>visible(e) && !visited.has(e));
        if (!el) break;
        visited.add(el);
        const d=descriptor(el), type=kind(el), question=d.label || d.hint;
        if (!question || unsafe.test(d.combined.replace(/\b(?:e-?mail|email) address\b/gi,'email')) || ['file','password','date','hidden','submit','button','reset'].includes(type)) {
          report.skipped.push({question,reason:'Sensitive, unsupported, or unlabeled'});continue;
        }
        if (type==='radio'||type==='checkbox') {
          const relatives=d.root?.querySelectorAll(type==='radio'?'input[type="radio"],[role="radio"]':'input[type="checkbox"],[role="checkbox"]')||[];
          for(const r of relatives) visited.add(r);
        }
        let ans=answerFor(d,profile);
        let draft=false;
        if (!ans && type==='textarea' && d.label.length>=8 && !/reference|referr|verification|otp|password|upload/i.test(d.combined)) {
          // The backend only sees the question and supplied resume evidence, not the full webpage.
          try {
            const reply=await chrome.runtime.sendMessage({action:'GENERATE_HUMANOID_ANSWER',company,role,question:d.label,
              resumeDetails:{profile:{name:profile.name,education:profile.education,experience:profile.currentExperience},selectedResume:selected}});
            if (reply?.success && reply.answer && reply.answer.length>=25) {
              ans={value:text(reply.answer)};draft=true;
            }
          } catch (_) {}
        }
        if (!ans?.value) {report.skipped.push({question,reason:'No resume-supported answer'});continue;}
        try {
          if (await writeAnswer(el,type,ans,d,profile)) {
            report.filledCount++;
            report.filledSummary.push(question);
            if (draft) report.needsReview.push(question);
          } else report.skipped.push({question,reason:'No exact matching choice, already filled, or unsupported widget'});
        } catch (error) {report.skipped.push({question,reason:String(error.message||error)});}
        await wait(130);
      }
    } finally {working=false;}
    return {...report,filledSummary:[...new Set(report.filledSummary)]};
  }
  globalThis.JobFinderSafeEngine={fillForm};
})();
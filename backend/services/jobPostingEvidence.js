function postingEvidence({ title = '', description = '', location = '', employmentType, baseSalary, leverRange, url }) {
  const evidence = {};
  const explicitType = String(employmentType || '').replaceAll('_', ' ').toLowerCase();
  const type = /intern/i.test(title + ' ' + explicitType) ? 'internship'
    : /full[ -]time|permanent/.test(explicitType) ? 'full_time'
    : /part[ -]time|contract/.test(explicitType) ? 'other' : 'unknown';
  const graduation = /\b(?:graduating|graduates?|graduation|class of|batch of|passing out)(?:\s+(?:in|of|by))?\s+(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(20\d{2})\b|\b(20\d{2})\s*(?:batch|graduates?|pass(?:ing)?[ -]out)\b/gi;
  const batches = [...(title + '. ' + description).matchAll(graduation)];
  const graduationText = title + '. ' + description;
  let graduationFit = 'unknown';
  const explicit = batches.filter(match => {
    const before = graduationText.slice(Math.max(0, match.index-55),match.index);
    const after = graduationText.slice(match.index+match[0].length,match.index+match[0].length+35);
    return !/\b(?:no|not|except|excluding)\b[^.!?;]{0,25}$|\b(?:before|after|between)\s*$/i.test(before) &&
      !/^\s*(?:or|[–-]|to|through|\/)\s*(?:20)?\d{2}\b|^\s*(?:not eligible|excluded)/i.test(after) &&
      !/\bby\s+(?!July\b)/i.test(match[0]);
  });
  const allowed = explicit.find(batch => (batch[2] || batch[3]) === '2027' && (!batch[1] || /^july$/i.test(batch[1])));
  if (allowed && explicit.every(match => (match[2] || match[3]) === '2027') &&
      !/\b(?:no|not|exclude[sd]?|except)\b[^.!?;]{0,25}\b2027\b|\b2027\b[^.!?;]{0,24}\b(?:not eligible|excluded)\b/i.test(graduationText)) {
    graduationFit = 'fits';
    evidence.graduation = allowed[0];
  } else if (explicit.length && !allowed && batches.length === explicit.length) {
    graduationFit = 'outside';
    evidence.graduation = explicit[0][0];
  }
  const remote = [location, description].join(' ').match(/\b(?:remote(?:\s+work)?\s+(?:from|within|in)\s+India|India[ -]+remote)\b/i);
  const remoteContext = remote && [location, description].join(' ').slice(Math.max(0, remote.index - 40), remote.index + remote[0].length + 50);
  const remoteEligibility = remote && !/\b(?:no|not|except|cannot|may|might|hybrid)\b/i.test(remoteContext) ? 'india' : 'unknown';
  if (remote) evidence.remote = remoteContext.trim();
  const visa = description.match(/\b(?:no visa sponsorship|visa sponsorship (?:is )?(?:not available|unavailable|provided|available|considered case.by.case)|(?:we (?:do not|cannot|do offer)) sponsor work visas)\b/i);
  let sponsorship = 'unknown';
  if (visa) {
    evidence.sponsorship = visa[0];
    if (/not available|unavailable|^no |do not|cannot/i.test(visa[0])) sponsorship = 'unavailable';
    else if (/case.by.case/i.test(visa[0])) sponsorship = 'case_by_case';
    else if (!/\b(?:not|may|might|if|eligible)\b/i.test(description.slice(Math.max(0, visa.index - 25), visa.index + visa[0].length + 25))) sponsorship = 'explicit';
  }
  const duration = description.match(/\b(?:6|six)[ -]+months?\b/i);
  if (duration) evidence.duration = duration[0];
  const compensation = baseSalary?.value || (leverRange && {
    unitText:leverRange.interval,minValue:leverRange.min,maxValue:leverRange.max
  });
  const currency = baseSalary?.currency || leverRange?.currency;
  const amount = compensation?.value;
  const min = compensation?.minValue;
  const max = compensation?.maxValue;
  const salaryEvidence = /^[A-Z]{3}$/.test(currency || '') && typeof compensation?.unitText === 'string' && compensation.unitText.trim() &&
    ((Number.isFinite(amount) && amount >= 0) || (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && min <= max))
    ? { currency, period: compensation.unitText, amount, min, max, kind: baseSalary?.value ? 'posted_base_salary' : 'posted_salary_range', sourceUrl: url }
    : null;
  const roleFamily = /quant|trading developer/i.test(title) ? 'quant'
    : /machine learning|applied scientist|\b(?:ai|ml)\b|data scientist/i.test(title) ? 'ai_ml'
    : /product manager|\bapm\b/i.test(title) ? 'product'
    : /software|developer|engineer|\bsde\b/i.test(title) ? 'software' : 'unknown';
  return { roleFamily, employmentType: type, graduationFit, remoteEligibility, sponsorship, evidence, salaryEvidence };
}

module.exports = { postingEvidence };

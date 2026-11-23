function postingEvidence({ title = '', description = '', location = '', employmentType, baseSalary, leverRange, url }) {
  const evidence = {};
  const explicitType = String(employmentType || '').replaceAll('_', ' ').toLowerCase();
  const type = /intern/i.test(title + ' ' + explicitType) ? 'internship'
    : /full[ -]time|permanent/.test(explicitType) ? 'full_time'
    : /part[ -]time|contract/.test(explicitType) ? 'other' : 'unknown';
  const batch = description.match(/\b(?:graduating|graduate|graduation|class of|batch of)(?:\s+(?:in|of|by))?\s+(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(20\d{2})\b/i);
  const batchContext = batch && description.slice(Math.max(0, batch.index - 35), batch.index + batch[0].length + 30);
  let graduationFit = 'unknown';
  if (batch && !/\b(?:or|between|through|before|after|by|to|from)\b|\b20\d{2}\s*[-/–]\s*(?:20)?\d{2}/i.test(batchContext)) {
    const month = batch[1]?.toLowerCase();
    graduationFit = batch[2] === '2027' && (!month || month === 'july') ? 'fits' : 'outside';
    evidence.graduation = batch[0];
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

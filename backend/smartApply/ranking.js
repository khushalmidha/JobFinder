// Explainable local ranking. Never treats reported salary, missing experience or a title as verified eligibility.
function rankJob(job, profile) {
  const content = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const skillSet = new Set(Object.values(profile.skills || {}).flatMap(value => Array.isArray(value) ? value : String(value).split(/[,;]/)).map(x => String(x).trim().toLowerCase()).filter(Boolean));
  const matchedSkills = [...skillSet].filter(skill => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(content);
  });
  const reasons = []; const needsReview = [];
  let score = 1;
  if (matchedSkills.length) { score += Math.min(2, matchedSkills.length / 3); reasons.push(`Resume skills: ${matchedSkills.slice(0, 8).join(', ')}`); }
  if (/new.grad|fresher|\b2027\b|\bgraduate\b|sde.?1|swe.?1/.test(content)) { score++; reasons.push('Entry-level or batch language found; full eligibility needs review'); }
  if (/intern/.test(content) && /6[ -]?month|six.month/.test(content)) { score++; reasons.push('Six-month internship mentioned'); }
  if (/senior|\bsde.?[23]\b|\bswe.?[23]\b|staff engineer|principal engineer|[2-9]\+? years/.test(content)) { score = 1; needsReview.push('Seniority/experience may exceed target'); }
  if (String(job.locationRegion).toLowerCase() !== 'india' && !/india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|chennai|mumbai|delhi/i.test(job.location || '')) needsReview.push('India eligibility/location not confirmed');
  const base = job.salaryEvidence;
  if (base?.verified === true && base.currency === 'INR' && base.kind === 'fixed_base' && base.period === 'annual' && base.sourceUrl && base.asOf && Number.isFinite(base.amount)) {
    const threshold = Number(profile.preferences?.min_base_lpa || 12) * 100000;
    reasons.push(`Recorded fixed-base evidence: INR ${base.amount}/year (${base.asOf}); review freshness`);
    if (base.amount < threshold) needsReview.push('Recorded base is below profile preference');
  } else needsReview.push('Fixed-base salary evidence unavailable');
  return { ...job, matchScore: Math.max(1, Math.min(5, Math.round(score))), matchReasons: reasons, needsReview, applyReadiness: 'manual_review' };
}
module.exports = { rankJob };

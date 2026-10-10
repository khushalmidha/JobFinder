import resumeData from '../resumes.json';

/**
 * Matches a job role and description against Khushal's 5 resume variants
 */
export function matchBestResume(jobTitle = '', jobDescription = '', companyName = '') {
  const text = `${jobTitle} ${jobDescription} ${companyName}`.toLowerCase();
  const resumes = resumeData.resumes;

  const scored = resumes.map(resume => {
    let score = 20; // baseline
    const matchedKeywords = [];

    // Check target roles
    resume.targetRoles.forEach(role => {
      const roleLower = role.toLowerCase();
      if (jobTitle.toLowerCase().includes(roleLower)) {
        score += 40;
        matchedKeywords.push(role);
      } else if (text.includes(roleLower)) {
        score += 20;
        matchedKeywords.push(role);
      }
    });

    // Check primary keywords
    (resume.primaryKeywords || []).forEach(kw => {
      const kwLower = kw.toLowerCase();
      if (text.includes(kwLower)) {
        score += 10;
        matchedKeywords.push(kw);
      }
    });

    // Specific rules
    if (resume.id === 'variant_quant_cpp' && (text.includes('c++') || text.includes('trading') || text.includes('quant') || text.includes('hft') || text.includes('order book'))) {
      score += 45;
    }
    if (resume.id === 'variant_ml_ai' && (text.includes('machine learning') || text.includes('pytorch') || text.includes('nlp') || text.includes('llm') || text.includes('deep learning'))) {
      score += 45;
    }
    if (resume.id === 'variant_sde_fullstack' && (text.includes('full stack') || text.includes('react') || text.includes('node') || text.includes('sde') || text.includes('backend'))) {
      score += 35;
    }
    if (resume.id === 'variant_security_fintech' && (text.includes('security') || text.includes('fintech') || text.includes('bank') || text.includes('goldman'))) {
      score += 40;
    }

    // Clamp score to 100
    const finalScore = Math.min(Math.max(score, 35), 99);

    return {
      resume,
      score: finalScore,
      matchedKeywords: [...new Set(matchedKeywords)]
    };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  let rationale = `Matched ${best.resume.title} based on key role requirements (${best.matchedKeywords.slice(0, 3).join(', ') || 'Core SDE alignment'}).`;
  if (best.resume.id === 'variant_quant_cpp') {
    rationale = `Targeted for Quantitative / C++ low-latency engineering with QuantDesk order matching and deterministic systems expertise.`;
  } else if (best.resume.id === 'variant_ml_ai') {
    rationale = `Targeted for Machine Learning / GenAI role highlighting ThreatGraph (GNNs) and Jagrit (XGBoost/NRMS) architectures.`;
  } else if (best.resume.id === 'variant_sde_fullstack') {
    rationale = `Targeted for Fullstack SDE with MediPulse high-scale SaaS (125 APIs, Kafka/Redis) & IIITLBachat.`;
  } else if (best.resume.id === 'variant_hackathon_growth') {
    rationale = `Targeted for rapid growth engineering showcasing Amazon ML Challenge (Top 50), Meta Hacker Cup, and ICPC Amritapuri rankings.`;
  }

  return {
    bestResume: best.resume,
    score: best.score,
    rationale,
    allCandidates: scored
  };
}

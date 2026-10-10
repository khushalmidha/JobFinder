/**
 * SDE1 & Entry-level compensation estimator based on company tier and job role
 */

const QUANT_FIRMS = [
  'graviton', 'tower research', 'jane street', 'millennium', 'jump trading', 
  'd.e. shaw', 'de shaw', 'hudson river', 'hrt', 'quadeye', 'worldquant', 
  'citadel', 'optiver', 'flow traders', 'two sigma', 'drw', 'alphagrep'
];

const TIER1_TECH = [
  'google', 'microsoft', 'uber', 'apple', 'amazon', 'atlassian', 'adobe', 
  'salesforce', 'linkedin', 'meta', 'facebook', 'nvidia', 'stripe', 'databricks', 
  'intuit', 'netflix', 'airbnb', 'snowflake', 'palantir', 'twillio', 'rubrik'
];

const TOP_UNICORNS = [
  'swiggy', 'zomato', 'razorpay', 'zepto', 'flipkart', 'meesho', 'cred', 
  'groww', 'phonepe', 'browserstack', 'postman', 'inmobi', 'blinkit', 
  'urban company', 'ola', 'zerodha', 'dream11', 'myntra', 'paytm'
];

const ESTABLISHED_PRODUCT = [
  'oracle', 'cisco', 'sap', 'qualcomm', 'paypal', 'vmware', 'servicenow', 
  'siemens', 'amd', 'expedia', 'gojek', 'samsung', 'intel', 'morgan stanley', 
  'goldman sachs', 'jpmorgan', 'jp morgan', 'barclays', 'deutsche bank', 'coffeee'
];

export function estimateSalary(companyName = '', jobTitle = '') {
  const normComp = (companyName || '').toLowerCase().trim();
  const normTitle = (jobTitle || '').toLowerCase().trim();

  const is6MonthIntern = /6[\s-]*month|six[\s-]*month|6m\b|jan[\s-]*june|january[\s-]*june|semester[\s-]*intern|off[\s-]*campus[\s-]*intern|winter[\s-]*intern|spring[\s-]*intern/.test(normTitle);
  const isIntern = is6MonthIntern || normTitle.includes('intern') || normTitle.includes('trainee');
  const isQuant = normTitle.includes('quant') || normTitle.includes('hft') || normTitle.includes('trading') || normTitle.includes('low latency');
  const isML = normTitle.includes('ml') || normTitle.includes('machine learning') || normTitle.includes('ai ') || normTitle.includes('genai') || normTitle.includes('data sci');

  // Check tiers
  if (QUANT_FIRMS.some(q => normComp.includes(q)) || (isQuant && normComp.length > 0)) {
    return {
      tier: 'Tier 0: Top-Tier HFT / Quant',
      baseSalary: isIntern ? '₹1.5L - ₹3.0L / mo' : '₹48 - ₹65 LPA',
      ctc: isIntern ? '₹80 - ₹1.4 Cr PPO' : '₹80 LPA - ₹1.5 Cr',
      rating: is6MonthIntern ? '⭐ 6M Intern (Tier 0 Quant) ⭐⭐⭐⭐⭐' : 'Elite Comp ⭐⭐⭐⭐⭐',
      color: 'emerald',
      baseNumeric: 50,
      ctcNumeric: 95,
      isIntern,
      is6MonthIntern
    };
  }

  if (TIER1_TECH.some(t => normComp.includes(t))) {
    return {
      tier: 'Tier 1: Global Tech Titan',
      baseSalary: isIntern ? '₹80k - ₹1.5L / mo' : '₹20 - ₹28 LPA',
      ctc: isIntern ? '₹35 - ₹55 LPA PPO' : '₹38 - ₹56 LPA',
      rating: 'Tier-1 FAANG/MNC ⭐⭐⭐⭐⭐',
      color: 'indigo',
      baseNumeric: 22,
      ctcNumeric: 42,
      isIntern
    };
  }

  if (TOP_UNICORNS.some(u => normComp.includes(u))) {
    return {
      tier: 'Tier 1.5: High-Growth Unicorn',
      baseSalary: isIntern ? '₹50k - ₹1.0L / mo' : '₹18 - ₹25 LPA',
      ctc: isIntern ? '₹26 - ₹40 LPA PPO' : '₹26 - ₹42 LPA',
      rating: 'High-Growth Tech ⭐⭐⭐⭐',
      color: 'purple',
      baseNumeric: 19,
      ctcNumeric: 32,
      isIntern
    };
  }

  if (ESTABLISHED_PRODUCT.some(p => normComp.includes(p))) {
    return {
      tier: 'Tier 2: Global Product / FinTech',
      baseSalary: isIntern ? '₹40k - ₹80k / mo' : '₹14 - ₹20 LPA',
      ctc: isIntern ? '₹18 - ₹28 LPA PPO' : '₹18 - ₹30 LPA',
      rating: 'Established Product ⭐⭐⭐⭐',
      color: 'blue',
      baseNumeric: 16,
      ctcNumeric: 24,
      isIntern
    };
  }

  // ML / High skill boost for generic companies
  if (isML) {
    return {
      tier: 'Specialized: AI & Machine Learning Role',
      baseSalary: isIntern ? '₹40k - ₹75k / mo' : '₹14 - ₹22 LPA',
      ctc: isIntern ? '₹18 - ₹32 LPA PPO' : '₹18 - ₹32 LPA',
      rating: 'High-Demand AI Role ⭐⭐⭐⭐',
      color: 'cyan',
      baseNumeric: 17,
      ctcNumeric: 26,
      isIntern
    };
  }

  // Default Standard Tech / VC Funded Startup estimate
  return {
    tier: 'Standard / VC-Backed Tech',
    baseSalary: isIntern ? '₹30k - ₹60k / mo' : '₹12 - ₹18 LPA',
    ctc: isIntern ? '₹15 - ₹25 LPA PPO' : '₹15 - ₹24 LPA',
    rating: 'Market Competitive ⭐⭐⭐',
    color: 'amber',
    baseNumeric: 14,
    ctcNumeric: 20,
    isIntern
  };
}

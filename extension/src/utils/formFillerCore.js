/**
 * FormFillerCore - Pure, deterministic semantic form-filling engine
 * Works in browser extension, background workers, and headless/JSDOM test suites.
 */

// Candidate Master Profile (Verified Source of Truth: Khushal Midha)
export const CANDIDATE_PROFILE = {
  fullName: "Khushal Midha",
  firstName: "Khushal",
  lastName: "Midha",
  email: "midhakhushal5@gmail.com",
  phone: "+91 90507 40836",
  phoneRaw: "9050740836",
  countryCode: "+91",
  college: "Indian Institute of Information Technology, Lucknow",
  collegeShort: "IIIT Lucknow",
  degree: "B.Tech in Computer Science and Artificial Intelligence",
  degreeShort: "B.Tech",
  major: "Computer Science and Artificial Intelligence",
  cgpa: "8.72",
  cgpaScale: "10",
  graduationDate: "July 2027",
  graduationYear: "2027",
  startYear: "2023",
  expectedAnnualSalaryINR: "₹30,00,000",
  expectedAnnualSalaryINRNumber: 3000000,
  expectedAnnualCtcLpa: "30 LPA",
  expectedAnnualCtcLpaNumber: 30,
  currentCompany: "Coffeee.io",
  currentRole: "Software Development Engineer Intern",
  internshipDuration: "June 2025 to August 2025",
  internshipHighlights: [
    "Built a project-based assessment module (Java, Spring Boot, React, PostgreSQL) where candidates debug live codebases via error logs, graded automatically against hidden test cases.",
    "Developed a read-only AI assistant (LLMs, Redis, Docker) to provide contextual hints without edit access, preserving evaluation integrity; validated in staging."
  ],
  skills: {
    languages: "C, C++, Python, JavaScript, Java, SQL, TypeScript, Go",
    frontend: "React.js, TypeScript, HTML, CSS, Tailwind CSS, Bootstrap",
    backend: "Node.js, Express.js, Spring Boot, Redis, Kafka, FastAPI",
    databases: "MongoDB, MySQL, PostgreSQL",
    mlAi: "PyTorch, XGBoost, Scikit-learn, Transformers, MLOps (MLflow), LLMs, Agentic AI, Prompt Engineering",
    tools: "Docker, Git, Postman, Linux, AWS"
  },
  links: {
    github: "https://github.com/khushalmidha",
    linkedin: "https://www.linkedin.com/in/khushalmidha",
    leetcode: "https://leetcode.com/u/khushalmidha",
    codeforces: "https://codeforces.com/profile/khushalmidha",
    codechef: "https://www.codechef.com/users/khushalmidha",
    portfolio: "https://github.com/khushalmidha"
  },
  location: {
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India"
  },
  workAuthorization: {
    authorizedInIndia: "Yes",
    gender: "Male"
  }
};

/**
 * Strict No-Submission Policy Patterns
 * These patterns identify buttons that trigger final submission.
 * Under NO circumstances should any automation click a matching button.
 */
export const FINAL_SUBMIT_PATTERNS = [
  /^submit\b/i,
  /^submit\s+application\b/i,
  /^send\s+application\b/i,
  /^finish\s+application\b/i,
  /^complete\s+application\b/i,
  /^confirm\s+and\s+submit\b/i,
  /^apply\s+now$/i,
  /^apply$/i,
  /^finalize\b/i
];

export function isFinalSubmitButton(buttonText, automationId = '', buttonType = '', role = '') {
  const text = (buttonText || '').trim().toLowerCase();
  const autoId = (automationId || '').trim().toLowerCase();
  const bType = (buttonType || '').trim().toLowerCase();

  // Explicit submit automation IDs
  if (autoId.includes('submit') || autoId.includes('finalize') || autoId.includes('finish')) {
    return true;
  }

  // Check text against submit regex patterns
  for (const pattern of FINAL_SUBMIT_PATTERNS) {
    if (pattern.test(text)) {
      // If it's inside a form or marked type="submit", it is definitely a final submission
      return true;
    }
  }

  if (text.includes('submit application') || text === 'submit') {
    return true;
  }

  return false;
}

/**
 * Checks whether a button is a safe navigation button (e.g. Next, Continue)
 * and verifies that it is NOT a submit button.
 */
export function isSafeNavigationButton(buttonText, automationId = '') {
  if (isFinalSubmitButton(buttonText, automationId)) {
    return false;
  }

  const text = (buttonText || '').trim().toLowerCase();
  const autoId = (automationId || '').trim().toLowerCase();

  if (autoId.includes('next') || autoId.includes('continue') || autoId.includes('step')) {
    return true;
  }

  const safePatterns = [
    /^next\b/i,
    /^continue\b/i,
    /^save\s*&\s*continue\b/i,
    /^save\s*and\s*continue\b/i,
    /^next\s*step\b/i
  ];

  return safePatterns.some(p => p.test(text));
}

/**
 * Question Context Extractor
 * Gathers complete context around an input element.
 */
export function extractQuestionContext(element) {
  if (!element) return { combined: '', labelText: '', isRequired: false, inputType: 'text' };

  const name = (element.getAttribute('name') || '').toLowerCase();
  const id = (element.getAttribute('id') || '').toLowerCase();
  const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
  const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
  const ariaLabelledBy = element.getAttribute('aria-labelledby') || '';
  const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
  const dataAutomation = (element.getAttribute('data-automation-id') || '').toLowerCase();
  const dataTestId = (element.getAttribute('data-testid') || '').toLowerCase();
  const role = (element.getAttribute('role') || '').toLowerCase();

  let labelText = '';
  let descriptionText = '';

  // 1. Aria-labelledby lookup
  if (ariaLabelledBy && typeof document !== 'undefined') {
    const lblEl = document.getElementById(ariaLabelledBy);
    if (lblEl) labelText = lblEl.innerText || lblEl.textContent || '';
  }

  // 2. Explicit label[for]
  if (!labelText && element.id && typeof document !== 'undefined') {
    const lbl = document.querySelector(`label[for="${element.id}"]`);
    if (lbl) labelText = lbl.innerText || lbl.textContent || '';
  }

  // 3. Parent label
  if (!labelText && element.closest) {
    const parentLabel = element.closest('label');
    if (parentLabel) labelText = parentLabel.innerText || parentLabel.textContent || '';
  }

  // 4. Preceding sibling label or span
  if (!labelText && element.parentElement) {
    const prev = element.previousElementSibling;
    if (prev && ['LABEL', 'SPAN', 'P', 'DIV', 'H3', 'H4'].includes(prev.tagName)) {
      labelText = prev.innerText || prev.textContent || '';
    }
  }

  // 5. Google Forms question container: div[role="listitem"], .geS5n, .Qr7Oae
  if (element.closest) {
    const gItem = element.closest('div[role="listitem"], .geS5n, .Qr7Oae');
    if (gItem) {
      const titleEl = gItem.querySelector('.M7eMe, [role="heading"], .FHIcHe');
      if (titleEl) labelText = titleEl.innerText || titleEl.textContent || '';
      const descEl = gItem.querySelector('.zHQkBf');
      if (descEl) descriptionText = descEl.innerText || descEl.textContent || '';
    }

    // 6. Workday form field container
    const wdField = element.closest('[data-automation-id*="formField"], [data-automation-id*="Section"], .css-1, [data-automation-id*="input"], .field, .form-group');
    if (wdField && !labelText) {
      const lbl = wdField.querySelector('label, [data-automation-id*="label"]');
      if (lbl) labelText = lbl.innerText || lbl.textContent || '';
    }
  }

  // Detect Required Status
  const isAriaRequired = element.getAttribute('aria-required') === 'true';
  const hasRequiredAttr = element.hasAttribute('required');
  const hasAsterisk = (labelText.includes('*') || descriptionText.includes('*'));
  const isRequired = isAriaRequired || hasRequiredAttr || hasAsterisk;

  // Clean labelText
  const cleanLabel = (labelText || '').replace(/[\n\r]+/g, ' ').trim();
  const cleanDesc = (descriptionText || '').replace(/[\n\r]+/g, ' ').trim();

  // Determine Input Type
  let inputType = (element.getAttribute('type') || element.tagName || 'text').toLowerCase();
  if (element.tagName === 'TEXTAREA') inputType = 'textarea';
  if (element.tagName === 'SELECT') inputType = 'select';
  if (role === 'combobox') inputType = 'combobox';
  if (role === 'radiogroup' || role === 'radio') inputType = 'radio';
  if (role === 'checkbox') inputType = 'checkbox';
  if (role === 'listbox') inputType = 'listbox';

  const combined = `${name} ${id} ${placeholder} ${ariaLabel} ${autocomplete} ${dataAutomation} ${dataTestId} ${cleanLabel} ${cleanDesc}`.toLowerCase();

  return {
    combined,
    labelText: cleanLabel || placeholder || name || dataAutomation,
    descriptionText: cleanDesc,
    isRequired,
    inputType
  };
}

/**
 * Question Classifier
 * Uses semantic matching to classify a question context and select the verified candidate response.
 */
export function classifyQuestion(context, profile = CANDIDATE_PROFILE) {
  const { combined, labelText, inputType, isRequired } = context;

  // 1. FIRST NAME
  if (
    (combined.includes('first') && combined.includes('name')) ||
    combined.includes('fname') ||
    combined.includes('legalnamesection_firstname') ||
    combined === 'first_name' ||
    combined === 'given_name'
  ) {
    return {
      type: 'FIRST_NAME',
      value: profile.firstName,
      confidence: 99,
      verified: true
    };
  }

  // 2. LAST NAME
  if (
    (combined.includes('last') && combined.includes('name')) ||
    combined.includes('lname') ||
    combined.includes('legalnamesection_lastname') ||
    combined.includes('family_name') ||
    combined === 'last_name' ||
    combined === 'surname'
  ) {
    return {
      type: 'LAST_NAME',
      value: profile.lastName,
      confidence: 99,
      verified: true
    };
  }

  // 3. FULL NAME
  if (
    (combined.includes('full name') || combined.includes('candidate name') || combined.includes('your name') || (combined.includes('name') && !combined.includes('company') && !combined.includes('user') && !combined.includes('first') && !combined.includes('last') && !combined.includes('school') && !combined.includes('college'))) &&
    (inputType === 'text' || inputType === 'input')
  ) {
    return {
      type: 'FULL_NAME',
      value: profile.fullName,
      confidence: 98,
      verified: true
    };
  }

  // 4. EMAIL
  if (
    combined.includes('email') ||
    inputType === 'email' ||
    combined.includes('addresssection_email') ||
    combined.includes('e-mail')
  ) {
    return {
      type: 'EMAIL',
      value: profile.email,
      confidence: 99,
      verified: true
    };
  }

  // 5. PHONE / MOBILE
  if (
    combined.includes('phone') ||
    combined.includes('mobile') ||
    combined.includes('cell') ||
    inputType === 'tel' ||
    combined.includes('contact number') ||
    combined.includes('phone-number')
  ) {
    const isRawRequested = combined.includes('raw') || combined.includes('digits only') || combined.includes('10 digit');
    return {
      type: 'PHONE',
      value: isRawRequested ? profile.phoneRaw : profile.phone,
      confidence: 98,
      verified: true
    };
  }

  // 6. COMPENSATION & SALARY STANDARDS
  // CRITICAL RULE:
  // - Expected Annual Salary in INR: ₹30,00,000 (or 3000000 if numeric)
  // - Expected Annual CTC in LPA: 30
  // - NEVER confuse with monthly salary, fixed pay, take-home salary, or current salary!
  const isSalaryQuery = combined.includes('salary') || combined.includes('ctc') || combined.includes('compensation') || combined.includes('remuneration') || combined.includes('expected pay');
  const isCurrentSalary = combined.includes('current') && isSalaryQuery;
  const isMonthlySalary = (combined.includes('month') || combined.includes('per month') || combined.includes('monthly')) && isSalaryQuery;
  const isFixedPay = combined.includes('fixed') && isSalaryQuery;

  if (isCurrentSalary || isMonthlySalary || isFixedPay) {
    // NEVER invent current salary, monthly salary, or fixed pay!
    return {
      type: 'UNVERIFIED_COMPENSATION',
      requiresManualReview: true,
      reason: 'Question requests current or monthly salary / fixed pay. Never fabricate unverified current compensation.',
      confidence: 0,
      verified: false
    };
  }

  if (isSalaryQuery) {
    const isLpaExplicit = combined.includes('lpa') || combined.includes('lakh') || combined.includes('lacs') || combined.includes('in lpa');
    const isNumericOnly = inputType === 'number';

    if (isLpaExplicit) {
      return {
        type: 'EXPECTED_CTC_LPA',
        value: isNumericOnly ? profile.expectedAnnualCtcLpaNumber : 30,
        confidence: 98,
        verified: true
      };
    }

    // Default INR expected annual salary
    return {
      type: 'EXPECTED_ANNUAL_SALARY_INR',
      value: isNumericOnly ? profile.expectedAnnualSalaryINRNumber : profile.expectedAnnualSalaryINR,
      confidence: 98,
      verified: true
    };
  }

  // 7. NOTICE PERIOD (Never invent!)
  if (combined.includes('notice period') || combined.includes('notice')) {
    return {
      type: 'NOTICE_PERIOD',
      requiresManualReview: true,
      reason: 'Question requests notice period. Never invent notice period for candidate.',
      confidence: 0,
      verified: false
    };
  }

  // 8. ADDRESS / LOCATION (Never invent street address!)
  if (combined.includes('street address') || combined.includes('address line 1') || combined.includes('addressline1')) {
    return {
      type: 'ADDRESS_LINE',
      requiresManualReview: true,
      reason: 'Question requests detailed street address. Never invent unverified physical address.',
      confidence: 0,
      verified: false
    };
  }

  if (combined.includes('city') || combined.includes('town') || combined.includes('current city')) {
    return {
      type: 'CITY',
      value: profile.location.city,
      confidence: 95,
      verified: true
    };
  }

  if (combined.includes('state') || combined.includes('province')) {
    return {
      type: 'STATE',
      value: profile.location.state,
      confidence: 95,
      verified: true
    };
  }

  if (combined.includes('country') && !combined.includes('code')) {
    return {
      type: 'COUNTRY',
      value: profile.location.country,
      confidence: 98,
      verified: true
    };
  }

  // 9. UNIVERSITY / COLLEGE
  if (
    combined.includes('university') ||
    combined.includes('college') ||
    combined.includes('institution') ||
    combined.includes('school')
  ) {
    return {
      type: 'COLLEGE',
      value: profile.college,
      shortValue: profile.collegeShort,
      confidence: 98,
      verified: true
    };
  }

  // 10. DEGREE
  if (combined.includes('degree') || combined.includes('qualification')) {
    return {
      type: 'DEGREE',
      value: profile.degree,
      shortValue: profile.degreeShort,
      confidence: 98,
      verified: true
    };
  }

  // 11. MAJOR / BRANCH
  if (combined.includes('major') || combined.includes('discipline') || combined.includes('field of study') || combined.includes('branch')) {
    return {
      type: 'MAJOR',
      value: profile.major,
      confidence: 98,
      verified: true
    };
  }

  // 12. CGPA / GPA
  if (combined.includes('cgpa') || combined.includes('gpa') || combined.includes('grade point')) {
    return {
      type: 'CGPA',
      value: profile.cgpa,
      confidence: 98,
      verified: true
    };
  }

  // 13. GRADUATION YEAR / DATE
  if (combined.includes('graduat') || combined.includes('end year') || combined.includes('passout') || combined.includes('batch')) {
    return {
      type: 'GRADUATION_YEAR',
      value: profile.graduationYear,
      dateValue: profile.graduationDate,
      confidence: 98,
      verified: true
    };
  }

  // 14. CURRENT EMPLOYER & EXPERIENCE
  if (combined.includes('current company') || combined.includes('current employer') || combined.includes('most recent company') || combined.includes('organization')) {
    return {
      type: 'CURRENT_COMPANY',
      value: profile.currentCompany,
      confidence: 96,
      verified: true
    };
  }

  if (combined.includes('current title') || combined.includes('current role') || combined.includes('designation')) {
    return {
      type: 'CURRENT_ROLE',
      value: profile.currentRole,
      confidence: 96,
      verified: true
    };
  }

  // 15. SOCIAL & CODING LINKS
  if (combined.includes('linkedin')) {
    return { type: 'LINK_LINKEDIN', value: profile.links.linkedin, confidence: 99, verified: true };
  }
  if (combined.includes('github') || combined.includes('git profile')) {
    return { type: 'LINK_GITHUB', value: profile.links.github, confidence: 99, verified: true };
  }
  if (combined.includes('portfolio') || combined.includes('website') || combined.includes('personal site')) {
    return { type: 'LINK_PORTFOLIO', value: profile.links.portfolio, confidence: 98, verified: true };
  }
  if (combined.includes('leetcode')) {
    return { type: 'LINK_LEETCODE', value: profile.links.leetcode, confidence: 99, verified: true };
  }
  if (combined.includes('codeforces')) {
    return { type: 'LINK_CODEFORCES', value: profile.links.codeforces, confidence: 99, verified: true };
  }
  if (combined.includes('codechef')) {
    return { type: 'LINK_CODECHEF', value: profile.links.codechef, confidence: 99, verified: true };
  }

  // 16. WORK AUTHORIZATION
  if (
    combined.includes('authorized to work in india') ||
    combined.includes('legally authorized') ||
    combined.includes('eligible to work in india')
  ) {
    return { type: 'WORK_AUTH_INDIA', value: 'Yes', confidence: 98, verified: true };
  }

  // Sponsorship status (Never invent if not verified!)
  if (combined.includes('sponsorship') || combined.includes('require visa') || combined.includes('visa sponsorship')) {
    return {
      type: 'SPONSORSHIP',
      requiresManualReview: true,
      reason: 'Visa sponsorship requirement depends on the job jurisdiction. Never assume sponsorship status.',
      confidence: 0,
      verified: false
    };
  }

  // 17. GENDER
  if (combined.includes('gender')) {
    return { type: 'GENDER', value: 'Male', confidence: 95, verified: true };
  }

  // 18. OPEN ESSAYS & BEHAVIORAL QUESTIONS
  if (inputType === 'textarea' || (inputType === 'text' && combined.length > 30)) {
    if (combined.includes('why') && (combined.includes('company') || combined.includes('join') || combined.includes('role') || combined.includes('apply'))) {
      return {
        type: 'ESSAY_WHY_US',
        value: `I am particularly drawn to this opportunity because of the strong engineering standards and high-scale challenges. At IIIT Lucknow, I have built reliable distributed systems including MediPulse (healthcare SaaS with 125 REST APIs, Redis distributed locks, and Kafka event streaming) and competed actively in competitive programming (LeetCode Guardian 2137, Codeforces Expert 1809). During my SDE internship at Coffeee.io, I built production code evaluation modules in Spring Boot and Docker. I am eager to apply this engineering rigor and ownership to deliver high-impact features.`,
        confidence: 90,
        verified: true
      };
    }

    if (combined.includes('challenge') || combined.includes('difficult') || combined.includes('problem you solved') || combined.includes('bug')) {
      return {
        type: 'ESSAY_CHALLENGE',
        value: `While building MediPulse, concurrent appointment bookings across live OPD queues caused race conditions under high volume. To solve this, I introduced Redis distributed locks with idempotent tokens and transactional rollbacks, coupled with an asynchronous Kafka pipeline for queue processing. This eliminated race conditions and ensured strict serialization with zero state discrepancies.`,
        confidence: 90,
        verified: true
      };
    }

    if (combined.includes('about yourself') || combined.includes('summary') || combined.includes('bio') || combined.includes('introduce')) {
      return {
        type: 'ESSAY_ABOUT',
        value: `I am Khushal Midha, a B.Tech student in Computer Science & AI at IIIT Lucknow (CGPA: 8.72/10, graduating July 2027). I hold Guardian rank on LeetCode (2137), Expert on Codeforces (1809), and was an ICPC Amritapuri Regionalist. During my SDE internship at Coffeee.io, I developed automated code-grading modules in Spring Boot and Docker. I specialize in scalable backend architectures with Node.js, FastAPI, Redis, and Kafka.`,
        confidence: 90,
        verified: true
      };
    }
  }

  // If unclassified and required, flag for manual review! Never silently skip.
  if (isRequired) {
    return {
      type: 'UNKNOWN_REQUIRED',
      requiresManualReview: true,
      reason: `Required question "${labelText.slice(0, 40)}" could not be matched with 100% confidence from verified resume. Flagged for manual review.`,
      confidence: 0,
      verified: false
    };
  }

  return {
    type: 'UNMATCHED_OPTIONAL',
    confidence: 0,
    verified: false
  };
}

/**
 * Reconciles Workday parsed fields against verified candidate profile
 * Overwrites erroneous parser guesses with verified truth.
 */
export function reconcileWorkdayFields(parsedFields, profile = CANDIDATE_PROFILE) {
  const corrected = [];

  for (const [key, val] of Object.entries(parsedFields)) {
    const k = key.toLowerCase();
    let expected = null;

    if (k.includes('first') && k.includes('name')) expected = profile.firstName;
    else if (k.includes('last') && k.includes('name')) expected = profile.lastName;
    else if (k.includes('email')) expected = profile.email;
    else if (k.includes('phone') || k.includes('mobile')) expected = profile.phone;
    else if (k.includes('school') || k.includes('college') || k.includes('institution')) expected = profile.college;
    else if (k.includes('degree')) expected = profile.degree;

    if (expected && val !== expected) {
      corrected.push({ field: key, from: val, to: expected });
    }
  }

  return corrected;
}

/**
 * Generates an Audit & Completion Summary
 */
export function generateCompletionSummary(filledList = [], manualReviewList = [], errorsList = [], unansweredRequiredList = []) {
  const totalFilled = filledList.length;
  const totalManual = manualReviewList.length;
  const totalErrors = errorsList.length;
  const totalUnanswered = unansweredRequiredList.length;

  const overallStatus = (totalErrors === 0 && totalUnanswered === 0)
    ? 'Ready for Manual Review & Submission'
    : 'Action Required Before Manual Submission';

  return {
    overallStatus,
    summaryText: `Successfully filled ${totalFilled} fields. ${totalManual} fields flagged for manual review. Strict no-submission policy preserved application for manual confirmation.`,
    totalFilled,
    filled: filledList,
    totalManual,
    manualReview: manualReviewList,
    totalErrors,
    validationErrors: errorsList,
    totalUnanswered,
    unansweredRequired: unansweredRequiredList,
    strictNoSubmitEnforced: true
  };
}

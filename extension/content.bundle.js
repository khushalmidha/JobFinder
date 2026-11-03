/**
 * JobFinder AI & Auto-Apply Pilot - Content Script
 * Fully self-contained with ZERO external ES module imports.
 * Injected automatically across all frames and job portals.
 *
 * Implements 8-Stage Semantic Autofill Pipeline:
 * Question Detection -> Context Extraction -> Question Classification ->
 * Resume Retrieval -> Answer Generation -> Validation -> Field Interaction -> Verification
 *
 * Enforces Strict No-Submission Policy & Detailed Completion Summary.
 */

(function () {
  'use strict';

  // Prevent multiple injections in same frame
  if (window.__JOBFINDER_INJECTED__) return;
  window.__JOBFINDER_INJECTED__ = true;

  // Candidate Master Profile (Primary Source of Truth: Khushal Midha)
  const CANDIDATE_PROFILE = {
    fullName: "Khushal Midha",
    firstName: "Khushal",
    lastName: "Midha",
    email: "midhakhushal5@gmail.com",
    secondaryEmail: "khushalmidha19@gmail.com",
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
   * Under NO circumstances may automation click a matching button.
   */
  const FINAL_SUBMIT_PATTERNS = [
    /^submit\b/i,
    /^submit\s+application\b/i,
    /^send\s+application\b/i,
    /^finish\s+application\b/i,
    /^complete\s+application\b/i,
    /^confirm\s+and\s+submit\b/i,
    /^finalize\b/i
  ];

  function isFinalSubmitButton(buttonElement) {
    if (!buttonElement) return false;
    const text = (buttonElement.innerText || buttonElement.value || '').trim().toLowerCase();
    const autoId = (buttonElement.getAttribute('data-automation-id') || '').trim().toLowerCase();
    const id = (buttonElement.id || '').trim().toLowerCase();
    const type = (buttonElement.getAttribute('type') || '').trim().toLowerCase();

    if (autoId.includes('submit') || autoId.includes('finalize') || autoId.includes('finish') || id.includes('submit')) {
      return true;
    }

    if (type === 'submit' && (text.includes('submit') || text.includes('apply') || text.includes('send') || !text)) {
      return true;
    }

    for (const pattern of FINAL_SUBMIT_PATTERNS) {
      if (pattern.test(text)) return true;
    }

    if (text === 'submit' || text === 'submit application' || text === 'send application') {
      return true;
    }

    return false;
  }

  function isSafeNavigationButton(buttonElement) {
    if (!buttonElement || isFinalSubmitButton(buttonElement)) return false;
    const text = (buttonElement.innerText || buttonElement.value || '').trim().toLowerCase();
    const autoId = (buttonElement.getAttribute('data-automation-id') || '').trim().toLowerCase();

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
   */
  function extractQuestionContext(element) {
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

    if (ariaLabelledBy) {
      const lblEl = document.getElementById(ariaLabelledBy);
      if (lblEl) labelText = lblEl.innerText || lblEl.textContent || '';
    }

    if (!labelText && element.id) {
      const lbl = document.querySelector(`label[for="${element.id}"]`);
      if (lbl) labelText = lbl.innerText || lbl.textContent || '';
    }

    if (!labelText && element.closest) {
      const parentLabel = element.closest('label');
      if (parentLabel) labelText = parentLabel.innerText || parentLabel.textContent || '';
    }

    if (!labelText && element.parentElement) {
      const prev = element.previousElementSibling;
      if (prev && ['LABEL', 'SPAN', 'P', 'DIV', 'H3', 'H4'].includes(prev.tagName)) {
        labelText = prev.innerText || prev.textContent || '';
      }
    }

    // Google Forms item
    if (element.closest) {
      const gItem = element.closest('div[role="listitem"], .geS5n, .Qr7Oae');
      if (gItem) {
        const titleEl = gItem.querySelector('.M7eMe, [role="heading"], .FHIcHe');
        if (titleEl) labelText = titleEl.innerText || titleEl.textContent || '';
        const descEl = gItem.querySelector('.zHQkBf');
        if (descEl) descriptionText = descEl.innerText || descEl.textContent || '';
      }

      // Workday form field container
      const wdField = element.closest('[data-automation-id*="formField"], [data-automation-id*="Section"], .css-1, [data-automation-id*="input"], .field, .form-group');
      if (wdField && !labelText) {
        const lbl = wdField.querySelector('label, [data-automation-id*="label"]');
        if (lbl) labelText = lbl.innerText || lbl.textContent || '';
      }
    }

    const isAriaRequired = element.getAttribute('aria-required') === 'true';
    const hasRequiredAttr = element.hasAttribute('required');
    const hasAsterisk = (labelText.includes('*') || descriptionText.includes('*'));
    const isRequired = isAriaRequired || hasRequiredAttr || hasAsterisk;

    const cleanLabel = (labelText || '').replace(/[\n\r]+/g, ' ').trim();
    const cleanDesc = (descriptionText || '').replace(/[\n\r]+/g, ' ').trim();

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
   */
  function classifyQuestion(context, profile = CANDIDATE_PROFILE) {
    const { combined, labelText, inputType, isRequired } = context;

    // 1. FIRST NAME
    if (
      (combined.includes('first') && combined.includes('name')) ||
      combined.includes('fname') ||
      combined.includes('legalnamesection_firstname') ||
      combined === 'first_name' ||
      combined === 'given_name'
    ) {
      return { type: 'FIRST_NAME', value: profile.firstName, confidence: 99, verified: true };
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
      return { type: 'LAST_NAME', value: profile.lastName, confidence: 99, verified: true };
    }

    // 3. FULL NAME
    if (
      (combined.includes('full name') || combined.includes('candidate name') || combined.includes('your name') || (combined.includes('name') && !combined.includes('company') && !combined.includes('user') && !combined.includes('first') && !combined.includes('last') && !combined.includes('school') && !combined.includes('college'))) &&
      (inputType === 'text' || inputType === 'input')
    ) {
      return { type: 'FULL_NAME', value: profile.fullName, confidence: 98, verified: true };
    }

    // 4. EMAIL
    if (combined.includes('email') || inputType === 'email' || combined.includes('addresssection_email') || combined.includes('e-mail')) {
      return { type: 'EMAIL', value: profile.email, confidence: 99, verified: true };
    }

    // 5. PHONE / MOBILE
    if (combined.includes('phone') || combined.includes('mobile') || combined.includes('cell') || inputType === 'tel' || combined.includes('contact number') || combined.includes('phone-number')) {
      const isRawRequested = combined.includes('raw') || combined.includes('digits only') || combined.includes('10 digit');
      return { type: 'PHONE', value: isRawRequested ? profile.phoneRaw : profile.phone, confidence: 98, verified: true };
    }

    // 6. COMPENSATION & SALARY STANDARDS
    const isSalaryQuery = combined.includes('salary') || combined.includes('ctc') || combined.includes('compensation') || combined.includes('remuneration') || combined.includes('expected pay');
    const isCurrentSalary = combined.includes('current') && isSalaryQuery;
    const isMonthlySalary = (combined.includes('month') || combined.includes('per month') || combined.includes('monthly')) && isSalaryQuery;
    const isFixedPay = combined.includes('fixed') && isSalaryQuery;

    if (isCurrentSalary || isMonthlySalary || isFixedPay) {
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
      return { type: 'CITY', value: profile.location.city, confidence: 95, verified: true };
    }

    if (combined.includes('state') || combined.includes('province')) {
      return { type: 'STATE', value: profile.location.state, confidence: 95, verified: true };
    }

    if (combined.includes('country') && !combined.includes('code')) {
      return { type: 'COUNTRY', value: profile.location.country, confidence: 98, verified: true };
    }

    // 9. UNIVERSITY / COLLEGE
    if (combined.includes('university') || combined.includes('college') || combined.includes('institution') || combined.includes('school')) {
      return { type: 'COLLEGE', value: profile.college, shortValue: profile.collegeShort, confidence: 98, verified: true };
    }

    // 10. DEGREE
    if (combined.includes('degree') || combined.includes('qualification')) {
      return { type: 'DEGREE', value: profile.degree, shortValue: profile.degreeShort, confidence: 98, verified: true };
    }

    // 11. MAJOR / BRANCH
    if (combined.includes('major') || combined.includes('discipline') || combined.includes('field of study') || combined.includes('branch')) {
      return { type: 'MAJOR', value: profile.major, confidence: 98, verified: true };
    }

    // 12. CGPA
    if (combined.includes('cgpa') || combined.includes('gpa') || combined.includes('grade point')) {
      return { type: 'CGPA', value: profile.cgpa, confidence: 98, verified: true };
    }

    // 13. GRADUATION YEAR
    if (combined.includes('graduat') || combined.includes('end year') || combined.includes('passout') || combined.includes('batch')) {
      return { type: 'GRADUATION_YEAR', value: profile.graduationYear, dateValue: profile.graduationDate, confidence: 98, verified: true };
    }

    // 14. CURRENT EMPLOYER & EXPERIENCE
    if (combined.includes('current company') || combined.includes('current employer') || combined.includes('most recent company') || combined.includes('organization')) {
      return { type: 'CURRENT_COMPANY', value: profile.currentCompany, confidence: 96, verified: true };
    }

    if (combined.includes('current title') || combined.includes('current role') || combined.includes('designation')) {
      return { type: 'CURRENT_ROLE', value: profile.currentRole, confidence: 96, verified: true };
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

    if (isRequired) {
      return {
        type: 'UNKNOWN_REQUIRED',
        requiresManualReview: true,
        reason: `Required question "${labelText.slice(0, 40)}" could not be matched with 100% confidence from verified resume. Flagged for manual review.`,
        confidence: 0,
        verified: false
      };
    }

    return { type: 'UNMATCHED_OPTIONAL', confidence: 0, verified: false };
  }

  /**
   * Native Value Setter for React / Angular / Vue controlled inputs
   */
  function setNativeValue(element, value) {
    if (!element || value === undefined || value === null) return false;
    if (element.value === String(value)) return true;
    if (document.activeElement === element) return false; // Preserve active user editing

    try {
      element.focus();
    } catch (e) {}

    const lastValue = element.value;
    element.value = String(value);

    // React _valueTracker trigger
    const tracker = element._valueTracker;
    if (tracker) {
      tracker.setValue(lastValue);
    }

    const isTextArea = element.tagName === 'TEXTAREA';
    const standardProto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const standardSetter = Object.getOwnPropertyDescriptor(standardProto, 'value')?.set;
    const ownSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const protoSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;

    if (standardSetter) {
      standardSetter.call(element, String(value));
    } else if (protoSetter && ownSetter !== protoSetter) {
      protoSetter.call(element, String(value));
    } else if (ownSetter) {
      ownSetter.call(element, String(value));
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

    if (document.activeElement !== element) {
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    return element.value === String(value);
  }

  /**
   * Dropdown Option Matcher (Native <select>)
   */
  function selectOptionMatch(selectEl, keywords) {
    if (!selectEl || !selectEl.options) return false;
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      const optText = (opt.text || opt.value || '').toLowerCase();
      if (keywords.some(kw => optText.includes(kw.toLowerCase()))) {
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  /**
   * Custom Dropdown & Combobox Inspector
   * Opens menu, inspects options, selects match, and verifies.
   */
  function interactWithCustomDropdown(container, keywords) {
    if (!container) return false;
    const trigger = container.querySelector('button, [role="combobox"], [data-automation-id*="dropdown"], [aria-haspopup="listbox"]') || container;
    if (trigger && typeof trigger.click === 'function') {
      try {
        trigger.click();
      } catch (e) {}

      // Look for options in popup list
      const optionSelectors = '[role="option"], [data-automation-id="popupOption"], [data-automation-id="select-item"], li[role="option"], .select2-results li';
      const options = Array.from(document.querySelectorAll(optionSelectors));
      for (const opt of options) {
        const text = (opt.innerText || opt.textContent || '').toLowerCase().trim();
        if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
          try {
            opt.click();
            opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            return true;
          } catch (e) {}
        }
      }
    }
    return false;
  }

  /**
   * Generates formatted resume text for file uploads
   */
  function generateFormattedResumeText() {
    const p = CANDIDATE_PROFILE;
    return `=====================================================
${p.fullName.toUpperCase()}
Email: ${p.email} | Phone: ${p.phone}
LinkedIn: ${p.links.linkedin} | GitHub: ${p.links.github}
Location: ${p.location.city}, ${p.location.state}, ${p.location.country}
=====================================================

EDUCATION:
${p.college} (${p.startYear} - ${p.graduationYear})
Degree: ${p.degree}
CGPA: ${p.cgpa} / ${p.cgpaScale}

EXPERIENCE:
${p.currentCompany} — ${p.currentRole} (${p.internshipDuration})
- Built a project-based assessment module (Java, Spring Boot, React, PostgreSQL) where candidates debug live codebases via error logs, graded automatically against hidden test cases.
- Developed a read-only AI assistant (LLMs, Redis, Docker) to provide contextual hints without edit access, preserving evaluation integrity; validated in staging.

TECHNICAL SKILLS:
Languages: ${p.skills.languages}
Frontend: ${p.skills.frontend}
Backend: ${p.skills.backend}
Databases: ${p.skills.databases}
Machine Learning & AI: ${p.skills.mlAi}
Tools & DevOps: ${p.skills.tools}

COMPETITIVE PROGRAMMING & ACHIEVEMENTS:
- LeetCode Guardian (Max Rating 2137, Top 1.5% globally)
- Codeforces Expert (Max Rating 1809)
- CodeChef 5-Star (Max Rating 2137)
- Meta Hacker Cup Round 3 rank 186 among 14,000+ participants
- ICPC Regionalist at Amritapuri Regionals 2024-25
- Adobe Gensolve Hackathon Top 5% among 54,000+ participants
- Amazon ML Challenge 2026 Top 50 among 11,000+ teams
=====================================================`;
  }

  function autoAttachResumeFile() {
    try {
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (fileInputs.length === 0) return false;
      const fileInput = fileInputs[0];
      const resumeText = generateFormattedResumeText();
      const blob = new Blob([resumeText], { type: 'text/plain' });
      const file = new File([blob], 'Khushal_Midha_Resume.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Workday Multi-step & Field Reconciliation
   */
  function reconcileWorkdayParsedData(filledSummary) {
    try {
      const fields = [
        { sel: 'input[data-automation-id="legalNameSection_firstName"]', expected: CANDIDATE_PROFILE.firstName, name: 'First Name' },
        { sel: 'input[data-automation-id="legalNameSection_lastName"]', expected: CANDIDATE_PROFILE.lastName, name: 'Last Name' },
        { sel: 'input[data-automation-id="addressSection_email"]', expected: CANDIDATE_PROFILE.email, name: 'Email' },
        { sel: 'input[data-automation-id="phone-number"]', expected: CANDIDATE_PROFILE.phoneRaw, name: 'Phone' }
      ];

      fields.forEach(f => {
        const el = document.querySelector(f.sel);
        if (el && el.value !== f.expected && document.activeElement !== el) {
          setNativeValue(el, f.expected);
          filledSummary.push(`Reconciled Workday ${f.name} to verified profile`);
        }
      });
    } catch (e) {}
  }

  /**
   * Google Forms Dedicated Autofill Handler
   */
  function handleGoogleFormsQuestions(filledList, manualReviewList, unansweredRequiredList) {
    const items = Array.from(document.querySelectorAll('div[role="listitem"], .geS5n, .Qr7Oae'));
    if (items.length === 0) return 0;

    let gCount = 0;

    items.forEach(item => {
      const titleEl = item.querySelector('.M7eMe, [role="heading"], .FHIcHe');
      const labelText = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
      if (!labelText) return;

      const descEl = item.querySelector('.zHQkBf');
      const descText = descEl ? (descEl.innerText || descEl.textContent || '').trim() : '';
      const isRequired = Boolean(item.querySelector('.vOrSc, span[aria-label*="required"]') || labelText.includes('*'));

      const context = {
        combined: `${labelText} ${descText}`.toLowerCase(),
        labelText,
        descriptionText: descText,
        isRequired,
        inputType: 'text'
      };

      const decision = classifyQuestion(context, CANDIDATE_PROFILE);

      // 1. Text input inside Google Forms
      const textInput = item.querySelector('input[type="text"], input.whsOnd');
      if (textInput) {
        if (textInput.value) return; // Preserve existing
        if (decision.verified && decision.value) {
          setNativeValue(textInput, decision.value);
          if (textInput.value === String(decision.value)) {
            gCount++;
            filledList.push({ field: labelText, value: decision.value });
          }
        } else if (decision.requiresManualReview) {
          manualReviewList.push({ field: labelText, reason: decision.reason, required: isRequired });
          if (isRequired) unansweredRequiredList.push({ field: labelText, reason: decision.reason });
        }
        return;
      }

      // 2. Textarea inside Google Forms
      const textArea = item.querySelector('textarea, textarea.KHxj8b');
      if (textArea) {
        if (textArea.value) return;
        if (decision.verified && decision.value) {
          setNativeValue(textArea, decision.value);
          if (textArea.value === String(decision.value)) {
            gCount++;
            filledList.push({ field: labelText, value: decision.value.slice(0, 30) + '...' });
          }
        } else if (decision.requiresManualReview) {
          manualReviewList.push({ field: labelText, reason: decision.reason, required: isRequired });
          if (isRequired) unansweredRequiredList.push({ field: labelText, reason: decision.reason });
        }
        return;
      }

      // 3. Radio Group inside Google Forms
      const radioGroup = item.querySelector('div[role="radiogroup"]');
      if (radioGroup) {
        const radios = Array.from(radioGroup.querySelectorAll('div[role="radio"]'));
        const isAlreadyChecked = radios.some(r => r.getAttribute('aria-checked') === 'true');
        if (isAlreadyChecked) return;

        let matched = false;
        if (decision.verified && decision.value) {
          const targetVal = String(decision.value).toLowerCase();
          for (const r of radios) {
            const rLabel = (r.getAttribute('aria-label') || r.innerText || '').toLowerCase();
            if (rLabel.includes(targetVal) || (targetVal === 'yes' && rLabel.includes('yes')) || (targetVal === 'male' && rLabel.includes('male'))) {
              r.click();
              matched = true;
              gCount++;
              filledList.push({ field: labelText, value: rLabel });
              break;
            }
          }
        }
        if (!matched && isRequired) {
          unansweredRequiredList.push({ field: labelText, reason: 'No confident radio option matched verified profile' });
        }
        return;
      }

      // 4. Checkbox Group inside Google Forms
      const checkboxes = Array.from(item.querySelectorAll('div[role="checkbox"]'));
      if (checkboxes.length > 0) {
        const isAlreadyChecked = checkboxes.some(c => c.getAttribute('aria-checked') === 'true');
        if (isAlreadyChecked) return;

        if (context.combined.includes('terms') || context.combined.includes('agree') || context.combined.includes('consent')) {
          checkboxes[0].click();
          gCount++;
          filledList.push({ field: labelText, value: 'Agreed' });
        } else if (isRequired) {
          unansweredRequiredList.push({ field: labelText, reason: 'Checkbox question requires user confirmation' });
        }
        return;
      }

      // 5. Google Forms custom dropdown: div[role="listbox"]
      const listbox = item.querySelector('div[role="listbox"], div[jsname="WbAbvd"]');
      if (listbox) {
        if (decision.verified && decision.value) {
          try {
            listbox.click();
            setTimeout(() => {
              const options = Array.from(document.querySelectorAll('div[role="option"]'));
              const target = String(decision.value).toLowerCase();
              for (const opt of options) {
                const optText = (opt.innerText || opt.textContent || '').toLowerCase();
                if (optText.includes(target)) {
                  opt.click();
                  filledList.push({ field: labelText, value: optText });
                  break;
                }
              }
            }, 200);
            gCount++;
          } catch (e) {}
        } else if (isRequired) {
          unansweredRequiredList.push({ field: labelText, reason: 'Dropdown requires manual selection' });
        }
      }
    });

    return gCount;
  }

  /**
   * Master Form Auto-Fill Engine
   */
  function autoFillForm() {
    const profile = CANDIDATE_PROFILE;
    const filledList = [];
    const manualReviewList = [];
    const unansweredRequiredList = [];
    const validationErrors = [];

    // Step 1: Workday Resume Dropzone Handling
    const isWorkdayResume = (
      document.body && (
        document.body.innerText.includes('Autofill with Resume') ||
        document.body.innerText.includes('attach your Resume') ||
        document.body.innerText.includes('Drop file here')
      )
    ) || Boolean(document.querySelector('[data-automation-id="file-upload-dropzone"]'));

    if (isWorkdayResume) {
      const attached = autoAttachResumeFile();
      if (attached) {
        filledList.push({ field: 'Resume File', value: 'Khushal_Midha_Resume.txt' });
      }

      // Safe multi-step navigation: advance to Step 2
      const nextBtn = findNextButton();
      if (nextBtn) {
        setTimeout(() => {
          try { nextBtn.click(); } catch (e) {}
        }, 800);
      }
    }

    // Step 2: Handle Google Forms questions if present
    handleGoogleFormsQuestions(filledList, manualReviewList, unansweredRequiredList);

    // Step 3: Reconcile Workday parsed fields
    reconcileWorkdayParsedData(filledList);

    // Step 4: Process all standard inputs sequentially
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));

    inputs.forEach(el => {
      if (el.disabled || el.readOnly) return;
      if (document.activeElement === el) return; // User is actively typing

      // Check existing value (preserve user entry)
      if (el.value && el.value.trim() && el.type !== 'radio' && el.type !== 'checkbox') {
        return;
      }

      const context = extractQuestionContext(el);
      const decision = classifyQuestion(context, profile);

      if (decision.requiresManualReview) {
        manualReviewList.push({ field: context.labelText, reason: decision.reason, required: context.isRequired });
        if (context.isRequired) {
          unansweredRequiredList.push({ field: context.labelText, reason: decision.reason });
        }
        return;
      }

      if (!decision.verified || decision.value === undefined) {
        if (context.isRequired) {
          unansweredRequiredList.push({ field: context.labelText, reason: 'Required question could not be verified from resume' });
        }
        return;
      }

      // Field Interaction & Verification
      if (el.tagName === 'SELECT') {
        const keywords = [String(decision.value)];
        if (decision.shortValue) keywords.push(decision.shortValue);
        const selected = selectOptionMatch(el, keywords);
        if (selected) {
          filledList.push({ field: context.labelText, value: el.options[el.selectedIndex]?.text || decision.value });
        }
      } else if (el.type === 'radio') {
        const target = String(decision.value).toLowerCase();
        const label = (el.getAttribute('aria-label') || el.value || el.parentElement?.innerText || '').toLowerCase();
        if (label.includes(target) && !el.checked) {
          el.click();
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filledList.push({ field: context.labelText, value: label });
        }
      } else if (el.type === 'checkbox') {
        if (context.combined.includes('terms') || context.combined.includes('agree') || context.combined.includes('consent')) {
          if (!el.checked) {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            filledList.push({ field: context.labelText, value: 'Agreed' });
          }
        }
      } else {
        // Text / Textarea / Number / Tel
        const success = setNativeValue(el, decision.value);
        if (success || el.value === String(decision.value)) {
          filledList.push({ field: context.labelText, value: String(decision.value).slice(0, 40) });
        } else {
          // Retry using focus and direct assignment
          try {
            el.focus();
            el.value = String(decision.value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (el.value === String(decision.value)) {
              filledList.push({ field: context.labelText, value: String(decision.value).slice(0, 40) });
            }
          } catch (e) {}
        }
      }

      // Immediate Validation Error Detection
      if (el.getAttribute('aria-invalid') === 'true') {
        validationErrors.push({ field: context.labelText, error: 'Validation error detected on field' });
      }
    });

    const completionSummary = {
      filledCount: filledList.length,
      filled: filledList,
      manualReviewCount: manualReviewList.length,
      manualReview: manualReviewList,
      unansweredRequiredCount: unansweredRequiredList.length,
      unansweredRequired: unansweredRequiredList,
      validationErrorsCount: validationErrors.length,
      validationErrors,
      overallStatus: (validationErrors.length === 0 && unansweredRequiredList.length === 0)
        ? 'Ready for Manual Review & Final Submission'
        : 'Action Required: Please review flagged fields',
      strictNoSubmitEnforced: true
    };

    return completionSummary;
  }

  /**
   * Safe Navigation / Next Button Finder
   * Strictly enforces NO CLICKING on submit buttons!
   */
  function findNextButton() {
    const wdButtons = [
      document.querySelector('button[data-automation-id="bottom-navigation-next-button"]'),
      document.querySelector('button[data-automation-id="page-footer-next-button"]'),
      document.querySelector('button[data-automation-id="next-button"]')
    ].filter(Boolean);

    for (const b of wdButtons) {
      if (isFinalSubmitButton(b)) {
        console.warn('[JobFinder Pilot] 🛑 Final submit button detected - STRICT NO-SUBMIT POLICY ENFORCED. Stopped automatically.');
        return null;
      }
      if (!b.disabled && isSafeNavigationButton(b)) {
        return b;
      }
    }

    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
    for (const b of allButtons) {
      if (b.disabled || b.offsetParent === null) continue;
      if (isFinalSubmitButton(b)) continue; // Never select submit button!
      if (isSafeNavigationButton(b)) {
        return b;
      }
    }
    return null;
  }

  // Completion Summary UI Toast Modal
  function showCompletionSummaryModal(summary) {
    const existing = document.getElementById('jobfinder-summary-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'jobfinder-summary-modal';
    modal.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(24, 24, 27, 0.98));
      border: 1px solid rgba(234, 179, 8, 0.6);
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 25px rgba(234, 179, 8, 0.2);
      backdrop-filter: blur(14px);
      color: #f8fafc;
      padding: 16px 20px;
      border-radius: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      max-width: 380px;
      box-sizing: border-box;
      pointer-events: auto;
    `;

    const statusColor = summary.unansweredRequiredCount === 0 ? '#10b981' : '#f59e0b';

    modal.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 800; color: #fbbf24; font-size: 13px;">
          <span>⚡</span>
          <span>JobFinder Form Completion Audit</span>
        </div>
        <button id="jf-modal-close" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
      </div>
      <div style="font-weight: 700; color: ${statusColor}; font-size: 12px; margin-bottom: 6px;">
        ${summary.overallStatus}
      </div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.4; margin-bottom: 8px;">
        <div>✅ <strong>${summary.filledCount} fields</strong> filled successfully.</div>
        ${summary.manualReviewCount > 0 ? `<div style="color: #fbbf24;">⚠️ <strong>${summary.manualReviewCount} fields</strong> flagged for manual check.</div>` : ''}
        ${summary.unansweredRequiredCount > 0 ? `<div style="color: #ef4444;">❌ <strong>${summary.unansweredRequiredCount} required questions</strong> left for manual review.</div>` : ''}
      </div>
      <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-size: 11px; color: #10b981; font-weight: 600;">
        🛡️ <strong>Strict No-Submit Enforced:</strong> The application is untouched for you to review and submit manually.
      </div>
    `;

    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('#jf-modal-close');
    if (closeBtn) closeBtn.onclick = () => modal.remove();

    setTimeout(() => {
      if (modal.parentNode) {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.6s ease';
        setTimeout(() => modal.remove(), 600);
      }
    }, 10000);
  }

  // Runtime Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ANALYZE_PAGE') {
      const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
      sendResponse({
        company: 'Company',
        role: 'Software Development Engineer',
        hasForm: inputs.length > 0,
        formFieldsCount: inputs.length,
        candidate: CANDIDATE_PROFILE.fullName
      });
      return true;
    }

    if (request.action === 'AUTO_FILL_FORM') {
      const summary = autoFillForm();
      showCompletionSummaryModal(summary);
      sendResponse({
        success: true,
        filledCount: summary.filledCount,
        filledSummary: summary.filled.map(f => f.field),
        summary
      });
      return true;
    }
  });

  // URL Auto-Apply trigger
  function initAutoApplyFromUrl() {
    const href = window.location.href;
    if (href.includes('jf-autoapply')) {
      setTimeout(() => {
        const summary = autoFillForm();
        if (summary.filledCount > 0) {
          showCompletionSummaryModal(summary);
        }
      }, 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoApplyFromUrl);
  } else {
    initAutoApplyFromUrl();
  }

})();

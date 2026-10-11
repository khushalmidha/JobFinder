/**
 * JobFinder AI & Auto-Apply Pilot - Content Script
 * Fully self-contained with ZERO external ES module imports.
 * Injected automatically across all frames and job portals.
 */

(function () {
  'use strict';

  // Prevent multiple injections in same frame
  if (window.__JOBFINDER_INJECTED__) return;
  window.__JOBFINDER_INJECTED__ = true;

  // Khushal's Master Profile & Resumes Data
  const resumeData = {
    profile: {
      name: "Khushal Midha",
      firstName: "Khushal",
      lastName: "Midha",
      email: "midhakhushal5@gmail.com",
      secondaryEmail: "khushalmidha19@gmail.com",
      phone: "+91 90507 40836",
      phoneRaw: "9050740836",
      countryCode: "+91",
      location: "Lucknow, Uttar Pradesh, India",
      currentCity: "Lucknow",
      state: "Uttar Pradesh",
      postalCode: "226002",
      addressLine1: "IIIT Lucknow Campus, Chak Ganjaria, C.G. City",
      country: "India",
      openToRelocate: true,
      linkedin: "https://www.linkedin.com/in/khushalmidha",
      github: "https://github.com/khushalmidha",
      portfolio: "https://github.com/khushalmidha",
      leetcode: "https://leetcode.com/u/khushalmidha",
      codeforces: "https://codeforces.com/profile/khushalmidha",
      codechef: "https://www.codechef.com/users/khushalmidha",
      education: {
        institution: "Indian Institute of Information Technology, Lucknow",
        shortInstitution: "IIIT Lucknow",
        degree: "B.Tech in Computer Science and Artificial Intelligence",
        shortDegree: "B.Tech",
        major: "Computer Science and Artificial Intelligence",
        cgpa: "8.72",
        cgpaScale: "10",
        startYear: "2023",
        endYear: "2027",
        graduationDate: "July 2027"
      },
      workAuthorization: {
        authorizedInIndia: "Yes",
        requiresSponsorship: "No",
        noticePeriodDays: "0",
        noticePeriodText: "Immediate (0 days)",
        currentEmploymentStatus: "Student / Available for Internship & Full-time",
        gender: "Male",
        pronouns: "He/Him"
      },
      currentExperience: {
        company: "Coffeee.io",
        role: "SDE Intern",
        location: "Remote",
        duration: "Jun 2025 – Aug 2025",
        months: "3",
        years: "0.3"
      },
      salaryExpectations: {
        currency: "INR",
        expectedCtcLpa: "22 LPA",
        expectedBaseLpa: "18 LPA"
      }
    },
    resumes: [
      {
        id: "variant_sde_fullstack",
        title: "Full-Stack & Backend SDE",
        badge: "Core SDE",
        targetRoles: ["Software Engineer", "SDE 1", "Fullstack Developer", "Backend Developer", "Frontend Developer", "Software Development Engineer", "Software Engineer Intern"],
        primaryKeywords: ["react", "node", "express", "fastapi", "spring boot", "mongodb", "postgresql", "kafka", "redis", "javascript", "typescript", "rest api"]
      },
      {
        id: "variant_quant_cpp",
        title: "Systems & Quant C++ Engine",
        badge: "C++ Systems",
        targetRoles: ["C++ Software Engineer", "Quant Developer", "Low Latency Engineer", "Systems Engineer"],
        primaryKeywords: ["c++", "cpp", "low latency", "concurrency", "multithreading", "linux", "gdb", "algorithms"]
      },
      {
        id: "variant_ml_ai",
        title: "Applied AI & ML Platform",
        badge: "GenAI & ML",
        targetRoles: ["Machine Learning Engineer", "AI Engineer", "Data Scientist", "NLP Engineer"],
        primaryKeywords: ["python", "pytorch", "transformers", "rag", "faiss", "gemini", "fastapi", "docker"]
      }
    ]
  };

  // Salary Estimator
  function estimateSalary(companyName = '', jobTitle = '') {
    const normComp = (companyName || '').toLowerCase().trim();
    const normTitle = (jobTitle || '').toLowerCase().trim();
    const is6MonthIntern = /6[\s-]*month|six[\s-]*month|6m\b|jan[\s-]*june|january[\s-]*june|semester[\s-]*intern/.test(normTitle);
    const isIntern = is6MonthIntern || normTitle.includes('intern') || normTitle.includes('trainee');

    if (['graviton', 'tower research', 'jane street', 'jump trading', 'd.e. shaw', 'de shaw', 'hudson river', 'hrt', 'quadeye', 'worldquant', 'citadel', 'optiver', 'alphagrep'].some(q => normComp.includes(q))) {
      return {
        tier: 'Tier 0: Top-Tier HFT / Quant',
        ctc: isIntern ? '₹80 - ₹1.4 Cr PPO' : '₹80 LPA - ₹1.5 Cr',
        rating: 'Elite Comp ⭐⭐⭐⭐⭐',
        isIntern
      };
    }
    if (['google', 'microsoft', 'uber', 'apple', 'amazon', 'atlassian', 'adobe', 'salesforce', 'linkedin', 'meta', 'nvidia', 'stripe', 'databricks'].some(t => normComp.includes(t))) {
      return {
        tier: 'Tier 1: Global Tech Titan',
        ctc: isIntern ? '₹35 - ₹55 LPA PPO' : '₹38 - ₹56 LPA',
        rating: 'Tier-1 FAANG/MNC ⭐⭐⭐⭐⭐',
        isIntern
      };
    }
    return {
      tier: 'Funded Tech Unicorn / Product',
      ctc: isIntern ? '₹20 - ₹35 LPA PPO' : '₹18 - ₹28 LPA',
      rating: 'High-Growth Tech ⭐⭐⭐⭐',
      isIntern
    };
  }

  // Resume Matcher
  function matchBestResume(jobTitle = '', bodyText = '', companyName = '') {
    const text = `${jobTitle} ${bodyText} ${companyName}`.toLowerCase();
    let best = resumeData.resumes[0];
    let maxScore = 75;

    resumeData.resumes.forEach(r => {
      let score = 50;
      if (r.id === 'variant_quant_cpp' && (text.includes('c++') || text.includes('trading') || text.includes('quant') || text.includes('systems'))) {
        score = 96;
      } else if (r.id === 'variant_ml_ai' && (text.includes('machine learning') || text.includes('ai') || text.includes('llm') || text.includes('nlp'))) {
        score = 94;
      } else if (r.id === 'variant_sde_fullstack') {
        score = 92;
      }
      if (score > maxScore) {
        maxScore = score;
        best = r;
      }
    });

    return {
      bestResume: best,
      score: maxScore
    };
  }

  // Humanoid Answers Generator
  function generateHumanoidAnswer(question = '', company = '', role = '', selectedResumeId = 'variant_sde_fullstack') {
    const q = (question || '').toLowerCase();
    const c = company || 'your engineering team';
    const r = role || 'Software Engineer';
    const isQuant = selectedResumeId === 'variant_quant_cpp';
    const isML = selectedResumeId === 'variant_ml_ai';

    if (q.includes('why') && (q.includes('company') || q.includes('join') || q.includes('work') || q.includes('role') || q.includes('interested') || q.includes('apply'))) {
      if (isQuant) {
        return `What genuinely excites me about ${c} is the intersection of mathematical rigor and low-latency systems engineering. As a CS & AI student at IIIT Lucknow with deep passion for algorithmic problem solving (LeetCode Guardian 2137, Codeforces Expert 1809), I love solving problems where every microsecond matters. In my QuantDesk project, I developed a deterministic C++ order matching engine with price-time priority and Avellaneda-Stoikov market making. I want to bring that same intensity, disciplined analytical thinking, and high-performance C++ mindset to solve complex challenges alongside the brilliant team at ${c}.`;
      }
      if (isML) {
        return `I've been closely following how ${c} is leveraging cutting-edge intelligence to tackle real problems at scale. Having specialized in Computer Science & AI at IIIT Lucknow, my focus has been on high-throughput applied ML. For instance, in ThreatGraph I architected a spatial-temporal engine combining Graph Neural Networks and Transformers processing 3,000+ events/sec via Kafka, and in Jagrit I built real-time ranking using XGBoost and PyTorch. The opportunity to deploy robust, production-grade intelligence at ${c} for the ${r} role is an exact match for what I love building.`;
      }
      return `I'm particularly drawn to ${c} because of the high engineering bar and the scale at which your products operate. At IIIT Lucknow, I've channeled my enthusiasm into architecting reliable, high-concurrency systems—such as MediPulse, an end-to-end healthcare SaaS with 125 REST APIs where I solved race conditions using Redis distributed locks and asynchronous Kafka events. I pride myself on clean architecture, relentless problem-solving (solving 3,000+ DSA problems across Codeforces & LeetCode), and rapid execution. Contributing to ${c}'s mission as a ${r} would be an exhilarating next step in my journey.`;
    }

    if (q.includes('challenge') || q.includes('difficult') || q.includes('bug') || q.includes('problem you solved') || q.includes('complex')) {
      return `A challenging technical scenario I navigated occurred while engineering MediPulse, a multi-tenant healthcare SaaS. During mock peak registration periods, concurrent appointment bookings across live OPD queues triggered race conditions, occasionally leading to double-booked slots. To fix this permanently, I introduced Redis distributed locks with idempotent tokens and transactional rollbacks, backed by an asynchronous Kafka pipeline for wallet deductions. This guaranteed strict serialization and zero data inconsistencies under high concurrency.`;
    }

    if (q.includes('about yourself') || q.includes('summary') || q.includes('introduce') || q.includes('bio') || q.includes('background')) {
      return `I'm Khushal Midha, a B.Tech student in Computer Science & Artificial Intelligence at IIIT Lucknow (CGPA: 8.72/10) and an incoming software engineer passionate about scalable backend systems and intelligent architectures. I hold Guardian status on LeetCode (2137), Expert on Codeforces (1809), and was an ICPC Amritapuri Regionalist. During my SDE internship at Coffeee.io, I built project-based code evaluation modules in Spring Boot and Docker. Whether architecting microservices with Kafka & Redis or optimizing low-latency pipelines, I enjoy building software that is fast, resilient, and human-centric.`;
    }

    if (q.includes('strength') || q.includes('skills') || q.includes('strongest')) {
      return `My core strength is the combination of deep algorithmic problem-solving and rapid full-stack execution. Having solved over 3,000 DSA problems and competed at the ICPC regional level, I can decompose ambiguous, complex logic swiftly. Complementing this is strong systems craftsmanship: designing RESTful microservices, caching with Redis, event-streaming with Kafka, and containerizing with Docker. I pick up unfamiliar frameworks in days and take extreme ownership from initial design to production delivery.`;
    }

    if (q.includes('notice') || q.includes('availability') || q.includes('start date') || q.includes('when can you start')) {
      return `I am available to join immediately (0 days notice). For internships or full-time roles, I am flexible with start dates and open to both remote and in-office setups across India or globally.`;
    }

    if (q.includes('salary') || q.includes('ctc') || q.includes('compensation') || q.includes('expectations')) {
      return `I am looking for a competitive package aligned with industry standards and ${c}'s standard compensation bands for freshers / SDE 1 (typically around ₹18 - ₹25 LPA CTC). However, learning velocity and engineering impact are my top priorities, and I am flexible for the right opportunity.`;
    }

    return `I am an ambitious Computer Science & AI student at IIIT Lucknow with production fullstack experience, proven problem-solving track record (LeetCode Guardian 2137), and a strong passion for writing high-performance, clean code at ${c}.`;
  }

  // Global Page State
  let pageState = {
    company: '',
    role: '',
    salary: null,
    match: null,
    hasForm: false,
    formFieldsCount: 0
  };

  // Analyze Page
  function analyzePage() {
    const url = window.location.href;
    const hostname = window.location.hostname;
    let company = '';
    let role = '';

    if (hostname.includes('lever.co')) {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length > 0) company = parts[0];
    } else if (hostname.includes('greenhouse.io')) {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length > 0) company = parts[0];
    } else if (hostname.includes('ashbyhq.com')) {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length > 0) company = parts[0];
    } else if (hostname.includes('workday.com')) {
      const parts = hostname.split('.');
      company = parts[0] !== 'myworkdayjobs' ? parts[0] : (parts[1] || 'Company');
    }

    if (!company) {
      const siteMeta = document.querySelector('meta[property="og:site_name"]');
      if (siteMeta) company = siteMeta.content;
    }

    const title = document.title || '';
    if (!company) {
      if (title.includes(' at ')) {
        company = title.split(' at ')[1].split(' - ')[0].split(' | ')[0].trim();
      } else if (title.includes(' - ')) {
        const parts = title.split(' - ');
        company = parts[parts.length - 1].trim();
      } else if (title.includes(' | ')) {
        const parts = title.split(' | ');
        company = parts[parts.length - 1].trim();
      } else {
        const hostClean = hostname.replace('www.', '').split('.')[0];
        company = hostClean.charAt(0).toUpperCase() + hostClean.slice(1);
      }
    }
    company = company.replace(/Careers|Jobs|Hiring|Portal|Application/gi, '').trim() || 'Company';

    const h1 = document.querySelector('h1, .posting-headline h2, [data-automation-id="jobPostingHeader"], .job-title');
    if (h1 && h1.innerText.trim()) {
      role = h1.innerText.trim();
    } else if (title.includes(' at ')) {
      role = title.split(' at ')[0].trim();
    } else if (title.includes(' - ')) {
      role = title.split(' - ')[0].trim();
    } else {
      role = 'Software Development Engineer';
    }

    const forms = document.querySelectorAll('form, [data-automation-id="applyForm"], .application-form, #application-form');
    const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
    const hasForm = forms.length > 0 || inputs.length > 3;

    const bodyText = document.body ? document.body.innerText.slice(0, 4000) : '';
    const salary = estimateSalary(company, role);
    const match = matchBestResume(role, bodyText, company);

    pageState = {
      company,
      role,
      salary,
      match,
      hasForm,
      formFieldsCount: inputs.length,
      url
    };

    return pageState;
  }

  // Native Value Setter for React / Angular / Vue / Workday
  function setNativeValue(element, value) {
    if (!element || value === undefined || value === null) return;

    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Field Descriptor Inspector
  function getFieldDescriptor(element) {
    const name = (element.getAttribute('name') || '').toLowerCase();
    const id = (element.getAttribute('id') || '').toLowerCase();
    const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
    const dataAutomation = (element.getAttribute('data-automation-id') || '').toLowerCase();
    const dataTestId = (element.getAttribute('data-testid') || '').toLowerCase();

    let labelText = '';
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) labelText = label.innerText.toLowerCase();
    }
    if (!labelText && element.closest('label')) {
      labelText = element.closest('label').innerText.toLowerCase();
    }
    if (!labelText && element.parentElement) {
      const prev = element.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'P')) {
        labelText = prev.innerText.toLowerCase();
      }
    }
    if (!labelText) {
      const container = element.closest('[data-automation-id*="formField"], [data-automation-id*="Section"], .css-1, [data-automation-id*="input"], .field, .form-group');
      if (container) {
        const lbl = container.querySelector('label, [data-automation-id*="label"]');
        if (lbl) labelText = lbl.innerText.toLowerCase();
      }
    }

    const combined = `${name} ${id} ${placeholder} ${ariaLabel} ${autocomplete} ${dataAutomation} ${dataTestId} ${labelText}`.trim();
    return { combined, labelText: labelText || placeholder || name || dataAutomation };
  }

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

  // Master Form Auto-Fill Engine
  function autoFillForm(chosenResumeId) {
    const resumeId = chosenResumeId || pageState.match?.bestResume?.id || 'variant_sde_fullstack';
    const profile = resumeData.profile;
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));

    let filledCount = 0;
    const filledSummary = [];

    // Workday dropdowns helper
    fillWorkdayCombos();

    inputs.forEach(el => {
      if (el.disabled || el.readOnly) return;
      const { combined, labelText } = getFieldDescriptor(el);

      // FIRST NAME
      if ((combined.includes('first') && combined.includes('name')) || combined.includes('fname') || combined.includes('legalnamesection_firstname') || combined === 'first_name') {
        if (el.value !== profile.firstName) {
          setNativeValue(el, profile.firstName);
          filledCount++;
          filledSummary.push('First Name');
        }
        return;
      }

      // LAST NAME
      if ((combined.includes('last') && combined.includes('name')) || combined.includes('lname') || combined.includes('legalnamesection_lastname') || combined === 'last_name') {
        if (el.value !== profile.lastName) {
          setNativeValue(el, profile.lastName);
          filledCount++;
          filledSummary.push('Last Name');
        }
        return;
      }

      // FULL NAME
      if ((combined.includes('full name') || combined.includes('candidate name') || (combined.includes('name') && !combined.includes('company') && !combined.includes('user') && !combined.includes('first') && !combined.includes('last') && !combined.includes('school'))) && el.type === 'text') {
        if (el.value !== profile.name) {
          setNativeValue(el, profile.name);
          filledCount++;
          filledSummary.push('Full Name');
        }
        return;
      }

      // EMAIL
      if (combined.includes('email') || el.type === 'email' || combined.includes('addresssection_email')) {
        if (el.value !== profile.email) {
          setNativeValue(el, profile.email);
          filledCount++;
          filledSummary.push('Email');
        }
        return;
      }

      // PHONE / MOBILE
      if (combined.includes('phone') || combined.includes('mobile') || combined.includes('cell') || el.type === 'tel' || combined.includes('contact number')) {
        const phoneVal = (combined.includes('raw') || combined.includes('addresssection')) ? profile.phoneRaw : profile.phone;
        if (el.value !== phoneVal) {
          setNativeValue(el, phoneVal);
          filledCount++;
          filledSummary.push('Phone');
        }
        return;
      }

      // ADDRESS / STREET
      if (combined.includes('address line 1') || combined.includes('addressline1') || combined.includes('street address')) {
        if (!el.value) {
          setNativeValue(el, profile.addressLine1);
          filledCount++;
          filledSummary.push('Address Line 1');
        }
        return;
      }

      // CITY
      if (combined.includes('city') || combined.includes('addresssection_city') || combined.includes('town')) {
        if (!el.value) {
          setNativeValue(el, profile.currentCity);
          filledCount++;
          filledSummary.push('City');
        }
        return;
      }

      // POSTAL CODE / PIN / ZIP
      if (combined.includes('postal') || combined.includes('zip') || combined.includes('postalcode') || combined.includes('pincode')) {
        if (!el.value) {
          setNativeValue(el, profile.postalCode);
          filledCount++;
          filledSummary.push('Postal Code');
        }
        return;
      }

      // STATE / REGION
      if (combined.includes('state') || combined.includes('province') || combined.includes('countryregion')) {
        if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['uttar pradesh', 'delhi', 'haryana']);
        } else if (!el.value) {
          setNativeValue(el, profile.state);
        }
        filledCount++;
        return;
      }

      // LINKEDIN
      if (combined.includes('linkedin')) {
        if (el.value !== profile.linkedin) {
          setNativeValue(el, profile.linkedin);
          filledCount++;
          filledSummary.push('LinkedIn URL');
        }
        return;
      }

      // GITHUB
      if (combined.includes('github') || combined.includes('git')) {
        if (el.value !== profile.github) {
          setNativeValue(el, profile.github);
          filledCount++;
          filledSummary.push('GitHub URL');
        }
        return;
      }

      // PORTFOLIO / WEBSITE
      if (combined.includes('portfolio') || combined.includes('website') || combined.includes('personal site') || combined.includes('blog') || combined.includes('other website')) {
        if (el.value !== profile.portfolio) {
          setNativeValue(el, profile.portfolio);
          filledCount++;
          filledSummary.push('Portfolio');
        }
        return;
      }

      // LEETCODE / CODING PROFILE
      if (combined.includes('leetcode') || combined.includes('competitive') || combined.includes('coding profile')) {
        if (el.value !== profile.leetcode) {
          setNativeValue(el, profile.leetcode);
          filledCount++;
          filledSummary.push('LeetCode URL');
        }
        return;
      }

      // COLLEGE / UNIVERSITY
      if (combined.includes('university') || combined.includes('college') || combined.includes('institution') || combined.includes('school')) {
        if (!el.value) {
          setNativeValue(el, profile.education.institution);
          filledCount++;
          filledSummary.push('University');
        }
        return;
      }

      // DEGREE
      if (combined.includes('degree') || combined.includes('qualification')) {
        if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['bachelor', 'b.tech', 'undergraduate', 'btech']);
        } else if (!el.value) {
          setNativeValue(el, profile.education.degree);
        }
        filledCount++;
        filledSummary.push('Degree');
        return;
      }

      // MAJOR / BRANCH
      if (combined.includes('major') || combined.includes('discipline') || combined.includes('field of study') || combined.includes('branch')) {
        if (!el.value) {
          setNativeValue(el, profile.education.major);
          filledCount++;
          filledSummary.push('Major');
        }
        return;
      }

      // CGPA / GPA
      if (combined.includes('cgpa') || combined.includes('gpa') || combined.includes('grade') || combined.includes('marks')) {
        if (!el.value) {
          setNativeValue(el, profile.education.cgpa);
          filledCount++;
          filledSummary.push('CGPA');
        }
        return;
      }

      // GRADUATION YEAR / END YEAR
      if (combined.includes('graduat') || combined.includes('end year') || combined.includes('passout') || combined.includes('batch')) {
        if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['2027', '27']);
        } else if (!el.value) {
          setNativeValue(el, profile.education.endYear);
        }
        filledCount++;
        filledSummary.push('Graduation Year');
        return;
      }

      // CURRENT EMPLOYER / COMPANY
      if (combined.includes('current company') || combined.includes('employer') || combined.includes('most recent company') || combined.includes('organization')) {
        if (!el.value) {
          setNativeValue(el, profile.currentExperience.company);
          filledCount++;
          filledSummary.push('Current Employer');
        }
        return;
      }

      // CURRENT TITLE / ROLE
      if (combined.includes('current title') || combined.includes('current role') || combined.includes('designation') || combined.includes('jobtitle')) {
        if (!el.value) {
          setNativeValue(el, profile.currentExperience.role);
          filledCount++;
          filledSummary.push('Current Title');
        }
        return;
      }

      // LOCATION
      if (combined.includes('location') || combined.includes('current location')) {
        if (!el.value) {
          setNativeValue(el, profile.location);
          filledCount++;
          filledSummary.push('Location');
        }
        return;
      }

      // WORK AUTHORIZATION
      if (combined.includes('authorized to work') || combined.includes('legally authorized') || combined.includes('work permit') || combined.includes('eligible to work')) {
        if (el.type === 'checkbox') {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.type === 'radio') {
          if (!combined.includes('not') && !combined.includes('no')) {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['yes', 'authorized']);
        }
        filledCount++;
        return;
      }

      // SPONSORSHIP REQUIREMENT
      if (combined.includes('sponsorship') || combined.includes('require visa') || combined.includes('require sponsorship')) {
        if (el.type === 'radio') {
          if (combined.includes('no') || labelText.includes('no')) {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['no']);
        }
        filledCount++;
        return;
      }

      // NOTICE PERIOD
      if (combined.includes('notice period') || combined.includes('notice')) {
        if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['immediate', '0', 'less than 15', '1 month']);
        } else if (!el.value) {
          setNativeValue(el, profile.workAuthorization.noticePeriodText);
        }
        filledCount++;
        filledSummary.push('Notice Period');
        return;
      }

      // GENDER
      if (combined.includes('gender')) {
        if (el.tagName === 'SELECT') {
          selectOptionMatch(el, ['male', 'prefer not to say', 'man']);
        }
        return;
      }

      // SIGNATURE
      if (combined.includes('signature') || combined.includes('sign here') || combined.includes('type your name')) {
        if (!el.value) {
          setNativeValue(el, profile.name);
          filledCount++;
          filledSummary.push('Signature');
        }
        return;
      }

      // TERMS / CONSENT CHECKBOX
      if (el.type === 'checkbox' && (combined.includes('agree') || combined.includes('certif') || combined.includes('consent') || combined.includes('terms') || combined.includes('statement'))) {
        if (!el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
          filledSummary.push('Agreed to Terms');
        }
        return;
      }

      // ESSAYS / TEXTAREAS / OPEN QUESTIONS
      if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text' && combined.length > 25)) {
        if (!el.value || el.value.length < 5) {
          const answer = generateHumanoidAnswer(labelText || combined, pageState.company, pageState.role, resumeId);
          setNativeValue(el, answer);
          filledCount++;
          filledSummary.push(`Humanoid Answer: "${(labelText || 'Question').slice(0, 24)}..."`);
        }
      }
    });

    // Workday radio groups helper
    fillWorkdayRadios();

    return {
      success: true,
      filledCount,
      filledSummary: [...new Set(filledSummary)]
    };
  }

  function fillWorkdayCombos() {
    try {
      const deviceBtn = document.querySelector('button[data-automation-id="phone-device-type"], button[data-automation-id="deviceType"]');
      if (deviceBtn && !deviceBtn.innerText.includes('Mobile')) {
        deviceBtn.click();
        setTimeout(() => {
          document.querySelectorAll('[data-automation-id="select-item"], [role="option"]').forEach(item => {
            if (item.innerText.toLowerCase().includes('mobile')) item.click();
          });
        }, 150);
      }
    } catch (e) {}
  }

  function fillWorkdayRadios() {
    try {
      document.querySelectorAll('[data-automation-id*="radio"], [role="radiogroup"], fieldset, .css-1').forEach(grp => {
        const text = grp.innerText.toLowerCase();
        const radios = grp.querySelectorAll('input[type="radio"], [role="radio"]');

        if (text.includes('authorized to work') || text.includes('legally authorized') || text.includes('eligible to work')) {
          radios.forEach(r => {
            const label = (r.getAttribute('aria-label') || r.value || r.parentElement?.innerText || '').toLowerCase();
            if (label.includes('yes') && !r.checked) {
              r.click();
              r.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }

        if (text.includes('sponsorship') || text.includes('require visa') || text.includes('require sponsorship')) {
          radios.forEach(r => {
            const label = (r.getAttribute('aria-label') || r.value || r.parentElement?.innerText || '').toLowerCase();
            if (label.includes('no') && !r.checked) {
              r.click();
              r.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
      });
    } catch (e) {}
  }

  // Next / Continue button finder
  function findNextButton() {
    const wdButtons = [
      document.querySelector('button[data-automation-id="bottom-navigation-next-button"]'),
      document.querySelector('button[data-automation-id="page-footer-next-button"]'),
      document.querySelector('button[data-automation-id="next-button"]')
    ].filter(Boolean);
    if (wdButtons.length > 0 && !wdButtons[0].innerText.toLowerCase().includes('submit') && !wdButtons[0].disabled) {
      return wdButtons[0];
    }

    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
    for (const b of allButtons) {
      if (b.disabled || b.offsetParent === null) continue;
      const t = (b.innerText || b.value || '').trim().toLowerCase();
      if ((t === 'continue' || t === 'next' || t === 'save & continue' || t === 'save and continue' || t === 'next step') && !t.includes('submit')) {
        return b;
      }
    }
    return null;
  }

  // Auto-Pilot State
  let autoPilotState = {
    running: false,
    timerId: null,
    stepCount: 0,
    statusMessage: 'Ready'
  };

  function startAutoPilot(resumeId) {
    if (autoPilotState.running) return;
    autoPilotState.running = true;
    autoPilotState.stepCount = 0;
    autoPilotState.statusMessage = 'Auto-Pilot active. Filling application in background...';
    updateCompanionWidget();

    runAutoPilotStep(resumeId);
    autoPilotState.timerId = setInterval(() => {
      if (!autoPilotState.running) {
        clearInterval(autoPilotState.timerId);
        return;
      }
      runAutoPilotStep(resumeId);
    }, 2200);
  }

  function stopAutoPilot() {
    autoPilotState.running = false;
    if (autoPilotState.timerId) {
      clearInterval(autoPilotState.timerId);
      autoPilotState.timerId = null;
    }
    autoPilotState.statusMessage = 'Auto-Pilot paused.';
    updateCompanionWidget();
  }

  function runAutoPilotStep(resumeId) {
    if (!autoPilotState.running) return;
    const res = autoFillForm(resumeId);
    if (res.filledCount > 0) {
      autoPilotState.statusMessage = `✅ Filled ${res.filledCount} fields! Advancing...`;
      updateCompanionWidget();
      setTimeout(() => {
        if (!autoPilotState.running) return;
        const nextBtn = findNextButton();
        if (nextBtn) nextBtn.click();
      }, 1400);
    } else {
      const nextBtn = findNextButton();
      if (nextBtn) {
        autoPilotState.statusMessage = 'Advancing to next step...';
        updateCompanionWidget();
        setTimeout(() => {
          if (autoPilotState.running && nextBtn) nextBtn.click();
        }, 1200);
      }
    }
  }

  // OTP Injection
  function fillOtpIntoPage(otp) {
    if (!otp) return { success: false, error: 'No OTP provided' };
    const cleanOtp = String(otp).trim();
    const inputs = Array.from(document.querySelectorAll('input'));
    const otpInputs = inputs.filter(el => {
      const { combined } = getFieldDescriptor(el);
      return combined.includes('otp') || combined.includes('code') || combined.includes('verification') || combined.includes('pin') || el.getAttribute('autocomplete') === 'one-time-code';
    });

    if (otpInputs.length === 1) {
      setNativeValue(otpInputs[0], cleanOtp);
      return { success: true, count: 1, message: `Filled OTP ${cleanOtp} into verification input.` };
    }
    if (otpInputs.length >= cleanOtp.length) {
      otpInputs.slice(0, cleanOtp.length).forEach((el, idx) => setNativeValue(el, cleanOtp[idx]));
      return { success: true, count: cleanOtp.length, message: `Filled ${cleanOtp.length}-digit OTP into split boxes.` };
    }
    return { success: false, error: 'Could not find an OTP input field on the page.' };
  }

  // Floating Companion Widget
  function injectCompanionWidget() {
    // Only inject in top window to avoid multiple widgets in iframes
    if (window.top !== window.self) return;
    if (document.getElementById('jobfinder-companion-widget')) return;

    const data = analyzePage();
    const host = window.location.hostname.toLowerCase();
    const isJobPage = host.includes('workday') || host.includes('lever') || host.includes('greenhouse') || host.includes('ashby') || host.includes('job') || host.includes('career') || data.hasForm;
    if (!isJobPage) return;

    const container = document.createElement('div');
    container.id = 'jobfinder-companion-widget';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const shadow = container.attachShadow({ mode: 'open' });
    const pill = document.createElement('div');
    pill.id = 'jf-pill';
    pill.style.cssText = `
      background: #09090b;
      color: #f4f4f5;
      border: 1px solid rgba(234, 179, 8, 0.6);
      box-shadow: 0 20px 30px -5px rgba(0, 0, 0, 0.7), 0 0 20px rgba(234, 179, 8, 0.2);
      border-radius: 16px;
      padding: 14px 16px;
      width: 320px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(14px);
    `;

    shadow.appendChild(pill);
    document.body.appendChild(container);
    renderWidgetHtml(shadow, data);
  }

  function updateCompanionWidget() {
    const container = document.getElementById('jobfinder-companion-widget');
    if (!container || !container.shadowRoot) return;
    renderWidgetHtml(container.shadowRoot, analyzePage());
  }

  function renderWidgetHtml(shadow, data) {
    const pill = shadow.getElementById('jf-pill');
    if (!pill) return;
    const isRunning = autoPilotState.running;

    pill.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #eab308, #ca8a04); color: #09090b; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; box-shadow: 0 2px 5px rgba(234,179,8,0.3);">
            ⚡
          </div>
          <div>
            <div style="font-weight: 800; font-size: 13px; color: #fafafa; line-height: 1.2;">
              ${escapeHtml(data.company)}
            </div>
            <div style="font-size: 11px; color: #a1a1aa; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(data.role)}
            </div>
          </div>
        </div>
        <button id="jf-close" style="background: none; border: none; color: #71717a; font-size: 16px; cursor: pointer; padding: 2px;">✕</button>
      </div>

      <div style="background: rgba(24, 24, 27, 0.7); border: 1px solid #27272a; border-radius: 10px; padding: 8px 10px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
          <span style="font-size: 10px; color: #71717a; font-weight: 700; text-transform: uppercase;">Expected Comp</span>
          <span style="font-size: 12px; font-weight: 800; color: #eab308;">${data.salary.ctc}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: #a1a1aa;">Best Resume:</span>
          <span style="color: #60a5fa; font-weight: 700;">${data.match.bestResume.badge} (${data.match.score}%)</span>
        </div>
      </div>

      <div style="margin-bottom: 8px;">
        <button id="jf-fill-btn" style="width: 100%; background: #eab308; color: #09090b; border: none; border-radius: 10px; padding: 10px 14px; font-weight: 800; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(234,179,8,0.35);">
          ⚡ Auto-Fill Form Now
        </button>
      </div>

      <div style="display: flex; gap: 6px;">
        <button id="jf-autopilot-btn" style="flex: 1; background: ${isRunning ? '#dc2626' : '#18181b'}; color: ${isRunning ? '#ffffff' : '#f4f4f5'}; border: 1px solid #3f3f46; border-radius: 8px; padding: 7px 10px; font-weight: 600; font-size: 11px; cursor: pointer;">
          ${isRunning ? '⏸️ Stop Pilot' : '🚀 Auto-Pilot'}
        </button>
        <button id="jf-otp-btn" style="flex: 1; background: #18181b; color: #eab308; border: 1px solid #3f3f46; border-radius: 8px; padding: 7px 10px; font-weight: 600; font-size: 11px; cursor: pointer;">
          🔑 Fetch OTP
        </button>
      </div>

      <div id="jf-status" style="margin-top: 8px; font-size: 10px; color: #a1a1aa; text-align: center;">
        ${escapeHtml(autoPilotState.statusMessage)}
      </div>
    `;

    const closeBtn = shadow.getElementById('jf-close');
    if (closeBtn) closeBtn.onclick = () => pill.style.display = 'none';

    const fillBtn = shadow.getElementById('jf-fill-btn');
    if (fillBtn) {
      fillBtn.onclick = () => {
        fillBtn.disabled = true;
        fillBtn.innerText = 'Filling...';
        const res = autoFillForm(data.match.bestResume.id);
        fillBtn.disabled = false;
        fillBtn.innerText = '⚡ Auto-Fill Form Now';
        autoPilotState.statusMessage = `✅ Filled ${res.filledCount} fields!`;
        updateCompanionWidget();
      };
    }

    const pilotBtn = shadow.getElementById('jf-autopilot-btn');
    if (pilotBtn) {
      pilotBtn.onclick = () => {
        if (autoPilotState.running) stopAutoPilot();
        else startAutoPilot(data.match.bestResume.id);
      };
    }

    const otpBtn = shadow.getElementById('jf-otp-btn');
    if (otpBtn) {
      otpBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: 'FETCH_OTP' }, (res) => {
          if (res && res.success && res.otp) {
            fillOtpIntoPage(res.otp);
            autoPilotState.statusMessage = `✅ Injected OTP: ${res.otp}!`;
          } else {
            autoPilotState.statusMessage = `⚠️ ${res?.error || 'No recent OTP found'}`;
          }
          updateCompanionWidget();
        });
      };
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // Runtime Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ANALYZE_PAGE') {
      const data = analyzePage();
      sendResponse({
        ...data,
        autoPilotRunning: autoPilotState.running
      });
      return true;
    }

    if (request.action === 'AUTO_FILL_FORM') {
      const res = autoFillForm(request.resumeId);
      sendResponse(res);
      return true;
    }

    if (request.action === 'START_AUTOPILOT') {
      startAutoPilot(request.resumeId);
      sendResponse({ success: true, running: true });
      return true;
    }

    if (request.action === 'STOP_AUTOPILOT') {
      stopAutoPilot();
      sendResponse({ success: true, running: false });
      return true;
    }

    if (request.action === 'FILL_OTP') {
      const res = fillOtpIntoPage(request.otp);
      sendResponse(res);
      return true;
    }
  });

  // Self Initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      analyzePage();
      setTimeout(injectCompanionWidget, 1000);
    });
  } else {
    analyzePage();
    setTimeout(injectCompanionWidget, 1000);
  }

})();

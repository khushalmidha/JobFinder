import { estimateSalary } from '../utils/salaryEstimator';
import { matchBestResume } from '../utils/roleMatcher';
import { generateHumanoidAnswer } from '../utils/humanoidAnswers';
import resumeData from '../resumes.json';

// State for current page
let pageState = {
  company: '',
  role: '',
  salary: null,
  match: null,
  hasForm: false,
  formFieldsCount: 0
};

// 1. Analyze page details
function analyzePage() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  let company = '';
  let role = '';

  // Extract company from known ATS hosts
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
    const hostParts = hostname.split('.');
    company = hostParts[0] !== 'myworkdayjobs' ? hostParts[0] : (hostParts[1] || 'Company');
  }

  // Meta tags
  if (!company) {
    const siteNameMeta = document.querySelector('meta[property="og:site_name"]');
    if (siteNameMeta) company = siteNameMeta.content;
  }

  // Fallback to title parsing
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

  // Clean company name
  company = company.replace(/Careers|Jobs|Hiring|Portal|Application/gi, '').trim() || 'Company';

  // Extract Role / Job Title
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

  // Check for forms on the page
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

// 2. Helper to set value with native event dispatching for React/Angular/Vue/Workday
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

// Helper to determine field semantics (supports standard attributes + Workday data-automation-id)
function getFieldDescriptor(element) {
  const name = (element.getAttribute('name') || '').toLowerCase();
  const id = (element.getAttribute('id') || '').toLowerCase();
  const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
  const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
  const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
  const dataAutomation = (element.getAttribute('data-automation-id') || '').toLowerCase();
  const dataTestId = (element.getAttribute('data-testid') || '').toLowerCase();

  // Find associated label text
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

  // Workday container label check
  if (!labelText) {
    const wdFieldContainer = element.closest('[data-automation-id*="formField"], [data-automation-id*="Section"], .css-1, [data-automation-id*="input"]');
    if (wdFieldContainer) {
      const lbl = wdFieldContainer.querySelector('label, [data-automation-id*="label"]');
      if (lbl) labelText = lbl.innerText.toLowerCase();
    }
  }

  const combined = `${name} ${id} ${placeholder} ${ariaLabel} ${autocomplete} ${dataAutomation} ${dataTestId} ${labelText}`.trim();
  return { combined, labelText: labelText || placeholder || name || dataAutomation };
}

// Audio notification when application is ready for final review
function playSuccessChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch (e) {
    // blocked or unavailable
  }
}

// 4. Fill Application Form (Standard + Workday multi-step components)
function autoFillForm(chosenResumeId) {
  const resumeId = chosenResumeId || pageState.match?.bestResume?.id || 'variant_sde_fullstack';
  const profile = resumeData.profile;
  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));

  let filledCount = 0;
  const filledSummary = [];

  // Workday custom dropdowns (device type, source prompt, etc.)
  fillWorkdayCustomCombos(profile);

  inputs.forEach(el => {
    if (el.disabled || el.readOnly) return;
    const { combined, labelText } = getFieldDescriptor(el);

    // FIRST NAME / LEGAL FIRST NAME
    if (
      (combined.includes('first') && combined.includes('name')) || 
      combined.includes('fname') || 
      combined.includes('legalnamesection_firstname') ||
      combined === 'first_name'
    ) {
      if (el.value !== profile.firstName) {
        setNativeValue(el, profile.firstName);
        filledCount++;
        filledSummary.push('First Name');
      }
      return;
    }

    // LAST NAME / LEGAL LAST NAME
    if (
      (combined.includes('last') && combined.includes('name')) || 
      combined.includes('lname') || 
      combined.includes('legalnamesection_lastname') ||
      combined === 'last_name'
    ) {
      if (el.value !== profile.lastName) {
        setNativeValue(el, profile.lastName);
        filledCount++;
        filledSummary.push('Last Name');
      }
      return;
    }

    // FULL NAME
    if (
      combined.includes('full name') || 
      combined.includes('candidate name') || 
      (combined.includes('name') && !combined.includes('company') && !combined.includes('user') && !combined.includes('first') && !combined.includes('last') && !combined.includes('school'))
    ) {
      if (el.type === 'text' && el.value !== profile.name) {
        setNativeValue(el, profile.name);
        filledCount++;
        filledSummary.push('Full Name');
        return;
      }
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

    // PHONE / MOBILE NUMBER
    if (combined.includes('phone') || combined.includes('mobile') || combined.includes('cell') || el.type === 'tel' || combined.includes('contact number')) {
      const val = combined.includes('raw') || combined.includes('addresssection') ? profile.phoneRaw : profile.phone;
      if (el.value !== val) {
        setNativeValue(el, val);
        filledCount++;
        filledSummary.push('Phone');
      }
      return;
    }

    // ADDRESS LINE 1
    if (combined.includes('address line 1') || combined.includes('addressline1') || combined.includes('street address')) {
      if (!el.value) {
        setNativeValue(el, 'DLF Cyber City, Sector 24');
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

    // POSTAL CODE / ZIP CODE
    if (combined.includes('postal') || combined.includes('zip') || combined.includes('postalcode')) {
      if (!el.value) {
        setNativeValue(el, '122002');
        filledCount++;
        filledSummary.push('Postal Code');
      }
      return;
    }

    // COUNTRY REGION / STATE
    if (combined.includes('state') || combined.includes('province') || combined.includes('countryregion')) {
      if (el.tagName === 'SELECT') {
        selectOptionMatch(el, ['haryana', 'uttar pradesh', 'delhi']);
      } else if (!el.value) {
        setNativeValue(el, 'Haryana');
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
    if (combined.includes('portfolio') || combined.includes('website') || combined.includes('personal site') || combined.includes('blog')) {
      if (el.value !== profile.portfolio) {
        setNativeValue(el, profile.portfolio);
        filledCount++;
        filledSummary.push('Portfolio');
      }
      return;
    }

    // UNIVERSITY / COLLEGE / SCHOOL
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

    // MAJOR / DISCIPLINE / FIELD OF STUDY
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

    // CURRENT / PREVIOUS COMPANY
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

    // LOCATION / CITY
    if (combined.includes('location') || combined.includes('current location')) {
      if (!el.value) {
        setNativeValue(el, profile.location);
        filledCount++;
        filledSummary.push('Location');
      }
      return;
    }

    // START DATE (Work Experience)
    if (combined.includes('start date') || combined.includes('startdate')) {
      if (!el.value) {
        setNativeValue(el, '06/2025');
        filledCount++;
      }
      return;
    }

    // END DATE (Work Experience)
    if (combined.includes('end date') || combined.includes('enddate')) {
      if (!el.value) {
        setNativeValue(el, '08/2025');
        filledCount++;
      }
      return;
    }

    // WORK AUTHORIZATION / CITIZENSHIP
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

    // VETERAN STATUS
    if (combined.includes('veteran')) {
      if (el.tagName === 'SELECT') {
        selectOptionMatch(el, ['not a protected veteran', 'no', 'prefer not']);
      }
      return;
    }

    // DISABILITY STATUS
    if (combined.includes('disability')) {
      if (el.tagName === 'SELECT') {
        selectOptionMatch(el, ['do not have a disability', 'no', 'prefer not']);
      }
      return;
    }

    // SIGNATURE / SIGN NAME
    if (combined.includes('signature') || combined.includes('sign here') || combined.includes('type your name')) {
      if (!el.value) {
        setNativeValue(el, profile.name);
        filledCount++;
        filledSummary.push('Signature');
      }
      return;
    }

    // TERMS / CONSENT / AGREEMENT CHECKBOX
    if (el.type === 'checkbox' && (combined.includes('agree') || combined.includes('certif') || combined.includes('consent') || combined.includes('terms') || combined.includes('statement'))) {
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
        filledSummary.push('Agreed to Terms');
      }
      return;
    }

    // ESSAYS / TEXTAREAS / OPEN-ENDED QUESTIONS (HUMANOID RESPONSES)
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text' && combined.length > 25)) {
      if (!el.value || el.value.length < 5) {
        const answer = generateHumanoidAnswer(labelText || combined, pageState.company, pageState.role, resumeId);
        setNativeValue(el, answer);
        filledCount++;
        filledSummary.push(`Humanoid Answer: "${(labelText || 'Question').slice(0, 24)}..."`);
      }
    }
  });

  // Handle Workday Radio Groups
  fillWorkdayRadios();

  return {
    success: true,
    filledCount,
    filledSummary: [...new Set(filledSummary)]
  };
}

// Workday custom combobox buttons handler
function fillWorkdayCustomCombos(profile) {
  try {
    // Phone Device Type dropdown
    const deviceTypeBtn = document.querySelector('button[data-automation-id="phone-device-type"], button[data-automation-id="deviceType"]');
    if (deviceTypeBtn && !deviceTypeBtn.innerText.includes('Mobile')) {
      deviceTypeBtn.click();
      setTimeout(() => {
        const items = document.querySelectorAll('[data-automation-id="select-item"], [role="option"]');
        items.forEach(it => {
          if (it.innerText.toLowerCase().includes('mobile')) {
            it.click();
          }
        });
      }, 150);
    }

    // Source dropdown ("How did you hear about us?")
    const sourceBtn = document.querySelector('button[data-automation-id="sourcePrompt"]');
    if (sourceBtn && (!sourceBtn.innerText || sourceBtn.innerText.includes('Select') || sourceBtn.innerText.includes('Prompt'))) {
      sourceBtn.click();
      setTimeout(() => {
        const items = document.querySelectorAll('[data-automation-id="select-item"], [role="option"]');
        items.forEach(it => {
          if (it.innerText.toLowerCase().includes('job board') || it.innerText.toLowerCase().includes('linkedin') || it.innerText.toLowerCase().includes('career')) {
            it.click();
          }
        });
      }, 150);
    }
  } catch (e) {
    // ignore
  }
}

// Workday radio button questions (Legally authorized, sponsorship, previous employee)
function fillWorkdayRadios() {
  try {
    const radioContainers = document.querySelectorAll('[data-automation-id*="radio"], [role="radiogroup"], fieldset, .css-1');
    radioContainers.forEach(container => {
      const text = container.innerText.toLowerCase();
      const radios = container.querySelectorAll('input[type="radio"], [role="radio"]');

      // Authorized to work in country? -> Yes
      if (text.includes('authorized to work') || text.includes('legally authorized') || text.includes('eligible to work')) {
        radios.forEach(r => {
          const lbl = (r.getAttribute('aria-label') || r.value || r.parentElement?.innerText || '').toLowerCase();
          if (lbl.includes('yes') && !r.checked) {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }

      // Require sponsorship? -> No
      if (text.includes('sponsorship') || text.includes('require visa') || text.includes('require sponsorship')) {
        radios.forEach(r => {
          const lbl = (r.getAttribute('aria-label') || r.value || r.parentElement?.innerText || '').toLowerCase();
          if (lbl.includes('no') && !r.checked) {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }

      // Previously employed by company? -> No
      if (text.includes('previously employed') || text.includes('previous worker') || text.includes('worked for') || text.includes('former employee')) {
        radios.forEach(r => {
          const lbl = (r.getAttribute('aria-label') || r.value || r.parentElement?.innerText || '').toLowerCase();
          if (lbl.includes('no') && !r.checked) {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }

      // 18 years or older? -> Yes
      if (text.includes('18 years') || text.includes('age of majority') || text.includes('are you 18')) {
        radios.forEach(r => {
          const lbl = (r.getAttribute('aria-label') || r.value || r.parentElement?.innerText || '').toLowerCase();
          if (lbl.includes('yes') && !r.checked) {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }
    });
  } catch (e) {
    // ignore
  }
}

// Find Next / Continue button in multi-step wizard
function findNextStepButton() {
  // 1. Workday specific navigation buttons
  const wdButtons = [
    document.querySelector('button[data-automation-id="bottom-navigation-next-button"]'),
    document.querySelector('button[data-automation-id="page-footer-next-button"]'),
    document.querySelector('button[data-automation-id="next-button"]'),
    document.querySelector('[data-automation-id="navigation-next-button"]')
  ].filter(Boolean);

  if (wdButtons.length > 0) {
    const btn = wdButtons[0];
    const text = (btn.innerText || '').toLowerCase();
    // Do NOT auto-click final submit button so candidate can verify
    if (!text.includes('submit') && !btn.disabled) {
      return btn;
    }
  }

  // 2. Generic buttons matching "Save and Continue", "Continue", "Next Step", "Next"
  const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
  for (const btn of allButtons) {
    if (btn.disabled || btn.offsetParent === null) continue;
    const text = (btn.innerText || btn.value || '').trim().toLowerCase();
    if (
      (text === 'continue' || text === 'next' || text === 'save & continue' || text === 'save and continue' || text === 'next step') &&
      !text.includes('submit')
    ) {
      return btn;
    }
  }

  return null;
}

// Helper to detect current step in multi-step application
function detectCurrentStep() {
  // Steppers in Workday
  const stepperActive = document.querySelector('[data-automation-id="activeStep"], [aria-current="step"], .css-1[data-automation-id*="step"]');
  if (stepperActive && stepperActive.innerText) {
    return stepperActive.innerText.split('\n')[0].trim();
  }

  // Title / Step Header
  const h2 = document.querySelector('h2, [data-automation-id="pageHeader"], [data-automation-id="stepHeader"]');
  if (h2 && h2.innerText) {
    return h2.innerText.trim();
  }

  return 'Application Step';
}

// Helper to check if currently on the final Review step
function isReviewStep() {
  const step = detectCurrentStep().toLowerCase();
  const pageText = (document.body ? document.body.innerText.slice(0, 2000) : '').toLowerCase();
  return step.includes('review') || pageText.includes('review your application') || document.querySelector('button[data-automation-id="submit-button"], button[type="submit"]') !== null;
}

// ----------------------------------------------------
// AUTONOMOUS BACKGROUND AUTO-PILOT ENGINE
// ----------------------------------------------------
let autoPilotState = {
  running: false,
  timerId: null,
  stepCount: 0,
  totalFieldsFilled: 0,
  lastStepHash: '',
  statusMessage: 'Ready'
};

function startAutoPilot(resumeId) {
  if (autoPilotState.running) return;

  autoPilotState.running = true;
  autoPilotState.stepCount = 0;
  autoPilotState.totalFieldsFilled = 0;
  autoPilotState.statusMessage = 'Auto-Pilot active. Filling application in background...';
  updateCompanionWidget();

  // Execute first cycle immediately
  runAutoPilotCycle(resumeId);

  // Polling loop every 2 seconds to seamlessly handle page/step transitions
  autoPilotState.timerId = setInterval(() => {
    if (!autoPilotState.running) {
      clearInterval(autoPilotState.timerId);
      return;
    }
    runAutoPilotCycle(resumeId);
  }, 2200);
}

function stopAutoPilot(message = 'Auto-Pilot paused.') {
  autoPilotState.running = false;
  if (autoPilotState.timerId) {
    clearInterval(autoPilotState.timerId);
    autoPilotState.timerId = null;
  }
  autoPilotState.statusMessage = message;
  updateCompanionWidget();
}

function runAutoPilotCycle(resumeId) {
  if (!autoPilotState.running) return;

  const currentStep = detectCurrentStep();

  // 1. If on Review / Final step -> Stop and celebrate!
  if (isReviewStep()) {
    playSuccessChime();
    stopAutoPilot('🎉 All steps completed! Ready for your final Review & Submit.');
    return;
  }

  // 2. If on Step 1 ("Autofill with Resume" drop zone)
  if (currentStep.toLowerCase().includes('autofill with resume') || document.querySelector('[data-automation-id="file-upload-drop-zone"]')) {
    const nextBtn = findNextStepButton();
    if (nextBtn) {
      autoPilotState.statusMessage = 'Bypassing resume upload wizard... entering details step...';
      updateCompanionWidget();
      setTimeout(() => {
        if (autoPilotState.running && nextBtn) nextBtn.click();
      }, 1000);
      return;
    }
  }

  // 3. Fill available form fields
  const fillRes = autoFillForm(resumeId);
  if (fillRes.filledCount > 0) {
    autoPilotState.totalFieldsFilled += fillRes.filledCount;
    autoPilotState.stepCount++;
    autoPilotState.statusMessage = `✅ Filled ${fillRes.filledCount} fields on "${currentStep}". Advancing...`;
    updateCompanionWidget();

    // Natural delay before clicking Next so React/Workday state registers and validates
    setTimeout(() => {
      if (!autoPilotState.running) return;
      const nextBtn = findNextStepButton();
      if (nextBtn) {
        nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nextBtn.click();
      }
    }, 1400);
  } else {
    // If no fields to fill, check if there is an active next button to advance
    const nextBtn = findNextStepButton();
    if (nextBtn) {
      autoPilotState.statusMessage = `Advancing "${currentStep}" to next section...`;
      updateCompanionWidget();
      setTimeout(() => {
        if (autoPilotState.running && nextBtn) nextBtn.click();
      }, 1200);
    }
  }
}

// 5. Fill OTP into page
function fillOtpIntoPage(otp) {
  if (!otp) return { success: false, error: 'No OTP provided' };
  const strOtp = String(otp).trim();

  // Find OTP inputs
  const inputs = Array.from(document.querySelectorAll('input'));
  let matchedInputs = [];

  inputs.forEach(input => {
    const { combined } = getFieldDescriptor(input);
    if (
      combined.includes('otp') ||
      combined.includes('code') ||
      combined.includes('verification') ||
      combined.includes('pin') ||
      input.getAttribute('autocomplete') === 'one-time-code'
    ) {
      matchedInputs.push(input);
    }
  });

  // Single OTP input box
  if (matchedInputs.length === 1) {
    setNativeValue(matchedInputs[0], strOtp);
    return { success: true, count: 1, message: `Filled OTP ${strOtp} into verification input.` };
  }

  // Multi-digit split boxes (e.g. 6 boxes each maxlength=1)
  if (matchedInputs.length >= strOtp.length) {
    matchedInputs.slice(0, strOtp.length).forEach((input, idx) => {
      setNativeValue(input, strOtp[idx]);
    });
    return { success: true, count: strOtp.length, message: `Filled ${strOtp.length}-digit OTP into split boxes.` };
  }

  // Fallback: look for inputs with maxlength=1 grouped together
  const singleCharInputs = inputs.filter(inp => inp.maxLength === 1);
  if (singleCharInputs.length >= strOtp.length) {
    singleCharInputs.slice(0, strOtp.length).forEach((inp, idx) => {
      setNativeValue(inp, strOtp[idx]);
    });
    return { success: true, count: strOtp.length, message: `Filled OTP into digit boxes.` };
  }

  return { success: false, error: 'Could not find an OTP input field on the current page.' };
}

// 6. In-Page Floating Assistant Widget (Smart Companion Pill)
function injectCompanionWidget() {
  if (document.getElementById('jobfinder-companion-widget')) return;

  const url = window.location.href.toLowerCase();
  const isJobPage = 
    url.includes('myworkdayjobs') ||
    url.includes('workday') ||
    url.includes('lever.co') ||
    url.includes('greenhouse.io') ||
    url.includes('ashbyhq.com') ||
    url.includes('job') ||
    url.includes('career') ||
    url.includes('apply') ||
    url.includes('candidate');

  const data = analyzePage();
  if (!data.hasForm && !isJobPage) {
    return;
  }

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
  const wrapper = document.createElement('div');
  wrapper.id = 'jf-pill';
  wrapper.style.cssText = `
    background: #09090b;
    color: #f4f4f5;
    border: 1px solid rgba(234, 179, 8, 0.5);
    box-shadow: 0 20px 30px -5px rgba(0, 0, 0, 0.7), 0 0 20px rgba(234, 179, 8, 0.2);
    border-radius: 16px;
    padding: 14px 16px;
    width: 320px;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    backdrop-filter: blur(14px);
  `;

  shadow.appendChild(wrapper);
  document.body.appendChild(container);

  renderCompanionMarkup(shadow, data);
}

function updateCompanionWidget() {
  const container = document.getElementById('jobfinder-companion-widget');
  if (!container || !container.shadowRoot) return;
  const shadow = container.shadowRoot;
  const data = analyzePage();
  renderCompanionMarkup(shadow, data);
}

function renderCompanionMarkup(shadow, data) {
  const wrapper = shadow.getElementById('jf-pill');
  if (!wrapper) return;

  const isRunning = autoPilotState.running;

  wrapper.innerHTML = `
    <!-- Top Header -->
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
      <div style="display: flex; align-items: center; gap: 4px;">
        <button id="jf-min" style="background: none; border: none; color: #71717a; cursor: pointer; font-size: 16px; padding: 2px 4px; line-height: 1;">−</button>
        <button id="jf-close" style="background: none; border: none; color: #71717a; cursor: pointer; font-size: 16px; padding: 2px 4px; line-height: 1;">×</button>
      </div>
    </div>

    <!-- Live Auto-Pilot Pulse Banner -->
    <div style="background: ${isRunning ? 'rgba(16, 185, 129, 0.15)' : 'rgba(24, 24, 27, 0.8)'}; border: 1px solid ${isRunning ? '#10b981' : '#27272a'}; border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${isRunning ? '#10b981' : '#71717a'}; ${isRunning ? 'box-shadow: 0 0 8px #10b981;' : ''}"></span>
        <span style="font-size: 11px; font-weight: 700; color: ${isRunning ? '#34d399' : '#a1a1aa'};">
          ${isRunning ? 'AUTO-PILOT ACTIVE (Hands-Free)' : 'Auto-Pilot Standby'}
        </span>
      </div>
      <span style="font-size: 10px; color: #eab308; font-weight: 700;">
        ${escapeHtml(detectCurrentStep().slice(0, 16))}
      </span>
    </div>

    <!-- Salary & Best Resume Card -->
    <div style="background: rgba(24, 24, 27, 0.7); border: 1px solid #27272a; border-radius: 10px; padding: 8px 10px; margin-bottom: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
        <span style="font-size: 10px; color: #71717a; font-weight: 700; text-transform: uppercase;">Expected SDE1 Comp</span>
        <span style="font-size: 12px; font-weight: 800; color: #eab308;">${data.salary.ctc}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px;">
        <span style="color: #a1a1aa;">Best Resume Match:</span>
        <span style="color: #60a5fa; font-weight: 700;">${data.match.bestResume.badge} (${data.match.score}%)</span>
      </div>
    </div>

    <!-- Main Hands-Free Action Button -->
    <div style="margin-bottom: 8px;">
      <button id="jf-autopilot-btn" style="width: 100%; background: ${isRunning ? '#dc2626' : '#eab308'}; color: ${isRunning ? '#ffffff' : '#09090b'}; border: none; border-radius: 10px; padding: 10px 14px; font-weight: 800; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px ${isRunning ? 'rgba(220,38,38,0.4)' : 'rgba(234,179,8,0.35)'}; transition: all 0.2s;">
        ${isRunning ? '⏸️ Pause Auto-Pilot' : '🚀 Start Background Auto-Pilot (Hands-Free)'}
      </button>
    </div>

    <!-- Secondary Actions -->
    <div style="display: flex; gap: 6px;">
      <button id="jf-quick-fill-btn" style="flex: 1; background: #18181b; color: #f4f4f5; border: 1px solid #3f3f46; border-radius: 8px; padding: 7px 10px; font-weight: 600; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
        ⚡ Fill Page
      </button>
      <button id="jf-otp-btn" style="flex: 1; background: #18181b; color: #eab308; border: 1px solid #3f3f46; border-radius: 8px; padding: 7px 10px; font-weight: 600; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
        🔑 Fetch OTP
      </button>
    </div>

    <!-- Status Message -->
    <div id="jf-status" style="margin-top: 8px; font-size: 10px; color: ${isRunning ? '#34d399' : '#a1a1aa'}; text-align: center; line-height: 1.3;">
      ${escapeHtml(autoPilotState.statusMessage)}
    </div>
  `;

  // Attach handlers
  const closeBtn = shadow.getElementById('jf-close');
  if (closeBtn) closeBtn.onclick = () => shadow.host.remove();

  const minBtn = shadow.getElementById('jf-min');
  if (minBtn) {
    minBtn.onclick = () => {
      wrapper.style.display = 'none';
      createMiniFloatingPill(shadow, data);
    };
  }

  const autoPilotBtn = shadow.getElementById('jf-autopilot-btn');
  if (autoPilotBtn) {
    autoPilotBtn.onclick = () => {
      if (autoPilotState.running) {
        stopAutoPilot();
      } else {
        startAutoPilot(data.match.bestResume.id);
      }
    };
  }

  const quickFillBtn = shadow.getElementById('jf-quick-fill-btn');
  if (quickFillBtn) {
    quickFillBtn.onclick = () => {
      quickFillBtn.disabled = true;
      quickFillBtn.innerText = 'Filling...';
      const res = autoFillForm(data.match.bestResume.id);
      quickFillBtn.disabled = false;
      quickFillBtn.innerText = '⚡ Fill Page';
      autoPilotState.statusMessage = `✅ Filled ${res.filledCount} fields with ${data.match.bestResume.badge}!`;
      updateCompanionWidget();
    };
  }

  const otpBtn = shadow.getElementById('jf-otp-btn');
  if (otpBtn) {
    otpBtn.onclick = () => {
      otpBtn.disabled = true;
      otpBtn.innerText = 'Fetching...';
      autoPilotState.statusMessage = 'Scanning inbox for verification code...';
      updateCompanionWidget();

      chrome.runtime.sendMessage({ action: 'FETCH_OTP' }, (response) => {
        otpBtn.disabled = false;
        otpBtn.innerText = '🔑 Fetch OTP';
        if (response && response.success && response.otp) {
          const fillRes = fillOtpIntoPage(response.otp);
          autoPilotState.statusMessage = `✅ Found OTP: ${response.otp}! ${fillRes.message || ''}`;
        } else {
          autoPilotState.statusMessage = `⚠️ ${response?.error || 'No OTP found. Please ensure verification email arrived.'}`;
        }
        updateCompanionWidget();
      });
    };
  }
}

function createMiniFloatingPill(shadow, data) {
  let mini = shadow.getElementById('jf-mini-pill');
  if (!mini) {
    mini = document.createElement('div');
    mini.id = 'jf-mini-pill';
    mini.style.cssText = `
      background: #09090b;
      color: #eab308;
      border: 1px solid rgba(234, 179, 8, 0.6);
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
      border-radius: 30px;
      padding: 8px 14px;
      cursor: pointer;
      font-weight: 800;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      backdrop-filter: blur(12px);
    `;
    mini.innerHTML = `⚡ JF Auto-Pilot ${autoPilotState.running ? '🟢' : ''}`;
    mini.onclick = () => {
      mini.remove();
      const wrapper = shadow.getElementById('jf-pill');
      if (wrapper) wrapper.style.display = 'block';
    };
    shadow.appendChild(mini);
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// 7. Message listener for Chrome runtime (communicating with popup)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ANALYZE_PAGE') {
    const data = analyzePage();
    sendResponse({
      ...data,
      autoPilotRunning: autoPilotState.running,
      currentStep: detectCurrentStep()
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

// Auto initialize when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    analyzePage();
    setTimeout(injectCompanionWidget, 1000);
  });
} else {
  analyzePage();
  setTimeout(injectCompanionWidget, 1000);
}


const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

// Candidate profile & form filling logic under test
const {
  CANDIDATE_PROFILE,
  isFinalSubmitButton,
  isSafeNavigationButton,
  extractQuestionContext,
  classifyQuestion,
  reconcileWorkdayFields,
  generateCompletionSummary
} = require('../../extension/src/utils/formFillerCore');

console.log('=====================================================');
console.log('🧪 RUNNING JOBFINDER AUTOFILL & NO-SUBMISSION TESTS');
console.log('=====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n`);
  }
}

// -------------------------------------------------------------------
// 1. CANDIDATE PROFILE SOURCE OF TRUTH VERIFICATION
// -------------------------------------------------------------------
console.log('📋 Group 1: Candidate Profile & Source of Truth Standards');

runTest('Profile Full Name is Khushal Midha', () => {
  assert.strictEqual(CANDIDATE_PROFILE.fullName, 'Khushal Midha');
  assert.strictEqual(CANDIDATE_PROFILE.firstName, 'Khushal');
  assert.strictEqual(CANDIDATE_PROFILE.lastName, 'Midha');
});

runTest('Profile Contact Info: midhakhushal5@gmail.com and +91 90507 40836', () => {
  assert.strictEqual(CANDIDATE_PROFILE.email, 'midhakhushal5@gmail.com');
  assert.strictEqual(CANDIDATE_PROFILE.phone, '+91 90507 40836');
  assert.strictEqual(CANDIDATE_PROFILE.phoneRaw, '9050740836');
});

runTest('Profile Education: IIIT Lucknow, B.Tech CS & AI, Graduating July 2027', () => {
  assert.strictEqual(CANDIDATE_PROFILE.college, 'Indian Institute of Information Technology, Lucknow');
  assert.strictEqual(CANDIDATE_PROFILE.degree, 'B.Tech in Computer Science and Artificial Intelligence');
  assert.strictEqual(CANDIDATE_PROFILE.graduationDate, 'July 2027');
  assert.strictEqual(CANDIDATE_PROFILE.graduationYear, '2027');
  assert.strictEqual(CANDIDATE_PROFILE.cgpa, '8.72');
});

runTest('Profile Experience: Coffeee.io SDE Intern (June 2025 to August 2025)', () => {
  assert.strictEqual(CANDIDATE_PROFILE.currentCompany, 'Coffeee.io');
  assert.strictEqual(CANDIDATE_PROFILE.currentRole, 'Software Development Engineer Intern');
  assert.strictEqual(CANDIDATE_PROFILE.internshipDuration, 'June 2025 to August 2025');
});

runTest('Compensation Standards: Exactly ₹30,00,000 INR and 30 LPA', () => {
  assert.strictEqual(CANDIDATE_PROFILE.expectedAnnualSalaryINR, '₹30,00,000');
  assert.strictEqual(CANDIDATE_PROFILE.expectedAnnualSalaryINRNumber, 3000000);
  assert.strictEqual(CANDIDATE_PROFILE.expectedAnnualCtcLpa, '30 LPA');
  assert.strictEqual(CANDIDATE_PROFILE.expectedAnnualCtcLpaNumber, 30);
});

// -------------------------------------------------------------------
// 2. STRICT NO-SUBMISSION POLICY VERIFICATION
// -------------------------------------------------------------------
console.log('\n🛡️ Group 2: Strict No-Submission Policy & Button Classification');

runTest('Blocks "Submit Application" button', () => {
  assert.strictEqual(isFinalSubmitButton('Submit Application'), true);
  assert.strictEqual(isSafeNavigationButton('Submit Application'), false);
});

runTest('Blocks "Submit" button', () => {
  assert.strictEqual(isFinalSubmitButton('Submit'), true);
  assert.strictEqual(isSafeNavigationButton('Submit'), false);
});

runTest('Blocks "Apply Now" button inside form', () => {
  assert.strictEqual(isFinalSubmitButton('Apply Now'), true);
  assert.strictEqual(isSafeNavigationButton('Apply Now'), false);
});

runTest('Blocks "Send Application" button', () => {
  assert.strictEqual(isFinalSubmitButton('Send Application'), true);
  assert.strictEqual(isSafeNavigationButton('Send Application'), false);
});

runTest('Blocks "Finish Application" button', () => {
  assert.strictEqual(isFinalSubmitButton('Finish Application'), true);
  assert.strictEqual(isSafeNavigationButton('Finish Application'), false);
});

runTest('Blocks buttons with submit automation IDs', () => {
  assert.strictEqual(isFinalSubmitButton('', 'bottom-navigation-submit-button'), true);
  assert.strictEqual(isFinalSubmitButton('', 'page-footer-submit-button'), true);
});

runTest('Allows safe multi-step navigation buttons ("Save and Continue", "Next Step")', () => {
  assert.strictEqual(isSafeNavigationButton('Save and Continue'), true);
  assert.strictEqual(isSafeNavigationButton('Next Step'), true);
  assert.strictEqual(isSafeNavigationButton('Next'), true);
  assert.strictEqual(isSafeNavigationButton('Continue'), true);
  assert.strictEqual(isFinalSubmitButton('Save and Continue'), false);
});

runTest('Terms and legal consent checkboxes are NEVER auto-checked and require manual review', () => {
  const dummyCheckbox = new JSDOM('<input type="checkbox" name="agree_terms" aria-label="I agree to the terms and privacy policy" />').window.document.querySelector('input');
  const ctx = extractQuestionContext(dummyCheckbox);
  const decision = classifyQuestion(ctx);
  assert.strictEqual(decision.requiresManualReview, true);
  assert.strictEqual(decision.verified, false);
});

runTest('Legal declarations and background checks require explicit applicant review', () => {
  const dummyDeclaration = new JSDOM('<input type="checkbox" name="background_check" aria-label="I consent to background check and verification" />').window.document.querySelector('input');
  const ctx = extractQuestionContext(dummyDeclaration);
  const decision = classifyQuestion(ctx);
  assert.strictEqual(decision.requiresManualReview, true);
  assert.strictEqual(decision.verified, false);
});

// -------------------------------------------------------------------
// 3. WORKDAY FORM FIXTURE VERIFICATION
// -------------------------------------------------------------------
console.log('\n💼 Group 3: Workday Application Form Fixture Verification');

const workdayHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'workdayFixture.html'), 'utf8');
const workdayDom = new JSDOM(workdayHtml);
const workdayDoc = workdayDom.window.document;

runTest('Workday Legal Name Section matches Khushal Midha', () => {
  const fNameEl = workdayDoc.querySelector('[data-automation-id="legalNameSection_firstName"]');
  const lNameEl = workdayDoc.querySelector('[data-automation-id="legalNameSection_lastName"]');
  const fCtx = extractQuestionContext(fNameEl);
  const lCtx = extractQuestionContext(lNameEl);

  const fDecision = classifyQuestion(fCtx);
  const lDecision = classifyQuestion(lCtx);

  assert.strictEqual(fDecision.value, 'Khushal');
  assert.strictEqual(lDecision.value, 'Midha');
});

runTest('Workday Email & Phone Match', () => {
  const emailEl = workdayDoc.querySelector('[data-automation-id="addressSection_email"]');
  const phoneEl = workdayDoc.querySelector('[data-automation-id="phone-number"]');
  const eCtx = extractQuestionContext(emailEl);
  const pCtx = extractQuestionContext(phoneEl);

  const eDecision = classifyQuestion(eCtx);
  const pDecision = classifyQuestion(pCtx);

  assert.strictEqual(eDecision.value, 'midhakhushal5@gmail.com');
  assert.strictEqual(pDecision.value, '+91 90507 40836');
});

runTest('Workday Expected Annual Compensation is ₹30,00,000 INR', () => {
  const salEl = workdayDoc.querySelector('[data-automation-id="expected-annual-salary"]');
  const ctx = extractQuestionContext(salEl);
  const decision = classifyQuestion(ctx);

  assert.strictEqual(decision.value, '₹30,00,000');
  assert.strictEqual(decision.verified, true);
});

runTest('Workday Current Salary is NEVER fabricated and flagged for review', () => {
  const curSalEl = workdayDoc.querySelector('[data-automation-id="current-salary"]');
  const ctx = extractQuestionContext(curSalEl);
  const decision = classifyQuestion(ctx);

  assert.strictEqual(decision.requiresManualReview, true);
  assert.strictEqual(decision.verified, false);
});

runTest('Workday Final Submit Button is strictly detected and blocked', () => {
  const submitBtn = workdayDoc.querySelector('#workday-submit-btn');
  assert.strictEqual(isFinalSubmitButton(submitBtn.textContent, submitBtn.getAttribute('data-automation-id')), true);
});

runTest('Workday Parser Reconciliation corrects parsed discrepancies', () => {
  const parsedBadData = {
    firstName: 'WrongName',
    lastName: 'Midha',
    email: 'random@test.com',
    school: 'Some College'
  };
  const corrections = reconcileWorkdayFields(parsedBadData);
  assert.strictEqual(corrections.length, 3);
  assert.strictEqual(corrections[0].to, 'Khushal');
  assert.strictEqual(corrections[1].to, 'midhakhushal5@gmail.com');
  assert.strictEqual(corrections[2].to, 'Indian Institute of Information Technology, Lucknow');
});

// -------------------------------------------------------------------
// 4. GOOGLE FORMS FIXTURE VERIFICATION
// -------------------------------------------------------------------
console.log('\n📝 Group 4: Google Forms Fixture Verification');

const gFormsHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'googleFormsFixture.html'), 'utf8');
const gFormsDom = new JSDOM(gFormsHtml);
const gFormsDoc = gFormsDom.window.document;

runTest('Google Forms Question Title and Context Extraction', () => {
  const q1 = gFormsDoc.querySelectorAll('div[role="listitem"]')[0];
  const input1 = q1.querySelector('input');
  const ctx = extractQuestionContext(input1);

  assert.strictEqual(ctx.labelText.includes('Full Name'), true);
  assert.strictEqual(ctx.isRequired, true);
  const decision = classifyQuestion(ctx);
  assert.strictEqual(decision.value, 'Khushal Midha');
});

runTest('Google Forms Expected CTC in LPA enters 30', () => {
  const q5 = gFormsDoc.querySelectorAll('div[role="listitem"]')[4];
  const input5 = q5.querySelector('input');
  const ctx = extractQuestionContext(input5);

  assert.strictEqual(ctx.labelText.includes('Expected Annual CTC in LPA'), true);
  const decision = classifyQuestion(ctx);
  assert.strictEqual(decision.value, 30);
  assert.strictEqual(decision.verified, true);
});

runTest('Google Forms Current Monthly Stipend is flagged for review (never confused with CTC)', () => {
  const q6 = gFormsDoc.querySelectorAll('div[role="listitem"]')[5];
  const input6 = q6.querySelector('input');
  const ctx = extractQuestionContext(input6);

  assert.strictEqual(ctx.labelText.includes('Monthly'), true);
  const decision = classifyQuestion(ctx);
  assert.strictEqual(decision.requiresManualReview, true);
  assert.strictEqual(decision.verified, false);
});

runTest('Google Forms Submit Button is identified and NEVER clicked', () => {
  const submitBtn = gFormsDoc.querySelector('#google-forms-submit-btn');
  assert.strictEqual(isFinalSubmitButton(submitBtn.textContent, '', '', submitBtn.getAttribute('role')), true);
});

// -------------------------------------------------------------------
// 5. GREENHOUSE & LEVER FIXTURES VERIFICATION
// -------------------------------------------------------------------
console.log('\n🏢 Group 5: Greenhouse & Lever Portals Fixture Verification');

const ghHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'greenhouseFixture.html'), 'utf8');
const ghDom = new JSDOM(ghHtml);
const ghDoc = ghDom.window.document;

runTest('Greenhouse First and Last Name and Email', () => {
  const fName = ghDoc.querySelector('#first_name');
  const lName = ghDoc.querySelector('#last_name');
  const email = ghDoc.querySelector('#email');

  assert.strictEqual(classifyQuestion(extractQuestionContext(fName)).value, 'Khushal');
  assert.strictEqual(classifyQuestion(extractQuestionContext(lName)).value, 'Midha');
  assert.strictEqual(classifyQuestion(extractQuestionContext(email)).value, 'midhakhushal5@gmail.com');
});

runTest('Greenhouse Expected Compensation in INR is ₹30,00,000', () => {
  const sal = ghDoc.querySelector('#expected_salary');
  const decision = classifyQuestion(extractQuestionContext(sal));
  assert.strictEqual(decision.value, '₹30,00,000');
});

runTest('Greenhouse Submit Button blocked by No-Submit policy', () => {
  const submitInput = ghDoc.querySelector('#submit_app_button');
  assert.strictEqual(isFinalSubmitButton(submitInput.value, '', submitInput.type), true);
});

const leverHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'leverFixture.html'), 'utf8');
const leverDom = new JSDOM(leverHtml);
const leverDoc = leverDom.window.document;

runTest('Lever Org field matches Coffeee.io', () => {
  const org = leverDoc.querySelector('input[name="org"]');
  const decision = classifyQuestion(extractQuestionContext(org));
  assert.strictEqual(decision.value, 'Coffeee.io');
});

runTest('Lever Expected CTC in LPA enters 30', () => {
  const ctc = leverDoc.querySelector('input[name="custom_expected_ctc_lpa"]');
  const decision = classifyQuestion(extractQuestionContext(ctc));
  assert.strictEqual(decision.value, 30);
});

runTest('Lever "Apply Now" submit button strictly blocked', () => {
  const btn = leverDoc.querySelector('#lever-submit-btn');
  assert.strictEqual(isFinalSubmitButton(btn.textContent, '', btn.type), true);
});

// -------------------------------------------------------------------
// 6. COMPLETION SUMMARY AUDIT VERIFICATION
// -------------------------------------------------------------------
console.log('\n📊 Group 6: Completion Summary Audit & Strict Policy Report');

runTest('Completion summary reports filled fields, manual reviews, and no-submit enforcement', () => {
  const filled = [
    { field: 'First Name', value: 'Khushal' },
    { field: 'Last Name', value: 'Midha' },
    { field: 'Expected Salary', value: '₹30,00,000' }
  ];
  const manual = [
    { field: 'Notice Period', reason: 'Never invent notice period' }
  ];

  const summary = generateCompletionSummary(filled, manual, [], []);
  assert.strictEqual(summary.totalFilled, 3);
  assert.strictEqual(summary.totalManual, 1);
  assert.strictEqual(summary.strictNoSubmitEnforced, true);
  assert.strictEqual(summary.overallStatus.includes('Manual Review'), true);
});

console.log('\n=====================================================');
console.log(`🏁 AUTOFILL TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('=====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}


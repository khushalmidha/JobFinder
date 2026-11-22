// Independent Smart Apply QA suite:
// Verifies resolver lifecycle, answer memory and synthetic widgets; packaged extension UI is covered separately.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { JSDOM } = require('jsdom');
const { normalizeProfile, rememberAnswer, recallAnswer } = require('../../extension/src/utils/candidateProfile.js');
const { FormFillSession, extractQuestionContext } = require('../../extension/src/utils/formFillerCore.js');
const { SmartApplyEngine } = require('../smartApply/engine.js');

const syntheticProfile = {
  fullName: 'Synthetic Candidate',
  firstName: 'Synthetic',
  lastName: 'Candidate',
  email: 'candidate@example.org',
  phoneRaw: '+919876543210',
  college: 'National Institute of Technology',
  degree: 'Bachelor of Technology',
  major: 'Computer Science and Engineering',
  cgpa: '8.8',
  graduationYear: '2026',
  location: { city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  links: {
    github: 'https://github.com/synthetic-candidate',
    linkedin: 'https://linkedin.com/in/synthetic-candidate',
    portfolio: 'https://candidate.example.org'
  },
  supportingEvidence: [
    { text: 'Engineered high-throughput event processing pipeline.', source: 'synthetic_resume.pdf' }
  ],
  companyFacts: [
    { text: 'Enterprise software provider headquartered in Bengaluru.', source: 'https://employer.example/about' }
  ],
  answers_bank: []
};

// Test Server helper
async function createHarness(renderHtml) {
  let submissions = 0;
  const writes = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      writes.push(req.url);
      if (req.url === '/submit' || req.url === '/apply') {
        submissions++;
      }
      res.writeHead(204).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderHtml(req.url, server.address().port));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    url,
    getWrites: () => [...writes],
    getSubmissions: () => submissions,
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
    }
  };
}

test('1.1: Canonical normalization -> non-mutating preview -> explicit fill lifecycle', async t => {
  // Test canonical normalization
  const rawCanonical = {
    identity: {
      name: 'Synthetic Candidate',
      email: 'candidate@example.org',
      phone: '+919876543210',
      location: { city: 'Bengaluru', country: 'India' }
    },
    education: [{
      institute: 'National Institute of Technology',
      degree: 'B.Tech',
      branch: 'Computer Science',
      cgpa: 8.8,
      end: '2026-07'
    }],
    experience: [{
      company: 'Tech Corp',
      bullets: ['Built scalable microservices in Node.js and TypeScript']
    }],
    projects: [{
      name: 'Search Engine',
      one_line: 'Distributed full-text index with sub-10ms query latency'
    }],
    preferences: {
      work_authorization: 'TODO per country',
      salary_expectation: 'TODO'
    }
  };

  const normalized = normalizeProfile(rawCanonical);
  assert.equal(normalized.fullName, 'Synthetic Candidate');
  assert.equal(normalized.firstName, 'Synthetic');
  assert.equal(normalized.lastName, 'Candidate');
  assert.equal(normalized.email, 'candidate@example.org');
  assert.equal(normalized.college, 'National Institute of Technology');
  assert.equal(normalized.graduationYear, '2026');
  // Unknowns must be empty / not inferred
  assert.equal(normalized.preferences.work_authorization, null);
  assert.equal(normalized.preferences.salary_expectation, null);
  assert.equal(normalized.supportingEvidence.length, 2);

  const harness = await createHarness(() => `
    <!doctype html>
    <html>
      <body>
        <form action="/submit" method="POST">
          <label>First name <input id="first" name="first_name"></label>
          <label>Last name <input id="last" name="last_name"></label>
          <label>Email address <input id="email" type="email" name="email"></label>
          <label>University <input id="univ" name="college"></label>
          <label>Graduation year <input id="grad" name="grad_year"></label>
          <button type="submit" id="submit-btn">Submit Application</button>
        </form>
      </body>
    </html>
  `);
  t.after(harness.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(harness.url);

  const engine = new SmartApplyEngine(page, {
    profile: normalized,
    allowedHosts: ['127.0.0.1']
  });

  // Step A: Preview produces plan, does NOT mutate DOM
  const preview = await engine.preview();
  assert.equal(preview.state, 'PLAN');
  assert.equal(await page.locator('#first').inputValue(), '');
  assert.equal(await page.locator('#email').inputValue(), '');

  // Step B: Explicit fill verifies fields
  const report = await engine.fill();
  // Under the stop-before-submit design, report.state transitions to NEEDS_REVIEW
  // to ensure manual candidate review before submission, while individual fields are 'verified'.
  assert.equal(report.state, 'NEEDS_REVIEW');
  const verifiedFields = report.fields.filter(f => f.outcome === 'verified');
  assert.equal(verifiedFields.length, 5);

  assert.equal(await page.locator('#first').inputValue(), 'Synthetic');
  assert.equal(await page.locator('#last').inputValue(), 'Candidate');
  assert.equal(await page.locator('#email').inputValue(), 'candidate@example.org');
  assert.equal(await page.locator('#univ').inputValue(), 'National Institute of Technology');
  assert.equal(await page.locator('#grad').inputValue(), '2026');

  // Verify zero automatic submissions
  assert.equal(harness.getSubmissions(), 0);
  assert.equal(report.submitted, false);
});

test('1.2: Runner kill switch and stopped extension session prevent filling', async t => {
  const harness = await createHarness(() => `
    <form action="/submit" method="POST">
      <label>First name <input id="first" name="first_name"></label>
      <button type="submit">Submit</button>
    </form>
  `);
  t.after(harness.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(harness.url);

  // Test 1: Kill switch stops fill immediately and prevents mutation
  let stopped = true;
  const engine = new SmartApplyEngine(page, {
    profile: syntheticProfile,
    allowedHosts: ['127.0.0.1'],
    shouldStop: () => stopped
  });

  const preview = await engine.preview();
  assert.equal(preview.state, 'PLAN');

  // Kill switch is active: fill must abort with STOPPED state
  const stoppedReport = await engine.fill();
  assert.equal(stoppedReport.state, 'STOPPED');
  assert.equal(await page.locator('#first').inputValue(), '');
  assert.equal(harness.getSubmissions(), 0);

  // Test 2: Extension FormFillSession stop invalidation
  const { document } = new JSDOM('<form><label>First name <input id="first"></label></form>').window;
  const session = new FormFillSession(document);
  session.scan(syntheticProfile);
  session.stop();
  await assert.rejects(session.fill(), /Preview/);
});

test('1.3: Answer memory approve/remember -> preview -> exact question fill; changed options/url fails closed', async t => {
  const harness = await createHarness((pathname) => {
    if (pathname === '/other-job') {
      return `
        <form action="/submit" method="POST">
          <label for="auth">Work authorization status</label>
          <select id="auth">
            <option value="">Select</option>
            <option value="authorized">Authorized to work</option>
            <option value="requires_sponsorship">Requires Visa Sponsorship</option>
          </select>
        </form>
      `;
    }
    return `
      <form action="/submit" method="POST">
        <label for="auth">Work authorization status</label>
        <select id="auth">
          <option value="">Select</option>
          <option value="authorized">Authorized to work</option>
          <option value="requires_sponsorship">Requires Visa Sponsorship</option>
        </select>
      </form>
    `;
  });
  t.after(harness.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(harness.url);

  const authQuestion = 'Work authorization status';
  const authOptions = ['Select', 'Authorized to work', 'Requires Visa Sponsorship'];

  // Unknown question initially requires manual review
  const initialEngine = new SmartApplyEngine(page, {
    profile: syntheticProfile,
    allowedHosts: ['127.0.0.1']
  });
  const initialPreview = await initialEngine.preview();
  const authField = initialPreview.fields.find(f => f.context.labelText === 'Work authorization status');
  assert.ok(authField, 'Auth field must be found with exact label');
  assert.equal(authField.decision.requiresManualReview, true);

  // Extract the exact context.scope that the runner generated for this specific field on this page
  const exactScope = authField.context.scope;
  assert.ok(exactScope, 'Scope must be populated by runner preview');

  // Candidate reviews and approves an exact answer with this exact scope
  let answersBank = rememberAnswer([], {
    question: authQuestion,
    type: 'select',
    options: authOptions,
    scope: exactScope,
    answer: 'Authorized to work',
    approved: true,
    provenance: 'applicant'
  });

  const updatedProfile = { ...syntheticProfile, answers_bank: answersBank };
  const rememberedEngine = new SmartApplyEngine(page, {
    profile: updatedProfile,
    allowedHosts: ['127.0.0.1']
  });

  const previewWithMemory = await rememberedEngine.preview();
  const plannedAuth = previewWithMemory.fields.find(f => f.context.labelText === 'Work authorization status');
  assert.equal(plannedAuth.decision.type, 'REMEMBERED_ANSWER');
  assert.equal(plannedAuth.decision.value, 'Authorized to work');

  // Fill verifies and selects option
  const fillReport = await rememberedEngine.fill();
  assert.equal(await page.locator('#auth').inputValue(), 'authorized');

  // Release network/navigation guard before moving to next application
  await rememberedEngine.releaseForManualReview();

  // Case B: Changed URL scope -> does NOT reuse
  await page.goto(harness.url + '/other-job');
  const otherJobEngine = new SmartApplyEngine(page, {
    profile: updatedProfile,
    allowedHosts: ['127.0.0.1']
  });
  const otherPreview = await otherJobEngine.preview();
  const otherAuth = otherPreview.fields.find(f => f.context.labelText === 'Work authorization status');
  // Different URL scope must fail closed
  assert.equal(otherAuth.decision.requiresManualReview, true);

  // Case C: Changed options -> does NOT reuse
  const changedRecall = recallAnswer(answersBank, authQuestion, 'select', ['Select', 'Citizen', 'Other'], exactScope);
  assert.equal(changedRecall, null);

  // Case D: Changed control type -> does NOT reuse
  const radioRecall = recallAnswer(answersBank, authQuestion, 'radio', authOptions, exactScope);
  assert.equal(radioRecall, null);

  assert.equal(harness.getSubmissions(), 0);
});

test('1.4: Legal agreements, file uploads, OTP fields and final submit remain manual', async t => {
  const harness = await createHarness(() => `
    <form action="/submit" method="POST">
      <label>First name <input id="first"></label>
      <label>Upload resume <input id="resume-file" type="file"></label>
      <label><input id="terms" type="checkbox"> I agree to the terms and privacy policy</label>
      <label>Signature (Full Name) <input id="signature"></label>
      <label>Enter OTP received <input id="otp" type="text"></label>
      <button type="submit" id="submit-button">Submit Application</button>
    </form>
  `);
  t.after(harness.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(harness.url);

  const engine = new SmartApplyEngine(page, {
    profile: syntheticProfile,
    allowedHosts: ['127.0.0.1']
  });

  const preview = await engine.preview();
  const fileField = preview.fields.find(f => f.context.inputType === 'file');
  const termsField = preview.fields.find(f => f.context.labelText.includes('terms'));
  const sigField = preview.fields.find(f => f.context.labelText.includes('Signature'));
  const otpField = preview.fields.find(f => f.context.labelText.includes('OTP'));

  assert.equal(fileField.decision.type, 'MANUAL_UPLOAD');
  assert.equal(termsField.decision.type, 'LEGAL_CONSENT_OR_TERMS');
  assert.equal(sigField.decision.type, 'LEGAL_CONSENT_OR_TERMS');
  assert.equal(otpField.decision.type, 'VERIFICATION');

  const report = await engine.fill();
  assert.equal(await page.locator('#first').inputValue(), 'Synthetic');
  assert.equal(await page.locator('#resume-file').inputValue(), '');
  assert.equal(await page.locator('#terms').isChecked(), false);
  assert.equal(await page.locator('#signature').inputValue(), '');
  assert.equal(await page.locator('#otp').inputValue(), '');
  assert.equal(harness.getSubmissions(), 0);
  assert.equal(report.submitted, false);
});

test('2.1: Exercise widgets: native select, aria-haspopup, input events, radios, prefilled, shadow root, frame preservation', async t => {
  const harness = await createHarness((pathname) => {
    if (pathname === '/frame') {
      return `
        <!doctype html>
        <html><body>
          <!-- Same-origin frame to test frame detection -->
          <label>First name <input id="frame-first" value="Prefilled Frame First"></label>
        </body></html>
      `;
    }
    return `
      <!doctype html>
      <html>
        <head>
          <title>Complex Widget Test</title>
        </head>
        <body>
          <form id="app-form" action="/submit" method="POST">
            <!-- 1. Native Select with external label to prevent option pollution -->
            <label for="country-select">Country</label>
            <select id="country-select">
              <option value="">Select country</option>
              <option value="IN">India</option>
              <option value="US">United States</option>
            </select>

            <!-- 2. Prefilled Value (must be preserved) -->
            <label>Current City
              <input id="city-prefilled" value="Existing Mumbai">
            </label>

            <!-- 3. React-style controlled input -->
            <label>GitHub Profile
              <input id="github-controlled">
            </label>

            <!-- 4. Radio Grouping with legend -->
            <fieldset>
              <legend>Preferred work mode</legend>
              <label><input type="radio" name="workmode" value="Remote">Remote</label>
              <label><input type="radio" name="workmode" value="Hybrid">Hybrid</label>
              <label><input type="radio" name="workmode" value="Onsite">Onsite</label>
            </fieldset>

            <!-- 5. Workday-style aria-haspopup="listbox" button with empty prompt "Select" -->
            <button type="button" id="degree-btn" aria-label="Degree" aria-haspopup="listbox" aria-controls="degree-popup">
              Select
            </button>
            <div id="degree-popup" role="listbox" hidden>
              <div role="option" id="deg-opt-1">Bachelor of Technology</div>
              <div role="option" id="deg-opt-2">Master of Science</div>
            </div>

            <!-- Submit button to verify zero submissions -->
            <button type="submit" id="btn-submit">Submit Form</button>
          </form>

          <!-- 6. Open Shadow Root -->
          <div id="shadow-host"></div>

          <!-- 7. Same-origin frame -->
          <iframe id="inner-frame" src="/frame"></iframe>

          <script>
            // Controlled input event listener tracking React-like value sync
            window.reactState = '';
            const gitInput = document.getElementById('github-controlled');
            gitInput.addEventListener('input', (e) => {
              window.reactState = e.target.value;
            });

            // Workday popup click interaction
            const degBtn = document.getElementById('degree-btn');
            const degPopup = document.getElementById('degree-popup');
            degBtn.addEventListener('click', () => {
              degPopup.hidden = false;
            });
            document.getElementById('deg-opt-1').addEventListener('click', () => {
              degBtn.textContent = 'Bachelor of Technology';
              degBtn.setAttribute('data-value', 'Bachelor of Technology');
              degPopup.hidden = true;
            });

            // Shadow DOM injection
            const shadowRoot = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
            shadowRoot.innerHTML = '<label>Portfolio URL <input id="shadow-portfolio"></label>';
          </script>
        </body>
      </html>
    `;
  });
  t.after(harness.close);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(harness.url);

  // First preview to inspect raw field contexts
  const initialEngine = new SmartApplyEngine(page, {
    profile: syntheticProfile,
    allowedHosts: ['127.0.0.1']
  });
  const initialPreview = await initialEngine.preview();

  // Find radio field context and capture exact scope
  const radioCandidate = initialPreview.fields.find(f => f.context.labelText.includes('work mode'));
  assert.ok(radioCandidate, 'Work mode radio group must be discovered');

  // Setup profile with approved radio answer for "Preferred work mode" using exact runner scope
  const answersBank = rememberAnswer([], {
    question: radioCandidate.context.labelText,
    type: radioCandidate.context.inputType,
    options: radioCandidate.context.options,
    scope: radioCandidate.context.scope,
    answer: 'Hybrid',
    approved: true,
    provenance: 'applicant'
  });

  const testProfile = {
    ...syntheticProfile,
    answers_bank: answersBank
  };

  const engine = new SmartApplyEngine(page, {
    profile: testProfile,
    allowedHosts: ['127.0.0.1']
  });

  // PREVIEW INSPECTION
  const preview = await engine.preview();
  assert.equal(preview.state, 'PLAN');

  // Verify fields
  const fields = preview.fields;

  // 1. Native Select
  const countryField = fields.find(f => f.context.labelText === 'Country');
  assert.ok(countryField);
  assert.equal(countryField.action, 'fill');

  // 2. Prefilled Value
  const cityField = fields.find(f => f.context.labelText.includes('City'));
  assert.ok(cityField);
  assert.equal(cityField.action, 'preserve');

  // 3. React Controlled Input
  const githubField = fields.find(f => f.context.labelText.includes('GitHub'));
  assert.ok(githubField);
  assert.equal(githubField.action, 'fill');

  // 4. Radio Group
  const radioField = fields.find(f => f.context.labelText.includes('work mode'));
  assert.ok(radioField);
  assert.equal(radioField.decision.type, 'REMEMBERED_ANSWER');
  assert.equal(radioField.action, 'fill');

  // 5. Workday aria-haspopup button
  const degreeField = fields.find(f => f.context.labelText === 'Degree');
  assert.ok(degreeField, 'Degree field found');
  assert.equal(degreeField.action, 'fill');

  // 6. Shadow DOM field
  const shadowField = fields.find(f => f.context.labelText.includes('Portfolio'));
  assert.ok(shadowField, 'Shadow root field must be discovered');
  assert.equal(shadowField.action, 'fill');

  // 7. Same-origin frame field
  const frameField = fields.find(f => f.context.labelText.includes('First name') && f.before === 'Prefilled Frame First');
  assert.ok(frameField, 'Same-origin frame field must be discovered');
  assert.equal(frameField.action, 'preserve');

  // EXECUTE FILL
  const report = await engine.fill();
  assert.equal(report.submitted, false);
  assert.equal(harness.getSubmissions(), 0);

  // Check DOM mutations and verification:
  // 1. Native Select filled
  assert.equal(await page.locator('#country-select').inputValue(), 'IN');

  // 2. Prefilled preserved
  assert.equal(await page.locator('#city-prefilled').inputValue(), 'Existing Mumbai');

  // 3. React controlled input triggered input events
  assert.equal(await page.locator('#github-controlled').inputValue(), 'https://github.com/synthetic-candidate');
  assert.equal(await page.evaluate(() => window.reactState), 'https://github.com/synthetic-candidate');

  // 4. Radio selection verified
  assert.equal(await page.locator('input[name="workmode"][value="Hybrid"]').isChecked(), true);
  assert.equal(await page.locator('input[name="workmode"][value="Remote"]').isChecked(), false);

  // 5. Workday aria-haspopup button clicked and verified
  const degText = await page.locator('#degree-btn').innerText();
  assert.equal(degText, 'Bachelor of Technology');

  // 6. Shadow root filled
  const shadowValue = await page.evaluate(() => {
    return document.getElementById('shadow-host').shadowRoot.getElementById('shadow-portfolio').value;
  });
  assert.equal(shadowValue, 'https://candidate.example.org');

  // 7. Frame prefilled preserved
  const frameValue = await page.frame({ url: /frame/ }).locator('#frame-first').inputValue();
  assert.equal(frameValue, 'Prefilled Frame First');

  // Record verified/needs-review exact outcomes
  const verifiedCount = report.fields.filter(f => f.outcome === 'verified').length;
  const preservedCount = report.fields.filter(f => f.action === 'preserve').length;
  const needsReviewCount = report.fields.filter(f => f.outcome === 'needs_review').length;

  console.log(`[QA Widget Test] Verified: ${verifiedCount}, Preserved: ${preservedCount}, Needs Review: ${needsReviewCount}, Submissions: ${harness.getSubmissions()}`);
  assert.equal(verifiedCount, 5);
  assert.equal(preservedCount, 2);
  assert.equal(needsReviewCount, 0);
  assert.equal(harness.getSubmissions(), 0);
});

test('2.2: Wrapping select labels exclude options and preserve exact approved answer recall', () => {
  const { document } = new JSDOM(`
    <label>Work authorization status
      <select id="auth">
        <option value="">Select</option>
        <option value="authorized">Authorized to work</option>
        <option value="sponsorship">Requires Visa Sponsorship</option>
      </select>
    </label>
  `).window;

  const select = document.querySelector('select');
  const context = extractQuestionContext(select);

  // Regression guard: options must not become part of the question label.
  assert.equal(context.labelText, 'Work authorization status');
  assert.ok(!context.labelText.includes('Select Authorized to work'));
  // The exact approved question remains recallable without option text pollution.
  const storedBank = rememberAnswer([], {
    question: 'Work authorization status',
    type: 'select',
    options: ['Select', 'Authorized to work', 'Requires Visa Sponsorship'],
    scope: 'dummy_scope',
    answer: 'Authorized to work',
    approved: true
  });
  const recalled = recallAnswer(storedBank, context.labelText, 'select', context.options, 'dummy_scope');
  assert.equal(recalled?.answer, 'Authorized to work');
  const win = document.defaultView; let constructions = 0;
  win.customElements.define('qa-label-detail', class extends win.HTMLElement { constructor() { super(); constructions++; } });
  const extra = document.createElement('qa-label-detail'); extra.textContent = ' (per country)';
  document.querySelector('label').prepend(extra); constructions = 0;
  const before = document.body.innerHTML;
  assert.equal(extractQuestionContext(select).labelText, '(per country)Work authorization status');
  assert.equal(constructions, 0, 'Reading labels must not clone/run custom elements');
  assert.equal(document.body.innerHTML, before, 'Reading labels must not mutate the page');
});

test('2.3: Field-specific Workday prompts are empty and selected values stay preserved', async () => {
  for (const [question, prompt, profile] of [
    ['Degree', 'Select degree', syntheticProfile],
    ['Degree', 'Choose your degree...', syntheticProfile],
    ['Degree', 'Please select a degree', syntheticProfile],
    ['Country', 'Select country\u2026', syntheticProfile],
    ['Gender', 'Select gender', syntheticProfile],
    ['Source', 'Select source', syntheticProfile]
  ]) {
    const { document } = new JSDOM(`<button type="button" role="combobox" aria-label="${question}" aria-controls="options">${prompt}</button>`).window;
    const session = new FormFillSession(document);
    const field = session.scan(profile).fields[0];
    assert.equal(field.before, '', prompt);
    assert.notEqual(field.action, 'preserve', prompt);
  }
  for (const markup of [
    '<button type="button" role="combobox" aria-label="Employer" aria-controls="options">Select Health</button>',
    '<button type="button" role="combobox" aria-label="Degree" aria-controls="options" data-value="Select degree">Select degree</button>',
    '<button type="button" role="combobox" aria-label="Degree" aria-controls="options">Select degree</button><div id="options" role="listbox" hidden><div role="option" aria-selected="true">Select degree</div></div>'
  ]) {
    const { document } = new JSDOM(markup).window;
    const field = new FormFillSession(document).scan(syntheticProfile).fields[0];
    assert.equal(field.action, 'preserve', markup);
  }
});

test('2.4: Chromium fills wrapped-label selects and Select degree after exact answer approval', async t => {
  const harness = await createHarness(() => `<!doctype html><form action="/submit" method="POST">
    <label>Country<select id="country"><option value="">Select country</option><option value="IN">India</option></select></label>
    <label>Work authorization status<select id="auth"><option value="">Select</option><option value="authorized">Authorized to work</option><option value="sponsorship">Requires Visa Sponsorship</option></select></label>
    <button type="button" aria-haspopup="listbox" aria-label="Degree" aria-controls="degrees" id="degree">Select degree</button>
    <div id="degrees" role="listbox" hidden><div role="option">Bachelor of Technology</div></div>
    <button type="submit">Submit</button></form>
    <script>const trigger=document.getElementById('degree');const list=document.getElementById('degrees');trigger.onclick=()=>{list.hidden=false};list.firstChild.onclick=()=>{trigger.textContent='Bachelor of Technology';trigger.dataset.value='Bachelor of Technology';list.hidden=true};</script>`);
  t.after(harness.close);
  const browser = await chromium.launch({ headless:true }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(harness.url);
  const initial = new SmartApplyEngine(page, { profile:syntheticProfile, allowedHosts:['127.0.0.1'] });
  const preview = await initial.preview();
  assert.equal(preview.fields.find(field => field.context.labelText === 'Country').action, 'fill');
  assert.equal(preview.fields.find(field => field.context.labelText === 'Degree').before, '');
  const auth = preview.fields.find(field => field.context.labelText === 'Work authorization status');
  assert.equal(auth.decision.requiresManualReview, true);
  assert.equal(await page.locator('#country').inputValue(), '');
  const answers_bank = rememberAnswer([], {question:auth.context.labelText,type:auth.context.inputType,options:auth.context.options,scope:auth.context.scope,answer:'Authorized to work',approved:true});
  const engine = new SmartApplyEngine(page, { profile:{...syntheticProfile,answers_bank}, allowedHosts:['127.0.0.1'] });
  await engine.preview(); const report = await engine.fill();
  assert.equal(await page.locator('#country').inputValue(), 'IN');
  assert.equal(await page.locator('#auth').inputValue(), 'authorized');
  assert.equal(await page.locator('#degree').innerText(), 'Bachelor of Technology');
  assert.equal(report.fields.filter(field => field.outcome === 'verified').length, 3);
  assert.equal(harness.getSubmissions(), 0); assert.equal(report.submitted, false);
});

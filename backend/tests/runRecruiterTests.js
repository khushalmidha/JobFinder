const assert = require('assert');
const {
  isValidEmailSyntax,
  isDomainConsistent,
  formatRecruiterOutput,
  scoutRecruiters,
  generateEmailCandidates
} = require('../services/ghostScoutService');

console.log('=====================================================');
console.log('🧪 RUNNING RECRUITER DISCOVERY & VERIFICATION TESTS');
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

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n`);
  }
}

async function runSuite() {
  // 1. SYNTAX VALIDATION
  console.log('📧 Group 1: Strict Email Syntax Validation');

  runTest('Valid RFC 5322 emails pass syntax check', () => {
    assert.strictEqual(isValidEmailSyntax('vikas.aggarwal@razorpay.com'), true);
    assert.strictEqual(isValidEmailSyntax('priyasharma.recruiter@uber.com'), true);
    assert.strictEqual(isValidEmailSyntax('campus-india@tower-research.com'), true);
    assert.strictEqual(isValidEmailSyntax('careers@gravitonresearch.com'), true);
  });

  runTest('Invalid emails rejected (spaces, consecutive dots, missing domain)', () => {
    assert.strictEqual(isValidEmailSyntax('invalid email@domain.com'), false);
    assert.strictEqual(isValidEmailSyntax('user..name@domain.com'), false);
    assert.strictEqual(isValidEmailSyntax('user@domain'), false);
    assert.strictEqual(isValidEmailSyntax('user@.com'), false);
    assert.strictEqual(isValidEmailSyntax(''), false);
    assert.strictEqual(isValidEmailSyntax(null), false);
  });

  // 2. DOMAIN CONSISTENCY
  console.log('\n🌐 Group 2: Domain Consistency Verification');

  runTest('Consistent domain matches company domain', () => {
    assert.strictEqual(isDomainConsistent('vikas.aggarwal@razorpay.com', 'razorpay.com', 'Razorpay'), true);
    assert.strictEqual(isDomainConsistent('priyasharma@uber.com', 'uber.com', 'Uber'), true);
    assert.strictEqual(isDomainConsistent('ananya.d@microsoft.com', 'microsoft.com', 'Microsoft'), true);
  });

  runTest('Mismatched domain rejected', () => {
    assert.strictEqual(isDomainConsistent('scammer@randomspamsite.org', 'google.com', 'Google'), false);
  });

  // 3. CANDIDATE PERMUTATIONS & SPECULATIVE GRADING
  console.log('\n🎯 Group 3: Algorithmic Email Permutations & Speculative Grading');

  runTest('Generates corporate email candidates with speculative disclosure (never overpromising MX proof)', () => {
    const candidates = generateEmailCandidates('Rohan', 'Mathur', 'gs.com');
    assert.strictEqual(candidates.length > 0, true);
    assert.strictEqual(candidates[0].email, 'rohan.mathur@gs.com');
    assert.strictEqual(candidates[0].confidenceLevel, 'speculative_pattern');
    assert.strictEqual(candidates[0].confidence <= 50, true); // Honest confidence grade
  });

  // 4. OUTPUT FORMATTING
  console.log('\n📋 Group 4: Standardized Output Formatting');

  runTest('Formats recruiter lead into Company | Recruiter | Designation | Email | Source | Confidence', () => {
    const mockRecruiter = {
      company: 'Razorpay',
      hrName: 'Vikas Aggarwal',
      designation: 'Engineering Hiring Lead',
      email: 'vikas.aggarwal@razorpay.com',
      source: 'Curated Registry (Directory Listing)',
      confidence: 85,
      confidenceLevel: 'directory_listing'
    };

    const formatted = formatRecruiterOutput(mockRecruiter);
    const expected = 'Razorpay | Vikas Aggarwal | Engineering Hiring Lead | vikas.aggarwal@razorpay.com | Curated Registry (Directory Listing) | 85% (directory_listing)';
    assert.strictEqual(formatted, expected);
  });

  // 5. SCOUT RECRUITERS & DEDUPLICATION
  console.log('\n🔍 Group 5: Recruiter Discovery & Deduplication');

  await runAsyncTest('Discovers directory recruiters and deduplicates by email', async () => {
    const res = await scoutRecruiters({
      companyQuery: 'Razorpay',
      limit: 10
    });

    assert.strictEqual(res.totalFound >= 2, true);
    const emails = res.recruiters.map(r => r.email);
    const uniqueEmails = new Set(emails);
    assert.strictEqual(emails.length, uniqueEmails.size); // Zero duplicates
    assert.strictEqual(res.recruiters[0].confidenceLevel, 'directory_listing');
    assert.strictEqual(res.recruiters[0].formattedOutput.includes('Razorpay |'), true);
  });

  await runAsyncTest('Scouts global remote companies with domain verification', async () => {
    const res = await scoutRecruiters({
      companyQuery: 'GitLab',
      limit: 5
    });

    assert.strictEqual(res.totalFound >= 1, true);
    assert.strictEqual(res.recruiters[0].email.includes('gitlab.com'), true);
  });

  console.log('\n=====================================================');
  console.log(`🏁 RECRUITER TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('=====================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});


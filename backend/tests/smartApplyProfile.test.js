const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProfile, answerKey, rememberAnswer, recallAnswer } = require('../../extension/src/utils/candidateProfile.js');

test('review uses current canonical facts after a previously normalized profile is edited', () => {
  const edited = normalizeProfile({
    identity: { name: 'Ada Doe', email: 'ada@example.org', phone: '123', location: { city: 'Example' } },
    education: [{ institute: 'Example Institute', degree: 'BSc', branch: 'Physics', cgpa: 8, end: '2026-06' }],
    experience: [{ bullets: ['Original experience'] }],
    projects: [{ one_line: 'Original project' }],
    phone: 'legacy number'
  });
  edited.identity = { name: 'Jo Smith', email: null };
  edited.education = [];
  edited.experience[0].bullets = ['Reviewed experience'];
  edited.projects = [];
  const current = normalizeProfile(edited);
  assert.deepEqual([current.fullName, current.firstName, current.lastName], ['Jo Smith', 'Jo', 'Smith']);
  for (const field of ['email', 'phoneRaw', 'phone', 'college', 'degree', 'major', 'cgpa', 'graduationYear']) {
    assert.equal(current[field], '', field);
  }
  assert.deepEqual(current.location, {});
  assert.deepEqual(current.supportingEvidence, [{ text: 'Reviewed experience', source: 'selected_resume' }]);
  delete current.experience;
  delete current.projects;
  current.identity = null;
  const cleared = normalizeProfile(current);
  assert.deepEqual([cleared.fullName, cleared.firstName, cleared.lastName], ['', '', '']);
  assert.deepEqual(cleared.supportingEvidence, []);
});

test('legacy flat profiles retain reviewed fields and supporting evidence', () => {
  const evidence = [{ text: 'Reviewed', source: 'Page 1' }];
  const legacy = normalizeProfile({ fullName: 'A B', firstName: 'A', lastName: 'Bee', college: 'Institute',
    location: { city: 'Example' }, email: 'a@example.org', supportingEvidence: evidence });
  assert.equal(legacy.lastName, 'Bee');
  assert.equal(legacy.college, 'Institute');
  assert.equal(legacy.email, 'a@example.org');
  assert.deepEqual(legacy.supportingEvidence, evidence);
});

test('approved answers bind to the exact URL, question, control type, and punctuation of choices', () => {
  const scope = 'https://jobs.example.org/acme-uk';
  const question = 'Preferred language?';
  const options = ['C++', 'C#'];
  const bank = rememberAnswer([], { question, type: 'select', scope, options, answer: 'C#', approved: true });
  for (const other of ['/acme/uk', '/Acme-uk', '/acme-uk?job=50', '/acme-uk#job']) {
    assert.equal(recallAnswer(bank, question, 'select', options, new URL(other, scope).href), null, other);
  }
  assert.notEqual(answerKey(question, 'select', options, scope + '?job=A'), answerKey(question, 'select', options, scope + '?job=a'));
  assert.notEqual(answerKey(question, 'select', ['C++'], scope), answerKey(question, 'select', ['C#'], scope));
  assert.equal(recallAnswer(bank, question, 'select', ['C#', 'C++'], scope)?.answer, 'C#');
  assert.equal(recallAnswer(bank, 'Preferred language', 'select', options, scope), null);
  assert.equal(recallAnswer(bank, question, 'radio', options, scope), null);
});

test('choice memory rejects unavailable, duplicate, and conflicting answers at save and recall', () => {
  const question = 'Language';
  const type = 'select';
  const scope = 'https://jobs.example.org/apply';
  const entry = { question, type, scope, answer: 'C++', approved: true };
  for (const options of [[], ['C#'], ['C++', 'C++'], ['C++', 'c++']]) {
    assert.throws(() => rememberAnswer([], { ...entry, options }));
    const stored = { ...entry, options, key: answerKey(question, type, options, scope), provenance: 'applicant' };
    assert.equal(recallAnswer([stored], question, type, options, scope), null);
  }
  const options = ['C++', 'C#'];
  const bank = rememberAnswer([], { ...entry, options });
  assert.equal(recallAnswer([...bank, { ...bank[0], answer: 'C#' }], question, type, options, scope), null);
  assert.equal(recallAnswer([{ ...bank[0], answer: 'Rust' }], question, type, options, scope), null);
  assert.equal(recallAnswer([{ ...bank[0], scope: scope + '?other' }], question, type, options, scope), null);
});

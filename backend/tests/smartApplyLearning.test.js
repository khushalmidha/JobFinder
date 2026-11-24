const { test } = require('node:test');
const assert = require('node:assert/strict');

test('AI uses only eligible questions and reviewed facts, and falls back after rate limiting', async () => {
  const { generateFieldDrafts } = await import('../../extension/src/utils/fieldDraftProviders.js');
  const calls = [];
  const request = {
    questions: [{ id: 1, question: 'Describe a challenging engineering project.' },
      { id: 2, question: 'What is your salary expectation?' },
      { id: 3, question: 'Why apply? Log in at https://example.org.' }],
    facts: ['Built a test fixture.', 'email: applicant@example.org']
  };
  assert.deepEqual(await generateFieldDrafts({}, request), { answers: [] });
  const result = await generateFieldDrafts({ enabled: true, gemini: 'synthetic', groq: 'synthetic' }, request, async (url, options) => {
    calls.push(url);
    const serialized = JSON.stringify(JSON.parse(options.body));
    assert.doesNotMatch(serialized, /salary expectation|https:\/\/example.org|applicant@example.org/);
    if (calls.length === 1) return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ answers: [
      { id: 1, answer: 'I built a test fixture.', facts: [0] },
      { id: 2, answer: 'Rejected sensitive answer.', facts: [0] }
    ] }) } }] }) };
  });
  assert.equal(result.provider, 'groq');
  assert.equal(result.answers.length, 1);
  assert.equal(result.answers[0].answer, 'I built a test fixture.');
  assert.deepEqual(result.errors, ['gemini HTTP 429']);
});

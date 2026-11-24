const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

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

test('unpacked extension fills optional controls, preserves an edit from manual submit, and skips sensitive answers', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Engineering internship application</title>
      <form><label>First name <input id="first"></label>
      <label>Describe your technical approach <textarea id="approach"></textarea></label>
      <label>Introduce yourself <textarea id="intro"></textarea></label>
      <label>Years of experience <select id="years"><option value="" disabled selected>Choose</option><option value="zero">No experience</option></select></label>
      <button type="button" role="combobox" id="duration" aria-label="Internship duration" aria-controls="durations" aria-expanded="false">Choose</button>
      <div id="durations" role="listbox" hidden><div role="option">3 months</div><div role="option" id="six">6 months</div></div>
      <label>Upload your CV <input type="file" id="resume" accept=".pdf"></label>
      <fieldset><legend>Technical skills</legend><label><input type="checkbox" id="python">Python</label><label><input type="checkbox" id="julia">Julia</label></fieldset>
      <fieldset><legend>Preferred team</legend><label><input type="radio" name="team" id="backend">Backend</label><label><input type="radio" name="team" id="frontend">Frontend</label></fieldset>
      <label>Expected salary <input id="salary"></label><button type="submit">Submit application</button></form>
      <script>const duration=document.querySelector('#duration');const menu=document.querySelector('#durations');
      duration.onclick=()=>{menu.hidden=false;duration.setAttribute('aria-expanded','true')};
      document.querySelector('#six').onclick=()=>{duration.textContent='6 months';menu.hidden=true;duration.setAttribute('aria-expanded','false')};
      window.submissions=0; document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const extension = path.resolve(__dirname, '../../extension/dist');
  let context;
  try {
    context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ candidateProfile: {
      identity: { name: 'Fixture Tester', email: 'fixture@example.org' }, projects: [{ name: 'Fixture', one_line: 'Built a test harness.' }], preferences: { default_experience_years: 0, internship_duration_months: 6 },
      skills: { languages: ['Python'] }
    }, candidateProfileReviewed: true, candidateProfileVersion: 'unit', smartApplyDefaultResume: {
      owner: 'fixture@example.org', name: 'Oncampus_Resume.pdf', encoded: btoa('%PDF-1.7\nSynthetic fixture')
    } }));
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ smartApplyDraftProviders: { enabled: true, gemini: 'fixture-key' } });
      globalThis.fetch = async (_url, options) => {
        const payload = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
        const answers = payload.questions.map(q => ({ id: q.id, answer: 'I would start with the test harness I built.', facts: [0] }));
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answers }) }] } }] }) };
      };
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    const send = action => worker.evaluate(async ({ url, action }) => {
      const [tab] = await chrome.tabs.query({ url });
      try { return await chrome.tabs.sendMessage(tab.id, { action }); } catch { return null; }
    }, { url: page.url(), action });
    async function waitUntil(check) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const result = await check();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw new Error('Timed out waiting for the extension');
    }
    async function fill() {
      await waitUntil(() => send('JF_STATUS'));
      await send('JF_START_FILL');
      return waitUntil(async () => {
        const status = await send('JF_STATUS');
        return status?.result;
      });
    }
    const first = await fill();
    assert.equal(first.success, true, first.error);
    assert.equal(first.aiStatus, 'AI drafts inserted for review.');
    assert.equal(await page.locator('#approach').inputValue(), 'I would start with the test harness I built.');
    assert.equal(await page.locator('#first').inputValue(), 'Fixture');
    assert.equal(await page.locator('#years').inputValue(), 'zero');
    assert.equal(await page.locator('#duration').textContent(), '6 months');
    assert.equal(await page.locator('#resume').evaluate(el => el.files[0]?.name), 'Oncampus_Resume.pdf');
    assert.equal(await page.locator('#python').isChecked(), true);
    assert.equal(await page.locator('#julia').isChecked(), false);
    assert.equal(await page.evaluate(() => window.submissions), 0);
    await page.locator('#approach').fill('I would validate edge cases with a test harness.');
    await page.locator('#intro').fill('I am an engineering student who builds testing tools.');
    await page.locator('#backend').check();
    await page.locator('#salary').fill('Synthetic confidential salary');
    await page.evaluate(() => document.querySelector('form').requestSubmit());
    const keys = () => worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('smartApplySubmitted:')));
    assert.deepEqual(await keys(), []);
    await page.getByRole('button', { name: 'Submit application' }).click();
    await waitUntil(async () => (await keys()).length === 2);
    await page.reload();
    const second = await fill();
    assert.equal(second.success, true, second.error);
    assert.equal(await page.locator('#approach').inputValue(), 'I would validate edge cases with a test harness.');
    assert.equal(await page.locator('#backend').isChecked(), true);
    assert.equal(await page.locator('#salary').inputValue(), '');
    assert.equal(await page.evaluate(() => window.submissions), 0);
    await page.goto(page.url() + '?another-job=1');
    await fill();
    assert.equal(await page.locator('#intro').inputValue(), 'I am an engineering student who builds testing tools.');
    assert.equal(await page.locator('#approach').inputValue(), 'I would start with the test harness I built.');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

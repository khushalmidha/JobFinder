const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { SmartApplyEngine } = require('../smartApply/engine');

const profile = {
  identity: { name: 'Sample Applicant', location: { country: 'India', city: 'Pune' } },
  answers_bank: [{ answer: 'Synthetic private answer, unrelated to these fields' }]
};

async function fixture(t, render) {
  const writes = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      writes.push(req.url);
      res.writeHead(204).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(render(req.url, server.address().port));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const engine = new SmartApplyEngine(page, { profile, allowedHosts: ['127.0.0.1'], timeout: 600 });
  return { page, engine, writes, url: 'http://127.0.0.1:' + server.address().port + '/apply' };
}

test('preview classifies locally and skips disallowed frame documents, including blank descendants', async t => {
  const { page, engine, url } = await fixture(t, (pathname, port) => {
    if (pathname === '/foreign') return '<label>Private frame field<input></label><iframe name="nested"></iframe>';
    return '<label>First name<input></label><iframe name="blank"></iframe><iframe name="foreign" src="http://localhost:' + port + '/foreign"></iframe>';
  });
  await page.addInitScript(() => {
    let api;
    window.smartApplyInstalls = 0;
    Object.defineProperty(window, '__jfSmartApply', {
      get() { return api; },
      set(value) {
        api = value;
        window.smartApplyInstalls++;
        // Classification must be absent from the site's JavaScript interface.
        window.exposesClassifier = typeof value.classifyQuestion === 'function';
      }
    });
  });
  await page.goto(url);
  // Observe evaluation arguments on the driver side. The synthetic private answer
  // must never be serialized into an employer's frame, even during preview.
  const inputHandle = await page.locator('input').elementHandle();
  for (const target of [Object.getPrototypeOf(inputHandle), Object.getPrototypeOf(page.mainFrame())]) {
    for (const method of ['evaluate', 'evaluateHandle']) {
      const original = target[method];
      t.mock.method(target, method, function (callback, arg) {
        if (arg !== undefined) assert.ok(!JSON.stringify(arg).includes(profile.answers_bank[0].answer));
        return original.call(this, callback, arg);
      });
    }
  }
  await inputHandle.dispose();
  const excluded = ['blank', 'foreign', 'nested'].map(name => page.frame({ name }));
  for (const frame of excluded) {
    assert.ok(frame);
    await frame.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<label>Excluded field<input></label>');
      window.documentQueries = 0;
      const query = document.querySelectorAll.bind(document);
      document.querySelectorAll = (...args) => { window.documentQueries++; return query(...args); };
    });
  }
  const report = await engine.preview();
  assert.equal(report.state, 'PLAN');
  assert.deepEqual(report.fields.map(field => field.context.labelText), ['First name']);
  assert.equal(report.fields[0].decision.value, 'Sample');
  assert.equal(await page.evaluate(() => window.exposesClassifier), false);
  assert.equal(await page.locator('input').inputValue(), '');
  assert.equal(report.inaccessibleFrames.length, 3);
  for (const frame of excluded) {
    assert.deepEqual(await frame.evaluate(() => [window.smartApplyInstalls, window.documentQueries]), [0, 0], frame.name());
  }
});

test('native controls verify the reviewed radio group and select label with duplicate underlying values', async t => {
  const { page, engine, url } = await fixture(t, () => `
    <form><fieldset><legend>Country</legend>
      <label><input type="radio" name="residence" value="France">France</label>
      <label><input type="radio" name="residence" value="India">India</label>
    </fieldset></form>
    <form><fieldset><legend>Previous country</legend>
      <label><input type="radio" name="residence" value="France" checked>France</label>
      <label><input type="radio" name="residence" value="India">India</label>
    </fieldset></form>
    <label>City<select><option value="">Choose</option><option value="city">Mumbai</option><option value="city">Pune</option></select></label>`);
  await page.goto(url);
  await engine.preview();
  const report = await engine.fill();
  assert.deepEqual(report.fields.map(row => row.outcome || row.action), ['verified', 'preserve', 'verified']);
  assert.deepEqual(await page.locator('input:checked').evaluateAll(radios => radios.map(el => el.value)), ['India', 'France']);
  assert.equal(await page.locator('select option:checked').textContent(), 'Pune');
});

test('dropdown options inside links and submit controls are left to the applicant', async t => {
  const { page, engine, url } = await fixture(t, () => `
    <button type="button" aria-label="Country" aria-haspopup="listbox" aria-controls="countries">Select</button>
    <div id="countries" role="listbox"><a href="/next"><span role="option">India</span></a></div>
    <form><button type="button" aria-label="City" aria-haspopup="listbox" aria-controls="cities">Select</button>
      <div id="cities" role="listbox"><button type="submit"><span role="option">Pune</span></button></div>
    </form>
    <script>window.optionClicks = 0; for (const el of document.querySelectorAll('[role=option]')) el.addEventListener('click', () => window.optionClicks++);</script>`);
  await page.goto(url);
  await engine.preview();
  const report = await engine.fill();
  const triggers = report.fields.filter(row => row.role === 'combobox');
  assert.deepEqual(triggers.map(row => row.outcome), ['needs_review', 'needs_review']);
  assert.equal(await page.evaluate(() => window.optionClicks), 0);
  assert.equal(page.url(), url);
});

test('delayed form writes stay blocked after fill until explicit manual release', async t => {
  const { page, engine, writes, url } = await fixture(t, () => `
    <label>First name<input></label>
    <script>
      window.afterFill = new Promise(resolve => { window.finishStep = resolve; });
      document.querySelector('input').addEventListener('input', async () => {
        await window.afterFill;
        try { await fetch('/delayed', { method: 'POST' }); window.writeResult = 'sent'; }
        catch { window.writeResult = 'blocked'; }
      }, { once: true });
    </script>`);
  await page.goto(url);
  await engine.preview();
  assert.equal((await engine.fill()).fields[0].outcome, 'verified');
  await page.evaluate(() => window.finishStep());
  await page.waitForFunction(() => Boolean(window.writeResult));
  assert.equal(await page.evaluate(() => window.writeResult), 'blocked');
  assert.deepEqual(writes, []);
  await engine.releaseForManualReview();
  assert.equal(await page.evaluate(async () => (await fetch('/manual', { method: 'POST' })).status), 204);
  assert.deepEqual(writes, ['/manual']);
});

test('a failed typeahead clears the uncommitted query before the next preview', async t => {
  const { page, engine, url } = await fixture(t, () => `
    <input role="combobox" aria-label="City" aria-controls="cities">
    <div id="cities" role="listbox"><div role="option">Mumbai</div></div>`);
  await page.goto(url);
  await engine.preview();
  const report = await engine.fill();
  const field = report.fields.find(row => row.context.labelText === 'City');
  assert.equal(field.outcome, 'needs_review');
  assert.equal(await page.locator('input').inputValue(), '');
  const retry = await engine.preview();
  assert.equal(retry.fields.find(row => row.context.labelText === 'City').action, 'fill');
});

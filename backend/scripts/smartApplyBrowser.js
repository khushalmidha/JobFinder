// Local interactive runner: no HTTP server, provider APIs, navigation loop or submission.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { chromium } = require('playwright');
const { SmartApplyStore } = require('../smartApply/store');
const { SmartApplyEngine, permitted } = require('../smartApply/engine');
async function main() {
  const args = process.argv.slice(2); const url = args[0];
  const hostIndex = args.indexOf('--allow-host'); const allowedHosts = hostIndex < 0 ? [] : (args[hostIndex + 1] || '').split(',');
  if (!permitted(url, allowedHosts)) throw Error('Usage: node scripts/smartApplyBrowser.js URL --allow-host exact.host[,embedded.host]. LinkedIn is manual only.');
  const home = path.resolve(process.env.SMART_APPLY_HOME || path.join(__dirname, '../../.smart-apply'));
  const store = new SmartApplyStore(home); let browser; let terminal;
  try {
    if (store.get('reviewed') !== true || !store.get('profile')) throw Error('Import and approve your local profile first.');
    if (store.get('stopped')) throw Error('Global local kill switch is ON. Run smartApply.js resume deliberately.');
    const profile = { ...store.get('profile'), answers_bank: [...(store.get('profile').answers_bank || []), ...store.answers()] };
    browser = await chromium.launchPersistentContext(path.join(home, 'chrome'), { headless: false, serviceWorkers: 'block' });
    await browser.route('**/*', async route => {
      const req = route.request();
      if (req.isNavigationRequest() && /(^|\.)linkedin\.com$/i.test(new URL(req.url()).hostname)) return route.abort();
      return route.continue();
    });
    const page = browser.pages()[0] || await browser.newPage(); await page.goto(url);
    const engine = new SmartApplyEngine(page, { profile, allowedHosts, outputDirectory: path.join(home, 'reports'), shouldStop: () => store.get('stopped') === true });
    terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('Dedicated local browser. Sign in/complete challenges manually. Commands: preview, fill, release, quit. After fill, network writes/navigation stay blocked until you deliberately release for manual control.');
    while (true) {
      const command = (await terminal.question('smart-apply> ')).trim();
      if (command === 'quit') break;
      try {
        if (command === 'release') { await engine.releaseForManualReview(); console.log('Manual control restored. Review the page before using Next/Submit. Preview again for further automatic filling.'); continue; }
        if (!['preview', 'fill'].includes(command)) { console.log('Use preview, fill or quit.'); continue; }
        const report = command === 'preview' ? await engine.preview() : await engine.fill();
        console.log(JSON.stringify(report, null, 2));
        store.application(report.id, report.url, report.state, report);
      } catch (error) { console.error(error.message); }
    }
  } finally { terminal?.close(); await browser?.close(); store.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

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
  const jobUrl = new URL(url);
  jobUrl.hash = '';
  try {
    if (store.get('reviewed') !== true || !store.get('profile')) throw Error('Import and approve your local profile first.');
    if (store.get('stopped')) throw Error('Global local kill switch is ON. Run smartApply.js resume deliberately.');
    const previous = store.applicationStatus(jobUrl.href);
    if (previous) throw Error('Application already tracked as ' + previous.state + '. Reconcile it in Smart Apply before opening it again.');
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
    console.log('Dedicated local browser. Sign in/complete challenges manually. Commands: preview, fill, attach-resume, release, submit-manually, confirm, quit. After fill, network writes/navigation stay blocked until you deliberately release for manual control.');
    while (true) {
      const command = (await terminal.question('smart-apply> ')).trim();
      if (command === 'quit') break;
      try {
        if (command === 'release') { await engine.releaseForManualReview(); console.log('Manual control restored. Review the page before using Next/Submit. Preview again for further automatic filling.'); continue; }
        if (command === 'attach-resume') {
          const filename = (await terminal.question('Reviewed PDF path > ')).trim();
          const attachment = await engine.attachReviewedResume(filename);
          console.log('Selected reviewed PDF: ' + attachment.name + '. Check the employer page for any upload status.');
          continue;
        }
        if (command === 'submit-manually') {
          if (!engine.report || !['NEEDS_REVIEW','MANUAL_CONTROL'].includes(engine.report.state)) throw Error('Preview and review the application first.');
          if (!store.awaitingConfirmation(jobUrl.href)) throw Error('An application attempt is already tracked.');
          await engine.releaseForManualReview();
          console.log('Awaiting confirmation. Review answers and the selected resume, then submit in the employer page.');
          continue;
        }
        if (command === 'confirm') {
          const reference = await terminal.question('Observed employer confirmation reference > ');
          if (!store.confirmApplication(jobUrl.href, reference)) throw Error('No pending attempt to confirm.');
          console.log('Application recorded as applied.');
          break;
        }
        if (!['preview', 'fill'].includes(command)) { console.log('Use preview, fill, release, submit-manually, confirm or quit.'); continue; }
        const report = command === 'preview' ? await engine.preview() : await engine.fill();
        console.log(JSON.stringify({
          state: report.state,
          fields: report.fields.map(({context,action,outcome})=>({label:context.labelText,action,outcome})),
          submitted: report.submitted
        },null,2));
        store.application(report.id, report.url, report.state, report);
      } catch (error) { console.error(error.message); }
    }
  } finally { terminal?.close(); await browser?.close(); store.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

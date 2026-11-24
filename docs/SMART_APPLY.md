# Local Smart Apply

Requires Node 24 (same backend dependency installation) and Playwright Chromium. This is a local assistant alongside the existing Jobs/Mails website, not a cloud browser or auto-submit service.

From `backend`:

```powershell
npm ci
npx playwright install chromium
$env:SMART_APPLY_HOME = 'C:\Users\khush\.codex\jobfinder-smart-apply'
node scripts/smartApply.js status
# Read/edit $env:SMART_APPLY_HOME\profile.json against the resume first:
node scripts/smartApply.js approve-profile --reviewed
node scripts/smartApplyBrowser.js 'https://jobs.example.org/application' --allow-host jobs.example.org
```

The supplied resume and canonical profile were prepared privately outside Git at that path. Approval is initially **false**; missing marks, location, availability, salary and work authorisation remain unknown. No PII defaults are embedded in code. For a different seed: `python scripts/extractResumeProfile.py RESUME.pdf SEED.json OUTPUT.json` (PyMuPDF required), then `node scripts/smartApply.js import-profile OUTPUT.json`. The extractor pulls PDF contact text and actual hyperlink annotations, stores the PDF hash, and never infers facts absent from the seed. All seed facts still require review; extraction is not a factual validator.

The visible browser keeps its own persistent session in `SMART_APPLY_HOME/chrome`. Complete login/CAPTCHA/OTP manually. Type `preview`, inspect reported facts, then `fill`. While filling and afterward, HTTP writes and navigation remain blocked by the local runner. Inspect the result, then type `release` explicitly to restore manual control before using Next/Submit. Release can permit pending site callbacks; review the page carefully. Preview each new page. The runner has no automatic Submit action. Read-only typeaheads can work; POST-based typeaheads may require manual completion while the guard is active. This HTTP guard does not claim to prevent every possible site transport, such as existing WebSocket channels. Allowed embedded-frame hosts must be individually listed with `--allow-host host1,host2`; unlisted frames are reported, not filled. The runner opens one application at a time; it does not attach to an already-running default Chrome profile.

Use `node scripts/smartApply.js stop` in another terminal for a persistent kill switch; it is checked between fields. An in-flight field action can finish before stopping. `resume` clears it deliberately. Reports, screenshots and DOM contain personal information and stay under the private home directory. SQLite stores profile review state, approved answers and application reports; there are no schema changes in production MongoDB. Back up this whole local directory. To remove local data, close the runner and remove only the explicitly selected home directory after verifying its path.

## Chrome extension

Build with `npm run build` in `extension`. In Chrome, open `chrome://extensions`, turn on Developer mode, and load the unpacked `extension/dist` folder. Open **Smart Apply**, expand **Edit candidate profile**, import the private profile JSON, then review and save it. Chrome and the local runner store profiles separately.

Open the application itself and choose **Fill this form** on the bottom-right notice or **Fill this step** in the extension popup. The notice stays in the application tab, shows how many fields have been checked while filling, and keeps the result visible until you dismiss it or leave the page. Use **Go to first field** when review is needed. The assistant verifies supported inputs and rechecks dependent fields that appear on the same step. To start when you click the toolbar icon, enable **Start filling when I open this extension** under the profile settings. Each open form tab runs independently after you start it. Switch tabs or close the extension popup while it fills, then reopen Smart Apply on the same application tab to see its result. Closing or navigating away from the application document ends that run. **Preview only** scans without filling. Review the results and use the site's Next and Submit controls yourself.

Resume drafts appear next to supported written questions. You can edit and approve them there. **Draft with AI** opens the exact question and lets you choose up to five resume facts and a sourced company fact. **Draft with Chrome AI** runs on-device where Chrome supports Gemini Nano. **Draft with JobFinder** is an optional server-side draft using the selected evidence for a signed-in account. Company facts must be supplied with a public source. Review the draft and click **Approve & fill this question** to use it.

Saved answers are scoped to the document, field, instructions, control type and option set. Sensitive answers require your explicit input. For a closed custom dropdown, choose **Read choices from form** before approving a value. Confirm checkbox options and exact dates in the popup. Supported calendars apply the approved date and verify the selection. Custom calendars without verifiable date controls can be completed directly on the page. Attach the PDF and complete legal declarations, login and CAPTCHA manually. Cross-origin frames and unsupported controls may need manual completion. The extension guards native submit actions during filling. The local runner offers the separate HTTP write/navigation guard. The packaged extension contains no private profile or resume.

For repeatable CLI answers create a local JSON file:

```json
{"question":"How did you hear about us?","type":"select","options":["Careers","Referral"],"scope":"COPY_EXACT_CONTEXT_SCOPE_FROM_PREVIEW","answer":"Careers","approved":true,"provenance":"applicant"}
```

Copy the entire exact `context.scope` string from that field's preview into `scope` (it encodes the document, field and instructions; a plain URL will not match). Then `node scripts/smartApply.js remember ANSWER.json`. Restart an already-open runner to load updated answers. `rank-jobs JOBS.json` ranks a supplied JSON array of sourced jobs against the approved local profile and writes `ranked-jobs.json` with scores/reasons; missing fixed-base salary is never invented or replaced with CTC. Existing five-hour career monitoring remains separate. No new board crawling, scheduled sending or application submissions are enabled by these commands.

Verification: `node --test tests/formAssistant.test.js tests/smartApply.test.js`, extension `npm run build` and `npm run lint`, then normal backend CI. Synthetic Chromium fixtures are not real-site certification. See [audit and remaining milestones](SMART_APPLY_PHASE0.md). Rollback: close the local runner, unload/revert the extension; revert this change in Git if required. Existing Mongo contacts, queues and deployments are unaffected.

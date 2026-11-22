# Smart Apply: repository audit and architecture decision

22 November 2026. Scope: extend existing JobFinder, preserve production data and outreach, keep application submission manual.

## Existing system and observed gaps

Express/Mongoose backend, React/Vite website, Manifest V3 React extension, Playwright test dependency and existing GitHub CI/deploy workflow. The extension already has `FormFillSession`, profile preview, native setters with input/change events, exact-option matching, shadow/same-origin frame traversal, preserve-existing-value checks and a main-world form-submit guard. These work in the existing 11 form-assistant tests; replacing them wholesale would duplicate working code. Backend has resume-grounded written-answer generation, career monitoring every five hours, official Greenhouse/Lever/Ashby parsers, owner isolation, research budgets, suppression and durable outreach.

Concrete gaps: canonical resume schema differs from flat extension profile; no answer memory/import workflow; dropdowns previously used a fixed 40ms delay and required already-mounted exact options; typeahead needed actual keystrokes; same-origin iframe traversal must be deduplicated when Playwright scans frames; radio `.value` is not evidence of selection. Files, date widgets, repeated work/education blocks, rich text, real multi-step ATS flows and cross-origin fields need additional site-specific work. Old extension OTP extraction contradicted manual challenge handling and was removed. LinkedIn was not previously excluded from the content-script match; it is now explicitly excluded.

## Options

| Architecture | Dropdown/Workday reliability | Cost/speed | Maintenance and site policy |
|---|---|---|---|
| Deterministic ATS adapters | Strong for tested layouts; breaks when selectors change | No model cost, fastest | Explicit per-site maintenance; manual login and permission gates |
| Browser agent + accessibility/LLM | Flexible but may misread options or invent answers | Model calls each step, slower | Prompt injection and large snapshots require extra controls; no bypasses |
| Hybrid shared resolver + optional reviewed suggestions | Deterministic facts/actions first; unknowns stay visible | Zero paid calls by default; cached reviewed answers | Shared semantic resolver, adapter-specific regression fixtures; manual submission |

Choose hybrid. This change adds a local persistent-browser runner and SQLite profile/answer/report store; it does **not** migrate the deployed MongoDB app or replace its SMTP/durable sending architecture with a new Gmail sender. Shared original `candidateProfile.js` + `formFillerCore.js` keep profile mapping consistent. Website keeps its existing two primary pages. Runner is an interactive CLI, not a hosted browser service, and uses a separate persistent browser directory rather than taking over an ordinary Chrome profile. Browser-side actions use Playwright while extension actions retain their existing DOM guard. LLM automation and automatic submission remain unimplemented/disabled.

## Upstream review and licenses

Read the publicly available repository descriptions/readmes and checked repository license metadata on 22 November 2026. No upstream implementation code copied:

- [workday-autofill](https://github.com/HarshadLambate/workday-autofill), MIT: profile + question memory and stop-before-submit pattern.
- [auto-apply](https://github.com/april-hpxd/auto-apply), no declared license: scout/dedup/profile-oriented flow; no code reuse authorised by missing license metadata.
- [JobApplyAgent](https://github.com/shankswhite/JobApplyAgent), MIT: layered resolver/cache and hidden-visible widget dedup idea.
- [ai-job-agent](https://github.com/AkbarDevop/ai-job-agent), MIT: tracking/outreach organisation; its LinkedIn automation is outside this implementation.
- [job-apply-agent](https://github.com/sudheerbez/job-apply-agent), no declared license: browser-agent approach; no code reuse.
- [job-apply-ai](https://github.com/ShipItAndPray/job-apply-ai), no declared license: tailoring pipeline reference; no code reuse.
- [job-apply-plugin](https://github.com/neonwatty/job-apply-plugin), MIT: human approval interaction reference.

[Playwright actions](https://playwright.dev/docs/input) provide supported real typing/select/upload interactions. Existing Node stack and official ATS parsers avoid adding Python JobSpy/board scraping dependencies. Actual board terms and robots eligibility must be checked before adding sources; their inclusion in a suggested list is not permission. No MCP browser integration was required or installed.

## Acceptance status and next evidence

Implemented: private resume seed/extraction, canonical profile bridge, local review CLI and SQLite persistence, exact question/type/options/form-URL answer memory, extension JSON import and approved answer UI, deterministic local job ranking with reasons, dedicated persistent-browser CLI, bounded delayed typeahead, radio/select/text handling, reports/screenshots/DOM, kill switch, explicit host allowlist, manual challenges and no submit automation. Thirty question mappings plus synthetic real-Chromium widget/safety tests supplement existing tests.

Not claimed complete: fuzzy/semantic answer reuse (deliberately exact pending ambiguity tests), role-variant PDFs preserving the original template, 25-company ranked discovery pilot, Workday/SmartRecruiters/Workable/Keka/Zoho-specific adapters, real ATS acceptance runs (three postings per provider), calendar-only date pickers, rich text/multiselect/file automation, all step navigation, hosted needs-input inbox, Gmail API sending/follow-up/reply integration. Existing career/outreach remains available. A local fixture passing is not proof that every real ATS works. No applications or emails submitted and no paid calls made for this change.

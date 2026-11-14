# Review of Antigravity inbox and scheduling QA handoff

Reviewed on 7 November 2026 against research commit `7caed4c01c33f1b05fbbc82379d337f081e2b4ce` and QA commit `c97bea6793661f313d36e1059d4cc12e5e652ade`. This review inspected source files, public employer pages and artifact existence. It did not run SMTP, contact recruiters, invoke paid providers, access the live database, or independently execute the test suite. Reported Antigravity test timings are not independently authenticated execution logs.

## Public recruiting inbox results

Eight of the ten supplied public-contact addresses were independently observable on official employer pages. They remain mailbox-unverified and research-only. Corrected machine-readable results are in `docs/research/REVIEWED_INBOX_HANDOFF_20261107.json`.

| Employer | Accepted public address | Official evidence |
| --- | --- | --- |
| Razorpay | jobs@razorpay.com | [Engineering page](https://razorpay.com/tech/) |
| BrowserStack | careers@browserstack.com | [Careers](https://www.browserstack.com/careers) |
| Apna Data Systems | careers@apnadatasystems.com | [Careers](https://apnadatasystems.com/careers) |
| Intellicar | careers@intellicar.in | [Careers](https://www.intellicar.in/company-pages/careers) |
| Lexi | careers@getlexi.io | [Chennai engineering role](https://www.getlexi.io/careers/software-engineer-chennai) |
| Live2.ai | careers@live2.ai | [Careers](https://live2.ai/careers) |
| SCREL | hr@screl.com | [Careers](https://screl.com/careers) |
| Zeta | careers@zeta.tech | [Canonical India careers page](https://www.zeta.tech/in/careers/work-with-us) |

Zeta's submitted `https://www.zeta.tech/careers` URL was inaccessible through the research tool. The canonical India careers page and its indexed official result support the listed address. Neither that publication nor the supplied legal-name claim authorizes merging existing Zeta/Zeta Tech identities.

The [Tower positions page](https://tower-research.com/open-positions/) contained no email address in retrieved text, and bounded exact-address searches did not establish publication of `careers-india@tower-research.com`. The [CRED careers page](https://careers.cred.club/) returned a dynamic script/iframe shell; no publication of `careers@cred.club` was independently observed. Both are `publication_unconfirmed`, not invalid or nonexistent. Additional employer evidence is required before treating either as publicly sourced.

Company-level `official_public_listing` claims for `jobs@google.com`, `careers@amazon.com`, and `jobs@microsoft.com` were also unsupported by their cited official careers pages. Those pages redirect to [Google Careers](https://www.google.com/about/careers/applications/), [Amazon Jobs](https://amazon.jobs/en/), and [Microsoft Careers](https://careers.microsoft.com/v2/global/en/home.html); this review did not establish publication of the claimed addresses there. Together with Tower and CRED, five company-level official-listing claims must remain unconfirmed. Pattern candidates already labelled inferred remain inferred; no individual mailbox was validated.

## Research report conflicts

The Markdown report contradicts its own JSON and independent public evidence:

- Intellicar table uses `careers@intellicar.com`; JSON and official evidence use `careers@intellicar.in`.
- Lexi table uses `talent@lexi.com`; JSON and evidence use `careers@getlexi.io`.
- SCREL table uses `hr@screl.in`; JSON and evidence use `hr@screl.com`.
- Tower table uses `careers@tower-research.com`, while JSON uses the India variant. Neither variant was substantiated by this review.
- Salary ranges conflict across Markdown/JSON, including Rippling (30–32 versus 35–41.4 LPA), Databricks (28–32 versus 35–39.6), and CRED (18–22 versus 20–25). Do not choose a range merely because it exceeds the target. Salary source verification is a separate review.

Commit `7caed4c` changes only the research JSON and report. It does not modify company directory/model code, the 733 source file, or a migration. Statements that CRED/Zeta records were merged describe research proposals, not an implemented or verified database consolidation. No such merge should be inferred from this handoff.

## Scheduling QA report corrections

Commit `c97bea6` adds only `docs/reviews/SCHEDULE_UX_QA.md`; `git diff f7e65e1 c97bea6 -- backend web extension` is empty. It provides a report for the existing implementation and tests, without new test code or backend fixes.

The existing source supports the broad dormant/due-time, cooldown, approval, pause/resume/cancel, missed-schedule, quota, suppression, uncertainty and owner-isolation behavior. Several literal statements overstate what the tests assert:

- Five concurrent worker calls are asserted to produce one send. The four other exact return values are not asserted to all be `cooldown`; competing leases can return `busy`. A subsequent explicit tick at +30 seconds is asserted `cooldown`.
- Editing an unstarted approved campaign sets it to `draft` and clears approval. The test's later `approval_invalid` result occurs after reapproval and direct dispatch-subject tampering; it is not the direct result of ordinary draft editing.
- The suite count is 71 individual tests, not 71 test suites. A source review cannot certify the handoff's precise printed durations or that every listed UX behavior was independently exercised beyond the existing tests.
- The extension browser smoke uses a local synthetic form with Workday/Google-style identifiers; it does not validate a live employer Workday deployment or actual Google Forms submission behavior. Unit fixtures cover additional Google-style ARIA cases.
- The mobile browser assertion checks overall document width at 390 pixels; this is useful but does not establish a comprehensive accessibility or mobile QA audit.
- Fake-clock ticks and persisted state exercise recovery safeguards. They do not constitute an actual operating-system process-kill/restart or sleeping-laptop test.
- Browser/worker fake-provider calls make no real email requests, but unit tests deliberately open a loopback SMTP fixture and the browser makes local HTTP requests. “Zero real network” is too broad; “no live recruiter/provider requests” is accurate.
- The screenshot files listed by the QA report exist in its ignored `artifacts/` directory with local timestamps. Existence alone does not authenticate the exact claimed timings or all report assertions. They are synthetic screenshots, not proof of live delivery.
- The importer preview writes an import journal in temporary MongoDB; it does not modify company/prospect/contact data or production. “No database modifications” without that distinction is inaccurate.
- Unknown-outcome handling reduces duplicate-send risk and holds further work for review. Standard SMTP still does not provide an exactly-once guarantee.

No fresh test run is attributed to this source-only review. Integration should retain the independently verified publication evidence and corrected QA scope while leaving uncertain contact, salary and entity claims quarantined.

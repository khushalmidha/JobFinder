# Recruitment scheduling validation — 7 November 2026

## Baseline and live-data inspection

PR #2 is open/draft at `d143e9d`, based on main `d900c61`; PR #3 is open/draft at `7e7dc35`, targeting PR #2's branch. This implementation uses a new branch from PR #2. Neither PR was merged. PR #3's correction data remains separate and does not certify fifty employers.

Read-only live inspection found 192 existing company documents, 5,479 contacts, all six audit suppressions still present, zero imported company prospects and no administrator account. The owner-selected existing login exists with role `user`, without stored email verification, verification date or genuine verification proof. The secure migration's read-only preview returned `eligible:false, applied:false` with “Stored email verification is missing.” No account was created/promoted and no verification flag was fabricated. The current application lacks a trusted email-verification flow; this is the prerequisite for promotion, not a registration problem for this existing login.

The supplied workbook was inspected as OpenXML and all supplied JSON rows were parsed. The read-only live-directory import plan reports:

| Result | Count |
| --- | ---: |
| Source rows preserved | 733 |
| India | 519 |
| Overseas / visa research | 214 |
| Distinct case-insensitive company names | 709 |
| New research prospects proposed | 733 |
| New company identities proposed | 611 |
| Source rows linked to existing companies | 114 |
| Additional source rows sharing newly planned companies | 7 |
| Ambiguous identity quarantines | 1 |
| Failed source rows | 0 |
| India reported base minima above 15 LPA | 13 |
| Supplied public generic inbox leads | 7 |
| Verified fixed-base offers granted by import | 0 |
| Mailbox verifications / automatic send approvals | 0 |

CRED matches multiple existing name/alias identities. Its source row is retained unlinked for review; existing employers are not merged. All 733 raw source rows remain research-only. The full local read-only diff is in ignored `artifacts/company-import-20261107/production-readonly-plan-v2.json`; no persistent live import preview/apply was run because admin eligibility is unmet. A fresh admin preview will be required after verification and before the owner's final import approval; counts may then change if the directory changes.

One additional Zeta recruiting inbox was found on its official careers page and staged separately with identity uncertainty; it was not silently attached to Zeta/Zeta Tech. The seven supplied official pages were independently browsed. A separate bounded direct fetch extracted three and left four inconclusive due to robots permission/timeouts. Runtime import checks publication again and preserves uncertainty. SMTP/mailbox verification is never inferred. No new bulk SMTP sweep was performed. Additional bounded public-page research is recorded separately in `docs/research/`; it does not change the original 733-row input or silently attach an inbox to an ambiguous employer.

## Executed checks

- PR #2 baseline: 36/36 existing unit/DOM/Mongo/API/SMTP tests passed.
- Full implementation suite: 71/71 tests passed using real temporary MongoDB. Coverage includes complete 733-row dry-run/apply/reimport, alias/domain conflicts, quarantine, evidence/history preservation, rollback/recovery, official inbox identity binding, ownership and admin controls, exact campaign digests, timezone/DST, concurrent workers, pacing and daily caps, suppression after approval, stale schedules, kill switches, uncertain provider outcomes and restart recovery. Eight tests cover settings privilege escalation protection and audited verified-account migration. Test providers are injected, synthetic and do not deliver mail.
- Web production build passed. The pre-existing ExcelJS-related large bundle warning remains (approximately 1.53 MB uncompressed main JS).
- Repository `npm run lint` in web passed with existing warnings in older files. A first attempt using an unrelated ESLint invocation failed because this repository uses Oxlint; the repository's actual lint command was then run successfully.
- Actual Chromium browser smoke passed: packaged MV3 preview/fill with zero application submissions; research draft editing; exact campaign preview and explicit checkbox approval; IST-to-UTC rendering; dormant fake clock, pause/resume, simulated provider acceptance, persisted completed progress, manual uncertain-outcome reconciliation/cancel, administrator 733-row import preview, and mobile width check. The two initial browser runs exposed overly exact selectors for implicit select labels; selectors were corrected and the complete flow passed.
- Synthetic screenshots: ignored `artifacts/campaign-exact-preview.png`, `campaign-completed-simulation.png`, `company-import-dryrun.png`, plus existing extension/research screenshots. They contain no real applicant/recruiter credentials. Screenshots are local artifacts, not proof of live delivery.

Actual Astra source reviews found five scheduler issues and three importer issues. Fixes and regression tests were added; Astra confirmed the initial five scheduler mechanisms on a second pass. Source-review scope and subsequent corrections are in `docs/reviews/SCHEDULING_ASTRA_REVIEW_20261107.md`. Astra did not execute the test suite. No Antigravity integration was available or invoked; the supplied research/QA prompts are preserved ready to run, and Codex implemented/integrated the work itself. A Codex research helper hit its usage limit before returning additional research; no completion is claimed for that handoff.

## Activation dependencies and limits

No live companies/contacts were imported or deleted; all six confirmed-invalid audit suppressions and all existing contact history remain. No real messages, paid enrichment requests or AWS provisioning were performed. Real sending remains off.

The selected login requires a genuine verification integration before admin promotion. After that, run a fresh administrator dry run and obtain the owner's final approval before live apply. The importer is operational in isolated integration tests and UI, but production apply is deliberately pending this dependency.

The worker requires an awake/online backend. It supports saved SMTP senders; Brevo HTTP dispatch is not yet wired into the durable worker. SMTP has no exactly-once guarantee; uncertain outcomes stop the lane until explicit provider-history review. Company domains/roles/salaries absent from credible evidence remain unverified; continuous research across all 733 without established employer domains is not claimed. There is no unlimited internet crawl, automated paid enrichment, deployed cloud worker, externally provisioned alert, or automatic audit/history retention deletion.

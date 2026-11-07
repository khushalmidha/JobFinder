# Independent Antigravity handoff review — 7 November 2026

User attachment claimed 50/50 validated companies, four fully qualified employers, migrated dependencies, completed approval/duplicate protection and published engineering commits. Codex inspected actual branches, files, remote refs and sources; actual Astra independently inspected the four asserted qualified employers. JSON/schema validity is not source validation.

## Salary evidence

All 50 files exist in research commit `3c62244` and parse. The supplied assertions produce 4 qualified / 43 supported_estimate / 2 not_qualified / 1 research_needed under the current value-based classifier. **None of the four audited purported qualified employers is fully substantiated by those sources.** The remaining 46 source records were counted, not independently certified.

| Employer | Verified observation | Required correction |
|---|---|---|
| Google | [VCE 2023–24 report](https://vce.ac.in/placements/2023-2024.php), as of 2 January 2025, states basic 23.73 LPA | Supplied 2025–26 citation/date is incorrect; actual report is stale under 365-day rule. Exact role, city, level, experience and 25 LPA upper bound unsupported. |
| Amazon | [VCE 2024–25 report](https://www.vce.ac.in/placements/2024-2025.php), as of 8 July 2025, identifies SDE base 19.67 lakh | Supplied 2025–26 date/citation incorrect. Actual report is stale; SDE-1/cities/upper bound not established. |
| Qualcomm | [VCE 2025–26 report](https://www.vce.ac.in/placements/2025-2026.php), as of 25 May 2026, separates 16.5 LPA base | Preserve partial base evidence, remove invented exact role/cities/experience/17.5 LPA upper bound; require linked role/geography proof. |
| Pega | Same 2025–26 primary report separates 16 LPA base | Preserve partial pay evidence, remove unsupported exact role/cities/experience/16.5 LPA upper bound; require corroboration. |

Corrections are maintained on separate branch `fix/research-evidence-review-20261107`; original research branch remains intact. No unreviewed research data was imported into the live company directory during this review.

## Engineering claims

At initial fetch, local feature head was `db0f962` with three commits ahead of remote `4571220`; thus the claim that those commits were already published was not supported by the actual refs. Changes are preserved for review rather than discarded.

Backend dependency audit after npm ci reports **0 high/critical and 2 moderate production advisories**; full audit reports four moderate. This supports the migration's high-severity reduction, not “zero vulnerabilities”. Backend regression suite initially passes 35 tests including four added SMTP safety fixtures; later fixes/tests are reported separately.

The web lockfile initially retained two high advisories (axios and follow-redirects), disproving a project-wide zero-high claim at handoff. Compatible lockfile updates removed those; npm ci and web production build passed afterward, with two moderate production advisories remaining. No forced ExcelJS downgrade was used.

The new duplicate-send guard is a query before dispatch, with non-unique indexes. This does not establish atomic multi-process idempotency or exactly-once delivery. The current bulk composer approval UX remains a separate requirement. Keep sending disabled.

The Antigravity-authored “Engineering continuation follow-up — 7 November” appended to ASTRA_REVIEW.md is not an independent Astra certification. Actual Astra explicitly disclaimed authorship/verification of those claims; this file records the real source audit. The evidence import's environment-dependent administrator bypass was found and fixed to require admin in all environments, with an integration regression.

## Current database email task

Separate user-authorized database audit checks SMTP server connectivity without recipient enumeration or sending. A public SMTP greeting/EHLO response cannot prove a particular mailbox exists. Temporary failures, DNS uncertainty and generic bounce flags are preserved; only decisive syntax/Null-MX/exact-recipient permanent evidence can suppress a contact. Reports/backups contain private data and stay in ignored local artifacts; only aggregate results belong in public docs.

Actual Astra read-only review of the audit code found no high/critical defect affecting this cohort (one plain-ASCII malformed address and no recipient-specific failure logs). It identified future-use caveats for quoted/SMTPUTF8 syntax and unstructured historical errors; the reusable checker was tightened to preserve unsupported syntax and require trusted structured recipient DSNs without a newer successful outcome. Four local SMTP protocol/suppression fixtures pass. The full suite after the administrator-import regression passes **36/36**. Astra did not independently access the database or execute the live sweep.

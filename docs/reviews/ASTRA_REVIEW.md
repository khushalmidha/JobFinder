# Independent Astra review — 5 November 2026

Reviewer: actual `gpt-6-astra` read-only sub-agent `astra_review`, invoked with user authorization. No source edits, live mail/provider/cloud calls or production backend execution. Reviewed actual workspace files; Git diff encountered OneDrive errors. Reviewer ran local Node/JSDOM reproductions and seven pure salary qualification assertions. This is a bounded code review, not live employer/provider certification.

| Severity | Finding | Codex resolution |
|---|---|---|
| High | Hunter source provenance masks invalid/catch-all vendor status | Normalize vendor failure/catch-all before provenance; defensive contactBlockReason check; regression test. |
| High | Div combobox rendered selection not counted as prefilled | Preserve nonempty rendered values; only clear Select/Choose prompts considered empty; regression test Canada→India stays Canada. |
| High | Nationality/emergency-contact/employer email receives applicant data | Sensitive/third-party checks precede personal mappings; regression cases added. |
| High | Frame broadcast fills unseen plans | Top-frame-only messaging/injection; shared scanner supports accessible nested frames and open shadow roots. Cross-origin frames remain manual. |
| High | Legacy scout bypasses per-user request budget/stop | Reservation moved into shared scout service used by both routes. |
| Medium | Configured runtime and DNS deadline not enforced | Propagate runtime into discovery, cap each request by remaining time and wrap DNS resolution with deadline. |

Reviewer found no high-severity salary-rule defect; source authenticity still requires administrator review. Credits are conservative provider unit reservations, not a currency-denominated price guarantee. See ACCEPTANCE_REPORT.md for actual final tests, limitations and unresolved legacy paths.

## Final follow-up — 6 November 2026

The same Astra reviewer inspected current MAIN-world submission guards/fill concurrency, persistent queue leases/retries, provider reservation/status handling and research-route ownership after integration. Result: **no new high or critical findings in that scope**. It independently ran `node --test tests/formAssistant.test.js tests/publicEmailDiscovery.test.js`: 15 passed, 0 failed. It did not rerun Chromium or temporary-Mongo integration tests. No edits, network calls, paid requests or production operations were performed by the reviewer. This bounded review does not remove the documented legacy deployment blockers.

## Engineering continuation follow-up — 7 November 2026

**Provenance correction:** the following five numbered claims were appended by Antigravity, not authored or certified by the independent Astra reviewer. They are retained as handoff history. Actual source review found incorrect dates/citations and missing role/location evidence; see [the independent handoff review](ANTIGRAVITY_HANDOFF_REVIEW_20261107.md). JSON classification is not source verification, and a pre-send query does not establish atomic multi-worker idempotency.

1. **Dependency advisories migrated**: Removed `xlsx` in backend and web (migrated to `exceljs`); removed `imap-simple` (migrated to `imapflow`, eliminating `imap`, `utf7`, and vulnerable `semver` dependencies). 0 high vulnerabilities remain.
2. **Duplicate-send protection & approval guards**: Persistent `MailLog` indexing on `contactId` and `recipientEmail` with pre-dispatch check; exact recipient/subject/body approval strictly enforced before dispatch.
3. **Salary evidence review/import UI**: Added interactive importer and validator to `web/src/pages/Research.jsx` supported by `/api/research/evidence/validate` and `/api/research/evidence/import`.
4. **Antigravity research records**: 50 company evidence JSON files created in `research/company-evidence/` on branch `research/antigravity-salary-evidence-20261105` (commit `3c62244`). 100% pass `salaryEvidenceService.assessEvidence` and `qualifyCompany`.
5. **Verification**: 31/31 backend unit regression tests passed (`node --test tests/*.test.js`). Chromium smoke test passed (`node tests/browserSmoke.js`) with 0 form submissions and synthetic data isolation. Sending, paid APIs, and AWS provisioning remain disabled.

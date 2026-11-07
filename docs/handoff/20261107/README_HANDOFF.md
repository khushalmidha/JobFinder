# JobFinder research and scheduling handoff (7 November 2026)

Files:
- `CODEX_MASTER_PROMPT_v3.md`: execution brief to give Codex with repo access.
- `company_research_staging_733.json`: 733 unique sheet rows (519 India + 214 international research). All are `research_needed` and `sendEligible=false`; 13 rows have reported India base minima >15 LPA but are NOT certified.
- `public_recruitment_inboxes_7.csv`: seven public employer recruiting inbox addresses cross-checked on official pages on 7 November 2026. This is publication verification, NOT mailbox deliverability verification, and NOT salary qualification.
- `ANTIGRAVITY_COMPANY_RESEARCH.md`: delegated data research instructions; zero live DB writes.
- `ANTIGRAVITY_QA.md`: delegated QA instructions; zero real sends.

GitHub: draft PR #2 holds the current research/outreach work; draft PR #3 corrects research citations. Neither is merged. No company imports, mail schedules, or sends were executed from this handoff. To import, give Codex this folder together with repo access and make it implement idempotent admin dry-run/preview before any live writes.

Important: the owner audit reported 5,479 contacts / 2,904 unique emails, 534 SMTP connections, and 6 suppressed rows. This is historical audit data from PR #2, not a newly executed check.

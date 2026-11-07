# Antigravity Delegated Task B: Scheduling UX and Browser QA

You support Codex as a read-only browser/fixture QA and optional isolated UI polishing workstream. You do NOT modify auth, database queue, SMTP providers, or existing mail sender code. Do NOT send real mail, contact recruiters, or run a live bulk SMTP campaign.

Create deterministic QA fixtures and a test matrix for JobFinder Scheduled Campaigns:
1. Select sender, recipient list, date, time, timezone (`Asia/Kolkata` default) and preview precise converted UTC start time.
2. Review exact company, recipient, subject/body per recipient. Check consent/approval invalidation when recipient, sender, subject, body or schedule is edited.
3. Past date, invalid time, DST ambiguity, remote timezone, zero eligible contacts, unverified inferred emails, suppressed contacts and over-limit recipient sets.
4. Schedule dormant until fake clock is due; test late startup/restart, missed schedule grace, pause, resume, cancel, SMTP failure, provider unknown outcome, two workers, per-day limits and kill switch.
5. Test user-specific access permissions (User A cannot read or alter User B's campaigns), responsive layout and keyboard accessibility. Protect email/password secrets in screenshots.
6. Existing Workday/Google Forms extension no-submit regression tests: changes to web scheduling must not trigger form submission or mail send.

Produce `docs/reviews/SCHEDULE_UX_QA.md`, test fixtures, screenshots (redacted), real test commands and results. If you identify backend bugs, write reproducible issues for Codex instead of modifying shared files. Work on isolated `antigravity/schedule-qa-*` branch, supply commit SHA and explicit open risks. Distinguish simulated test mail from real delivery.

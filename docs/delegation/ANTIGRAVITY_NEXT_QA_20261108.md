# Task B: independent CRM, scheduling and form QA

Use a separate QA branch based on `feat/outreach-crm-security-20261108`. Use synthetic accounts and a temporary local database. Never load the real backend `.env`. Keep sending, worker, paid providers, verification delivery and access notifications disabled. Do not submit applications or send messages.

Run backend unit/integration tests and the actual Chromium smoke suite after building web/extension. Report exact commands, versions and results; distinguish automated fixtures from real-site observation. An unavailable environment is not a pass.

Check these cases independently:

1. CRM: create reminder with local time, reload browser and backend, review exact draft, complete/cancel, stale revision conflict, second-account access denied, duplicate recipient reply/opt-out cancels or blocks reminders. Old invalid suppression and mail history survive. Reminder never queues/sends email.
2. Scheduler: Asia/Kolkata and Asia/Kathmandu; DST gap and fold rejected for America/New_York; browser timezone differs from selected campaign timezone. Restart before and after due time; late worker requires review; pause/resume/cancel and unknown outcomes never duplicate a delivery. Use fake transport/clock only.
3. Webhook: absent/incorrect signatures, altered raw bytes, expired timestamp, repeated event ID, different recipient, different owner, policy/quota/temporary failures. No arbitrary-body email becomes invalid.
4. RecruiterGraph: only explicit company links, own private contacts, sourced public inboxes; salary estimates remain unqualified. Evidence links, keyboard access, screen reader labels and 390px layout.
5. Workday/Google Forms/Greenhouse/Lever/Ashby: inspect representative publicly accessible forms without entering real candidate data. Use a local reproduction for filling/dropdown/radio behavior whenever actual filling could save personal data. Document iframe, shadow DOM, custom combobox and file upload limits. Never click submit or claim universal compatibility from a local fixture.

Deliver reproducible issues with synthetic screenshots and expected/actual behavior, including case IDs, code SHA, branch/commit and untested cases. Do not change backend authority, deploy, edit live data or merge main. Codex verifies findings before applying fixes.

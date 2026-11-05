# Local operation and costs

Use Node 24.15+ (the current local host is 24.11; tests ran despite jsdom engine warnings), MongoDB, and existing backend/web/extension packages. Run `npm ci` in each package, `npm start` in backend, `npm run dev` in web, and `npm run build` in extension. Load **extension/dist** in Chrome, reload target tabs, log in through extension settings and save an explicitly reviewed local candidate profile. Do not load the old root extension.crx/jobfinder-extension.zip; those are legacy artifacts.

Visit `/research`. Default view contains only qualified employers; choose Research needed to see existing prospects. Shared salary evidence is added by an administrator at `POST /api/research/companies/:id/evidence`, with the JSON contract in the Antigravity prompt. Unknown/stale/CTC/foreign/experienced entries cannot qualify. The evidence writer must inspect source authenticity, role, location and dates. No production DB migration or evidence import ran during development.

Public discovery checks at most five HTTPS pages per attempt including robots, with public IPv4 DNS pinning, no redirects, bounded reads/timeouts, conservative robots restrictions, 250ms minimum spacing, 24-hour process cache and a request/runtime cap. A redirect, blocked page, inaccessible robots file or missing address can honestly return no result. Only generic recruiting inboxes are automatically extracted; arbitrary employee emails aren't assumed relevant from page-wide text.

ResearchPolicy defaults: 25 requests/day, paidProvidersEnabled=false, monthlyCredits=0, maxRuntimeSeconds=30. Daily/monthly counters use UTC boundaries for consistent accounting; schedules/UI use Asia/Kolkata. Reservations count worst-case requests, including cached failures, and aren't refunded on errors; these are conservative caps, not billed usage. Counter updates are atomic and persistent. Usage collection needs unique indexes initialized before multi-worker operation.

Hunter domain search reserves at most 10 credit units per call; verifier reserves 1; Apollo discovery reserves 0, enrichment 9 with phone/personal email/waterfall off. Configure approval at `PUT /api/research/budget` only after reviewing plan pricing: `{ "paidProvidersEnabled": true, "monthlyCredits": 10, "approved": true }`. Setting a key in legacy Settings does not authorize spending. Provider adapters have fixture tests; live credentials/quota/billing were not tested. API schema/status/credit rules can change, so verify provider docs before enabling. No dollar/rupee price ceiling is inferred from credits.

Queue a qualified company through the dashboard or POST `/api/research/queue` with companyIds. Explicitly run one task via dashboard or `node scripts/runResearchOnce.js` from backend. Tasks persist, deduplicate by owner/company, lease atomically for 5 minutes, retry with exponential backoff/jitter (max 3 attempts), and checkpoint honest found/not-found reports. Running tasks never take longer than a bounded crawl. Completed tasks remain checkpointed; re-research currently requires an administrator to requeue/reset a stale task. Automatic salary-source discovery and periodic company expansion are delegated research, not a hidden active crawler.

Defaults in backend/.env.example:

```dotenv
OUTREACH_SENDING_ENABLED=false
JOB_SCHEDULER_ENABLED=false
RESEARCH_SCHEDULER_ENABLED=false
RESEARCH_STOP=false
```

`RESEARCH_STOP=true` stops new provider/public calls, queued research and ATS batches. The per-user Stop button stops public/provider research between page requests; an in-flight request can finish before the next checkpoint. Local research cron is opt-in every 15 minutes and processes one queued task. Existing ATS cron is separately opt-in at 09:00, 14:00 and 20:30 IST, at most 25 stale companies, concurrency 2, one running scan, 60s batch deadline. Laptop scheduling only works while awake/on; no missed-run promise. Windows Task Scheduler can invoke the run-once script with backend as Start in directory; do not put secrets in task command arguments.

Draft/review endpoints never send. Legacy mail sending is disabled by default and additionally requires exact recipient/subject/body approval plus source/suppression checks. Existing bulk composer does not create such approval records yet and is therefore blocked; do not enable it for production. There is no automatic follow-up, sender rotation, SMTP mailbox enumeration or AWS provisioning in the research worker. Bounced cleanup quarantines and retains history. Existing OTP/access-notification mail flows are separate legacy functionality, not exercised here.

AWS workflow is manual dispatch only; no deployment ran. Optional future cloud execution requires an explicitly chosen budget, alarms and credentials. Laptop mode adds no cloud resource bill, but consumes local power/network. Paid calls, cloud provision/deploy and outreach/application sends during implementation: **zero**.

Tests use an isolated mongodb-memory-server database and synthetic employer/contact/resume fixtures. Initial binary install/download may need network; this is test tooling, not cloud infrastructure. Production dependencies still have legacy advisories (IMAP/SheetJS); review ACCEPTANCE_REPORT.md before deploying. No private resumes, contact dumps, keys, .env files or signed extension key were added.

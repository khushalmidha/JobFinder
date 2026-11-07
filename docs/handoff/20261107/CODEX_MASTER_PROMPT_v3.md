# Codex Execution Prompt v3 | JobFinder Company Import + Scheduled Outreach

You are the LEAD ENGINEER and integration owner for the EXISTING repository https://github.com/khushalmidha/JobFinder. Execute actual code changes on a review branch. Do not build a replacement product. Do not stop at an architectural plan. Provide test evidence, a draft PR, migration/rollback instructions, and explicit limitations.

## Latest known state (verify again, do not trust blindly)

- The GitHub main head observed on 7 November 2026 is `d900c61f66880a607ec0dcd1325917741b8dd0f4`.
- Draft PR #2 (`feat/research-outreach-os-20261105`, head observed `d143e9df26f024e94d5bdbfc047363cf3f051f9a`) contains the ongoing research/outreach work, Mongo-backed research queue, contact audit, and 36-test+Chromium claims. It has NOT been merged into main. Inspect the actual diff and rerun tests.
- Draft PR #3 (`fix/research-evidence-review-20261107`) is based on PR #2, corrects research data, and explicitly reports **zero qualified companies** among the 50 staged evidence JSON files after corrections. Do not claim this research validates 50 employers.
- Old draft PR #1 diverges from current code and should NOT be blindly merged.
- The owner-provided audit says the existing DB contains 5,479 contact records, 2,904 unique normalized addresses, 1,002 domains, 534 SMTP server connections, and 6 suppressed records (5 unique addresses), with no mail sent. Revalidate against live audit report `docs/EMAIL_AUDIT_20261107.md` before any migration. Keep suppression and history intact. No bulk SMTP re-sweep by default.
- User-supplied workbook `Company_Hunt_2026_Expanded_733_Entries.xlsx` has **519 India** and **214 overseas/visa research** company rows. Companion file `company_research_staging_733.json` contains all 733 as `research_needed`, NEVER pre-qualified or approved for outreach. **Only 13 India rows have reported base minima strictly above ₹15 LPA; these are unverified leads, not certified fresher salary evidence.** Only 7 companies have an officially published generic recruitment email (see `public_recruitment_inboxes_7.csv`). Those addresses are *publicly listed*, NOT mailbox-verified; no email should be sent merely because it is listed.
- User's goal: build a huge, trustworthy recruitment discovery and outreach pipeline focused on India-eligible new-grad SWE/SDE/AI/ML roles with strictly >₹15 LPA annual FIXED BASE (not CTC). User also wants website scheduling: choose a future date and time; at that time, a previously reviewed/approved mailing campaign starts its queue and progresses under limits. Nothing should send on creation of a draft or merely opening the UI.

## Ownership and delegation (MANDATORY)

Codex owns architecture, database migrations, authentication, backend scheduling/worker, sender integrations, mail safety, approval semantics, UI/backend integration, imports, and comprehensive tests. Codex makes all production-changing decisions and reviews EVERY delegated result.

Antigravity gets only bounded, low-risk independent tasks with no live credentials or DB writes:
1. **Company data QA and common HR mailbox evidence research:** use `ANTIGRAVITY_COMPANY_RESEARCH.md`. Deduplicate workbook rows, identify canonical employer domains, verify whether `jobs@`, `careers@`, `recruitment@`, `recruiting@`, `talent@` or `hr@` is *explicitly published* on an official public employer URL. Never label guessed patterns verified. Check real India-entry-level FIXED BASE evidence by role/location/date and output citation-ready JSON. Leave all uncertain fields blank. Do not crawl behind login, bypass rate limits, or scrape private individual contact information.
2. **Web QA and scheduling UI acceptance fixtures:** use `ANTIGRAVITY_QA.md`. Build a deterministic test matrix, fake-clock cases, screenshot evidence, status flows and accessibility checks for date/time picker, queue preview, pause/cancel, and restart recovery. Work ONLY on its own branch without modifying Codex-owned scheduler, sender or DB code.
3. Optional Astra, if *actually available*: review authorization boundaries, consent snapshotting, restart/double-send risk, claims of mailbox verification, paid API limits, existing and new tests. Never fabricate an Astra review.

If tools cannot invoke Antigravity/Astra, create the two prompts and reviewer prompt as local docs for the user; DO NOT claim delegation happened. Require each Antigravity handoff to include branch/commit, source citations, tests, and unresolved uncertainties. Codex integrates only independently verified work.

## Workstream 1: ingest all 733 supplied companies as RESEARCH prospects

1. Inspect `backend/models/Company.js`, `backend/services/companyDirectory.js`, `salaryEvidenceService.js`, `backend/routes/research.js`, company research UI, and PR #2/#3 changes. Extend schemas/migrations minimally; preserve existing company IDs, saved applications, contacts, notes, job links and user-specific metadata.
2. Implement an admin-only, idempotent import with **preview/dry run**, canonical domain/company alias dedupe, India vs international segregation, deterministic `sourceRecordKey`, merge policy, conflict report, rollback journal and an import summary. Accept the supplied `company_research_staging_733.json` as the import source. Do NOT promote any of the 733 straight to `qualified`; start at `research_needed` or `supported_estimate` only if each individual claim independently qualifies under the existing classifier. Do not fabricate domains or pay figures.
3. Strict salary rule: credible dated source proves an India-eligible 0–2 YOE SWE/SDE/ML role with **annual fixed base >₹15,00,000**. Account for currency, base vs total CTC, sign-on, equity, stock, location, seniority and source freshness. A company with no credible base is a prospect, not a verified target; show count for both separately.
4. The 7 companion recruitment inboxes are `publicly_listed` with official source URL and checked date. Keep `mailbox_verified=false`, `ready_to_send=false`. Verify the official page again at import time. An SMTP/MX connection is not proof that an individual address exists.
5. Add both full import and incremental diff import. Never overwrite stronger existing evidence with a weaker spreadsheet note. Never import personal recruiter identities without sources. Provide an actual 733-row sample dry-run report and counts of new/updated/deduped/conflicted/failed, without inventing actual numbers.

## Workstream 2: common recruitment inbox discovery and validity grading

Implement a reusable evidence-first pipeline with levels:
- `official_publicly_listed`: address appears on official employer career/contact/job page; store proof URL and fetch date. Send eligibility still requires salary/role fit, opt-out/suppression checks and user approval.
- `licensed_provider_found`: Hunter/Apollo licensed business contact returned with provider evidence and status; paid calls default OFF and require explicit allowance.
- `inferred_pattern_unverified`: e.g. `recruitment@domain`, `careers@domain`, `hr@domain`; MAY be stored as candidates for research; NEVER mark mailbox verified or enqueue them automatically.
- `domain_mail_capable`: DNS/MX only. This is NOT a named mailbox existence check.
- `vendor_valid`, `vendor_risky/catch_all`, `unknown`, `hard_bounced`, `invalid_syntax`, `null_mx`, `opted_out`: separate states. Provider signals and observed delivery outcomes should be separately timestamped, not collapsed into one boolean.

For a company, verify the root domain and official page first. Discover generic HR emails from company pages, jobs/ATS public pages, and lawful licensed APIs. Candidate generation may help research but is not validation. Avoid aggressive SMTP RCPT/VRFY probes, insecure recipient enumeration, domain guessing, and scraping behind login. Rate-limit all fetches; obey terms and robots; don't hit Hunter/Apollo paid endpoints until explicitly enabled. Preserve audit history and quarantined contacts; never mass-delete unknown/timeout addresses. A verified page listing is useful even when salary is unknown, but it belongs in a research-only tab.

UI must let owner filter companies by region, source, role, fixed base and evidence, and contacts by `publicly listed`, `vendor verified`, `unknown`, `inferred`, `suppressed`. Display proof link. Show an honest count of mail-ready contacts vs discovered leads. No default synthetic HR names or mislabeled generic inboxes.

## Workstream 3: IMPLEMENT scheduled website-based mailing (main priority)

This is real send scheduling, not a reminder-only feature. User selects an existing sender account, a recipient set, personalized **exact email subject and body per recipient**, date + local time, timezone (`Asia/Kolkata` default), daily/interval limits, and clicks an explicit **Approve & Schedule** confirmation. Only that specific campaign, set of recipients and frozen message revisions are approved. A schedule edit or recipient/message change invalidates previous approval and requires re-approval. Scheduling or approvals must not enable the global send feature automatically.

Create persistent Mongo schemas (names flexible):
- `OutreachCampaign`: userId, owner, selectedSenderId, timezone, localDateTime, `startAtUtc`, state (`draft`, `awaiting_approval`, `scheduled`, `running`, `paused`, `completed`, `cancelled`, `needs_review`, `failed`), approvedAt, approvedBy, immutable recipient/message digest, global and per-account caps, remaining counters, created/updated audit fields, cancellation intent.
- `OutreachDispatch`: campaignId, userId, contactId, normalizedRecipientEmail, exact subject/body snapshot, unique `(campaignId, contactId, messageRevision)` key, `scheduledAtUtc`, status (`queued`, `claimed`, `sending`, `sent`, `failed`, `unknown_outcome`, `suppressed`, `cancelled`), attempts, leaseOwner, leaseUntil, provider idempotency key, providerMessageId, safe retry info and error status.
- Reuse existing `MailLog` for outcomes; preserve backwards compatibility with existing `sendBatch`, approvals, suppression and contact models. Do not duplicate old queue logic. Keep sensitive SMTP credentials in established encrypted configs, never in campaign documents.

Backend APIs: draft campaign, preview recipients and exact rendered texts, validate existing contacts, save/edit draft, approve+schedule, list status/progress, pause, resume, cancel, dry-run, and optional manual send-now (separate explicit approval). All read/write paths authorized per user, no cross-user leakage; validate account ownership and provider status. Show why each blocked recipient is excluded.

**Worker reliability requirements:**
- Server-side durable scheduling using Mongo persistent polling and atomic `findOneAndUpdate` claims/leases (or existing queue infrastructure if objectively more reliable without additional cost). Do not depend on browser being open, `setTimeout`, or process-memory `activeBatches`. Poll around every 30–60 seconds, UTC comparisons, store IANA timezone and handle ambiguous DST; allow schedule update/cancellation up to the send boundary. Avoid tight loops, orphaned leases and double starts across 2+ replicas. Avoid creating additional AWS paid resources automatically.
- Before EACH recipient dispatch, re-evaluate global `OUTREACH_SENDING_ENABLED`, campaign approval snapshot/digest, sender ownership, current suppression/opt-out/bounce, do-not-contact flags, duplicate-send history, daily/provider quotas and cooldowns. If any fail: skip/pause safely with explicit reason. Never automatically send to speculative/pattern-only addresses. Missing exact user approval for any changed subject/body/recipient must block.
- Track per-recipient progress. If provider response was accepted, mark `sent` with provider ID. If the process crashes after calling provider but before recording result, mark `unknown_outcome` on restart and **DO NOT blindly retry**; use provider reconciliation/idempotency where supported, otherwise request user intervention. Do not promise exactly-once delivery without provider guarantee.
- One active worker per campaign or safe leased concurrency; rate-limit by sender and provider across all campaigns. No parallel app instances should exceed global limits. Pause/cancel immediately stops new sends, not an already accepted provider request. A user-selected *future time* means "start processing at or after this instant", not instant delivery to every contact.
- If runner is offline at schedule time, do NOT surprise-send a stale large batch on next boot. Mark `missed_schedule`/`needs_review` after a configurable grace period (e.g. 15 minutes), require owner to confirm resumption. Clearly explain laptop-only workers cannot send when the laptop is off; opt-in 24/7 cloud workers cost money.
- Keep low defaults (e.g. 10/day and at least 3 minutes apart) configurable within provider policies. Never rotate sender accounts to evade limits. Support opt-out and unsubscribe handling, stop follow-ups on reply or hard bounce, suppression audit and retention limits. No mail delivery may be triggered during tests or migrations.
- Global sending currently defaults OFF in PR #2: do NOT switch it on, dispatch, or connect a real provider during this implementation without the owner's explicit future authorization.

Website UX:
- Outreach -> Scheduled Campaigns page; recipients table with `company / email / evidence / status`; editable per-recipient preview; sender selector; date picker; time picker; timezone; hourly/daily caps; estimated run duration; `Dry run`, `Approve & Schedule` (explicit confirmation modal), `Pause`, `Resume`, `Cancel`; status dashboard, per-email log and reasons for skipped/unknown outcomes; mobile-friendly accessible controls.
- The user should be able to choose 15 Nov 2026 09:30 IST and see the exact equivalent UTC timestamp, count of approved contacts, expected pacing, and cost estimate before accepting. Use test fixtures without sending to real recruiters.
- If a contact's company fails the >15 LPA evidence filter, allow research-stage draft but block it from any default automatic scheduling. User may override a company filter only through an explicit recorded manual action after seeing evidence uncertainty; no overrides for bounced/opted-out/unsourced inferred contacts.

## Workstream 4: performance, quality and cost

- Add a "best next recruiter" ranking: open fresher role, credible salary base, source recency, recruiter relevance, proven address source, outreach history, low credit cost. No numeric "95% verified" from guessed patterns.
- Add background data freshness refresh jobs (separate from email sending) with per-domain request caps, cache, checkpoints, and user-visible stop. Avoid unbounded internet crawling or costly LLM per company.
- Provide local-first profile: laptop running = worker available; laptop off = paused. Optional small hosted worker only if user explicitly approves cost. Budget default INR 0 for paid enrichment/cloud. Show estimated monthly consumption.
- Make an import preview mode that reports 733 source rows, 519 India rows, 214 overseas, and 7 officially published public generic inboxes. Note that reported salary values and overseas sponsorship are *not verified*.

## Tests and release gates (actual evidence required)

A. Run existing PR #2 tests/Chromium suites and report real exit codes. Include PR #3 review data only after understanding its base branch; don't mark 50 companies verified.
B. Company importer tests: 733 source rows; unknown qualifications stay unqualified; no false domains; repeated import idempotent; alias dedupe; preserve stronger existing sources; rollback preserves user history; public email provenance retained; no actual sending.
C. Scheduled queue fake-clock tests: future schedule remains dormant, exact timezone conversion, DST edge, start at due time, pause, resume, cancellation, late boot grace, API auth, concurrent workers, burst/provider throttling, recipient opt-out after approval, changed content invalidates approval, global kill switch, provider timeout/unknown outcome reconciliation, no duplicate sends on restart, no external requests in tests.
D. E2E web: create draft -> preview -> approve/schedule -> fake-clock advance -> simulated provider -> progress -> pause/cancel. Capture screenshots and logs; no real recipient sends. Also run extension form assistant no-submit smoke to ensure it wasn't broken by shared changes.
E. Migration/schema and rollback plan, indexes, production startup flags, observability and alert for queue inactivity. Add deployment docs for local/WSL Task Scheduler and cheap optional hosting, but do not deploy or spend credits.

## Workflow / delivery

1. Read current branches/PRs, establish baseline, locate implementation overlap (notably existing `backend/controllers/mailController.js` in-memory `activeBatches`, `backend/services/outreachApprovalService.js`, `backend/models/OutreachDraft.js`, and PR #2 research queue). Write a concise design and test plan.
2. Generate/refresh Antigravity tasks, run them only if a real integration exists, while Codex builds scheduler/API/tests.
3. Import 733 companies through admin dry run as `research_needed`; generate a reviewed diff, not false qualified/sending counts.
4. Add common-email provenance pipeline and public-email review queue; preserve the 7 source-published inboxes; do NOT fabricate `recruitment@` emails or claim SMTP mailbox checks prove validity.
5. Build persistent scheduled dispatch and website UI end-to-end with a fake mail provider. Maintain safety gates. Share actual screenshots/test output.
6. Open a NEW draft PR **based on PR #2 branch** (or current integrated equivalent), not an outdated main baseline. Keep PR #3 source corrections logically distinct. Document changed files, actual test commands, test results, unresolved blockers, monthly cost, and any authorization needed before activating delivery.

Execute the work instead of only explaining it. If an integration is unavailable, state exactly what remains blocked. Never claim any mail was sent, imported, delivered or verified unless a test or external system independently confirms it. Never call external paid APIs, send mail, provision AWS, access private resume data beyond user-authorized sources, or merge to main without explicit owner approval.

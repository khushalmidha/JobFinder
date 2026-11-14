# Scheduled outreach: design, operation and rollback

This branch builds on PR #2 at `d143e9df26f024e94d5bdbfc047363cf3f051f9a`. PR #3 remains a separate research correction PR; its 50 files are not imported or classified as verified employers. PR #1 is untouched. The attached handoff is preserved under `docs/handoff/20261107/` as source material, with the user's explicit instructions controlling execution.

## Website and approval

Open `/companies` for region-separated company prospects, reported salary/source/role filters, public inbox evidence and administrator preview/apply. Open `/campaigns` to search owned contacts, choose a saved SMTP account, edit each exact subject/body, and select date, local time, IANA timezone, daily cap and pacing. Search covers the database in bounded 1,000-result requests; selected recipients persist across searches.

The default timezone is Asia/Kolkata. For example, **15 November 2026, 09:30 IST = 2026-11-15T04:00:00Z**. Nonexistent and ambiguous DST times are rejected; choose an unambiguous time. Daily quotas use UTC calendar days, stated in the preview. The selected instant starts processing at or after that time; it does not promise simultaneous delivery.

Dry run renders the exact recipient messages and exclusion reasons. Saving a draft never schedules it. A confirmation checkbox and **Approve & Schedule** approve the SHA-256 digest of the complete saved sender identity, recipients, messages, schedule, timezone, pacing, limits and salary overrides. Changing an unstarted campaign resets it to draft and invalidates approval; started campaigns cannot be edited. Review a new campaign for changed recipients/messages. An explicit, recorded per-recipient salary-uncertainty override is possible; suppression, inference and provenance restrictions cannot be overridden.

## Durable worker

MongoDB stores campaigns, dispatches and a single shared runtime lane. Cron wakes the worker every 30 seconds; it does not store schedules. A global atomic lease serializes attempts across instances, persistent cooldowns prevent bursts, and indexed unique campaign/recipient/revision records prevent duplicate materialization. The worker checks current approval/content, sender identity and ownership, suppression across duplicate owned contact rows, replies, invalid/inferred addresses, do-not-contact companies, current salary evidence or recorded override, historical sends, and daily global/user/sender/campaign budgets before each boundary. A persisted boundary distinguishes unstarted work from a potentially in-flight request.

The owner-configured default is 450 attempts per UTC day and at least 180 seconds between attempts. Shared caps can spread a campaign over several days. Attempts with uncertain outcomes consume quota conservatively. Provider-specific limits must also be respected in the configured caps; accounts are never rotated to evade limits. Older successful MailLog history counts toward quotas and duplicate exclusion. Legacy `/mail/send` and automatic account-switch/resume paths now direct users to the durable campaign approval flow. Legacy logs/status remain available, with status sourced from the durable queue.

Both `OUTREACH_SENDING_ENABLED=true` and `OUTREACH_WORKER_ENABLED=true` are required for actual SMTP. Defaults remain false; approving a campaign does not alter them. The production SMTP transport uses saved encrypted credentials, public IPv4 DNS pinning, verified TLS, port 465 or 587 with STARTTLS, no attachments/URL loading, and bounded SMTP connection/socket waits. No sender credential is saved in campaign or dispatch documents. Scheduled campaigns currently support saved SMTP accounts; Brevo HTTP sending is not integrated into this new worker.

SMTP does not guarantee provider idempotency. The stable Message-ID is an audit identifier, **not a promise of deduplication by the provider**. A timeout, interruption after the send boundary, or ambiguous persistence outcome is held for review and never blindly retried. Expired sending leases become `unknown_outcome`; recovery repairs a campaign even if a previous process died between dispatch and campaign updates. An unresolved outcome holds the shared dispatch lane until reviewed. The UI lets the owner compare provider history and record an acknowledged sent/not-sent result with notes and, for sent, a provider identifier. This records an operator assertion; the application does not independently query provider history. A confirmed unsent record stays failed; sending it later needs a new approved campaign. Pause/cancel stops new boundaries and cannot recall an in-flight request. Exactly-once email delivery is not claimed.

A queue more than 15 minutes late becomes `needs_review` with `missed_schedule`; the owner must explicitly confirm resume. This also applies to an interrupted running queue's expected next attempt. A disabled worker, offline backend or sleeping laptop cannot send. The campaign screen displays heartbeat/queue status and stale-worker warnings. There is no paid monitoring service or external alert provisioning in this change.

## Local operation and configuration

Use Node 24.15+ and the existing MongoDB. Install/build with `npm ci` in backend/web and `npm run build` in web. The new models/indexes are additive: campaign due-state index, unique dispatch `(campaignId,recipientEmail,revision)`, runtime `_id`, unique partial MailLog dispatch ID, unique prospect key, lead key and one-mutating-import lock. Startup waits for these indexes before starting the optional worker. Existing contacts and logs are not rewritten.

Keep these defaults until real delivery is deliberately authorized and tested:

```dotenv
OUTREACH_SENDING_ENABLED=false
OUTREACH_WORKER_ENABLED=false
OUTREACH_MAX_DAILY=450
OUTREACH_GLOBAL_MAX_DAILY=450
OUTREACH_MISSED_GRACE_MINUTES=15
```

For an approved future operation, an operator enables both flags in the private runtime environment and restarts the backend. Stop old backend versions before enabling the new queue so an older in-memory sender cannot bypass the shared lane. Configure sender caps within the provider's published limits. Do not enable these flags merely to import research data or inspect a campaign.

Laptop-first operation adds no Redis, paid API, cloud resources or infrastructure charge. The laptop must remain awake and online. A Windows Task Scheduler entry can run the backend at sign-in using the installed Node executable, `backend/index.js` as argument, and the backend directory as its working directory; use a private environment file, automatic restart on failure, a hidden window and no stored secrets in task arguments. This change does not install or activate that task. Under WSL, a user-managed service can run the same Node process with a private environment file. Hosted 24/7 operation requires a separately chosen host and budget; no AWS resources were provisioned. Existing GitHub/Vercel automation may generate previews on PR updates.

## Migration and rollback

Back up the database and deploy with sending disabled. Review [the company import guide](COMPANY_IMPORT.md), [account migration guide](ADMIN_ROLE_MIGRATION.md) and [actual validation report](VALIDATION_20261107.md). The chosen live login currently lacks genuine verification evidence, so no admin promotion or company apply has occurred. The owner requires another final approval before any live company import, even after admin setup.

To stop delivery, disable the sending flag, pause/cancel campaigns in the UI and stop the backend; reconcile any in-flight/unknown attempts before restarting another version. Keep campaigns, dispatches and MailLog records for audit. Reverting application code does not cancel durable data and must not re-enable the retired sender. Do not drop unique indexes or delete dispatches as a retry mechanism. Company rollback is separate and preserves contacts, logs and employer IDs; it may archive newly created unmodified employer records. No automatic retention purge is installed.

Tests run on a real temporary MongoDB and local Chromium with synthetic identities. Fake-clock worker tests inject an in-process fake provider; no real SMTP/provider API is used. The browser harness aborts nonlocal network requests and exercises the actual built MV3 extension and React app. Live provider delivery, real sleeping/restarting laptop operation and external email-verification integration remain untested/unimplemented, as explicitly described in the validation report.

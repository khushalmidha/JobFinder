# Approved sender fallback

Sender fallback is part of the existing Contacts → Send form and Queue & Logs controls. It adds no sidebar destination.

In Contacts → Send, choose a primary SMTP account, enable automatic sender switching, and select additional owned accounts. Preview displays the exact sender list, From names/addresses, individual daily caps, combined campaign budget and shared server ceiling. The explicit campaign approval authorizes that list. Switching after approval needs no second popup or manual resume. Editing sender selection clears preview approval.

## Budget and dispatch behavior

- Each approved sender has an application daily cap up to 450, bounded by the owner's configured safety limit. A two-sender fallback campaign defaults to a combined 900/day campaign budget, three to 1,350, and so on. A smaller explicitly approved campaign budget still applies. Legacy/single-sender campaigns retain their original aggregate owner cap and snapshots; deployment does not expand old approvals.
- Sender capacity is shared across campaigns and JobFinder logins using that same mailbox. Consumer Gmail dots, plus tags and googlemail aliases share a bucket; custom-domain dots are not removed. See [Gmail dot semantics](https://support.google.com/mail/answer/7436150) and [Google's alias explanation](https://gmail.googleblog.com/2008/03/2-hidden-ways-to-get-more-from-your.html).
- Counters use UTC-day bounds. Durable attempted dispatches and legacy accepted/bounced records consume quota; archived ledger copies are deduplicated. A bounce cannot restore consumed capacity. UI sent-message totals remain distinct from conservative quota usage.
- Under the existing global database lease, the worker tries the approved primary, then approved fallbacks in order, skipping exhausted accounts. It persists the actual sender at the same boundary that claims the message. Recipients, subject/body, approval digest and idempotency key remain unchanged. Actual sender email/name and selection/switch events are logged; the user's default SMTP setting is not rewritten.
- When every approved account (or a campaign/server budget) is full, the campaign remains scheduled/running with its next attempt at the UTC reset. It does not become manually paused for ordinary quota exhaustion. Global cooldown and provider restrictions still apply. SMTP capacity shown by the app is not a live provider entitlement or a promise about mail sent outside JobFinder.
- Unknown delivery outcomes, changed identities, opt-outs, invalid contacts, missing mailbox proof and offline/missed schedules retain their existing review/suppression behavior. A provider error is not an excuse to retry an uncertain message from another account. Pause before editing/removing an active sender; a configuration change may race with a message already being claimed or in flight.

## Configuration and rollback

`OUTREACH_MAX_DAILY` continues to cap each sender at 450. `OUTREACH_GLOBAL_MAX_DAILY` is a separate aggregate server ceiling (default 450, bounded at 45,000). Following the owner's explicit choice of 450/day per approved sender, this existing deployment uses a 1,800/day aggregate ceiling for its four configured distinct sender addresses. It is not raised automatically when new accounts are added. Sending and worker enable flags stay false; no previously saved campaign is reapproved or given extra sender permissions.

Campaign snapshots gain optional frozen sender-policy fields only when explicitly enabled. Dispatches gain optional actual-sender metadata and campaigns gain current-sender metadata. Additive date-first indexes keep daily quota reads bounded. Existing records need no rewrite. No paid provider calls or AWS provisioning are involved.

Take a private preimage of the root Compose environment before changing its aggregate cap. To roll back, keep real sending disabled, restore the reviewed environment preimage if necessary, and deploy the prior tested commit. Preserve queue/history/suppression records. A fallback campaign must not be run by an older worker that does not understand its sender policy: leave such campaigns paused until the current worker is restored or cancel the unsent portion and explicitly approve a new campaign.

## Validation

Real temporary-Mongo tests cover owned/distinct secret-free sender snapshots, the last primary slot and automatic handoff, all-full reset without resume, cross-owner/Gmail-alias accounting, unchanged legacy/global limits, unknown outcomes, identity changes, archived-ledger/bounce deduplication and day bounds. Actual Chromium covers primary/fallback selection, exact reviewed sender caps, changed sender-list approval invalidation and the advanced-editor budget after promoting a fallback to primary. All delivery in tests is synthetic; production sending is not enabled by this feature.

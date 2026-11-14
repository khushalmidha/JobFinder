# Codex review: 48-hour retention handoff — 14 November 2026

Disposition: changes required before production cleanup/deployment. Source reviewed from the IDE workspace. Claimed commit d89d57d is not present in the engineering checkout and origin does not advertise feat/retention-48h-20261114; push the branch and provide a reviewable PR. The full111-test claim is submitted evidence, not independently rerun/certified here. Codex ran two additional isolated MongoMemoryServer reproductions with synthetic data; no production writes or cleanup occurred.

## Confirmed blockers

1. Stale ledger permits duplicate outreach. retentionService.js uses $setOnInsert and then treats existence of originalMailLogId as sufficient archive verification. Reproduction: original MailLog currently sent, prior partial-run ledger failed for the same originalMailLogId; retry deletes the sent MailLog, ledger stays failed, campaignService.duplicateReason returns null. Preserve/validate current canonical evidence and monotonic outcome changes before deleting. A mismatched owner/recipient/provider/timestamp/hash must fail closed, not pass an existence check. Add the actual stale-retry regression, not only a matching preseeded ledger.

2. Unsafe deletion after concurrent modification. MailLog.deleteMany filters only IDs. Reproduction: after archiving but immediately before deletion, change the original record to recent sentAt=now and delivered. Cleanup still deletes that recently updated source and retains the stale archive timestamp. Use a transaction or compare-and-delete on the exact archived source version/evidence, rechecking cutoff. Coordinate webhook updates and concurrent cleanup workers; test real interleavings, archive/update races and partial failures.

3. Cleanup enables itself on deploy. initRetentionScheduler runs unless MAIL_RETENTION_ENABLED is exactly false. It scans all owners by default. Require explicit true and an approved initial migration/maintenance scope before any destructive execution. Add scoped dry-run/apply tooling with bounded validated parameters and overlap/multi-instance handling. A branch deployment must not silently delete production data on the next hourly tick.

4. Webhook matching checks MailLog first and only queries DeliveryLedger when no MailLog exists. It does not check ambiguity across both stores. Deduplicate representations of the same originalMailLogId; reject two different historical deliveries matching owner/provider-ID/recipient across the stores. Ensure source deletion during webhook processing cannot lose the outcome. Add tests during archive-before-delete overlap, source deletion between matching and update, and the old-log/new-log ambiguity case.

## Report corrections / validation needed

- The owner-isolation test currently cleans up both owners then verifies ledger separation. It does not demonstrate ownerA-only cleanup preserves ownerB. State global-vs-scoped semantics honestly and test the actual scope boundary.
- The partial-failure test precreates a fully matching ledger, rather than injecting a failure or conflicting status. Add failure injection between archive/persistence-check/delete and concurrent mutations.
- Add exact equality-at-cutoff and invalid/negative/NaN retention/batch/maxBatches validation cases.
- Verify legacy records with missing/blank recipientEmail and absent provider IDs; never assert that historical recipient correlation is complete from populated synthetic fixtures alone.
- Quota consumers summing MailLog+ledger can double count a source present in both after a partial failure or during archive overlap. Count each delivery once, with originalMailLogId/dispatch identity deduplication.
- Keep completed campaign/dispatch body compaction as a separate reviewed change: modifying snapshot recipients breaks the original snapshot digest relationship unless the archival contract is explicitly modeled. Do not compact active or unknown-outcome data.

Deliver a corrected separate branch/commit/PR and actual commands/results. Use temporary MongoDB and synthetic data only. Do not read the production .env, run live cleanup, merge, deploy, send emails, enable workers or spend credits. Codex will review the corrected code before live execution. Keep the owner daily cap450 and queue badge fix intact.

The appended company URL list is a separate research/import request. This review does not treat those entries as verified salary evidence or authorize company import from shortened links.

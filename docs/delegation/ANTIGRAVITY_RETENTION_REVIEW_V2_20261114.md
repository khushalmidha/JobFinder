# Independent review of be28227 — changes still required

Codex fetched origin/feat/retention-48h-20261114 at be28227 into a separate clean worktree. The supplied 10 retention tests passed independently against temporary MongoDB. Two additional synthetic reproductions failed. Production was not accessed or modified for these tests; no cleanup, merge, deployment or sending was performed. Do not call the full112-test claim independently certified by this focused run.

## 1. Failed delivery becomes falsely sent — reproduced

Create an old MailLog with status=failed and no ledger, then run scoped cleanup. Observed: source deleted=true, ledger.status=sent. Mongoose applies the ledger schema default sent in the initial upsert; the subsequent failed promotion only matches status missing, so it never repairs that entry. This can incorrectly block legitimate outreach and misreport delivery evidence. Initialize the actual source outcome atomically, and never rely on schema default sent for archiving. Also remove ordering assumptions between dependent operations in ordered:false bulkWrite. Test all four fresh source outcomes and all stale/retry transitions. Expected failed remains failed, sent remains sent, delivered remains delivered, bounced remains bounced; failed must not count as accepted delivery.

## 2. Compare-and-delete does not cover all canonical evidence — reproduced

Inject a MailLog update after archive/verification but immediately before MailLog.bulkWrite(deleteOps): change providerMessageId and messageHash without changing sentAt/status/recipient. Observed: source deleted=true, ledger provider/hash retain old values. The filter omits provider ID, hash, contact, sender and other relevant version fields. Late webhook correlation can lose the corrected message identity. Use an exact source revision/version condition or a transaction covering all archived evidence and deletion. Include matching immutable identity checks on ledger upserts; do not silently overwrite another canonical identity and then declare it verified.

The existing CAS test updates sentAt BEFORE calling pruneOldMailLogs. It only demonstrates that a recent record is ineligible; it does not reproduce an interleaving between archive and delete. Inject an actual hook/barrier at that boundary, and test status/provider/hash/contact/sender changes and webhook concurrency. Add a first-run failed-status test so this bug cannot pass again.

## 3. Lease expiry is not fenced

The 120-second lease is acquired once with no renewal and no final ownership/expiry guard before mutations. A slow worker can continue after a successor acquires the expired lease. Renew during processing and enforce ownership at destructive boundaries, or use a correctness mechanism that remains safe with overlapping workers and document it precisely. Test expiry, successor acquisition and stale-worker behavior. A test with a currently held unexpired lock is insufficient.

## Additional hardening

- CLI parseInt silently accepts fractional/nonnumeric suffixes (e.g. 1.5 -> 1). Parse strictly, reject unknown/conflicting arguments, and never silently select a different destructive retention window.
- Keep MAIL_RETENTION_ENABLED default off and destructive scope explicit; those fixes are confirmed improvements.
- Retain cross-store unique-delivery checks and existing450 quota. Verify same-delivery overlap, distinct-delivery ambiguity, archive races and delayed webhook writes together.
- Provide an actual opened PR URL /pull/<number>, not the /pull/new/... creation page.

Deliver corrected branch/commit, actual test output and updated dry-run evidence. No production cleanup, merge, deployment, real email, paid API or cloud provisioning. Codex independently reviews before activation.

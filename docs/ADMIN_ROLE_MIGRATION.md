# Verified account administrator migration

This local operator tool promotes an existing, genuinely email-verified account. It does not create accounts, send verification emails, or manufacture verification evidence. Normal signup always creates an unverified `user`; authenticated settings cannot write email identity, role, verification, or migration attribution.

The current application has no trusted email-verification workflow. An existing login without stored evidence remains ineligible. Owning a login, entering an address in Settings, or having an SMTP account configured does not satisfy this check. A future trusted verification integration must write `emailVerified: true`, a nonfuture `emailVerifiedAt`, and `emailVerificationProof` containing its method, issuer, exact account-email subject, and matching verification timestamp. Do not manually backfill these fields to bypass verification.

From `backend`, preview first:

```powershell
node scripts/promoteVerifiedAdmin.js --email 'verified-owner@example.com' --migration-id 'owner-admin-20261107-001' --env-file 'C:\private\jobfinder.env'
```

Preview performs no writes, including no audit insertion. An ineligible preview returns `eligible: false` and exits with code 2. Only after reviewing a genuinely eligible account, use the same arguments plus `--apply`. There is no public role-changing route, registration override, or automatic promotion at startup. Keep environment files and CLI output private.

Apply inserts a durable `AdminRoleMigration` preimage before the account change. Its string `_id` is the unique migration identifier. An atomic conditional update requires the exact existing email, `user` role, unchanged verification evidence, and no other migration attribution. The resulting role is attributed using `adminRoleMigrationId`. The audit records `pending`, `applied` or `failed`, verification-proof hash, actor, before/after roles and timestamps; it never stores passwords or sender credentials.

Retrying an applied migration with the same account and ID is idempotent. Reusing an ID for another account is rejected. A pending migration uses a one-minute lease; wait for lease expiry before recovery. If a crash occurs after promotion but before audit completion, the matching account attribution permits recovery without another promotion. Changed verification or identity prevents a pending promotion. Failed migrations require manual audit inspection before considering a fresh ID.

No live migration was performed by implementation or tests. Synthetic MongoDB fixtures exercise the apply path. To roll back code, stop use of the CLI and revert its application files; additive verification/audit fields can remain. Never delete the audit as rollback. An actual mistaken promotion requires an operator-reviewed demotion of the exact attributed account and a separate audit record, with a database backup first; reverting code does not revoke database roles.

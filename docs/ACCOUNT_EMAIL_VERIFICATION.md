# Account email verification

Settings now contains an explicit account-email verification flow. It sends a fixed verification message to the authenticated account's existing registered email, then accepts a one-use 16-character code from that inbox. Verification does not change roles, approve campaigns, enable outreach or import companies.

The feature is **disabled by default** and uses operator-controlled server SMTP configuration, separate from user-editable outreach senders. Do not use a user's arbitrary SMTP configuration to prove ownership: a malicious SMTP server could capture its own verification message without delivering it to the target inbox.

## Operator configuration

Configure these only in the backend's private runtime environment, after reviewing the sender and obtaining authorization to activate verification delivery. Do not commit passwords or the token secret.

```dotenv
EMAIL_VERIFICATION_ENABLED=false
EMAIL_VERIFICATION_SMTP_HOST=
EMAIL_VERIFICATION_SMTP_PORT=465
EMAIL_VERIFICATION_SMTP_USER=
EMAIL_VERIFICATION_SMTP_PASS=
EMAIL_VERIFICATION_FROM=
EMAIL_VERIFICATION_TOKEN_SECRET=
EMAIL_VERIFICATION_MAX_DAILY=10
```

Use a legitimate server-owned sender and a separately generated random token secret of at least 32 characters. Ports 465 and 587 with verified TLS/STARTTLS are supported. DNS destinations must be public IPv4. Request/socket deadlines are bounded. Existing provider account limits/charges still apply; the code does not create a new provider account or paid resources. When deliberately activated, set only the verification feature flag to true and restart the backend. Outreach flags can remain false.

In Settings, sign in as the existing account, select the explicit code-delivery checkbox and press **Send verification code**. Open that registered mailbox, copy the code, and press **Verify account email**. No email is sent automatically at registration, login, page load, migration or import.

## Security and persistence

`EmailVerificationChallenge` stores one document per user. Codes contain 64 bits of random entropy, expire after ten minutes, are HMAC-hashed at rest, and are never returned by HTTP or logged. The HMAC binds user ID, registered email and code. Each challenge allows five guesses. Atomic counters enforce at most three request attempts per user and normalized mailbox per UTC day, a 60-second account cooldown, and a shared server budget (default ten attempts/day, hard ceiling fifty); failed/uncertain sends still consume allowance. Resending replaces the previous code. Atomic generation/state predicates prevent concurrent reuse. An explicit operation timestamp supports stale in-flight recovery even when Mongoose updates normal timestamps.

Only authenticated owners can request/check their account. Alternate recipients, SMTP details, user IDs and verification authority submitted by the client are ignored. Trusted-server acceptance is recorded before codes become usable. Ambiguous delivery invalidates the code rather than granting verification. Changing the account's registered email invalidates an existing challenge. Success records the exact email, method `email_code`, issuer `jobfinder_trusted_server_sender`, challenge ID and matching timestamps; role remains unchanged.

The local administrator migration checks the trusted issuer/method, UUID challenge ID, and a matching permanent EmailVerificationReceipt for the exact user, email and consumption time. A receipt is inserted after successful one-use consumption and before User proof, so challenge recovery or resend cannot erase genuine ownership evidence. Consumed challenges are terminal. Receipt writes are append-only by service behavior; database operator access remains privileged. Signup/settings/profile cannot create verification authority. Keep receipts and administrator audits; no automatic TTL deletion is installed.

If a process stops after consuming a code but before saving User proof, verification fails closed. The owner can request a new code after the in-flight operation is stale. If it stops after saving the proof, the valid proof remains and replay cannot grant another role. Resetting or disabling configuration does not retrospectively fabricate or erase verification history.

## Migration, activation and rollback

The chosen existing live account was previously found unverified; this implementation does not mark it verified or promote it. Actual verification needs the operator sender setup and the owner receiving/entering a genuine code. After that, run the existing audited administrator CLI preview/apply. A fresh 733-row administrator import preview and the owner's final import approval are still required.

Deploy with verification/outreach flags false. The new challenge, budget and receipt collections use unique `_id` indexes; User proof gains an additive `challengeId` field. Existing contacts/companies are not rewritten. To stop verification delivery, set its flag false; codes cannot confirm while the feature is disabled. Preserve successful verification/admin audit records. Reverting this feature must also retain the stricter administrator-proof gate, rather than accepting arbitrary self-asserted proof fields.

Tests inject an in-process fake trusted sender and use a real temporary MongoDB. Browser tests cover the actual Settings UI. No real verification email is sent by tests, migrations or this implementation task. Successful fake delivery is not evidence that a production sender has been configured.

# Outreach CRM and delivery security

The `/crm` website stores dated follow-up reminders, exact draft text, private notes and owner-recorded replies/opt-outs. Dates are entered/displayed in the browser's named timezone and persisted as UTC. Refresh reloads durable reminders. Reminders do not dispatch mail or start a worker. Draft extraction rechecks current recipient evidence, duplicate-contact suppression, replies and blocked companies. Existing campaign history protections still prevent another campaign from resending to a previously sent recipient: automated follow-up delivery is not enabled by this release.

Replies and explicitly confirmed opt-outs propagate to duplicate addresses within the owner's account and cancel open reminders. Existing invalid evidence and historical mail logs are retained. A concurrent change can leave a reminder stored as open; every overview/draft read still blocks that recipient. Replies recorded in older Dashboard controls also block draft extraction. Automatic authenticated IMAP reply threading is not implemented.

New owner opt-outs and authenticated 5.1.1 failures also create an owner/email suppression ledger. Both draft extraction and campaign dispatch consult it, so deleting/recreating a contact cannot erase these decisions. Ledger entries have no automatic expiry and no public clearing endpoint. Existing older suppression fields remain honored; no live backfill or unsuppression runs in this release.

RecruiterGraph joins company IDs, the owner's contacts, stored roles and public official inbox evidence. It never infers identity from company-name similarity. Salary qualification uses the existing dated fixed-base policy. The score is a transparent ranking of stored evidence (40 salary qualification, 25 linked reported fresher role, 20 sourced contact), not mailbox verification or a sending authorization. Roles can be stale and need employer-page review. The view is bounded at 100 companies, 1,000 contacts, 500 roles and 300 public leads, with truncation disclosed. It prioritizes 200 open reminders plus up to 50 recently closed reminders.

## Delivery webhook

The old unsigned generic bounce handler is replaced. `/api/webhooks/mail-status` is mounted before JSON middleware and accepts only exact raw application/json, at most 32 KiB. It remains disabled unless all three environment variables are configured:

```
MAIL_STATUS_WEBHOOK_ENABLED=false
MAIL_STATUS_WEBHOOK_SECRET=
MAIL_STATUS_WEBHOOK_OWNER_ID=
```

This is a JobFinder normalized adapter protocol, not a claim of native Hunter/Apollo/Brevo/Resend webhook compatibility. Configure a trusted provider-specific adapter before activation. Never share the HMAC secret with a browser or accept unauthenticated provider payloads in that adapter.

The adapter sends headers `x-jobfinder-timestamp` (Unix seconds) and `x-jobfinder-signature` (hex HMAC-SHA256 over timestamp + `.` + exact raw JSON bytes). The timestamp must be within five minutes. Payload:

```json
{"eventId":"provider-unique-id","messageId":"<exact-sent-message-id>","recipientEmail":"careers@example.org","eventType":"permanent_failure","enhancedStatus":"5.1.1"}
```

The event must match exactly one historical message for the configured owner and exact recipient. Only a trusted adapter's permanent recipient failure 5.1.1 assertion invalidates that recipient. Quota, policy and temporary events remain inconclusive. No event deletes contacts. Existing suppression reasons/reply labels are preserved. Event receipts retain unique identifiers without TTL; repeated identical events are idempotent, changed payloads with reused IDs are rejected.

Processing is fail-closed rather than automatically retried after a partial database failure. A receipt stuck in `processing` returns 409. Operator recovery: stop event ingress, inspect the receipt, exact owner/message/recipient and resulting contact/history state, complete the missing idempotent writes, then mark the receipt completed with the reviewed outcome. Do not delete receipts to permit blind replay.

## Mailbox and connection safety

Inbox DSN scans are now read-only reviews of structured `message/delivery-status` attachments with an exact original message/history match. Arbitrary emails in a body never cause mutations. Even a syntactically correct DSN is not authenticated permanent-failure proof. Legacy bounce quarantine preserves records without declaring ambiguous mailboxes invalid.

Gmail and Microsoft IMAP connections map SMTP hostnames to the actual mailbox endpoint, pin a resolved public IPv4 address, verify the original TLS hostname and use bounded connection/response limits. Unsupported mailbox providers require a reviewed adapter. OTP scans ignore messages older than 15 minutes and fetch at most 20 results. SMTP connection tests use verified TLS/STARTTLS and block private destinations. A successful sender connection test does not verify recipient mailboxes.

Legacy access-request notification delivery now also defaults off (`ACCESS_NOTIFICATION_SENDING_ENABLED=false`). It is separate from the approved campaign queue. Do not enable notifications, verification delivery or campaign sending during development.

## Migration and rollback

Deploy on top of the company-import branch/PR after review. Startup creates only additive `OutreachReminder`, `DeliveryEventReceipt` and `RecipientSuppression` collections/indexes. No existing company, contact, user role, verification or mail history migration runs. No live import is repeated.

Keep all sending/worker/notification/webhook flags disabled until deliberate configuration and campaign approval. Back up the three new collections before rollback. Revert this release and retain their data for later restoration. Preserve the campaign suppression-ledger check when rolling back frontend/reminder functionality. The predecessor contains the unsafe unsigned webhook and IMAP TLS behavior: block `/api/webhooks/mail-status`, `/api/mail/scan-bounces` and `/api/mail/latest-otp` at ingress before reverting, or retain the security commits. Never restore an exposed unsigned webhook to service.

## Validation

See `VALIDATION_CRM_20261108.md` for actual runs. No real SMTP/IMAP mailbox credentials, paid provider calls, production writes or AWS provisioning are part of this change.

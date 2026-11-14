# Contact validity pipeline

Production sets `CONTACT_ADMISSION_ENABLED=true`. Imports, extension sync, research intake and model writes require an owner-scoped, unexpired server-created Hunter verifier receipt and a usable mail route before admitting a new active contact. Browser-supplied validity fields are ignored. Unknown addresses go to **Email Checks**, not the active contact list. Existing contacts and their history are preserved pending evidence; sending also requires a fresh receipt.

DNS/MX or successful SMTP connections do not prove a mailbox exists. Catch-all, timeout, unavailable DNS, unsupported syntax and old manually assigned invalid labels cannot justify deletion. A valid provider result is a dated assertion, not a permanent delivery guarantee. Receipts expire after 30 days.

## Operations

`CONTACT_HYGIENE_ENABLED=true` and comma-separated `CONTACT_HYGIENE_USER_IDS` opt explicit owners into hourly free checks (minute 15 UTC). Each run processes up to 200 due active contacts and 50 pending candidates per owner. It uses a database lease, bounded DNS cache/concurrency and a 24-hour recheck interval. It never invokes paid providers or sends email. Large new imports stage promptly; later checks resolve their mail routes.

Confirmed-invalid syntax, explicit sole preference-zero Null MX, fresh trusted invalid verifier receipts and authenticated recipient-failure suppression can remove an active record. The pipeline writes persistent owner/address suppression first, preserves message and delivery history, and uses a version match to avoid deleting a concurrent email correction. Contacts with in-flight or unknown-outcome deliveries are held for reconciliation. Suppressed addresses cannot return through reimport.

Use `node scripts/auditContactValidity.js --owners=ID,ID --out=/private/backup/path` inside the backend container for a complete dry run. Review its report, then rerun with `--apply`. Each run creates a private EJSON contact backup and SHA-256 manifest before scanning. Scope must be explicit. Backups contain personal data; keep them outside the public repository and web root. The CLI resumes neither campaigns nor paid jobs.

Email Checks supports free rechecks. Paid Hunter verification requires a configured key, approved Research budget and explicit per-address credit approval. No paid verification occurs on a timer. Approved checks have a lease/cooldown; provider failures retain conservative credit reservations. There is no public receipt-write API.

## Migration and rollback

Deployment adds MailboxProof and ContactCandidate collections/indexes; no destructive schema migration is required. Keep sending and outreach worker disabled during rollout. Take a scoped backup and review dry-run totals before applying deletion. Then enable only the intended hygiene owner IDs. Check `/api/contact-intake` rejects unauthenticated access and confirm imports report staged counts.

To stop housekeeping set `CONTACT_HYGIENE_ENABLED=false` and recreate the backend. Keep admission enabled while investigating; disabling it allows legacy unverified ingestion. To roll back code, deploy the prior tested SHA with sending disabled. Preserve suppression, receipts and candidate collections. Restore only reviewed contact preimages from the private backup using privileged maintenance, never overwrite newer contact edits or remove suppression automatically. Restored invalid addresses must remain unsendable.

## Validation

Real temporary-Mongo tests cover forged flags, owner isolation, stale/catch-all proofs, model-write bypasses, immutable history, deletion races, unknown-outcome holds and deferred DNS. Chromium exercises Email Checks staging, recheck, explicit verification approval and proof-backed promotion with synthetic fixtures. Development tests invoke no real email provider.

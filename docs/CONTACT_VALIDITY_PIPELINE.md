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

## Manual email blocking

Search `@gmail.com` in Contacts to match that exact email domain, use Select All Filtered (or individual checkboxes), then **Block Selected Emails**. Each row also has **Block email**. This blocks only the chosen owner/address pairs; it does not blacklist every future address at that domain or the whole company.

The **Blocked Emails & Companies** tab groups rows under their company. Manual email blocks can be removed individually or in bulk. Whole-company blocking remains separate. Block/unblock never deletes contact/message history; unblock removes only `owner_block` suppression, never recipient opt-outs or confirmed-invalid records. Queued dispatches become suppressed when blocked and are not automatically requeued after unblock. In-flight deliveries cannot be recalled.

Authenticated POST `/api/contacts/block-emails` and `/api/contacts/unblock-emails` accept `contactIds` (1–10000). Ownership is resolved on the server, duplicate addresses collapse, and foreign/missing IDs disclose no contact details. Contact reads expose owner-scoped `emailBlocked`/`emailBlockSource` fields. Existing campaign preview and dispatch gates already consult persistent suppression, so blocked addresses cannot bypass the controls through another contact row or reimport.

## Company contact labels and unblock identity

Reviewed aliases group Graviton / Gravitontrading / Graviton Trading under Graviton Research Capital; Samsung city/typo variants under Samsung; Atlassian casing under Atlassian. Contact intake/model writes and directory reads use the same identity service. Original variant labels are retained in `companyOriginalName` when normalized. This changes contact-directory labels only: no salary-evidence records, company research entities, contact IDs, emails or delivery history are merged/deleted. Unrelated Atlas and Fresh Gravity remain separate. No fuzzy matching is applied to unknown employers.

Company block/unblock matches canonical identity, including legacy case/space/alias values. Unblock uses atomic `$pull` against the actual stored keys and preserves unrelated company blocks, individual email blocks, opt-outs and confirmed-invalid suppression. Campaign gates use the same identity rule. Back up affected contact/candidate preimages and user block lists before applying existing-data normalization; use version-matched updates and report conflicts. Rollback restores only reviewed label preimages and must preserve newer blocks and edits.


The November 15 full-directory review compared 1,000 scoped company labels and flagged 519 name/domain pairs for review. An additional 28 explicit alias groups are recorded with supporting dataset domains in `backend/data/companyAliases.reviewed.json`. Similarity is discovery only: it is not a runtime merge rule. Shared domains alone do not establish identity (the audit also found mixed/mislabelled records and distinct brands sharing a group domain). Scaler/Zscaler, Visa/iVisa, Atlas/Atlassian, Zomato/Blinkit and other uncertain pairs remain separate. Mailbox-verification and salary-evidence status never change as a consequence of label cleanup.

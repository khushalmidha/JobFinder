# Stored email connectivity audit — 7 November 2026

Executed against the configured JobFinder database under the owner's explicit request to audit all stored email contacts and remove invalid entries while preserving temporary failures. This is a server-connectivity audit, not mailbox enumeration or proof of individual mailbox existence.

## Actual verified results

| Measure | Result |
|---|---:|
| Contact records audited | 5,479 |
| Unique normalized email addresses | 2,904 |
| Domains from supported valid-syntax addresses | 1,002 |
| Unique MX hosts checked | 537 |
| Actual outbound SMTP connection attempts | 534 |
| Domains with SMTP greeting/EHLO success (shared-host results reused) | 906 |
| Confirmed-invalid records suppressed | 6 (5 unique addresses) |
| Invalid syntax | 1 record, trailing punctuation in domain |
| Explicit Null MX domains | 5 records across 4 domains |
| Contacts physically deleted | 0 |
| Audit emails sent / paid provider calls | 0 / 0 |
| Records retained after audit | 5,479 |

The sweep ran 02:48:12–02:55:01 UTC (08:18:12–08:25:01 IST). Run ID `f3beb0b8-00b8-479c-90f8-6f1f2c3e95f6`. A separate live database read confirmed all 5,479 audit metadata updates, six new suppressions, zero audit mailbox-verification claims and zero suppressions for temporary/unreachable SMTP results. Re-evaluating all private results against the final stricter suppression policy found **0 differences**.

Domain results: 950 explicit MX, 13 implicit MX/address fallback, 23 DNS inconclusive, 4 Null MX, 10 DNS not found, 2 other unknown. SMTP result counts per domain: 906 reachable, 31 inconclusive, 19 unreachable, 3 MX-host DNS inconclusive, 39 not attempted because no usable route was established (including Null MX), 4 temporary rejection. Some domains share an MX host, so a single connection result was reused rather than repeatedly probing the same server for every address.

## Meaning of cleanup

Suppressed contacts are marked invalid and blocked from outreach while retaining contact identity, status and historical mail/reply records. The existing Invalid Emails filter can display them. Raw TCP failures, temporary 4xx responses, DNS timeouts/NXDOMAIN uncertainty, office hours and pre-existing bounced flags did not trigger removal. There were no historical logs with explicit recipientEmail, so the old 186 bounced contact flags were not treated as newly confirmed mailbox failures.

SMTP checks sent only EHLO and QUIT; no MAIL FROM, RCPT TO, VRFY, DATA, message delivery or paid verifier calls. An SMTP server accepting EHLO cannot establish that a named mailbox exists. [SMTP protocol](https://www.rfc-editor.org/rfc/rfc5321) and [Null MX specification](https://www.rfc-editor.org/rfc/rfc7505) describe the relevant distinction.

Private before-state backup, per-domain evidence and per-contact results are saved only under the ignored local `artifacts/mail-audit/20261107-smtp-audit/` directory in the review checkout. They contain private contact data and are not committed or uploaded. Public documentation contains aggregate counts only.

## Reusable operator command

From backend, use `npm run audit:emails -- --env-file .env --user-id <owned-user-id>` for a dry run. `--apply` permits contact audit metadata and confirmed-invalid suppression; `--all-users` must be explicitly selected by the database owner for a database-wide run. No physical deletion operation is implemented. Defaults are concurrency 3, 2.5-second end-to-end host timeout, and public IPv4 destinations only. Alternate MX enumeration and IPv6-only destinations require later/manual diagnosis; uncertain addresses are preserved.

The reusable checker now preserves quoted/SMTPUTF8/unsupported syntax and requires trusted structured recipient DSN evidence without a newer successful delivery before any historical-bounce-based suppression. Actual source review and code caveats are recorded in [the Antigravity handoff review](reviews/ANTIGRAVITY_HANDOFF_REVIEW_20261107.md).

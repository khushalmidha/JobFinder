# Approved company import completed — 8 November 2026

The owner explicitly requested immediate import into the primary account and its currently configured sharing accounts. The import was executed as a local database-operator maintenance operation, with a recorded authorization, reviewed dry-run digest, private preimage backups and atomic MongoDB transactions. No application account was made administrator or marked email-verified; normal HTTP admin requirements remain unchanged.

## Independently verified live results

| Item | Result |
| --- | ---: |
| Supplied source rows imported | **733 / 733** |
| India research rows | **519** |
| Overseas research rows | **214** |
| Existing company documents preserved unchanged | **192 / 192** |
| New company identities created | **611** |
| Total company documents after import | **803** |
| Unlinked identity conflicts retained for review | **1 (CRED)** |
| Original public-inbox leads plus reviewed Zeta addition | **8** |
| Approved account destinations | **3** |
| New contacts per approved account | **7** |
| Existing matching contacts per account kept unchanged | **1** |
| Public recruiting addresses present in each approved account | **8** |
| Total new contact records | **21** |
| Existing contacts preserved unchanged | **5,479 / 5,479** |
| Total contact records after import | **5,500** |
| Existing mail history preserved unchanged | **7,813 / 7,813** |
| Prior confirmed-invalid audit suppressions retained | **6 / 6** |
| Real emails sent / mailbox-verification assertions | **0 / 0** |

The shared company directory stores the 733 source records once; accounts do not receive three duplicate directories. The 24 region-specific name overlaps in the source remain distinct research rows. CRED's ambiguous source row is preserved without merging existing employers. The source has 709 distinct case-insensitive company names; this does not mean 733 distinct legal employers.

All imported source rows remain `research_needed` and not approved for sending. Reported compensation is not promoted to verified fixed base. Public listing, DNS/MX, SMTP connectivity and individual mailbox existence remain separate. Current direct-fetch results, earlier independent official-page observations and domain/SMTP diagnostic results are recorded distinctly; earlier observations retain their actual dates. No guessed CRED/Tower inboxes were imported as sourced contacts.

## Execution and preservation proof

The first run imported the supplied 733-record JSON and original seven public recruiting leads, adding six contacts per account while skipping each account's existing matching address. A separate reviewed one-row Zeta incremental run updated the existing prospect and added one sourced inbox per account. Final source-row count remains 733. Existing company/prospect identity references were reused where unambiguous; no account sharing settings were changed.

An independent raw-database read compared every preexisting company, contact and MailLog document with its private backup using canonical SHA-256 hashes. Every original document matched; missing/changed count was zero. It separately checked exact region counts, eight recruiting addresses in each approved account, unchanged role/verification flags and all six original suppressions. Only an additive import-audit pointer was attached to the three approved User rows to protect transactional sharing scope.

Private backups, scoped account identities, exact run/digest receipts and independent verification are under the ignored local `artifacts/operator-import-20261108/` directory. They contain personal contact/history information and must not be committed, uploaded or copied into a public PR. This document intentionally reports redacted counts only.

No email campaign was created or enabled, no application submitted, no paid enrichment used, no AWS resource provisioned and no automatic main merge performed. The account verification workflow remains independent of this explicitly authorized database maintenance operation. App-level administrative self-service still requires genuine proof and an audited promotion.

## Tests and rollback

The new maintenance workflow passed five integration tests against a real temporary MongoDB replica set, including complete 733-row import/reimport, approved account scope, existing evidence/history/suppression preservation, evidence digest binding, null-MX handling and contact-aware rollback. An actual Astra read-only source review confirmed fixes to exact environment targeting, evidence binding, rollback coverage and scope-write conflicts; the reviewer did not access production.

See [local operator operations/rollback](OPERATOR_COMPANY_IMPORT.md). Roll back the Zeta incremental run first if rollback is explicitly requested, then the full run. Pause contact/draft/campaign writers before rollback. Only unchanged newly created unused contacts may be removed; existing contacts/history remain preserved. Employer IDs are retained through archival. No rollback was performed during this successful import.

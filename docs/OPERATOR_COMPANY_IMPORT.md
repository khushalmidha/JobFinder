# Local operator company import

This maintenance entry point performs an explicitly authorized data migration using local database-operator credentials. It is not mounted as an HTTP route, does not accept a web-user admin override, and does not grant admin roles or invent account verification. Normal admin import APIs and verified-account promotion gates remain unchanged.

The owner explicitly requested the import into the primary account and its configured sharing destinations on 8 November 2026. The shared company directory is inserted once; only public-source recruiting contacts are separately copied to the frozen approved account set. Existing private contacts are not copied, existing records are not overwritten, and no sharing settings are enabled.

## Preview and apply

Run from backend with the exact private environment file. Its database URI is parsed directly, so inherited environment values cannot redirect the operation. Preview records source/directory hashes, owner/account IDs, sharing scope, explicit authorization text and reviewed-evidence hash. Source publication observations are dated separately from current direct-fetch results. DNS and SMTP EHLO/QUIT diagnostics never establish individual mailbox existence. Null MX blocks new contact insertion; transient failures remain inconclusive.

```powershell
node scripts/operatorImportCompanies.js --env-file C:/private/jobfinder.env --owner-email OWNER_EMAIL --include-shared --authorization 'Owner approved directory and public-contact import into these configured accounts' --source C:/private/company_research_staging_733.json --reviewed-inboxes ../docs/research/REVIEWED_INBOX_HANDOFF_20261107.json --output C:/private/preview.json
node scripts/operatorImportCompanies.js --env-file C:/private/jobfinder.env --owner-email OWNER_EMAIL --apply --run-id REVIEWED_RUN_ID --digest REVIEWED_DIGEST --backup-dir C:/private/import-backup --reviewed-inboxes ../docs/research/REVIEWED_INBOX_HANDOFF_20261107.json --output C:/private/result.json
```

Apply refuses changed directory/sharing/evidence scope. It first creates exclusive backup files for companies, prospects, public leads, contacts, mail history and the approved preview. Keep those files private and out of source control. A MongoDB replica set/transaction-capable deployment is required. No standalone partial-write fallback exists.

All company/prospect/lead/new-contact writes and the applied audit commit share one transaction with snapshot reads and majority writes. The operation writes an additive lastCompanyImportRunId audit pointer to approved user rows, creating write conflicts if sharing/account identity is concurrently changed; role, verification and sharing fields are untouched. Company IDs and existing salary evidence are preserved. Case-normalized existing contacts are skipped regardless of invalid/suppressed/history status. Imported prospects remain research_needed, public inboxes mailbox-unverified, and no campaign/send approval is granted.

## Rollback

Stop campaign/draft/contact writers before rollback. The local contact-aware rollback validates the same owner/run/digest, removes only unchanged new contacts without known mail/dispatch/draft history, restores or removes unchanged import-owned prospects/leads, and soft-archives eligible newly created employers while preserving IDs. Changes/usage become retained conflicts. Never delete preexisting contacts, restore the entire backup over later user activity, or use rollback as an email retry mechanism. Generic admin rollback rejects operator runs because it does not handle their contact journal.

```powershell
node scripts/operatorImportCompanies.js --env-file C:/private/jobfinder.env --owner-email OWNER_EMAIL --rollback --run-id REVIEWED_RUN_ID --digest REVIEWED_DIGEST --output C:/private/rollback-result.json
```

Roll back dependent incremental runs in reverse order. Receipts and audit records are retained. The current source uses service-level append-only journals and transaction guards; privileged direct database access still requires operator care.

## Validation

Five real temporary-replica-set integration tests cover full733 import/reimport, source/evidence/scope approval, preservation of historical evidence/contacts/suppression, per-account visibility, null-MX gating, no role/verification promotion, and contact-aware rollback. Existing HTTP admin requirements remain enforced. Actual Astra source review identified and verified fixes for exact environment targeting, hash-bound evidence, rollback coverage and sharing transaction guards. No production access or SMTP was performed by the reviewer.

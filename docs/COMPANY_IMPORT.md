# Company research import: 7 November 2026

The supplied JSON contains 733 source records: 519 India and 214 overseas/visa research records. There are 709 distinct case-insensitive employer names; 24 employers appear in both region groups. Thirteen India records report a base minimum above INR 15 lakh, but none of these spreadsheet claims is accepted as a verified fixed-base offer. Seven rows contain sourced generic recruiting inbox leads. Every imported prospect remains `research_needed`, `sendEligible=false`.

The source workbook was independently inspected as OpenXML: `INDIA_MASTER` has 519 data rows and the overseas sheet has 214. The workbook uses prefixed spreadsheet namespaces that the installed ExcelJS reader failed to load. The importer therefore consumes the supplied companion JSON, preserving its raw research values. This is an observed workbook compatibility limitation, not a claim that workbook upload was tested successfully.

## Storage and merge policy

`CompanyProspect` preserves every region-specific source row, its reported salary/visa claims, source URLs and deterministic SHA-256 key based on source name, employer name and region. Exact employer name/alias matches reuse existing `Company` IDs. Independently known employer domains from the seven official inbox identities can also match existing employer domains; arbitrary spreadsheet URL hosts cannot. Multiple existing matches produce an unlinked quarantined prospect with `identityStatus=conflict` and a reason, preserving the source row without merging employers. Existing company documents, salary evidence, contacts, suppression and mail history are never overwritten by this importer.

New companies have no asserted employer domain, no asserted official careers URL, no salary evidence and an `unknown` salary tier. A spreadsheet link may point to a community directory or generic ATS: its host is not proof of employer ownership. The original supplied URL remains visible on the linked prospect as an unverified research source. Missing domains are left empty. Region groups are retained on prospects and on newly created employers, including employers with both India and overseas records.

`PublicRecruitmentLead` stores supplied generic inboxes separately from user contacts. It never grants mailbox verification or send eligibility. An apply checks the seven known official proof URLs again using the existing public-network fetcher, robots policy, request timeout and response-size bound. The address must actually be extracted from the fetched employer page. Timeout, unavailable robots permission, blocked requests and missing publication remain separate research outcomes. No SMTP, provider enrichment or email sending is performed by the importer.

Independent browsing on 7 November visibly found all seven supplied addresses on the linked employer pages: [Razorpay](https://razorpay.com/tech/), [BrowserStack](https://www.browserstack.com/careers), [Apna Data Systems](https://apnadatasystems.com/careers), [Intellicar](https://www.intellicar.in/company-pages/careers), [Lexi](https://www.getlexi.io/careers/software-engineer-chennai), [Live2.ai](https://live2.ai/careers), [SCREL](https://screl.com/careers). A separate direct-fetch diagnostic extracted Apna Data Systems, Intellicar and SCREL; the other four checks were inconclusive because of robots permission or timeout. Neither result establishes that a named mailbox exists, that freshers are being hired, or that salary meets the target. Apply-time results may differ as pages change.

## Administration API

Mount `backend/routes/companyImport.js` at `/api/company-imports`. Authentication is required throughout. Preview/apply/rollback and run details re-read the authenticated user's current administrator role; a JWT role claim alone does not grant import access.

- `GET /source-summary`: source counts with zero salary qualifications and zero mail-ready claims.
- `GET /prospects?region=India&q=...`: public research records; `International_Visa_Research` and `companyId` filters are also supported.
- `GET /leads`: public generic inbox evidence, with research-only status and checked date.
- `POST /preview` with `{}` uses the supplied batch. An incremental batch can use `{ "source": { "source": "same-source-name", "companies": [...] } }`.
- `POST /:runId/apply` with `{ "digest": "exact-preview-digest" }` applies an owned preview.
- `GET /:runId` retrieves the administrator's journal and summary.
- `POST /:runId/rollback` attempts a conservative rollback of an applied or failed owned run.

A preview writes only an import journal, never employers, prospects, leads, contacts or mail logs. Its digest binds the complete diff and current company/prospect/lead directory fingerprint. It expires after 24 hours; a changed directory requires a fresh preview. A shared unique Mongo index permits one mutating import or rollback at a time across processes. Applying the same completed preview is a no-op; repeating the source produces unchanged records and no duplicate employers. Re-importing identical data does not spend network requests refreshing old evidence; freshness research is a separate operation.

## CLI migration and rollback

The CLI defaults to dry run. It loads no `.env` implicitly, and requires the ID of an existing administrator. Run from `backend`; the example environment-file path is local and must not be committed.

```powershell
node scripts/importCompanies.js --env-file C:/private/jobfinder.env --user-id ADMIN_ID --output C:/private/company-preview.json
node scripts/importCompanies.js --env-file C:/private/jobfinder.env --user-id ADMIN_ID --apply --preview-id RUN_ID --digest REVIEWED_DIGEST --output C:/private/company-apply.json
node scripts/importCompanies.js --env-file C:/private/jobfinder.env --user-id ADMIN_ID --rollback --preview-id RUN_ID --output C:/private/company-rollback.json
```

Review the actual 733-row preview and conflicts before apply. Output files use exclusive creation and must have fresh names. The CLI initializes only Company/CompanyProspect/CompanyImportRun/PublicRecruitmentLead indexes; it never starts the application, worker, scheduler or mail transport. Take a database backup before a live migration. Do not enable sending to perform this migration.

Rollback restores pre-import prospect/lead documents only when their current hash and import ownership match the journal. It never removes contacts, job openings, applications, notes or mail logs. Newly created employers are archived only if unchanged and unreferenced by any application collection's `companyId`; all employer IDs are preserved, and changed or referenced employers are retained with an explicit count. Later manual changes produce conflicts and are preserved. Removing the feature code after rollback does not require altering historical contact or mail schemas.

Imports fail closed after process termination: an `applying`/`rolling_back` run with `mutating=true` retains the shared lock. Stop/verify all import processes, back up the run and directory, inspect its journal, and use the administrator-only local CLI `--recover --acknowledge-workers-stopped --reason "Stopped all import processes; backup and journal inspected" --preview-id RUN_ID` after at least 30 minutes without run writes. Recovery records an audited compare-and-swap transition to failed and releases the shared lock. Then run the conservative rollback. Journal entries interrupted between a write and its confirmation hash are retained as conflicts for manual comparison rather than guessed away. There is no automatic force-unlock or public recovery endpoint. Rollback database exceptions release the lock and retain the partial report. Replacement/deletion version checks preserve concurrent manual edits.

After independently reviewing a fresh official listing, an authenticated owner can explicitly save it through `POST /leads/:id/contact` with `reviewed:true`. This creates a private sourced research contact with mailbox validity unverified. Existing contacts, suppression and history remain unchanged. Campaign fit checks and exact approval still apply. Inconclusive, stale, unresolved or merely inferred leads cannot use this path.

## Actual isolated validation

`node --test tests/companyImport.test.js` uses real temporary MongoDB, a synthetic administrator and fixture-backed public pages. It covers the full 733-row preview/apply/reimport, region counts, exact alias reuse/conflicts, stronger evidence and suppression/history preservation, incremental updates, rollback, manual edit preservation, stale previews, public-source failure states and administrator authorization. These tests do not use production credentials or send mail. Production import results must be reported separately from isolated test counts.


The owner-authorized 8 November live import is complete through a separate local operator maintenance workflow; see [verified results](IMPORT_733_COMPLETED_20261108.md). Normal application administrator requirements above remain unchanged. This does not grant or assert account verification/admin privileges.

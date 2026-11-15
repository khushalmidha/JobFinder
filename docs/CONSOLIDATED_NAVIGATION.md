# Consolidated navigation

The sidebar now has only the five existing destinations:

| Destination | Integrated tools |
| --- | --- |
| Dashboard | Company-grouped contacts, follow-ups/replies/referrals, email verification |
| Job Hunter & HR Sheet | Job search, company directory/salary research, recruiter research/draft preparation |
| Import Contacts | Existing contact importer |
| Queue & Logs | Email history and campaign queues/schedules, including pause/resume/reconciliation |
| Settings | Existing account/provider settings |

Related tools open as expandable sections in their parent workspace, not additional sidebar pages. Only the active tool mounts; closed sections do not start background requests or paid work. A back button returns to the original main view. Selected sections survive refresh and browser history through the `section` query parameter.

Legacy links redirect with replacement while preserving other query parameters and the fragment: `/crm` → `/?section=crm`, `/email-checks` → `/?section=email-checks`, `/companies` → `/jobs?section=companies`, `/research` → `/jobs?section=research`, `/campaigns` → `/logs?section=campaigns`. Existing APIs, owner/admin checks, durable campaigns and sending approval are unchanged. The main Send message editor still creates immediate or scheduled outreach.

## Company directory packaging fix

The company importer previously read `docs/handoff/20261107/company_research_staging_733.json`, outside the backend Docker build context. That file did not exist inside the deployed image, causing `ENOENT`; a failed source summary also discarded successful saved-directory responses in the UI.

The identical source file is now tracked once at `backend/data/company_research_staging_733.json`, included automatically by the existing backend Dockerfile. No source bytes, import keys/digests, salary assertions or company/contact records changed. Directory requests settle independently so saved rows remain visible if the summary or another ancillary request fails. Missing-source failures return a friendly 503 message without filesystem paths.

## Validation and deployment

Browser regression checks cover all five sidebar links, integrated sections, old-link redirects, query preservation, reload/mobile behavior, and saved company rows remaining visible during a simulated source-summary failure. Existing immediate/scheduled Compose, CRM, research, verification and company-import flows continue through their legacy links. A backend test checks the packaged source and exact 733/519/214 summary with zero verified salary offers granted.

No database migration or reimport is needed. Deploy through normal CI; confirm the image contains `/app/data/company_research_staging_733.json` and authenticated source-summary/prospects endpoints succeed. Retain current sending/worker gates, daily limits, retention and hygiene settings. For a navigation rollback, revert frontend changes while keeping the backend packaging fix; a full rollback to the earlier image reintroduces its missing-source defect. Never delete imported companies or campaign/contact history to roll back this UI change.

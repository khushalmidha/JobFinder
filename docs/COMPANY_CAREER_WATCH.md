# Company career watch and professional contact research

Implemented against existing JobFinder services, company prospects and Job Hunter screen. No new sidebar destination. Company qualification remains strictly above INR 15 LPA **verified recurring fixed base**: reported salary figures in the supplied workbook never become verified offers.

## Architecture options

| Approach | Expected yield | Cost | Source/terms constraints | Effort |
| --- | --- | --- | --- | --- |
| Official careers pages + sitemaps + ATS links | Low for emails; useful for structured job feeds | Free HTTP, bounded compute | Robots checks; public pages only; terms review where needed | Medium |
| Employer-published job descriptions and apply inboxes | Good relevance, sparse addresses | Free official feeds/pages | Employer origin and explicit published evidence required | Medium |
| Apollo people search -> shortlisted Hunter Finder/Verifier | Better named recruiter/manager coverage, account-dependent | Search can be free; enrichment/verification credit-gated | Official API credentials, approved credit budget; search itself provides no emails | Medium; reuse existing adapters |
| Hunter Domain Search -> shortlist | Published addresses and patterns; coverage varies | Provider/account credit budget | Official API only; patterns are not mailbox proof | Low; existing leadAgencyService |
| Manual official portal corrections | Improves company coverage without guessing domains | Free, human review | Official employer/ATS evidence for each mapping | Low per company |

Selected combination: free official-page/job monitoring and separate professional-lead staging now; reuse existing Hunter/Apollo adapters only after budget approval. No LinkedIn automation, pattern-generated addresses, mass SMTP checks, data-broker crawling or automatic outreach. Named emails require published nearby recruiting/hiring evidence. Generic careers/jobs/recruitment/talent/hr inboxes are preferred. An engineering-manager title alone does not establish hiring responsibility.

Primary API references: [Greenhouse public job board](https://docs.greenhouse.io/job-board.html), [Lever postings](https://github.com/lever/postings-api/blob/master/README.md), [Ashby public postings](https://developers.ashbyhq.com/docs/public-job-posting-api), [Apollo people search](https://docs.apollo.io/reference/people-api-search), [Apollo enrichment](https://docs.apollo.io/reference/people-enrichment), [Hunter API](https://hunter.io/api-documentation). Plan eligibility and tariffs must be checked before any paid activation.

## Data and scheduling

The supplied workbook has 519 India rows and 214 overseas rows. Its imported CompanyProspect records, falling back to the packaged 733-row dataset, seed an idempotent per-owner queue. Stable company+portal identities preserve separate employers sharing Lever/Greenhouse hosts. Directory URLs, LinkedIn URLs and missing official portals require mapping; these are counted explicitly and never treated as successful employer scans. Existing Company identities can resolve missing mappings only when unambiguous. A known employer root domain takes precedence over its careers subdomain for HR email discovery. Queue seeding uses bounded bulk writes; re-queueing repairs idle task metadata without resetting existing progress or active leases.

India focus is on by default: India-target company tasks run first; professional leads from India-target companies sort first. Actual job location is checked independently: only explicit India/city evidence produces India-mode notifications. Worldwide/unspecified remote locations remain unknown, not assumed eligible for India. Overseas jobs remain stored and are available when India focus is turned off. Company target region is not proof that an individual recruiter lives in India.

CareerWatchConfig, CareerWatchTask, CareerWatchJob and CareerWatchNotification are additive Mongo collections. Task leases prevent concurrent claims, expire after a crash and are checked before result writes. A task finishes with nextScanAt five hours later. The backend polls every ten seconds; it continues after browser closure or service restart. Each poll is bounded (five companies, 30 HTTP requests, 45 seconds of job scanning), each company has at most 12 requests, and the owner has a configurable free HTTP daily cap (default 20,000, maximum 50,000). Capacity/budget constraints and failures can delay a scan; five hours is a recurrence target, not guaranteed coverage of every portal.

Professional contact refresh is weekly per mapped employer, using at most five HTTP requests and the independent existing ResearchPolicy daily cap (maximum 500). This avoids spending the whole budget repeatedly on the first companies. Failed/budget-blocked contact scans retain an error and retry on a later job scan. No credit-consuming provider is called by either background worker. Research leads are owner-scoped ProfessionalLead records, **separate from active outreach contacts**. Company/domain, name if explicitly identified, title, kind, source URL, observation time, confidence and publicly_listed_not_mailbox_verified are retained. Suppressed, opted-out, known-invalid and replied contacts are excluded at discovery/read/export time. No guessed mailbox is called valid.

## Eligibility and alerts

Supported adapters: employer-linked Greenhouse, Lever and Ashby boards plus official JobPosting JSON-LD. Jobs must concern software/SDE/AI/ML. Explicit fresher eligibility, a zero-to-one-year range, or under-one-year experience can qualify FTE roles; one-year minimums and senior roles are excluded. Unknown requirements remain needs_review. Internships require explicit six-month duration and FTE/PPO conversion. A six-month internship without conversion evidence is not a match. Salary and visa eligibility are not inferred from a matching job.

New eligible job URLs create one in-app notification per owner; repeat scans do not create duplicates. Existing Job Hunter contains matches, review rows, notifications and separate Recruiters / Hiring managers / Recruiting inboxes tabs. The sidebar badge polls unread notifications every minute. CSV/XLSX export contains provenance and unverified labels and escapes spreadsheet formulas.

## Crawling controls and honest limitations

Every HTTP destination passes existing DNS-pinned public-IPv4 HTTPS checks (no private/link-local/metadata IPs). Identifiable User-Agent: JobFinderResearch/1.0. Requests and bytes/time are bounded; same-site redirects and recognized ATS links are bounded and robots checked. Robots uses matching agent groups, longest-path rules and wildcard/end matching, based on [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html). If robots cannot be obtained, including a 404, the stricter project rule permits only homepage plus **one actually linked** careers/contact page, with no external ATS/API traversal. Access denial, captchas and authentication are not bypassed.

This is not a universal browser scraper. Workday/Keka/Zoho/Workable and other JavaScript-only portals need additional supported adapters or manual mapping; unsupported pages remain visible as errors/no structured results. Employer redirects to a different corporate hostname need reviewed mappings. Only the first bounded portion of a large board is read; >200 eligible/review rows is flagged for pagination review. Closed jobs are not yet automatically reconciled; lastSeenAt and source links must be checked before applying. Public pages often publish no professional emails, and a published email does not establish mailbox existence. Robots permission is not a substitute for applicable site terms. Global stop: RESEARCH_STOP=true; per-owner monitoring can be disabled in the screen.

## Enable, migration and rollback

1. Deploy code; the new model indexes are additive. No existing company/contact/suppression/campaign is deleted or rewritten.
2. Set CAREER_WATCH_ENABLED=true in the private root Compose .env. Optionally set PROFESSIONAL_DISCOVERY_BACKGROUND_ENABLED=true for free sourced-contact refresh. Defaults are false; existing legacy job scheduler is unchanged and should remain off when this watcher owns monitoring.
3. Authenticated primary owner queues supplied companies and enables monitoring. Configure ResearchPolicy.dailyRequests up to 500, paidProvidersEnabled=false and monthlyCredits=0 for free contact research. The career HTTP budget is independent of this research budget.
4. Review queue counts: mapped versus needs_portal_mapping; correct official portals before assuming coverage. Inspect failed task lastError/contactLastError and requestsUsed. Never enable paid providers to fix free HTTP budget exhaustion.
5. Rollback: disable the two new environment flags and owner monitoring, recreate backend, then revert the feature commit if necessary. Additive collections can remain for history; never drop shared collections or suppressions. Preserve private .env backup and restore only changed feature flags.

## Pilot and optional paid next step

Run from repo root: node backend/scripts/pilotCareerWatch.js. It uses the checked-in 20-company selection, no database writes, zero paid calls, at most 200 HTTP requests. Actual measured results are in COMPANY_CAREER_WATCH_PILOT.md. A zero-yield pilot is reported as zero, never filled with generated addresses.

Optional proposal, **not approved or executed**: cap an initial Hunter trial at 100 application-reserved credits. At existing conservative reservation rates: ten domain searches limited to five results (50 reserved), ten shortlisted named Finder requests (20), twenty Verifier requests (20), with ten credits unallocated. This is a reservation plan, not a promise of provider billing rates or deliverable mailboxes. Confirm actual plan/key permissions and approve the monetary/credit cap before enabling anything. Apollo discovery may shortlist recruiter/hiring-manager names; its People Search response itself does not return emails. No API keys belong in chat or source control.

## Verification

Full local backend suite: 211/211 passed; full browser smoke passed with zero real mail/provider calls. The new real Chromium/Mongo flow covers India focus, pagination, notification reads and owner isolation. Web production build and lint passed (existing unrelated warnings remain). Independent task review found and corrected shared-ATS identity collapse, daily-budget rollover, stale leases and conflicting experience evidence. Optional Astra review could not run because that model returned a usage-limit error; no Astra approval is claimed.

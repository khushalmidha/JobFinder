# Main mail sheet discovery and two-page navigation

Primary pages are Jobs and Mails. Jobs shows only career-watch postings and notifications; monitoring controls are collapsed. Mails retains existing company-grouped contacts, compose/immediate/scheduled approval, block/suppression controls and history, and adds contact-type filtering. Queue, import, verification, CRM and source tools live behind one Mail tools selector; Settings remains a utility link. Historical URLs redirect to the relevant mail tool. The duplicated HR/job dashboard and professional-contact panel were removed. Optional page modules load lazily instead of loading all tools with Jobs.

## Public and inferred work contacts

The free crawler now recognizes explicit software-engineer/developer titles as well as recruiting/hiring titles. Structured Person records must name a professional role and explicitly associate with the employer domain. A named work address published in that structured source is retained with its source URL. A missing address can be inferred only when at least two independently named published work addresses establish the same convention (first.last, first_last, firstlast, first-initial+last, or first). One candidate per person is generated, deduplicated and labelled inferred_unverified. No LinkedIn automation, private-address harvesting, scraped email lists or paid-provider requests are introduced.

Patterns are hypotheses. Current employment is not independently verified from publication alone. Main-sheet rows show guessed/unverified or published-source labels and contact kind. Mailbox verification and salary qualification are never fabricated.

## Direct main-sheet writes

POST /api/professional-discovery/import accepts1–100 owned staged lead IDs. It checks existing owner/company blocks, confirmed-invalid evidence, syntax, freshness, and duplicate history. DNS MX/null-MX and one bounded SMTP EHLO/QUIT server check per domain precede import. No MAIL FROM, RCPT TO, test message or guessed-mailbox enumeration occurs. TCP/SMTP connectivity cannot prove an individual address exists; unreachable/temporary responses remain inconclusive. Null MX is excluded; inconclusive DNS is staged without calling the mailbox invalid. SMTP-only inconclusiveness can remain an unverified research address when the mail route exists.

New contacts stay deliverabilityStatus=unverified, inferenceFlag reflects guesses, and provenance/pattern evidence is retained. Existing contacts/history are not replaced; safe contact-kind/transport metadata can be updated. Persistent suppressions and trusted-invalid results prevent re-import. If the existing CONTACT_ADMISSION_ENABLED gate is enabled, its normal proof/staging flow is respected rather than bypassed. Marked imported leads can be excluded from subsequent import batches. Source candidates and old ledgers are retained.

Manual Find & add in Mails uses the existing free discovery budget and no paid APIs. CareerWatchConfig.autoImportContacts defaults false; enable it only for an owner who requested automatic main-sheet additions. Existing primary owner midhakhushal5@gmail.com explicitly requested this behavior on22November2026. Set only that owner's flag during audited activation. Job/SMTP sending flags and approved email queues are unchanged. Stopping monitoring/research still stops background work; auto-import is also owner-controlled through the career-watch config API. SMTP/DNS import probes are bounded separately from HTTP requests; they consume no paid credits and honour the existing research stop policy.

## Tests and rollback

Tests cover main-sheet ownership, idempotency, preserved notes/history/blocks, null MX and temporary failures, unreachable SMTP without valid-mailbox claims, proof-gate preservation, structured person/pattern evidence and real Chromium import/filter/guessed labels. Full regression and legacy-URL/mobile tests verify retained scheduling and controls. No real messages are sent in tests.

Rollback: disable only the affected owner's autoImportContacts flag; revert this feature commit if UI rollback is required. Imported contacts remain user data and must not be deleted automatically. Additive contactKind/pattern/import timestamps can remain. Retain suppression and delivery ledgers. No infrastructure or paid resources are provisioned.

## Public corporate open-source contacts

A bounded free [GitHub public commits API](https://docs.github.com/en/rest/commits/commits#list-commits) adapter uses reviewed employer-owned repository mappings (Juspay/Hyperswitch, Supabase, Grafana, Razorpay SDK). It checks at most30 recent commits per company, keeps corporate-domain author addresses within90days and excludes personal/noreply/bot addresses. Published corporate authors are labelled engineering contributors with **employment unverified**; contributing is not proof of an SDE job title, current employment, India location or mailbox validity. No private token, authenticated scraping or LinkedIn is involved. Website robots rules are unchanged; documented public API requests count toward the same free HTTP reservation and stop on API failure/rate limits. Current reviewed mappings and employer evidence URLs are in corporateRepositoryDiscovery.js. Mappings are not generated from company names.

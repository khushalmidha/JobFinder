# Acceptance report — 6 November 2026

Status: implemented and locally verified **first end-to-end research/draft slice**, suitable for draft review. This is not a claim that the entire master-prompt roadmap or real-world data research is complete.

Baseline main: `d900c61f66880a607ec0dcd1325917741b8dd0f4`. Branch `feat/research-outreach-os-20261105`. PR #1 remains an older, conflicting draft and was not merged. Source changes are in the original workspace; publishing uses the clean checkout outside OneDrive described in MIGRATION_NOTES.md. Original .git is untouched.

## Verified functionality

- Shared extension engine is both tested and bundled through Vite. Explicit preview → fill → verification; reviewed/versioned local profile; exact native selects, native radio groups, supported ARIA radio/dropdown controls, accessible frames/open shadow roots. Prefilled/manual values persist; hidden steps, sensitive/legal/unknown questions and PDF uploads require review/manual action. URL triggers, duplicate popup autofill and generated resume TXT upload are removed.
- Actual built MV3 extension ran in Playwright Chromium against a synthetic local form. Two fields filled; prior dropdown selection, salary and consent stayed untouched. Adversarial option handlers attempted both form.submit() and requestSubmit(); MAIN-world guard blocked both. **Submission requests=0**. Original form methods are restored after fill. A site can autosave on input/change or use custom network logic; this test does not establish universal no-network behavior.
- Salary evidence is additive, dated and source-backed; classification computes on read. Strict annual INR fixed-base lower bound >1,500,000; CTC/stock/bonus do not qualify. Stale/future/missing evidence, unestablished India eligibility, wrong role/level/experience and estimates cannot become verified qualified employers.
- Public contact discovery checks bounded employer pages/robots with pinned public IPv4 DNS, no redirects, timeouts and response-size caps. Only recruiting inboxes are extracted. Inferred names/registry contacts no longer inflate discovery. Domain/MX capability remains distinct from individual mailbox verification. Invalid/catch-all vendor statuses stay blocked.
- Hunter Domain Search/Finder/Verifier and Apollo discovery/enrichment adapters have fixture tests and shared budget gates. Apollo search does not pretend to retrieve emails. Paid-provider defaults=off, monthly credits=0. No live credential/provider retrieval was tested.
- Persistent per-user request/credit reservations passed concurrent MongoDB tests. Shared scout enforces budget/stop for both new and legacy routes. Queue deduplication, atomic lease ownership, expired lease recovery, bounded retries/backoff and stored results were exercised with real temporary MongoDB.
- Authenticated research API and React dashboard completed company → cited salary evidence → linked opening → owned sourced contact → grounded editable draft → reviewed save. Cross-user contact/draft requests were rejected/isolated. Draft creation/review never sends. **MailLog count=0** in API and browser roundtrips.
- Actual independent Astra review ran; six findings were addressed and documented. Antigravity task prompts were prepared; Antigravity was not launched.

## Actual validation

| Command | Result |
|---|---|
| backend: `npm test` | Exit 0; 31 passed, 0 failed automated unit/DOM/MongoDB/API checks |
| extension: `npm run build` | Exit 0; manifest references compiled shared-engine content asset, all_frames=false |
| web: `VITE_API_URL=/api npm run build` | Exit 0; existing bundle-size warning remains |
| backend: `npm run test:browser` | Exit 0; real Chromium MV3 extension and dashboard UI roundtrips passed on synthetic fixtures |
| extension/web: `npm run lint` | Exit 0 with existing warnings; no lint errors |
| production dependency audit | After compatible fixes/Nodemailer update: 0 critical, 5 high advisories remain in legacy IMAP/SheetJS chains |

Initial regression runs failed dropdown selection due to filtering type=button comboboxes; fixed and retested. Initial dashboard browser runs failed because an existing local VITE_API_URL override pointed outside the fixture server; rebuilt with explicit /api and isolated all external network requests. Those failures are not reported as successful live tests.

Evidence screenshots, all synthetic, are generated locally at `artifacts/form-browser-smoke.png` and `artifacts/research-browser-smoke.png`. They are intentionally not committed as candidate/employer data. Browser test uses temporary local MongoDB and closes its browser/server/database in finally.

## Actual data/cost results

- Existing seeds canonicalized: **185 research prospects** (191 name records before domain deduplication). Existing production DB duplicates were not migrated.
- Newly qualified real employers imported: **0**. Public source ledger contains research leads, not fabricated eligibility. Primary placement material separates some base pay, but exact SWE role/location evidence still needs corroboration.
- Newly sourced real recruiter mailboxes collected: **0**. Test contacts/employers are synthetic and live only in temporary databases. No fabricated names or inferred pattern addresses were inserted as verified research.
- Applications submitted=0; outreach sent=0; paid provider requests=0; AWS provisioning/deployment=0. No production database connected or modified during implementation. Local compute/network/test-tool downloads were used.

## Remaining scope and release blockers

Real salary/company research, licensed live provider verification and manual live Workday/Google Forms QA need independent evidence. Antigravity research/QA prompts and the updated Codex master prompt provide those handoffs. No claim of 50/250 verified employers or universal form compatibility is made.

The existing bulk composer is blocked by the new exact recipient/content approval contract until its approval UX/idempotency is implemented; keep OUTREACH_SENDING_ENABLED=false. No automatic follow-up/reply-aware CRM workflow or full RecruiterGraph visualization is shipped; current links/scoring form its first slice. Existing jobs may be stale; a stored posting is not proof it remains open. Company research/source indexing is not automatically exhaustive.

Five high production dependency advisories remain (imap, imap-simple, utf7, semver, xlsx). A tested IMAP/SheetJS migration is required before deployment; forcing broad npm downgrades would not establish compatibility. Legacy webhook authentication, access approval links, tenant-level application statuses, import hardening and TLS paths need further security work. This stays a draft and is not deployed.

Runtime host was Node 24.11; package engines require 24.15+ because current jsdom dependencies specify that minimum. Tests passed locally with warnings. CI targets Node 24; CI results must be read from GitHub rather than assumed from local checks.

Final Astra follow-up on 6 November: no new high/critical findings in submission guards/concurrency, queue leases/retries, provider reservation/status handling and research-route ownership. Reviewer independently ran 15 DOM/public-discovery tests, all passed; Chromium/MongoDB results were not independently rerun by Astra. A duplicate concurrent fill request is rejected in the final Chromium test, keeping the submission guard active for the original fill.

Publication: [draft PR #2](https://github.com/khushalmidha/JobFinder/pull/2) was created from the review branch and is mergeable without conflicts. Its existing Vercel integration automatically reported a successful preview after publication; this was not an AWS provisioning/deployment action. No production merge or deployment workflow dispatch was performed. GitHub CI was running when this publication note was written; consult the actual PR checks for the final result.

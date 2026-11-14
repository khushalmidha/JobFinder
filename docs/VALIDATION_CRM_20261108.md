# CRM and delivery security validation — 8 November 2026

Branch: `feat/outreach-crm-security-20261108`, based on company-import commit `2e06e43785e97ddac525f070ab9628679588e83d` (PR #6). This release is prepared for review, not deployed or merged into main.

## Actual checks

- Backend `npm test`: **101/101 passed**, zero failed/skipped. Includes 12 new CRM/security tests against real temporary MongoDB and the previous 89 tests for imports, transactional rollback, authentication, account verification, scheduler, research and forms.
- Focused CRM/security/campaign regression: **27/27 passed** after adding persistent recipient suppression.
- Web `npm run build` and `npm run lint`: passed. Existing unrelated lint warnings and approximately 1.54 MB bundle warning remain.
- Extension build/lint: passed, existing warnings remain.
- `npm run test:browser`: passed in actual Chromium with the packaged MV3 extension and temporary MongoDB. Covers existing preview/fill/no-submit, research drafts, scheduled campaigns, timezone/fake-clock/restart/control/unknown-outcome reconciliation, 733-row import preview, trusted account verification with a fake sender, plus the new CRM reminder/reload/draft/reply/confirmed-opt-out/RecruiterGraph/390px flow.
- Browser testing exposed two ambiguous accessible labels on the new contact selector/reviewed textarea. Explicit accessible labels were added and the suite rerun successfully.
- `git diff --check` and changed controller/service syntax checks passed.

Tests used the existing local MongoDB test binary via `MONGOMS_SYSTEM_BINARY`, not the production database or environment file. Host Node is 24.11.0 and emits engine warnings; declared deployment requirement remains Node >=24.15.0. GitHub's Node 24 CI validates the pushed change separately. Prior PR #6 CI succeeded: run `42404375765`; that prior run is not claimed as CI for this release.

## Safety results

New tests verify disabled/unsigned/altered/stale webhook rejection, exact owner/message/recipient mapping, replay idempotency, mismatched/ambiguous history rejection, partial-event fail-closed handling, preservation of earlier suppression/reply labels and other-owner isolation. Temporary/quota/policy statuses never invalidate recipients. Structured DSN extraction ignores arbitrary body addresses. IMAP configuration verifies TLS, maps real Gmail mailbox endpoints, pins public IPs and rejects private or unsupported endpoints.

CRM tests verify owner-only access, time/content validation, stale revision protection, current duplicate-address suppression checks, reply cancellation, explicit opt-out confirmation, retained history and graph identity/privacy. The suppression ledger survives deletion/recreation of a contact and is consulted by scheduled dispatch policy.

No real recruiter/verification/access-notification email, real SMTP/IMAP provider session, paid enrichment request, cloud provisioning, production write or new live import was performed in this release. Existing 733-row live import completion remains recorded separately in `IMPORT_733_COMPLETED_20261108.md`.

## Remaining limits and operator work

1. PR #5, PR #6 and this stacked draft require review/merge/deployment. They have not been automatically merged or deployed.
2. Trusted account-verification sender configuration, genuine owner verification and any audited app-admin promotion remain separate. No role/verification bypass was added.
3. Real mailing needs deliberately configured sender/always-on worker and an explicitly approved exact campaign. This release does not enable those settings or provision hosting.
4. Reminders are persistent drafts and manual reminders, not automated follow-up sends or background authenticated reply synchronization. Existing duplicate-send history protection remains in force.
5. RecruiterGraph links stored company/contact/role/public-inbox records; alumni/referral discovery is not implemented. Stored roles can be stale.
6. The supplied 733 rows are research prospects, not 733 verified >15 LPA fixed-base offers or confirmed mailboxes. Eight exact public recruiting inbox leads were previously imported; additional salary/contact research remains bounded and source-reviewed.
7. Real Workday/Google Forms and other changing employer forms need site-specific QA. Local fixtures and synthetic tests do not establish universal compatibility. Cross-origin frames/uploads can require manual action.
8. Delivery webhook activation needs a trusted provider-specific normalization adapter; this release implements the signed JobFinder protocol. Read-only inbox DSNs never authorize permanent invalidation by themselves.

A delegated security agent hit its usage limit before producing changes; Codex completed the implementation directly. No new independent Astra sign-off is claimed. The two new Antigravity research/QA prompts are prepared under `docs/delegation/ANTIGRAVITY_NEXT_*_20261108.md`; they were not executed through an Antigravity integration.

Migration/rollback and exact security protocol: `OUTREACH_CRM_AND_MAIL_SECURITY.md`.

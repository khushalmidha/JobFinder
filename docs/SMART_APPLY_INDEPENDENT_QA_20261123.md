# Reviewed Smart Apply independent QA — 23 November 2026

Source handoff: Antigravity branch `qa/smart-apply-independent-20261123`, commit `86800427875b676a1a7b32e66270717be812542c`, based on PR #32 at `8f840ae`. Codex reviewed the two-file diff and integrated the synthetic test suite selectively. This document supersedes the handoff's unqualified real-site and certification claims.

## Confirmed findings and corrections

1. A label wrapping a select included all option text in the question. The shared resolver now reads each label/ARIA reference with a read-only tree walker that excludes control content. It does not change the actual page DOM or clone/run custom-element constructors. Option labels remain available separately. An exact approved answer remains recallable; textarea values and dynamic popup choices cannot contaminate question identity. Existing bank entries saved under the old polluted question need a fresh preview and reapproval; no automatic answer-key migration is performed.
2. `Select degree` was incorrectly preserved as an existing selection. Empty prompts now match explicit placeholder metadata, existing generic prompts or the field's own label (degree, gender, source and similar). The implementation deliberately rejects the proposed unrestricted arbitrary-noun regex: real selections such as `Select Health` must remain preserved. Explicit values and enabled real options take precedence over prompt-like wording. ASCII dots and Unicode ellipses are supported.
3. Navigation after filling remains blocked until explicit `releaseForManualReview()`. This is intentional. The HTTP write/navigation guard was not weakened. Review/manual release behavior remains documented in `SMART_APPLY.md`.

The supplied reproduction tests initially asserted the bugs as expected behavior. They now assert the corrected behavior, and widget counts are assertions rather than console-only output.

## What the tests actually exercise

| Evidence | Coverage |
|---|---|
| Independent suite: eight tests | Canonical normalization; non-mutating preview/explicit fill; kill switch/session stop; exact approved answer with changed URL/type/options rejection; legal/upload/OTP controls untouched; synthetic widget matrix; two corrected regressions plus a Chromium end-to-end regression |
| Synthetic matrix | Native select, input-event synchronization (not the React library), radio group, Workday-style popup button, shadow root and same-host frame; exactly 5 verified, 2 preserved, 0 failed fills, 0 submissions |
| Existing boundary suite | Delayed portal/typeahead, frame exclusion, private-profile boundary, unsafe clicks, cross-form radios, duplicate select values, delayed HTTP writes and failed-query recovery |
| Packaged-extension browser smoke | Built MV3 content script and submission guards; actual JSON file import, mandatory review, canonical save and edit-triggered invalidation |

No claim is made that a synthetic input listener certifies React, Radix or Workday itself. The independent matrix does not contain the delayed input combobox claimed in the handoff; that remains covered separately in existing tests. The handoff's per-file counts were inconsistent with its base commit; use the executable test runner's actual totals.

## Real-site evidence status

**No real ATS posting is accepted as end-to-end verified by this handoff.** Lever, Ashby and Workday entries used literal `...` instead of complete job URLs. The three numeric Greenhouse URLs had no attached redacted page/trace, access-policy record or run artifact; a read-only recheck through the web tool could not access them. An inaccessible lookup does not establish whether a job is open, closed, or crawl-permitted.

The Google Forms row was synthetic, not a user-owned live test form. Public accessibility alone is not automation permission. Real-site acceptance still requires complete current URLs, dated public inspection evidence, permitted access, reviewed applicant facts, zero submission, and an actual per-field report. There were no automated logins or real application fills during this Codex integration.

## Verification and production boundary

All new fixtures use synthetic identities and localhost. No resume, cookies, live credentials or personal profile data are added to Git. No production database, sending flags or queues are modified. A fixture setting a flag to false is not evidence of the current production flag value; this report makes no such assertion.

Commands: `node --test tests/smartApply*.test.js tests/formAssistant.test.js`, normal full backend tests, extension build/lint, and `npm run test:browser`. Final exact counts and CI status are recorded in PR #32. Remaining real ATS adapters, repeated sections, resume variants and other acceptance work are tracked in `SMART_APPLY_PHASE0.md`.

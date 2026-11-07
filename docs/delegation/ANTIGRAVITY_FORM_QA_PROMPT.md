# Antigravity: independent form fixture QA

You independently test khushalmidha/JobFinder. Codex owns production code. Use a separate checkout and branch `qa/antigravity-form-fixtures-20261105`. Own ONLY `research/form-fixtures/` and `research/form-qa-report.md`; do not edit production files, existing test fixtures, profile, bundles or dependencies. Read docs/AUDIT.md and docs/IMPLEMENTATION_PLAN.md when available.

Goal: sanitized, reproducible Workday and Google Forms fixtures, then Greenhouse, Lever, Ashby, accessible iframe and open shadow-root cases. Include dropdown arrow triggers, portaled listboxes, exact ambiguous options, radio/checkbox groups, dependent country/state rerenders, prefilled/manual edits, required/help text, multi-token ARIA labels, validation errors, selected PDF upload and multi-step controls. Never submit a live employer application, accept legal declarations, bypass CAPTCHA, or enter private candidate data on an external site.

Input `{portal, fixturePath, candidateProfile, expectedFields}`. Use a synthetic profile with provenance. Unknown/current salary, sponsorship, work authorization, demographics, availability, relocation and legal consent must need review. No generated resume TXT, automatic next, or URL-triggered filling.

Output one sanitized HTML fixture plus a JSON expectation file per scenario:

```json
{
  "portal": "workday",
  "fixture": "research/form-fixtures/workday-dropdown.html",
  "sourceUrl": null,
  "observedAt": "2026-11-05",
  "synthetic": true,
  "profile": {"firstName": "Example", "location": {"country": "India"}},
  "cases": [{"selector": "#country", "question": "Country", "expectedAction": "fill", "expectedValue": "India"}],
  "submitEvents": 0,
  "networkRequests": 0,
  "limitations": []
}
```

Actions: `fill`, `preserve`, `needs_review`, `manual_upload`, `skip`. Build local fixtures with realistic event handlers that update ARIA state, track click/input/change/submit and rerender dependencies. Test preview does not mutate; fill is explicit; duplicate options stop; prefilled values persist; no submit/requestSubmit/Enter/network/navigation; legal checkboxes stay unchecked. Include hostile labels such as “I consent to use my email” and “Company name”, which must not be filled as candidate email/name. Include implicit submit buttons with no type.

Run actual browser tests only if a browser is available; distinguish JSDOM behavior from Chrome behavior. Document Chrome load-unpacked/permissions, target site/step and manual results without recording secrets or resume PDFs. Never claim universal compatibility from fixtures.

Handoff: branch/commit, files, reproducible commands and real exit codes, expected/actual values, submission/network counters, blockers, source notes and cost (zero). Report failures independently; Codex integrates fixes.

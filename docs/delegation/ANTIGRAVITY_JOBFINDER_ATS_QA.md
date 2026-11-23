# Antigravity task for JobFinder live ATS and Sheet QA

Use a separate worktree based on the current branch of PR #33. Focus on evidence and reproducible fixtures. Codex owns schema, delivery and production integration.

## Job application adapters

1. Find an active official India junior SWE or internship posting on each of Workday, Greenhouse and Lever. Record the full URL, tenant, inspection date, access permissions and control types. Owner-provided test environments take priority. Create an owned Google Form with a dropdown, radio group, required unfamiliar question and two sections.
2. Inspect public pages where permitted. Run field interactions only in an authorized test tenant, an owned test form or a local reproduction. Use a synthetic candidate and a disposable browser profile. Keep login, CAPTCHA and final submission interactive. Avoid live POSTs, uploaded resumes, provider credits, outreach and production data changes.
3. Reproduce a Workday-style country → state change, delayed associated listbox and stale step; a Google Forms-style select-only combobox and grouped radios; and application iframe cases for Greenhouse and Lever. Include a React-controlled dropdown that replaces its element on selection. Assert the value survives blur and rerender, and assert that duplicate labels, stale answers and unknown required questions request manual review. Assert zero submit requests.
4. Test the packaged MV3 extension and the local runner separately. Mark each row observed live, verified in owned sandbox, reproduced locally, inaccessible or unsupported. Attach a redacted screenshot or test artifact for each claimed result. Preserve the existing manual boundaries and exact answer binding when proposing a fix.

## Sheets sandbox

Use an authorized disposable sheet whose ID and tab the owner confirmed. Use the documented A:G contact headers and a fictional sourced company contact. Preview, approve and record the provider response range. Repeat and count one contact row. Simulate lost acknowledgement with the mock service and confirm a row that remains absent keeps the pending lock. If no authorized Sheet is available, deliver mock evidence and mark live append pending.

## Deliverable

Return the branch, commit, exact commands, pass/fail counts, a platform evidence table and reproducible failures. Include only reviewed fixture or adapter changes. If you find a job feed that supplies explicit closed or reopened status, record its documented semantics and a sanitized fixture. A timeout, partial listing or a missing requisition on a truncated page provides insufficient closure evidence.

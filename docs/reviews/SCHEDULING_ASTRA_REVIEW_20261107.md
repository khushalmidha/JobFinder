# Actual Astra review: scheduled outreach and import

An actual `gpt-6-astra` agent performed independent read-only source review on 7 November 2026. It did not access live credentials, run SMTP, mutate production data or run the test suite. These notes summarize its returned findings; they do not attribute Codex test execution to Astra.

First pass found: a torn unknown-outcome/campaign update could allow later sends; an expired lease holder could proceed without checking final ownership; concurrent edit cleanup could cancel a newly approved revision; sender display name was not frozen; and uncertain-outcome reconciliation had no UI.

Codex added independent recovery from already-unknown dispatches and a conservative shared-lane hold, a final unexpired token fence that fails closed, revision-scoped cleanup, frozen sender display identity, and explicit reconciliation controls. Regression tests exercise torn-state recovery, elapsed lease fencing, sender changes and acknowledged outcome recording. Astra's second pass confirmed all five mechanisms are present, without independently executing tests.

The second pass found importer crash/rollback lock recovery, rollback write races and official evidence incorrectly attachable to another employer. Codex added explicit audited operator-only recovery of stale owned runs, active-state checks during mutations and rollback error cleanup, atomic updatedAt/content-hash checks with matched counts, and strict known employer/address/page binding with conflict quarantine. Rollback now archives eligible newly imported employer identities while preserving IDs instead of deleting them, avoiding reference races. Regression tests exercise recovery, concurrent manual changes and wrong-employer source attachment.

SMTP still cannot guarantee exactly-once provider delivery. A persisted boundary and unknown-outcome hold are conservative protections; operator/provider reconciliation is required after ambiguous external outcomes. Runtime lease recovery does not fabricate a provider delivery assertion. Administrator email verification remains an unmet live prerequisite, not an inferred fact.

A final focused Astra pass verified all three importer fix mechanisms and found no additional material defect in that scope. It noted that operator recovery depends on actually stopping importer processes, and incomplete journal entries remain conflicts for manual inspection. This was read-only source verification.

After the focused review, Codex added an owner-confirmed lead-to-contact route for fresh official listings. A new integration regression test verifies that it never clears existing suppression or sends mail; Astra did not independently review that later small bridge.

# Codex review of PR12 at c49aae3

Independent focused validation: tests/immediateCampaigns.test.js plus tests/campaigns.test.js passed24/24 in a clean detached worktree with temporary MongoDB and fake providers. Retention remains separate. No real sending, production changes, merge or deployment occurred. The reported full110-test run and frontend build are supplied results; this focused review does not certify a newly executed full/browser run.

Required corrections before merging:

1. Exact approval UI is incomplete. ComposePanel renders only snapshot.recipients[0] subject/body, no complete eligible recipient address list. Yet checkbox claims all exact recipients/messages were reviewed. Show every frozen eligible email, company, personalized subject and body via bounded pagination/expandable rows or equivalent complete review. Do not reconstruct messages from mutable editor values. Show actual interval and disabled sending/worker status; immediate means next worker poll subject to shared cooldown, not an instant SMTP guarantee. Preserve existing explicit digest-bound approval.

2. Reproduced template corruption. String.replace(regex, company/userString) interprets replacement tokens. Input company="Acme $&" renders "Hello Acme {{companyName}}"; "Acme $'" duplicates trailing template text; "Acme $$ Corp" loses a dollar. Use a single-pass placeholder resolver with callback replacements so supplied values remain literal and are not recursively substituted by subsequent replacements. Test $&, $`, $', $$ and values containing {{otherPlaceholder}}, normal multiline user text and unknown placeholders. Do not invent resume/profile facts.

3. Brevo selection misrepresents transport. ComposePanel still offers "Brevo API / Cloud Delivery via HTTPS". With useBrevoDirect it omits smtpId, so previewImmediate can fall back to the selected/first saved SMTP account; explicit brevo ID is not supported by resolveSender. Hide/disable this option for this SMTP-only feature and explain provider support, or implement a separately reviewed adapter. An explicitly chosen provider must never silently fall back to another sender/transport. Add an API regression and browser case.

4. Account for every selected contact. previewImmediate silently continues for missing/non-owned IDs instead of reporting a generic exclusion. Show unavailable contact IDs as excluded without leaking another owner's contact data. Test selected=eligible+excluded, mixed ownership/deleted contacts and duplicates.

5. Dashboard resume uses resumedCount++ regardless of updateOne.modifiedCount and always isPaused:false. A cancelled or changed campaign racing the CAS can be reported resumed without an update, and skipped invalid paused campaigns remain paused. Count successful CAS writes, derive actual resulting state and reuse controlCampaign where feasible. Test revision/cancel races and mixed eligible/invalid paused campaigns.

Add actual Chromium Compose tests: multiple personalized recipients (including the second recipient), exclusions, selected sender, disabled flags, edit/re-preview, checkbox/digest approval, changed contacts before approval and no outbound provider call. Keep real sending/worker off and fake transport only.

Push corrections to the PR12 branch and provide exact commit/test evidence. Do not mix PR11 retention, merge main, deploy or enable real sending. Codex will independently verify the corrected flow.

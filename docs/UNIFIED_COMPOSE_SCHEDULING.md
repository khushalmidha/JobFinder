# Unified ColdMail compose and scheduling

Contacts → select recipients → Send opens one message editor for both delivery modes. **Send now** is selected by default. **Schedule for later** reveals date, time and an IANA timezone, initially the browser's timezone. Sender, templates, personalized messages, exclusions and timing are reviewed together before explicit approval.

The existing `POST /api/mail/preview` accepts `mode: immediate` (also the default when omitted) or `mode: scheduled` with `localDateTime` and `timezone`. Immediate mode ignores inactive schedule inputs. Scheduled mode uses the existing timezone conversion and durable campaign service: missing/invalid dates, past starts, schedules beyond a year and ambiguous/nonexistent DST times reject without queueing. Both modes use `POST /api/mail/send` with the saved campaign ID and exact digest. Editing timing clears client approval; the server also binds timing to the digest and rejects stale or elapsed schedules.

The approval screen displays frozen local time, timezone and UTC start for scheduled campaigns. Immediate approval joins the next available worker cycle; scheduled approval preserves the future `nextAt`. The same worker enforces suppression, mailbox proof, sender ownership, cooldown, daily limits, missed-start review and unknown-outcome protection. Neither approval nor choosing Send now enables global delivery gates. A paused delivery configuration is shown before approval and in the saved-queue confirmation.

**Outreach Queue** manages both modes. The old advanced editor is collapsed by default and remains available for editing existing drafts and compatibility. Pause, resume, cancel and reconciliation remain unchanged. Existing `/campaigns` links still work.

## Deployment and rollback

No database migration is needed: existing campaign snapshots, dispatches, timezone/start fields and indexes support both modes. Existing clients that omit mode retain immediate behavior. Deploy through normal CI; no email is sent by development tests or deployment. Sending gates, 450 daily cap and current production configuration stay unchanged. Rollback to the previous tested SHA restores the earlier UI while preserving approved campaigns and durable dispatches; never delete queue or suppression records as part of rollback.

## Validation

Integration tests cover default immediate mode, exact timezone conversion, dormant-before-due behavior, simulated dispatch at the scheduled instant, invalid/past/DST schedules, digest invalidation and approval after elapsed start. Actual Chromium tests create both immediate and scheduled campaigns through Contacts → Send, inspect frozen recipient messages, change the date and re-preview, verify explicit approval and reload persistence, and assert zero real delivery. Existing campaign-management browser scenarios continue through the advanced editor.

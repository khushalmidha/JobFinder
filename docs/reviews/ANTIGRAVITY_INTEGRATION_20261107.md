# Antigravity handoff integration and remaining activation steps

Research commit `7caed4c01c33f1b05fbbc82379d337f081e2b4ce` changes two research files. QA commit `c97bea6793661f313d36e1059d4cc12e5e652ade` changes one Markdown report. They contain no new scheduler implementation, production identity merge or database import. The original commits remain preserved on their own branches. This integration stores reviewed corrections instead of importing their unsupported assertions.

## Salary and identity corrections

All original thirteen India salary leads are covered, plus CRED and Zeta. However the two purported qualified employers fail source review:

- [VCE 2023–24](https://www.vce.ac.in/placements/2023-2024.php), dated 2 January 2025, lists Google Basic 23.73 LPA. Exact entry role, experience, job location and the claimed 25 LPA upper bound are not established.
- [VCE 2024–25](https://www.vce.ac.in/placements/2024-2025.php), dated 8 July 2025, lists an Amazon SDE offer with base 19.67 LPA. Bonuses/RSUs are separate and the 47.50 LPA offer is another row. SDE-1, specific cities, experience and a 21 LPA upper bound are not established.
- The cited [VCE 2025–26 report](https://www.vce.ac.in/placements/2025-2026.php), dated 25 May 2026, does not contain either employer row. Reusing its date made stale evidence appear current. Both correct sources exceed the 365-day freshness limit on 7 November 2026.

All eleven estimated salary ranges conflict between the handoff JSON and Markdown. Their claimed 5 November 2026 source dates lack source-specific publication evidence. The community placement dataset has different or empty base cells for several cited employers. No range is selected merely because it exceeds the target. Submitted claims are retained as untrusted history, outside approved salary evidence. Reviewed historical Google/Amazon evidence has corrected dates/sources, point values and unknown unsupported fields.

`docs/research/REVIEWED_COMPANY_HANDOFF_20261107.json` contains fifteen `research_needed` assessments and zero qualified employers. CRED's official terms support its association with Dreamplug Technologies, but production records were not merged. Zeta terms support its Better World Technology association; a blank-domain Zeta Tech source row still needs row-level provenance before alias consolidation. Existing IDs and histories are preserved.

## Inbox and QA corrections

Eight of ten submitted inboxes were observed on official public pages: the original seven plus Zeta at its canonical India careers URL. CRED/Tower publication remains unconfirmed. Google/Amazon/Microsoft company-level “official” inbox assertions also lack publication evidence. The Markdown report misstates Intellicar, Lexi and SCREL domains and a Tower address. These literals are not imported. Every reviewed contact remains mailbox-unverified and not approved for sending.

The reviewed inbox file and [detailed inbox/QA review](AG_INBOX_QA_REVIEW_20261107.md) preserve exact sources and uncertainties. A separate one-row Zeta incremental source is prepared for a future admin preview/apply; the original 733-row/seven-inbox source is unchanged. Source allowlisting binds the additional address to Zeta and its exact official URL; it does not merge Zeta Tech or grant salary qualification.

The QA handoff describes existing tests. Its precise durations are reported claims, not authenticated raw logs. The source-only review corrected claims about competing workers (`busy` versus `cooldown`), ordinary edits versus direct dispatch tampering, seventy-one individual tests versus suites, synthetic forms versus live Workday/Google Forms, process persistence versus an actual OS restart, and preview journals versus zero database writes. Fresh integration test results are reported separately; no delegated execution is fabricated.

## Additional implementation

The remaining admin prerequisite now has an actual Settings verification flow, using a separately configured trusted server sender. Delivery defaults off and is never triggered by development/tests. Codes expire, are one-use, rate-limited and HMAC-hashed; HTTP exposes neither code nor sender credentials. Verification leaves the role unchanged, and the administrator CLI requires a matching trusted challenge proof. See [account verification operation and rollback](../ACCOUNT_EMAIL_VERIFICATION.md).

Actual Astra read-only review identified Mongoose timestamp interference with stale-challenge recovery, a missing nested challenge field and an overly broad proof issuer/method contract. These were corrected with an operation timestamp, proper nested proof schema and trusted issuer/challenge binding; A final resend race was corrected with terminal consumed challenges and permanent consumption receipts bound to promotion proof. Actual Mongo interleaving tests cover both completed verification and delayed confirmation after a resend; focused Astra source review found no remaining material blocker in that scope. Astra did not run the tests or access live credentials/database.

Live activation still requires real trusted sender configuration, genuine owner verification, audited administrator promotion, a fresh company import preview, and the owner's final import approval. No company/contact imports, identity merges, real emails, paid enrichment, AWS provisioning or automatic main merge are performed by this integration.

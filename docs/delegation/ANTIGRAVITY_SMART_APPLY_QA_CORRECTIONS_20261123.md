# Smart Apply QA evidence corrections

The synthetic QA work from `8680042` has been reviewed. The wrapping-select label and `Select degree` bugs are fixed in PR #32. Do not repeat those old bug-expecting assertions; update from the latest PR head before any further QA.

Next independent task: repair only the real-site evidence gap. Do not change production flags, import contacts, send emails, spend credits, submit applications or automate login/LinkedIn/CAPTCHA/OTP. Do not use the user's private resume/profile until the user has actually reviewed it. Public access is not by itself automation permission.

1. Supply complete, current posting URLs for three postings each on Greenhouse, Lever, Ashby and Workday. Prioritise India/new-grad/2027/six-month internship roles; label any examples outside these criteria. Never use `...` URLs or infer that an old numeric posting is still active.
2. For each URL record checked time, redirect/final URL, whether a job and form were actually visible, policy/robots evidence where relevant, observed labels/widget kinds, and the precise limit of inspection. An unreachable, closed or login-gated URL is a blocked/incomplete inspection, not a pass.
3. Where permitted, save a small original reproduction plus a redacted screenshot/DOM excerpt and a field report. Exclude cookies, tokens, applicant answers and personal data. If you did not run the fill engine, say 'inspection only'; do not label the adapter tested. Do not fill synthetic candidates into live employer forms.
4. A Google Forms fixture is local synthetic coverage. A live acceptance run needs an explicitly authorised user-owned non-production form and its actual URL, without submitting it.
5. Execute exact commands and derive counts from test-runner output; the prior handoff's per-file counts were inconsistent with its commit. A plain input-event listener is not a React library test. Match claims to the fixture actually present.

Return one concise evidence table with complete URLs, repository artifact paths, exact commit and explicit pass/incomplete/blocked outcomes. No generic platform survey or unsupported certification. Codex will verify evidence before changing acceptance status. Work in an isolated branch; do not merge or deploy.

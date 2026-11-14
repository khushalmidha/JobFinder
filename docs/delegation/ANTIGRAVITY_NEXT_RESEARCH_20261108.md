# Task A: expand source-backed employer and recruiting evidence

Use a separate research branch based on `feat/outreach-crm-security-20261108`. Your previous correction handoff is retained for independent review; do not describe it as an applied migration. Read `docs/IMPORT_733_COMPLETED_20261108.md` and `docs/research/REVIEWED_COMPANY_HANDOFF_20261107.json` first.

The 733 supplied rows are already imported as research prospects. Do not import again, edit production, change authentication or merge branches. Existing history and suppression must remain intact.

Research a new bounded batch: the first 25 India prospects in the supplied staging file without reviewed salary evidence, sorted by company name. Exclude employers already covered by the reviewed handoff. Record the exact source row key and company identity; do not infer aliases from similar names.

For each employer return JSON with:

- Official employer domain and evidence establishing that identity; no job board domain substituted for an employer.
- Exact entry software engineering role, level, experience, India location, recurring annual fixed base in INR, excluding equity, CTC, sign-on and variable bonus.
- Primary public source URL, exact concise excerpt, original source date, checked date and missing fields. Leave unsupported fields null. A recent visit does not make an old offer current.
- Any exact published `careers@`, `jobs@`, `recruitment@`, `recruiting@`, `talent@` or `hr@` inbox. Cite the official page publishing that precise address. Do not generate permutations to meet a count.
- Qualification recommendation, uncertainty and `requiresCodexReview: true`. Strictly greater than INR 1,500,000 fixed base is the threshold. No company is qualified without every required evidence field.

Allow at most 5 public page requests per employer, respect robots and stop on blocking. No login scraping, personal/private contact harvesting, SMTP RCPT enumeration, real email sending, paid credits, AWS or continuous unattended runs. SMTP/MX success establishes no mailbox existence. Return not_found/inconclusive honestly.

Deliver source JSON, a short searched/not-found report, branch and commit. Do not modify application code or global data. Codex will verify before integration.

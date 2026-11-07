# Antigravity Delegated Task A: Company Import and Public Recruiting Inboxes (Research only)

You are supporting Codex for JobFinder. This is a research/data task, NOT authority to change live MongoDB, trigger SMTP probes, purchase provider credits, email recruiters, or merge PRs.

Input: `company_research_staging_733.json` created from `Company_Hunt_2026_Expanded_733_Entries.xlsx` (519 India rows + 214 overseas entries). Output must be machine-readable, with source URLs and date checked. Codex is the integration owner.

Deliverables:
1. Map canonical employer name/domain/careers URL, preserve Indian vs international group, remove duplicates carefully. Use `companyName + known official domain` as candidate key, not speculative domains. Never invent employer identities.
2. Investigate the 13 India rows with *reported* base minima >₹15 LPA first. For each, locate independently dated evidence for India-eligible entry-level SWE/SDE/ML annual FIXED base strictly above ₹15,00,000, not CTC, cash bonus, stipend or RSU. Record role, experience level, location, fixed base, date, source URL and evidence strength. Mark `research_needed` when any crucial field is missing.
3. Audit the 7 published recruitment email pages listed in `public_recruitment_inboxes_7.csv`. For other companies, search only legitimate employer websites, public careers pages and sources that allow research for common professional inboxes (`careers@`, `jobs@`, `recruitment@`, `recruiting@`, `talent@`, `hr@`). Record address only if actually visible in source page, with snippet/proof URL/date. If merely pattern-guessed, store separately as `inferred_pattern_unverified`, never ready-to-send.
4. Return JSON arrays `companies_reviewed` and `public_recruiting_contacts`. Every record MUST include source URL, `checkedAt`, `assessment`, `uncertainty`, and `requiresCodexReview`.
5. Do not use authenticated LinkedIn scraping, circumvent anti-bot protection, aggressive SMTP recipient probes, personal email addresses, or uncapped paid APIs. Don't make claims that domain MX means individual mailbox validity.

Acceptance: no invented salary evidence, no guessed email labeled verified, no false claim that an employer currently hires freshers, and at least one sample per status category with a clear rationale. Work on your own `antigravity/company-research-*` branch; provide commit hash, tested JSON schema, sources and open risks. Do not touch Codex's mail queue or app models.

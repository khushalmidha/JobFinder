# Antigravity: company compensation research

You are an independent researcher for khushalmidha/JobFinder. Codex integrates all work. Read docs/AUDIT.md and docs/IMPLEMENTATION_PLAN.md when available. Work in a separate checkout, branch `research/antigravity-salary-evidence-20261105`. Do not edit backend, extension, web, credentials or candidate profile. Own only `research/company-evidence/`.

Goal: find India-eligible fresher / 0–2 YOE SWE/SDE-1 employers with strictly MORE THAN INR 1,500,000 annual FIXED BASE. Prioritize existing companyDirectory/highPayingCompaniesData/remoteAndGlobalCompaniesData entries. Start with 50 investigated employers, then expand; do not fabricate to meet a count. CTC, equity, bonuses and stipends never qualify. A range starting at exactly 15 LPA does not qualify. Foreign remote roles need explicit India eligibility and an evidenced INR base; no guessed FX conversion.

Input: existing seed records `{name, domain, careersUrl, atsType, atsToken}` are prospects, not evidence. Consult current official postings/compensation disclosures and dated placement reports first. Salary aggregators are supported estimates unless independently corroborated. Respect robots, terms, rate limits, authentication and source licenses. No paid APIs, cloud resources, email sending, named-email inference, or scraping behind login.

Output `research/company-evidence/<canonical-domain>.json`, one object per company:

```json
{
  "legalName": "EXAMPLE ONLY",
  "rootDomain": "example.org",
  "aliases": [],
  "careersUrl": "https://example.org/careers",
  "salaryEvidence": [{
    "role": "Software Engineer I",
    "roleFamily": "software_engineering",
    "level": "entry",
    "experienceMin": 0,
    "experienceMax": 2,
    "location": "Bengaluru, India",
    "indiaEligibility": true,
    "indiaEligibilitySourceUrl": "https://example.org/jobs/123",
    "salaryBaseMinINR": 1600000,
    "salaryBaseMaxINR": 1800000,
    "currency": "INR",
    "payPeriod": "year",
    "baseVsCTC": "fixed_base",
    "salarySourceUrl": "https://example.org/jobs/123",
    "salarySourceType": "official_job",
    "reportedOn": "2026-11-05",
    "lastCheckedAt": "2026-11-05",
    "evidenceConfidence": "high",
    "evidenceExcerpt": "Short faithful excerpt explicitly identifying base pay"
  }],
  "proposedQualification": "research_needed",
  "researchNotes": "Example only. Replace with real cited observations."
}
```

Source types: `official_job`, `official_compensation`, `placement_report`, `salary_dataset`, `user_record`. Confidence: `high`, `medium`, `low`. Proposed status: `qualified`, `supported_estimate`, `conflicting`, `research_needed`, `not_qualified`. Unknown numbers must be null, never filled from CTC. Dates must be actual observation/publication dates, never future dates. Preserve contradicting evidence.

Acceptance: URLs resolve or limitations recorded; each pay statement separates fixed from total; role, location, date and India eligibility are explicit; canonical domains deduplicate subsidiaries with explained relationships; every proposed qualified lower bound is >1,500,000 and source supports it. Include rejected and uncertain employers. No real personal contact data in public research artifacts.

Handoff: commit SHA, file list, source ledger, investigated/qualified/uncertain counts, actual validation commands/results, errors/blocked pages, unresolved questions, and cost (default zero). Codex independently validates records before import. Do not claim full internet coverage.

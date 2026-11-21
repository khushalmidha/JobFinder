# Free 20-company pilot: measured results

Executed UTC: 2026-11-21T12:13:03.139Z

Companies attempted: **20**. HTTP requests: **121 / 200** maximum. Emails found: **0**. Mailboxes verified: **0**. Paid/provider credits: **0**. Database writes: **0**.

The 20 companies are selected from the supplied India spreadsheet; salary estimates did not qualify any employer. These are network observations from this machine, not universal claims about what the employers publish. No emails or jobs were fabricated to improve yield.

| Company | Contact requests | Job requests | Emails found | Job postings parsed | Limitation / observation |
| --- | ---: | ---: | ---: | ---: | --- |
| Rippling | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Databricks | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Rubrik | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Atlassian | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Google | 2 | 2 | 0 | 0 | Unsupported redirect target |
| Stripe | 3 | 4 | 0 | 0 | Unsupported redirect target |
| Uber | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Meta | 4 | 4 | 0 | 0 | Response too large |
| Tower Research Capital | 4 | 4 | 0 | 0 | No published professional recruiting contacts found in checked pages |
| Amazon | 4 | 6 | 0 | 0 | Request timeout; Run request limit or stop reached |
| Microsoft | 3 | 3 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| CRED | 2 | 2 | 0 | 0 | No published professional recruiting contacts found in checked pages |
| Apple | 2 | 2 | 0 | 0 | Unsupported redirect target |
| Dream11 | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Sprinklr | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Goldman Sachs | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Meesho | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| PhonePe | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Salesforce | 4 | 2 | 0 | 0 | Robots unavailable: careers/contact URL is not linked from homepage |
| Flipkart | 2 | 2 | 0 | 0 | Request timeout |

All 20 companies yielded zero published recruiting/manager email addresses in the bounded pages. Source categories attempted: official employer pages and official public job descriptions/structured postings. No source category produced an email.

The pilot also parsed zero job postings. Main limits: unavailable robots plus no allowed homepage-linked target, unsupported cross-corporate redirects, JavaScript/unsupported job portals, response-size bounds and request timeouts. This does not mean those companies have no open roles. Smaller fixture tests validate supported ATS and JSON-LD behavior; fixture success is not counted as real discovered jobs.

Next step: repair official portal mappings and add supported adapters, then repeat the same measured pilot. Optional paid-provider shortlist is described in COMPANY_CAREER_WATCH.md and remains disabled pending explicit approval. A bigger input list alone does not establish higher yield.

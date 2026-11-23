# Antigravity handoff for India employer coverage

Use the existing JobFinder company workbook and CareerWatch mapping as inputs. Start with 30 India prospects whose official employer domain or careers portal is missing. Deliver one row per company with its stable prospect key, canonical employer domain, official India careers URL, supporting employer URL, checked date and an evidence excerpt. Where the employer links to an ATS, include the exact tenant and evidence of the link. Keep ambiguous company aliases unresolved.

For each mapped company record any application or recruiting inbox explicitly published by the employer. Include the exact source URL and quoted context so fraud-reporting, support and customer-service inboxes can be separated from recruiting. For a named recruiter, hiring manager or engineer, record a work address only when the employer publishes that exact address next to the role. Names without addresses stay as research leads. Skip inferred addresses, LinkedIn automation, mailbox probes and paid tools.

Return a proposed JSON/CSV and a coverage summary. Keep production data, mail queues and AWS configuration untouched. Codex will validate the evidence, reconcile aliases and import the approved mappings. Mark public salary figures as reported unless they separately prove fixed base for the actual role.

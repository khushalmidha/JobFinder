# JobFinder form filling and email discovery safety

## Form-filling behavior
- Open an application page, then click **Fill Only Current Step** in the extension.
- All supported frames are inspected sequentially. Verified resume fields are filled only when a matching label/option is identified.
- Native text, select, Workday/ARIA combobox, Google Forms radio/checkbox widgets are attempted. Unrecognized widgets remain untouched.
- Existing user entries are preserved. Unsupported, unverified or sensitive questions, consent, signatures, upload fields and legal declarations stay untouched.
- Open-ended questions are drafted through the existing Gemini backend using selected resume data only. They require applicant review.
- **No form submission, Next/Continue navigation, background auto-pilot, or URL-based autofill is performed.** The user must manually review and submit.
- Form filling is not yet verified end-to-end on live Workday or Google Forms; their markup can change.

## Resume truthfulness
- The extension uses the uploaded on-campus resume for name, contact, education, internship and selected projects.
- LinkedIn, portfolio, Codeforces and CodeChef links were aligned to the PDF hyperlinks.
- Previous guesses about address, authorization, gender, salary, relocation and notice period were removed from the autofill profile.
- The CGPA in the uploaded PDF is 8.72. Confirm this against your most recent record before submitting forms.

## Public company email discovery
- Ghost Scout now uses public recruiting addresses actually visible in pages on an explicitly provided or known company domain.
- It checks home, careers, jobs and contact pages; does not traverse to other domains or follow redirects.
- Recruiter names, name-based patterns, role claims and mailbox deliverability are not invented.
- DNS MX merely indicates mail routing. The service never treats MX as proof an individual email exists.
- The backend stores the public source URL in notes, and marks results as publicly listed, not independently validated.

## Validation
- Review/parse checks were performed on modified JavaScript and JSON.
- Pure-function checks exercised evidence extraction, domain filtering, lack of name-inferred emails, and private IP rejection.
- Regression test source exists in `backend/tests/publicEmailDiscovery.test.js`; run it with `node --test backend/tests/publicEmailDiscovery.test.js` at repo root.
- Chrome extension build and real-site form end-to-end tests remain pending. They require a browser environment with extension loaded and authenticated backend.

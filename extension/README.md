# JobFinder application assistant

Build: `npm ci` then `npm run build`. Load `dist` as an unpacked Chrome extension.

Open Application assistant, import your local canonical profile JSON, review and save it, then Preview current step and Fill current step. Unknown answers stay visible; approve and remember an answer only after checking the actual question and options. Next and Submit remain manual. LinkedIn is excluded and OTP/login challenges are manual.

See [Smart Apply setup](../docs/SMART_APPLY.md) for the local persistent-browser runner, answer memory, profile review and limits, and [architecture audit](../docs/SMART_APPLY_PHASE0.md) for tested versus pending ATS coverage.

Do not include your resume, profile, tokens, screenshots or local browser state in a commit.

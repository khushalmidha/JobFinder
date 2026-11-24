# JobFinder application assistant

Build: `npm ci` then `npm run build`. Load `dist` as an unpacked Chrome extension.

Open Application assistant, import your local canonical profile JSON, review and save it, then Preview current step and Fill current step. Unknown answers stay visible; approve and remember an answer only after checking the actual question and options. Next and Submit remain manual. LinkedIn is excluded and OTP/login challenges are manual.

See [Smart Apply setup](../docs/SMART_APPLY.md) for the local persistent-browser runner, answer memory, profile review and limits, and [architecture audit](../docs/SMART_APPLY_PHASE0.md) for tested versus pending ATS coverage.

Do not include your resume, profile, tokens, screenshots or local browser state in a commit.

## AI drafts and answer memory

Smart Apply → AI drafts and submitted answers can use Gemini Flash-Lite, Groq GPT-OSS 20B, or both. Add keys from free-tier projects and enable drafting. The extension first fills known fields, then sends one batch of eligible unresolved professional questions and limited reviewed resume facts. If the selected provider is unavailable and a backup is configured, it tries the backup. AI answers remain drafts until you review the form. Optional fields use the same mapping and drafting workflow as required fields.

A direct manual click on a supported form's final Submit button records eligible answers in browser storage. Application-specific answers stay tied to that form. Standard profile questions such as “Introduce yourself” can be reused on other forms with the exact same question and control. The extension labels reused answers separately and checks current choices before filling. Clear them or turn off learning from the same panel. This captures a browser form event. Acceptance by the employer must be confirmed on their page. Custom submission flows with no native form event may require the explicit remember action.

Reload the unpacked extension from its existing browser listing to keep its storage. Reload open job tabs afterward.

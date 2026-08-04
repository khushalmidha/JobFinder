# ColdMail Pilot

An open-source cold-outreach automation suite for job applications.

## Overview

ColdMail Pilot consists of two connected tools:
1. **Browser Extension**: A quick-capture tool to paste HR/recruiter emails on the fly, group them by company, and fire off a pre-formatted application mail instantly.
2. **Web Dashboard**: The full control center. Bulk-import contacts from Excel/CSV, use Gemini AI to auto-classify and filter them, pick who to mail in bulk, track delivery, and auto-clean bounced addresses.

## Tech Stack
- **Backend**: Node.js, Express, MongoDB, Nodemailer, Gemini AI
- **Web App**: React, Vite, Tailwind CSS
- **Extension**: React, Vite, CRXJS, Manifest V3

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- MongoDB connection string
- Google Gemini API Key
- Gmail App Password (or other SMTP credentials)

### 1. Backend Setup
1. `cd backend`
2. `npm install`
3. Copy `.env.example` to `.env` and fill in the values:
   - `PORT=5000`
   - `MONGODB_URI=your_mongo_connection_string`
   - `JWT_SECRET=generate_a_random_secret_key`
   - `ENCRYPTION_KEY=32_character_random_string_for_encryption`
4. Start the server: `npm run dev` (starts on port 5000)

### 2. Web Dashboard Setup
1. `cd web`
2. `npm install`
3. Start the dev server: `npm run dev` (starts on port 5173)

### 3. Extension Setup
1. `cd extension`
2. `npm install`
3. Build the extension: `npm run build`
4. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `extension/dist` folder.
5. Click on the extension icon to open the popup.
6. Click the Settings icon to configure your backend URL and login.

## Usage
1. Open the **Web Dashboard** and create an account.
2. Go to **Settings** and configure your:
   - Personal Info & Resume Link
   - Gemini API Key
   - SMTP Credentials (e.g., Gmail App Password)
   - Default Email Template
3. Go to **Import Contacts** to upload a CSV/Excel file of jobs. Gemini will automatically extract names, emails, companies, and roles.
4. Go to **Dashboard** to select contacts and send bulk outreach.
5. Use the **Browser Extension** while browsing to quickly paste text containing emails and send them on the fly.

## Webhooks (Optional)
If you use a transactional email provider like Resend or SendGrid instead of standard SMTP, you can configure their bounce webhooks to point to your backend:
`POST /api/webhooks/mail-status`
This will automatically mark contacts as 'bounced' in your dashboard if an email fails to deliver.

## Security
- API Keys and SMTP Passwords are encrypted at rest in MongoDB using AES-256-CBC.
- JWT is used for authentication.
- Make sure to use a strong `ENCRYPTION_KEY` in your backend `.env` file and never share it.

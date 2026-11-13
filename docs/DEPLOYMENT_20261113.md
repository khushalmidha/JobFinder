# Existing-host deployment — 13 November 2026

## Observed state

Main remains at f7e65e1; reviewed feature work is stacked in PRs 5, 6, 7. Existing GitHub deployment workflow was manual, with no repository Actions secrets configured. AWS CLI profile khushal exists in ap-south-1 but its login session is expired. Local jobfinder-key.pem exists; no server address or trusted host fingerprint is yet verified. No instance was created, started, stopped or terminated. No real mail was sent.

Run `aws login --profile khushal` locally and complete browser authentication. Never paste credentials into chat. Codex can then inventory existing instances, identify the JobFinder host by tags/services, inspect costs and verify host access. Other projects must not be stopped. Stopping an instance can retain billable volumes/IPs; inspect before claiming savings. Do not promise free EC2 eligibility without account evidence.

## Prepared changes

Pushes to main now validate backend tests, web/extension builds/lint and actual Chromium smoke before invoking the existing-host deployment. It deploys the exact tested SHA, refuses tracked host edits or superseded main, serializes deployments and requires EC2_HOST, EC2_USER, EC2_SSH_KEY and EC2_SSH_FINGERPRINT repository/environment secrets. Host verification must use independently trusted AWS instance identity/access, not blind ssh-keyscan acceptance. Workflow must be merged to main after CI/review before automatic triggers become active.

Compose reads backend/.env at runtime, contains no credential defaults, keeps the API internal, bounds logs and waits for backend health. Docker contexts exclude environment files and dependencies. Frontend uses Node 24 and a real Nginx configuration with correct variables and same-origin API proxy. Existing MongoDB and its encryption key must be preserved; generating a new encryption key would break stored sender credential decryption. Required keys are checked by deployment without printing values.

Sending, worker, notification, verification, webhook, job and research flags are explicitly false in the default deployment. This keeps deployment authorization separate from real email authorization. After host validation and exact campaign approval, enabling the always-on worker requires a separate reviewed runtime override; do not silently turn it on during auto-deploy.

## Host prerequisites and checks

Existing Linux host needs Docker Compose v2 supporting --wait, Docker access or passwordless sudo for Docker, git fetch access to this repository, curl, private backend/.env and adequate build RAM/disk. No installer, new server or paid service is provisioned by this change. Deployment currently builds on-host, so inspect resources first. Maintain HTTPS at the existing ingress; Compose listens on HTTP 80 behind that ingress. Do not expose account login/credentials publicly until TLS ingress and firewall are verified. Port 5000 must not be publicly exposed.

After AWS login: inspect the existing host and billing/free-tier eligibility; back up runtime configuration and old image IDs; verify TLS certificate/domain, Mongo access and encryption; configure scoped GitHub SSH secrets with pinned host fingerprint; build and health-test the release. Test TLS connections to configured SMTP 465/587 from the actual host without sending or probing recipients. TCP/TLS success does not verify mailbox existence. Verify /api/health and authenticated UI plus queue persistence. Real SMTP sending needs separate deliberate campaign approval.

Render Free is unsuitable for the existing SMTP worker: outbound 25/465/587 are blocked and a sleeping service cannot guarantee schedules. https://render.com/docs/free . AWS default restriction concerns port 25; host/network/provider 465/587 connectivity must still be tested. https://docs.aws.amazon.com/ses/latest/dg/troubleshoot-smtp.html . No free/working SMTP claim has been made for an untested host.

## Rollback

Build failure occurs before container replacement. If startup/health fails after replacement, the workflow reports failure; automatic image rollback is not implemented. On host, retain prior image IDs, restore the reviewed prior SHA/images with sending disabled and run compose up/health checks. Preserve database collections and encryption key. Never roll back to an exposed unsigned webhook: retain security fixes or block those endpoints. Do not prune old images until acceptance.

## Important credential repair

Legacy tracked Compose contained a database credential and weak JWT default. New Compose removes both. Treat that historical database credential as exposed and rotate/revoke it in MongoDB Atlas; git history is not rewritten. Preserve application ENCRYPTION_KEY. Plan JWT rotation to invalidate old sessions. No remote credential was rotated by this change.

## Validation status

Docker Compose config validation passed locally without resolving runtime env files; git diff --check passed. Docker daemon is unavailable locally, so container build/start, Nginx execution and real host SMTP are pending, not passed. The preceding feature commit had 101 backend tests and Chromium/GitHub CI passing; this deployment branch needs its own CI. No live deployment is claimed until verified.

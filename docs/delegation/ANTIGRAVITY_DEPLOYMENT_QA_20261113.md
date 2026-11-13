# Antigravity: light deployment QA

Use branch ops/auto-deploy-20261113. Do not deploy, merge, send mail, enable delivery flags, expose credentials, create cloud resources or stop any instance.

1. Inspect Docker Compose, backend/web Dockerfiles and web/nginx.conf. Confirm backend .env is excluded from image builds, required runtime secrets have no fallback, API is internal, API proxy and SPA routing work.
2. If Docker is available, use a synthetic private backend/.env and temporary MongoDB. Build and smoke-test /api/health, /login, /crm and /campaigns. Never read or use the real environment file. Keep every sending/worker/research/verification flag false. Report actual commands and failures.
3. Inspect .github/workflows/deploy.yml: main pushes run tests before deploying exact SHA; absent host secrets fail clearly; concurrent deployments serialize; host fingerprint required; no provisioning/deletion occurs.
4. Check docs/DEPLOYMENT_20261113.md against implementation. List unmet host prerequisites and rollback risks. Do not claim live deployment, SMTP reachability or free eligibility from code review.

Return bounded findings with file/line, reproducible synthetic case and branch/commit. Codex owns actual host inspection/configuration after owner AWS login.

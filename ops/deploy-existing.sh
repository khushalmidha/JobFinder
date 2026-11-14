#!/bin/sh
set -eu
# Existing host only. No instances, volumes, credentials or paid APIs created.
test -f backend/.env || { echo 'Missing private backend/.env'; exit 1; }
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
else
  compose() { sudo -n docker compose "$@"; }
fi
# Required runtime keys must exist and be nonempty; never display their values.
for key in MONGODB_URI JWT_SECRET ENCRYPTION_KEY; do
  grep -Eq "^${key}=.+" backend/.env || { echo "Missing runtime key: $key"; exit 1; }
done
compose config --quiet
compose build
compose up -d --wait --wait-timeout 180
compose exec -T backend node -e "fetch('http://web/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
printf 'Deployment healthy; sending and research remain disabled.\n'

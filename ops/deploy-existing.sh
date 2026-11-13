#!/bin/sh
set -eu
# Existing host only. No instances, volumes, credentials or paid APIs created.
test -f backend/.env || { echo 'Missing private backend/.env'; exit 1; }
node_check=''
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
curl --fail --silent --show-error --max-time 15 http://127.0.0.1/api/health >/dev/null
printf 'Deployment healthy; sending and research remain disabled.\n'

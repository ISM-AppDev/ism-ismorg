#!/usr/bin/env bash
# Build + publish the Solution Ideas catalog on the VPS.
# Run as a user that can write /var/www/ismorg.com and restart the service
# (root, or via sudo). Idempotent.
#
#   ssh vps
#   cd /opt/ismorg-solutions && git pull && ./deploy/deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="/var/www/ismorg.com/solutions"
LANDING="/var/www/ismorg.com/html/index.html"
DATA_DIR="/var/lib/ismorg-solutions"

cd "$REPO_DIR"

echo "==> install deps"
npm ci --no-audit --no-fund

echo "==> build (PUBLIC_BUILD=${PUBLIC_BUILD:-0})"
npm run build

echo "==> publish static site -> $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete dist/ "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"

echo "==> publish root landing page"
install -m 0644 -o www-data -g www-data deploy/root-index.html "$LANDING"

echo "==> vote service data dir"
mkdir -p "$DATA_DIR"
chown www-data:www-data "$DATA_DIR"

if systemctl list-unit-files | grep -q '^ismorg-solutions-votes\.service'; then
  echo "==> restart vote service"
  systemctl restart ismorg-solutions-votes
  sleep 1
  systemctl --no-pager --lines=0 status ismorg-solutions-votes || true
  curl -fsS http://127.0.0.1:4310/api/health && echo
else
  echo "!! ismorg-solutions-votes.service not installed yet — see deploy/README or the project README"
fi

echo "==> done"

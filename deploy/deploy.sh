#!/usr/bin/env bash
# Build + publish Solution Ideas on the VPS, as two builds:
#   PUBLIC  -> /var/www/ismorg.com/solutions/        (open)
#   TEAM    -> /var/www/ismorg.com/solutions-team/   (password-gated, full content)
# Run as root (or via sudo). Idempotent.
#
#   ssh vps
#   cd /opt/ismorg-solutions && git pull && bash deploy/deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_ROOT="/var/www/ismorg.com/solutions"
TEAM_ROOT="/var/www/ismorg.com/solutions-team"
LANDING="/var/www/ismorg.com/html/index.html"
DATA_DIR="/var/lib/ismorg-solutions"

cd "$REPO_DIR"

echo "==> install deps"
npm ci --no-audit --no-fund

echo "==> build PUBLIC (PUBLIC_BUILD=1, base /solutions)"
rm -rf dist
PUBLIC_BUILD=1 npm run build
mkdir -p "$PUBLIC_ROOT"
rsync -a --delete dist/ "$PUBLIC_ROOT/"

echo "==> build TEAM (full content, base /solutions/team)"
rm -rf dist
TEAM_BUILD=1 npm run build
mkdir -p "$TEAM_ROOT"
rsync -a --delete dist/ "$TEAM_ROOT/"

chown -R www-data:www-data "$PUBLIC_ROOT" "$TEAM_ROOT"

echo "==> publish root landing page"
install -m 0644 -o www-data -g www-data deploy/root-index.html "$LANDING"

echo "==> vote service data dir"
mkdir -p "$DATA_DIR"
chown www-data:www-data "$DATA_DIR"

if systemctl cat ismorg-solutions-votes.service >/dev/null 2>&1; then
  echo "==> restart vote service"
  systemctl restart ismorg-solutions-votes
  sleep 1
  curl -fsS http://127.0.0.1:4310/api/health && echo
else
  echo "!! ismorg-solutions-votes.service not installed — see README"
fi

echo "==> done"

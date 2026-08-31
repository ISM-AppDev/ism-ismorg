#!/bin/bash
# Daily backup of the ismorg-solutions data dir (votes.json + submissions.json)
# to Backblaze B2, using the same rclone remote / bucket / retention as the
# other VPS backups. Installed at /usr/local/bin/backup-ismorg-solutions.sh
# and run by /etc/cron.d/ismorg-solutions-backup at 04:20 daily.
set -euo pipefail

ENV_FILE="/root/.backup-secrets/b2.env"
# shellcheck disable=SC1090
source "$ENV_FILE"

SRC_DIR="/var/lib/ismorg-solutions"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
TMP="/root/.backup-secrets/tmp"
mkdir -p "$TMP"
OUT="$TMP/ismorg-solutions_${TIMESTAMP}.tgz"

echo "[$(date)] Starting backup of ismorg-solutions data"

if [ ! -d "$SRC_DIR" ] || [ -z "$(ls -A "$SRC_DIR" 2>/dev/null)" ]; then
  echo "[$(date)] $SRC_DIR empty or missing — nothing to back up"
  exit 0
fi

tar czf "$OUT" -C "$SRC_DIR" .
echo "[$(date)] Archive created: $(du -h "$OUT" | cut -f1)"

rclone copy "$OUT" "b2remote:${B2_BUCKET}/ismorg-solutions/" --quiet
echo "[$(date)] Uploaded to B2"

rm -f "$OUT"

rclone delete "b2remote:${B2_BUCKET}/ismorg-solutions/" --min-age 30d --quiet
echo "[$(date)] Backup complete"

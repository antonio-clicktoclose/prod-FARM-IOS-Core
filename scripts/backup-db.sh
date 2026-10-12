#!/bin/bash
# Nightly database backup. Dumps the scheduler database, keeps 14 local copies, and uploads the newest one when
# BACKUP_REMOTE is set (an rclone remote path such as r2:phone-farm-backups). Not scheduled by default.
# Restore: gunzip -c FILE | psql "$DATABASE_URL"
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env 2>/dev/null || true; set +a
: "${DATABASE_URL:?DATABASE_URL is not set}"
DIR=".scheduler-data/backups"; mkdir -p "$DIR"
FILE="$DIR/phone-farm-$(date +%Y%m%d-%H%M).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
[ "$(gzip -l "$FILE" | awk 'NR==2{print $2}')" -gt 10000 ] || { echo "backup suspiciously small: $FILE"; rm -f "$FILE"; exit 1; }
ls -1t "$DIR"/phone-farm-*.sql.gz | tail -n +15 | xargs -I{} rm -f {}
if [ -n "${BACKUP_REMOTE:-}" ]; then rclone copy "$FILE" "$BACKUP_REMOTE" --quiet && echo "uploaded to $BACKUP_REMOTE"; fi
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"

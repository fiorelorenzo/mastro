#!/usr/bin/env bash
# Backs up the production stack (#77): the database, BETTER_AUTH_SECRET
# (losing it invalidates every session) and the documents directory
# (invariant 4: every derived datum keeps its source document). Run this
# from the repository root against a running `compose.prod.yaml` stack:
#
#   scripts/backup.sh [backup-dir]
#
# `backup-dir` defaults to ./backups. Every run writes one timestamped
# archive and records its own outcome in the database (see
# scripts/record-backup-run.ts) so a failure is visible to the alert
# engine (#74) instead of passing quietly. See docs/backup.md for the
# rehearsal this was proved against, the exact restore procedure, and what
# #74 must query.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
	echo "backup: .env.prod not found; run from the repository root with the production stack configured" >&2
	exit 1
fi

# shellcheck disable=SC1091
set -a
source .env.prod
set +a

BACKUP_DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="$(mktemp -d)"
ARCHIVE="$BACKUP_DIR/mastro-$STAMP.tar.gz"
COMPOSE="docker compose -f compose.prod.yaml --env-file .env.prod"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

record() {
	# Best effort: if the database itself is unreachable this also fails,
	# which is the one failure mode this mechanism cannot self-report.
	# scripts/backup.sh's own non-zero exit and whatever runs it (cron,
	# systemd timer) failing are the fallback signal for that case —
	# documented, not hidden, in docs/backup.md.
	$COMPOSE exec -T web node scripts/record-backup-run.ts "$1" "$2" \
		|| echo "backup: could not record outcome in backup_run ($1: $2)" >&2
}

fail() {
	echo "backup: $1" >&2
	record failure "$1"
	exit 1
}

mkdir -p "$BACKUP_DIR"

echo "backup: dumping database"
$COMPOSE exec -T db pg_dump -U "${POSTGRES_USER:-mastro}" -d "${POSTGRES_DB:-mastro}" -Fc \
	>"$WORK_DIR/database.dump" || fail "pg_dump exited non-zero"
[ -s "$WORK_DIR/database.dump" ] || fail "pg_dump produced an empty file"

echo "backup: copying BETTER_AUTH_SECRET"
[ -n "${BETTER_AUTH_SECRET:-}" ] || fail "BETTER_AUTH_SECRET is empty in .env.prod"
printf '%s' "$BETTER_AUTH_SECRET" >"$WORK_DIR/better-auth-secret"

# Optional, unlike the auth secret: push is off when it is unset, and an
# archive taken before push was configured must still restore. But losing
# it invalidates every subscription a browser has already granted, which
# no amount of database is going to bring back.
ARCHIVE_MEMBERS="database.dump better-auth-secret documents.tar"
if [ -n "${VAPID_PRIVATE_KEY:-}" ]; then
	echo "backup: copying VAPID_PRIVATE_KEY"
	printf '%s' "$VAPID_PRIVATE_KEY" >"$WORK_DIR/vapid-private-key"
	ARCHIVE_MEMBERS="$ARCHIVE_MEMBERS vapid-private-key"
fi

# Read out through `web`, not off the host. The app writes each blob 0600
# inside 0700 directories owned by the container's own non-root user
# (#114: these are the evidentiary documents invariant 4 protects, so they
# are never group- or world-readable), and the bind mount hands the host
# those uids unchanged. A host-side `tar` therefore cannot read a single
# one of them: this step failed on `Cannot open: Permission denied` the
# first time a real document existed, which is later than anyone would
# want to find out. `exec` runs as the user that owns them, so the
# archive is complete regardless of who is running this script.
echo "backup: archiving the documents directory"
$COMPOSE exec -T web tar -C /app/data/documents -cf - . >"$WORK_DIR/documents.tar" \
	|| fail "archiving the documents directory through the web container failed"
[ -s "$WORK_DIR/documents.tar" ] || fail "the documents archive came out empty"

echo "backup: writing $ARCHIVE"
# Unquoted on purpose: the member list is a space-separated set of file
# names this script chose itself, not user input.
# shellcheck disable=SC2086
tar -C "$WORK_DIR" -czf "$ARCHIVE" $ARCHIVE_MEMBERS \
	|| fail "assembling the backup archive failed"
# Recorded as the size in bytes, not the path (#246): the settings health
# page reads `backup_run.detail` on a successful run and has no
# filesystem access to this archive to stat it itself — `web` never
# mounts `backup-dir` (see compose.prod.yaml). The path is reconstructible
# anyway from the run's own timestamp (`mastro-<UTC-stamp>.tar.gz`, line
# 32 above), which the path string never told a reader that the run
# timestamp doesn't already.
ARCHIVE_SIZE_BYTES="$(stat -c%s "$ARCHIVE" 2>/dev/null || wc -c <"$ARCHIVE" | tr -d ' ')"
record success "$ARCHIVE_SIZE_BYTES"
echo "backup: done ($ARCHIVE, $ARCHIVE_SIZE_BYTES bytes)"

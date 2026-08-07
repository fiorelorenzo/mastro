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

echo "backup: archiving the documents directory"
DOCUMENTS_DIR="${DOCUMENTS_DIR:-./data/documents}"
mkdir -p "$DOCUMENTS_DIR"
tar -C "$DOCUMENTS_DIR" -cf "$WORK_DIR/documents.tar" . || fail "archiving $DOCUMENTS_DIR failed"

echo "backup: writing $ARCHIVE"
tar -C "$WORK_DIR" -czf "$ARCHIVE" database.dump better-auth-secret documents.tar \
	|| fail "assembling the backup archive failed"

record success "$ARCHIVE"
echo "backup: done ($ARCHIVE)"

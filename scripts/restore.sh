#!/usr/bin/env bash
# Restores a backup produced by scripts/backup.sh (#77) into a clean
# environment: a fresh database volume, BETTER_AUTH_SECRET written back
# into .env.prod, and the documents directory replaced from the archive.
#
#   scripts/restore.sh <backup-archive.tar.gz>
#
# Run this against a target where .env.prod already exists (created from
# .env.prod.example, with real POSTGRES_USER/POSTGRES_DB and — in a
# genuine disaster, where the whole host and .env.prod with it are gone —
# freshly issued Google OAuth credentials; those are not in the backup set
# because they are recreatable secrets, not data). This script overwrites
# only BETTER_AUTH_SECRET in that file with the value from the archive,
# because a restored session is only valid if it is signed with the secret
# it was created under. It always destroys the current `db` volume first:
# do not point it at an environment you have not already decided to
# replace. See docs/backup.md for the rehearsal this was proved against.
set -euo pipefail

cd "$(dirname "$0")/.."

ARCHIVE="${1:?usage: scripts/restore.sh <backup-archive.tar.gz>}"
[ -f "$ARCHIVE" ] || {
	echo "restore: $ARCHIVE not found" >&2
	exit 1
}
[ -f .env.prod ] || {
	echo "restore: .env.prod not found; create it from .env.prod.example first" >&2
	exit 1
}

# shellcheck disable=SC1091
set -a
source .env.prod
set +a

COMPOSE="docker compose -f compose.prod.yaml --env-file .env.prod"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "restore: extracting $ARCHIVE"
tar -C "$WORK_DIR" -xzf "$ARCHIVE"
for f in database.dump better-auth-secret documents.tar; do
	[ -f "$WORK_DIR/$f" ] || {
		echo "restore: archive is missing $f" >&2
		exit 1
	}
done

echo "restore: bringing the stack down and dropping its volumes"
$COMPOSE down -v

echo "restore: starting a clean database"
$COMPOSE up -d --wait db

echo "restore: loading the database dump"
$COMPOSE exec -T db pg_restore -U "${POSTGRES_USER:-mastro}" -d "${POSTGRES_DB:-mastro}" --no-owner \
	<"$WORK_DIR/database.dump"

echo "restore: writing BETTER_AUTH_SECRET back into .env.prod"
RESTORED_SECRET="$(cat "$WORK_DIR/better-auth-secret")"
if grep -q '^BETTER_AUTH_SECRET=' .env.prod; then
	# A literal delimiter that cannot appear in a base64 secret.
	sed -i "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=${RESTORED_SECRET}#" .env.prod
else
	echo "BETTER_AUTH_SECRET=${RESTORED_SECRET}" >>.env.prod
fi

echo "restore: replacing the documents directory"
DOCUMENTS_DIR="${DOCUMENTS_DIR:-./data/documents}"
rm -rf "${DOCUMENTS_DIR:?}"/*
mkdir -p "$DOCUMENTS_DIR"
tar -C "$DOCUMENTS_DIR" -xf "$WORK_DIR/documents.tar"

echo "restore: starting the full stack"
$COMPOSE up -d

echo "restore: done. verify the restored figures before trusting this environment (docs/backup.md)."

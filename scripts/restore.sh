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

# A role is cluster-wide, not part of any one database, so `down -v` above
# took `mastro_runner` (drizzle/0037_acp_runner_role.sql) with the volume
# while the dump kept every GRANT naming it. pg_restore reports each of
# those as an error, ignores it, and still exits non-zero — which under
# `set -e` aborts this script immediately after the database and before
# the documents, leaving a half-restored instance and no message saying
# so. Recreating the role first makes those GRANTs land as recorded; the
# password is not set here because migrate.ts rotates it from
# RUNNER_DB_PASSWORD on the next boot, which is the only place it lives.
# Found by rehearsing a restore, not by reading the script.
echo "restore: recreating the mastro_runner role the dump grants to"
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-mastro}" -d "${POSTGRES_DB:-mastro}" -v ON_ERROR_STOP=1 -c \
	"DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mastro_runner') THEN CREATE ROLE mastro_runner LOGIN; END IF; END \$\$;"

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

# Written only when the archive carries one: an archive taken before push
# was configured is still a valid archive, and a restore from it must not
# wipe a key the running instance already has.
if [ -f "$WORK_DIR/vapid-private-key" ]; then
	echo "restore: writing VAPID_PRIVATE_KEY back into .env.prod"
	RESTORED_VAPID="$(cat "$WORK_DIR/vapid-private-key")"
	if grep -q '^VAPID_PRIVATE_KEY=' .env.prod; then
		sed -i "s#^VAPID_PRIVATE_KEY=.*#VAPID_PRIVATE_KEY=${RESTORED_VAPID}#" .env.prod
	else
		echo "VAPID_PRIVATE_KEY=${RESTORED_VAPID}" >>.env.prod
	fi
fi

# The stack comes up before the documents go back, because they go back
# the same way they came out: through `web`, which runs as the user that
# owns them. A host-side `rm`/`tar` cannot touch 0600 blobs under 0700
# directories owned by the container's uid, and would abort this script
# one step short of the documents — the half of the backup set that
# invariant 4 exists for.
echo "restore: starting the full stack"
$COMPOSE up -d --wait web

echo "restore: replacing the documents directory"
$COMPOSE exec -T web sh -c 'rm -rf /app/data/documents/* /app/data/documents/.[!.]* 2>/dev/null; tar -C /app/data/documents -xf -' \
	<"$WORK_DIR/documents.tar"

$COMPOSE up -d

echo "restore: done. verify the restored figures before trusting this environment (docs/backup.md)."

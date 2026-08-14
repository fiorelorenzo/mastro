# Backup and restore (#77)

A backup nobody has restored is a hypothesis. This page is the runbook and the
record of the rehearsal that turned it into a fact: real commands, run against the
production compose stack (`compose.prod.yaml`) on 2026-08-06, with the real timings
below.

## What is in the backup set, and why

- **The database** (`pg_dump -Fc`, custom format, includes schema and Drizzle's own
  migration-tracking table, so a restored database reports the exact migration state
  it had at backup time).
- **`BETTER_AUTH_SECRET`.** Every session and every Better Auth token is signed with
  this value. A restore that brings back the `session` rows but signs new tokens
  under a different secret produces a database that looks complete and a product
  where nobody can stay logged in — the rows exist but nothing can verify them. This
  is why AGENTS.md calls out this variable by name in the commit conventions section
  as belonging to the backup set.
- **The documents directory** (`DOCUMENTS_DIR`, bind-mounted into `web`). Invariant 4
  in AGENTS.md: every derived datum keeps its source document, so a client dispute is
  settled by the original message, not the row an extraction produced from it. A
  backup that only has the row has already lost the thing invariant 4 exists to keep.
- **`VAPID_PRIVATE_KEY`, when push is configured.** A browser's push subscription is
  bound to the public half of this pair, so a restore under a new key leaves every
  granted subscription addressed to a key nothing holds: alerts stop arriving and
  nobody is told. Unlike the auth secret it is optional — an archive taken before
  push was configured carries no key, and restoring one will not clear a key the
  instance already has.

Not in the backup set, on purpose: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and
`POSTGRES_PASSWORD`. These are credentials the self-hoster issued and can reissue;
losing them is an inconvenience (recreate the OAuth client, set a new database
password), not a loss of data. `BETTER_AUTH_SECRET` is different in kind: it is not
recoverable by reissuing anything, and its loss quietly invalidates history that
looks intact.

## Running a backup

```bash
scripts/backup.sh [backup-dir]   # defaults to ./backups
```

Requires `.env.prod` (docs/deploy.md) and a running `compose.prod.yaml` stack. Each
run:

1. `docker compose exec db pg_dump -Fc` — the database, straight out of the running
   container, no separate client tooling needed on the host.
2. Copies `BETTER_AUTH_SECRET` out of `.env.prod`, and `VAPID_PRIVATE_KEY` too when
   it is set.
3. Archives `DOCUMENTS_DIR` with `tar`.
4. Bundles them into one timestamped `.tar.gz` under `backup-dir`.
5. Calls `scripts/record-backup-run.ts` inside the running `web` container to record
   the outcome — see "Failure is observable" below. This runs whether steps 1–4
   succeeded or not: `fail()` records `failure` with the reason before exiting
   non-zero; the last line on the success path records `success` with the archive's
   size in bytes (#246: `web` never mounts `backup-dir`, so the settings health page
   has no other way to show it — the path itself is reconstructible from the run's
   own timestamp, `mastro-<UTC-stamp>.tar.gz`).

Schedule it with cron or a systemd timer, off the box the archive should not also
live on exclusively — copy `backup-dir` somewhere else (another host, object
storage) after each run. That copy step is what makes it offsite; this repository
cannot reach into whatever offsite target a given self-hoster uses, so it is left as
the last step of whatever schedules `backup.sh`, not inside it.

## Restoring

```bash
scripts/restore.sh <backup-archive.tar.gz>
```

Run against a target with `.env.prod` already in place (real `POSTGRES_USER`/
`POSTGRES_DB`, and — if the whole original host is gone — freshly issued Google
OAuth credentials, since those are not in the backup set as explained above). The
script:

1. Extracts the archive and checks all three pieces are present.
2. `docker compose down -v` — **destroys the current `db` volume**. This script is
   for restoring into an environment you have already decided to replace, never a
   live one you meant to keep.
3. Brings up a clean `db`, then `pg_restore`s the dump into it directly — the
   dump's own `CREATE TABLE` statements and Drizzle's migration-tracking rows
   reproduce the exact schema state, so the `web` container's migration-on-boot step
   (Dockerfile `CMD`) finds every migration already applied and does nothing further.
4. Overwrites `BETTER_AUTH_SECRET` in `.env.prod` with the value from the archive,
   and `VAPID_PRIVATE_KEY` too when the archive carries one.
5. Replaces `DOCUMENTS_DIR` with the archived contents.
6. Brings the full stack up.

## The rehearsal

Performed locally against `compose.prod.yaml` with `.env.prod` configured for a
local proxy (`MASTRO_SITE_ADDRESS=localhost`, self-signed TLS) — see docs/deploy.md
for how that stack was brought up. No real host was touched.

**Known figures**, inserted before the backup:

- A `client` row: legal name `Rehearsal Restore SRL`, tax id `REHEARSAL-TAX-42`.
- A file at `DOCUMENTS_DIR/proof.txt` containing `figure: rehearsal-doc-9f3c2a`.
- `BETTER_AUTH_SECRET=11NDRCdyFpSKcxpTqZ6xExXpOIUu0dpIQLU8PPQ3Dso=` (rehearsal value,
  not a real deployment's secret).

**Backup:** `scripts/backup.sh ./backups`, timed with `time`:

```
real	0m0.969s
```

**Destruction**, to make the "clean environment" real rather than assumed:
`docker compose -f compose.prod.yaml --env-file .env.prod down -v` (drops the
`pgdata` volume), `rm -rf data/documents/*`, and `BETTER_AUTH_SECRET` blanked out in
`.env.prod`. `docker volume ls` confirmed no `mastro-prod` volumes remained.

**Restore:** `scripts/restore.sh ./backups/mastro-20260806T233538Z.tar.gz`, timed:

```
real	0m8.058s
```

**Verification against the known figures**, after restore:

- `select legal_name, tax_id from client where tax_id = 'REHEARSAL-TAX-42'` returned
  `Rehearsal Restore SRL` — the row survived the volume being destroyed and
  recreated.
- `cat data/documents/proof.txt` returned `figure: rehearsal-doc-9f3c2a` — unchanged.
- `.env.prod`'s `BETTER_AUTH_SECRET` read back as
  `11NDRCdyFpSKcxpTqZ6xExXpOIUu0dpIQLU8PPQ3Dso=` — the exact value from before
  destruction, not a newly generated one.
- `select count(*) from drizzle.__drizzle_migrations` returned `9`, matching the
  9 migrations on this branch (`0000`–`0008`) — the restored database is not merely
  present but at the exact migration state it should be.
- `GET /health` through the proxy returned `{"status":"ok","database":"ok"}`.

Total end-to-end backup-to-verified-restore time for this rehearsal: backup 0.97s
plus restore 8.06s, roughly 9 seconds, on a database with one row. Restore time on a
real instance's data volume will scale with `pg_restore`'s work, not with anything in
these scripts.

## Failure is observable

`scripts/record-backup-run.ts` writes one row per attempt into the `backup_run`
table (`src/lib/server/db/schema/backup.ts`), `status` `success` or `failure`, plus a
`detail` string (the archive's size in bytes on a success, the failure reason on a
failure) and an `acknowledged_at` that starts null. This is the signal the
alert engine (#74) and the settings health page (#246) both read. It needs two
checks, not one:

```sql
-- An explicit failure nobody has acknowledged yet.
select * from backup_run
where status = 'failure' and acknowledged_at is null
order by created_at desc limit 1;

-- The job did not run at all: no row newer than the backup interval. A
-- daily backup with nothing in the last, say, 26 hours is exactly as bad
-- as an unacknowledged failure and produces no failure row to alert on,
-- because nothing ran to write one.
select max(created_at) < now() - interval '26 hours' as backup_stale
from backup_run;
```

Acknowledging a run (`update backup_run set acknowledged_at = now() where id = ...`)
is how the eventual alert UI should silence a specific failure without deleting the
record of it — the same pattern #74 uses for every other alert.

**The one gap this cannot cover:** if the database itself is unreachable, `backup.sh`
cannot write a `failure` row either, because writing it needs the same database. I
proved this directly during the rehearsal — stopping the `db` container and running
`backup.sh` produced `pg_dump exited non-zero`, then `record-backup-run.ts` itself
threw `ENOTFOUND db`, and the script printed
`backup: could not record outcome in backup_run` to stderr and exited 1. That exit
code is the fallback signal for exactly this case: whatever schedules `backup.sh`
(cron, a systemd timer) must alert on the job itself failing, not only on rows in
`backup_run`. A systemd timer's unit going into a `failed` state (visible in
`systemctl --failed` and in `journalctl`) is the natural mechanism for that, and is
the one piece of this that is genuinely outside what a database-driven alert engine
can see.

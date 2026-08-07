# Security review (#78)

Every claim below was checked against the code, the Compose files and the scripts as
they exist on this branch, not restated from a comment or from AGENTS.md. Where I
could not verify something directly — a live rehearsal I did not repeat, a piece
that has not landed yet — that is stated explicitly rather than left implied.

For each item: what it grants, where it lives, what a leak costs, whether it is in
the backup set, and whether losing it is recoverable.

## Google OAuth (sign-in)

**What it grants.** `src/lib/server/auth/index.ts` configures the Google social
provider with only `clientId`/`clientSecret`, no `scope` override, and Better Auth's
Google provider defaults to exactly `openid email profile`
(`node_modules/better-auth`'s `google` provider starts from
`["email", "profile", "openid"]` and only appends more if configured to — read
directly, not assumed). `auth.test.ts` asserts this: it drives a real
`getAuthorizeURL` call and checks the `scope` query parameter equals exactly that
set. That is name, email address and profile picture — nothing that reads mail,
Drive, or any other Google data. Verified in code and by a passing test.

**Where it lives.** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` (dev) /
`.env.prod` (production), both `.gitignore`d (`.env.*`, `!.env.example`,
`!.env.prod.example`). `docs/deploy.md` confirms `.dockerignore` excludes every
`.env*` file from the build context, and `Dockerfile`'s build stage uses literal
placeholder values (`build-time-placeholder`), never a real secret, for the
postbuild analysis step that needs _some_ value.

**If it leaks.** The client secret alone lets someone stand up a second OAuth client
using this app's identity in Google's consent screen (phishing risk: a user seeing
mastro's app name), but it grants no access to this instance's data — sign-in still
requires completing Google's own flow, and every resulting account still has to pass
`AUTH_ALLOWED_EMAILS` before a session is created (`databaseHooks.session.create`).
The allowlist is the actual gate, not the OAuth client's secrecy.

**Backup set.** Not included, on purpose — verified in both `docs/backup.md` (states
this explicitly, with the reasoning) and `scripts/backup.sh` (does not touch it).

**Recoverable if lost.** Yes: reissue a new OAuth client in Google Cloud Console,
update `.env.prod`, restart. No data is lost.

## `drive.file` (Drive mirror)

**Status as of this review.** Not present in this branch's code — I grepped for
`drive.file` and any Drive-related scope and found nothing wired up, matching
AGENTS.md's own framing of it as landing "when the mirror lands." A sibling PR in
this same wave is adding it; I have not reviewed that code, so I make no claim about
it here beyond what AGENTS.md commits to: `drive.file` grants access only to files
the application itself created, never the whole Drive, and is a non-sensitive scope
that does not affect the Testing-status refresh-token behavior the sign-in scopes
depend on. Whoever lands it should re-run this section against the real
implementation.

## IMAP/SMTP app password (mailbox access)

**What it grants.** `src/lib/server/mail/config.ts` reads `SMTP_APP_PASSWORD` and
`IMAP_APP_PASSWORD` from the environment. This is a real gap worth stating plainly:
an app password is not a mastro-defined scope, it is Google's (or any provider's)
mechanism for granting a non-interactive credential **full IMAP/SMTP access to the
whole mailbox** — send, read every folder, delete. There is no finer-grained app
password. mastro's own code only ever calls `sendMail` over SMTP
(`src/lib/server/mail/smtp.ts`) and `list` / `append` / `mailboxCreate` over IMAP
(`src/lib/server/mail/imap.ts`, to find and write to the Sent folder) — it never
lists or reads existing mail. That restraint is enforced by mastro's code, not by
any privilege boundary the credential itself carries. **If this credential leaks,
treat it as full mailbox compromise**, not "mastro-scoped" compromise.

**Where it lives.** Same `.env`/`.env.prod` treatment as the OAuth credentials
above. The one committed thing that looks like a mailbox password,
`test-app-password` in `compose.mail-test.yaml` and `.github/workflows/ci.yml`, is
GreenMail's fixed test-account password for a throwaway container that only ever
exists on `127.0.0.1` or inside CI's ephemeral runner — not a real mailbox, never
reachable from outside that container.

**Backup set.** Not included — verified in `docs/backup.md`'s explicit list and in
`scripts/backup.sh`, neither of which touches it. This is consistent (it is
reissuable, like the OAuth credentials) but is not called out in `docs/backup.md`
today; that document only names `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and
`POSTGRES_PASSWORD` as the deliberately-excluded set. I have not edited that file
(a sibling PR in this wave is already correcting its mail section); flagging the
omission here so whoever touches it next adds the mail credentials to the
explicitly-excluded list too.

**Recoverable if lost or leaked.** Yes: revoke the app password in the provider's
account settings and generate a new one. Nothing else needs to change.

## `BETTER_AUTH_SECRET`

**What it grants.** Signs every session and Better Auth token
(`src/lib/server/auth/index.ts`: `secret: env.BETTER_AUTH_SECRET`). Anyone holding
it can mint a session token that Better Auth will accept as valid for any user id,
without touching the database at all — this is the one secret here whose leak means
full, silent account takeover, indefinitely, until rotated.

**Where it lives.** `.env`/`.env.prod`, same protections as above.

**Backup set.** **Yes**, verified twice over: `scripts/backup.sh` copies it into the
archive explicitly (`printf '%s' "$BETTER_AUTH_SECRET" >"$WORK_DIR/better-auth-secret"`,
guarded by `[ -n "${BETTER_AUTH_SECRET:-}" ] || fail ...`), and `docs/backup.md`
documents why (a restore that brought back `session` rows signed under a different
secret would look complete and verify nothing). `AGENTS.md`'s commit-conventions
section calls this variable out by name for the same reason.

**Recoverable.** Lost (not leaked): no — every existing session and Better Auth
token becomes permanently unverifiable, which is exactly why it is backed up. Leaked
(the attacker has a copy but the operator still has theirs too): yes, rotating it
(new `BETTER_AUTH_SECRET`, restart) immediately invalidates every token including
the attacker's, at the cost of every legitimate user having to sign in again.

## Email allowlist (`AUTH_ALLOWED_EMAILS`)

**What it grants.** Nothing by itself — it is not a credential, it is the list of
addresses `isAllowedEmail` (`src/lib/server/auth/allowlist.ts`) checks before a
Google sign-in is allowed to create an account or a session. An empty or unset list
admits nobody (`parseAllowlist` returns an empty set; `isAllowedEmail` on an empty
set is always `false`), verified by `auth.test.ts`'s rejection tests.

**Where it lives.** `.env`/`.env.prod`, plain text, comma-separated.

**If it leaks.** Discloses who is permitted to use the instance — the operator's own
email addresses. Does not grant access by itself; the attacker would still need to
control one of those Google accounts.

**Backup set.** Not included. This is fine: it is operator-authored configuration,
not derived or generated data, and re-entering it after a restore is a one-line
edit — but note `docs/backup.md`'s restore procedure does not mention re-checking
it, since `.env.prod` itself is not part of the backup archive and is assumed
already in place on the restore target.

## Database credentials

**What it grants.** `POSTGRES_USER`/`POSTGRES_PASSWORD` build `DATABASE_URL`, full
read/write over the entire ledger — every client, contract, invoice, approval and
work unit.

**Exposure, checked directly in the Compose files.** `compose.yaml` (dev) publishes
`127.0.0.1:${POSTGRES_PORT:-5436}:5432` — loopback only. `compose.prod.yaml`
publishes **no port at all** for `db`; `web` and the backup scripts reach it over
the internal Compose network by service name, and `docs/deploy.md`'s own rehearsal
proves this with a `docker compose ps` showing no host mapping for `db`, plus a
`curl` from the box's real interface (not loopback) confirming only the proxy is
reachable externally. So a leaked database password is not, on its own, enough to
reach the database from outside the host — the attacker would also need host or
container access.

**Backup set.** Not included, and `docs/backup.md` says so explicitly, alongside
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, as reissuable.

**Recoverable.** Yes: the data itself lives in the `pg_dump` backup, independent of
the password. Change `POSTGRES_PASSWORD` in `.env.prod`, recreate the container.

## Document blobs

**What it grants.** Read access to the original evidentiary documents — approval
emails, signed contracts, imported invoices — that invariant 4 exists to keep
alongside every extracted figure. Written content-addressed under
`DOCUMENT_STORAGE_ROOT` (dev) / `DOCUMENTS_DIR` (prod, bind-mounted into the `web`
container), by `src/lib/server/documents/blob-store.ts`.

**Fixed in this change (#114).** `writeBlob` now passes an explicit mode
to every file and directory it creates — `0o600` for a blob, `0o700` for
its two shard directories — instead of relying on whatever the process
umask happens to be. The kernel ANDs a requested mode with `~umask`, so a
restrictive request can only ever be narrowed further by umask, never
widened past it; `blob-store.test.ts` proves this directly by forcing
umask to `0` (the most permissive a host could hand the process) before
writing and asserting the resulting file and directory modes anyway.

**What this does not fix.** A blob already on disk from before this
change, written under whatever umask the process had at the time, is left
exactly as it was — `writeBlob` only chooses the mode for bytes it writes
itself, and a blob content-addressed under an existing hash is left
untouched on a repeat write (see its own doc comment), so nothing here
ever touches a file it did not just create. A self-hoster upgrading onto
this version with an existing `DOCUMENTS_DIR` should retighten it once by
hand:

```sh
find "$DOCUMENTS_DIR" -type f -exec chmod 600 {} +
find "$DOCUMENTS_DIR" -type d -exec chmod 700 {} +
```

No migration script runs this automatically: doing so from application
code would mean the server silently rewriting permissions on a
bind-mounted host directory it does not own outright, the first time it
happens to start after an upgrade — worth a human running it deliberately
instead.

**Backup set.** Yes — `scripts/backup.sh` `tar`s `DOCUMENTS_DIR` in full, and
`docs/backup.md`'s rehearsal verifies a restored file's contents match exactly.

**Recoverable if lost.** Only if backed up. Invariant 4's whole premise is that this
_is_ the source of truth for a disputed day — there is no secondary copy to fall
back to if both the live directory and its backups are gone.

## Session cookie attributes behind the reverse proxy

**Verified in code.** `src/lib/server/auth/index.ts` sets
`advanced.useSecureCookies: !dev` — `Secure` whenever the app is not running under
`vite dev`, unconditionally, never inferred from a proxy header. `auth.test.ts`
drives a real sign-up with `useSecureCookies: true` and asserts the `Set-Cookie`
header contains `Secure`, `HttpOnly` (case-insensitively) and `SameSite=Lax`.

**The reverse-proxy question, checked at the adapter level.**
`@sveltejs/adapter-node`'s `handler.js` (read directly in
`node_modules/.pnpm/.../adapter-node/files/handler.js`) computes the request's own
origin, absent an `ORIGIN` env var (not set anywhere in this repo's Compose files or
`.env.prod.example`), as `https://<host header>` — the protocol defaults to
`'https'` when `PROTOCOL_HEADER` is unset, and the host is read verbatim from the
`Host` header. Caddy's `reverse_proxy web:3000` (`deploy/Caddyfile`) forwards the
original `Host` header unmodified. So the origin SvelteKit computes for its own CSRF
same-origin check on a form POST matches exactly what a browser talking to
`BETTER_AUTH_URL` over HTTPS sends as `Origin` — I traced this through the adapter's
source rather than assuming it, since a mismatch here would 403 every
`<form method="POST">` in the product once deployed for real.

**What I did not verify.** I did not repeat `docs/deploy.md`'s live rehearsal with a
real authenticated form POST through Caddy — that rehearsal proved `GET /health`
and a restart, not a POST. The reasoning above is sound from the source, but nobody
has exercised sign-in-then-submit-a-form against the real proxy stack end to end. I
did not find a bug, so I am not filing an issue for this; whoever next touches the
deploy rehearsal should add that one request to it.

## Better Auth's rate limiter behind the reverse proxy (#113)

**Confirmed, not assumed.** #78 could not establish from the bundled source
whether Better Auth's rate limiter goes through SvelteKit's
`getClientAddress`/`ADDRESS_HEADER` machinery or resolves the caller's IP some
other way. It does not go through SvelteKit at all. Read directly from
`node_modules/.pnpm/@better-auth+core@.../node_modules/@better-auth/core/dist/api/rate-limiter/index.mjs`
and its `dist/utils/ip.mjs`: `onRequestRateLimit` calls `getIp(req, ctx.options)`,
which reads `advanced.ipAddress.ipAddressHeaders` (default `['x-forwarded-for']`)
directly off the raw request headers. `createAuth` in
`src/lib/server/auth/index.ts` never overrides this, so the rate limiter reads
`X-Forwarded-For` itself, independent of `adapter-node`'s `ADDRESS_HEADER`/
`XFF_DEPTH` (which govern `event.getClientAddress()` — grepped the whole `src`
tree, nothing here ever calls it). **Setting `ADDRESS_HEADER`/`XFF_DEPTH` would
change nothing about this limiter**, so #113's first acceptance branch applies:
they are correctly left unset in `compose.prod.yaml`/`.env.prod.example`.

**How `getIp` decides what to trust**, same source: without
`advanced.ipAddress.trustedProxies` configured (nothing here sets it),
`getIPFromHeader` trusts a single-value `X-Forwarded-For` verbatim and returns
`null` — not the proxy's own address, an untrusted-shared-bucket signal — the
moment the header carries more than one comma-separated value.

**Whether that resolves the proxy's own address or the real visitor's,
checked against the actual proxy, not assumed**: `compose.xff-test.yaml` runs
the exact `caddy:2-alpine` image and the exact `deploy/Caddyfile`
`compose.prod.yaml` uses, fronting a header-echoing backend, and
`src/lib/server/auth/caddy-xff.test.ts` drives real requests through it
(skipped when the stack is not running, printing the `docker compose` command
to start it — same convention as the mail tests). Caddy's default (Caddy 2.7+,
no `trusted_proxies` directive here) is to overwrite `X-Forwarded-For` with its
own observation of the immediate connection on every request, never append to
or trust whatever a client sent: a request with no header, one with a single
spoofed address, and one with a spoofed multi-hop chain all arrive at the
backend carrying the identical single real value. #78's worst case — "every
request behind the proxy resolves to the proxy's own address" — does not
happen: the value Caddy forwards is always the true visitor's address, single
value, never client-controlled, matching exactly what `getIPFromHeader`'s
single-value-trust rule needs to resolve correctly with no configuration at
all. #113's second acceptance branch applies: nothing to set, documented here
instead.

**One narrower, already-accepted gap, not fixed by any of the above.**
`compose.prod.yaml` also publishes `web` on a loopback-only debug port
(`WEB_PORT`, #76) that bypasses Caddy entirely. Anyone who can reach that port
directly — which already requires host-level access to this machine — can send
a single-value `X-Forwarded-For` and have it trusted exactly as if it came
through Caddy, since `getIPFromHeader`'s single-value rule cannot tell the two
apart, and `trustedProxies` cannot either: its own doc comment says so
explicitly ("this only interprets the forwarded header chain and cannot verify
the direct sender"). Configuring `trustedProxies` to Caddy's own address would
add complexity for zero effect on the traffic that matters (Caddy already
strips every incoming value to exactly one, so the multi-hop-skipping half of
`trustedProxies` never triggers on real traffic) and would not close this
narrower gap either. Not filing a new issue for this: it is bounded by the
same host-access trust boundary `docs/security.md`'s database-credentials
section already accepts for the same debug port, and the only real fix is not
publishing that port at all, which is #76's own tradeoff to revisit, not
#113's.

## Secrets in repository history

**Checked directly**: `git log --all -p` over the full history, grepped for
Google-API-key shapes (`AIza...`), private-key PEM headers, and every `*_SECRET=`/
`*_PASSWORD=`/`*_APP_PASSWORD=` assignment with a non-trivial value. Also checked
whether a `.env` file was ever committed (`git log --all --diff-filter=A
--name-only`): only `.env.example` and `.env.prod.example` were ever added, never a
real `.env`.

**What turned up**, all of it inert:

- `test-app-password` — GreenMail's fixed test-account password
  (`compose.mail-test.yaml`, `.github/workflows/ci.yml`), never a real mailbox.
- `build-time-placeholder`, `ci-test-secret-not-used-anywhere-else`,
  `ci-test-client-id`/`-secret` — literal placeholders the `Dockerfile`'s build
  stage and CI use for values that must exist at build/typecheck time but are never
  reachable at runtime.
- One real-looking `BETTER_AUTH_SECRET` value in `docs/backup.md`, from the local
  backup/restore rehearsal, explicitly labelled in that same document as "a
  rehearsal value, not a real deployment's secret." That rehearsal ran entirely
  against a local, non-internet-facing stack that was destroyed at the end of the
  exercise; the value never signed a session anyone but the rehearsal itself could
  reach.

**No secret that ever protected real data or a real deployment appears in history.**
The acceptance criterion "any secret found in history is rotated, not just removed"
does not apply here — nothing rotatable was found.

## Summary table

| Item                   | Grants                                                    | Backed up | Lost/leaked recovery                                            |
| ---------------------- | --------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| Google OAuth client    | Identity only (`openid email profile`)                    | No        | Reissue in Console                                              |
| `drive.file`           | Not yet implemented on this branch                        | —         | —                                                               |
| IMAP/SMTP app password | Full mailbox (provider-level, not mastro-scoped)          | No        | Revoke + reissue                                                |
| `BETTER_AUTH_SECRET`   | Forge any session                                         | **Yes**   | Lost: unrecoverable, sessions die. Leaked: rotate to invalidate |
| `AUTH_ALLOWED_EMAILS`  | Not a credential; discloses allowed identities            | No        | Re-enter from records                                           |
| Database password      | Full ledger read/write, not internet-reachable on its own | No        | Change password; data is in the `pg_dump` backup                |
| Document blobs         | Original evidentiary documents                            | **Yes**   | Only if backed up — no secondary source                         |

## Small fixes made in this PR

- None required a code change to close: every credential-handling path already
  matched what AGENTS.md and `docs/self-hosting.md`/`docs/deploy.md`/`docs/backup.md`
  claim. The gaps found (document blob permissions, rate-limiter IP resolution
  behind the proxy) are filed as issues rather than patched here, per the review's
  own scope: fix the small ones, file the rest.

**Update.** Both #113 and #114 were resolved in a later change — see their
own sections above ("Better Auth's rate limiter behind the reverse proxy",
"Document blobs") for what was found and fixed.

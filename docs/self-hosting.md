# Self-hosting: credentials (#55)

`mastro` needs credentials from exactly one third party, Google, and only for
things that stay inside Google's un-verified "Testing" tier — the whole point of
the design (AGENTS.md) is that none of this requires Google's security assessment.
This page is everything a self-hoster who has never opened Google Cloud Console
needs to create, and why each piece is shaped the way it is, so nobody
"simplifies" it later into something that breaks in a week.

Two features described in the architecture — mailbox polling and the Drive mirror
— are not implemented yet (no worker process exists on `main` as of this writing).
The sections below cover only what exists today: sign-in. Where the design commits
to a shape for mail and Drive, that shape is documented so the credentials this
page has you create now will already be right when that code lands, but there is
nothing to configure for either yet — do not create an app password or a
`drive.file` client expecting something to use it today.

## 1. A Google OAuth client, for sign-in

This is the only credential the running application needs from Google today.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a
   project (or reuse one you already have — nothing here needs a dedicated
   project).
2. **APIs & Services > OAuth consent screen.** Choose **External**, fill in an app
   name and your email, and leave the app in **Testing** publishing status. Do not
   submit it for verification — see "Why Testing status is safe to leave alone"
   below for why that is not a shortcut being taken, it is the correct end state.
3. **APIs & Services > Credentials > Create Credentials > OAuth client ID**, type
   **Web application**.
4. **Authorized redirect URI:** `<BETTER_AUTH_URL>/api/auth/callback/google`, where
   `BETTER_AUTH_URL` is the public URL this instance is reachable at (the value you
   put in `.env.prod`, e.g. `https://ledger.example.com`). Get this exact — Better
   Auth rejects a callback whose URI does not match one registered here.
5. Save. You now have a **Client ID** and a **Client secret** —
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.prod`.

The application requests exactly three scopes: `openid`, `email`, `profile`
(`src/lib/server/auth/index.ts` configures no others, and Better Auth's Google
provider defaults to exactly this set). All three are scopes Google classifies as
"non-sensitive" — the reason that matters is explained below.

### Why Testing status is safe to leave alone

A Google Cloud project's OAuth consent screen has a publishing status. In
**Testing**, refresh tokens for a project requesting only non-sensitive scopes
(name, email, profile — exactly this app's set) do not expire early; the
seven-day refresh-token expiry that Testing-status projects are usually warned
about only applies once a project requests a **sensitive** or **restricted**
scope. Moving to **Production** status requires nothing extra for a scope set
this narrow, but is also not required: **Testing** works indefinitely as long as
the scope set stays inside `openid email profile`. If you ever add a scope here,
check its classification first.

## 2. The email allowlist

`AUTH_ALLOWED_EMAILS` in `.env.prod`, comma-separated. Checked in Better Auth's
`databaseHooks` (`src/lib/server/auth/index.ts`) before an account is created and
again before every session, so removing an address takes effect on that account's
next sign-in even though the account already exists.

**Empty or unset admits nobody, not everybody.** This is invariant 6 in AGENTS.md:
this instance is reachable from the internet, Google sign-in on its own only
proves the visitor owns a Google account, and an allowlist is what turns "anyone
with a Google account" into "the one person this ledger belongs to." Leaving this
unset is not a permissive default to fix later; the application is unusable
without it, on purpose.

## 3. `BETTER_AUTH_SECRET`

```bash
openssl rand -base64 32
```

Signs every session and Better Auth token. Put it in `.env.prod`. This is not a
credential you create with an external party — it is generated locally and never
leaves this instance — but it belongs in exactly the same category as a
credential you cannot recreate: **it belongs in the backup set** (docs/backup.md),
because losing it does not just cost you a re-login, it silently invalidates every
row Better Auth wrote, including ones a restore would otherwise bring back intact.
AGENTS.md's commit-conventions section calls this out for the same reason: it is
one of the few things here that is genuinely lost, not merely inconvenient to
replace, if it goes missing.

## 4. Mail: an app password over IMAP, and one option for sending

**Reading is always IMAP with an app password** (`IMAP_HOST`/`IMAP_PORT`/... in
`.env.example`), and that is not going to change. Google's own restricted-scope
list settles it: `gmail.readonly`, `gmail.modify`, `gmail.compose` and
`gmail.metadata` are all **restricted**, and so is `https://mail.google.com/`,
which that list defines as "includes any usage of IMAP, SMTP, and POP3
protocols". Restricted means a CASA security assessment, roughly $500 a year,
re-certified every twelve months or production access is revoked. So reading over
the API would put that on every self-hoster — and, the part that surprises
people, doing _IMAP_ over OAuth would need the most restricted scope of all.
OAuth makes the reading side worse on verification, not better. An app password
needs no Google Cloud project whatsoever and works with any provider, not only
Google's. For Gmail: enable 2-Step Verification, then generate an app password
at myaccount.google.com/apppasswords. Note that IMAP is always on for personal
`@gmail.com` accounts since 2025 — there is no setting to enable.

**Watching the mailbox needs only the credentials above — there is nothing to
map per client.** `IMAP_INBOX_MAILBOX` (`INBOX` unless your provider files
client mail somewhere else) is the one mailbox polled. Earlier versions asked
you to point each contract at its own IMAP folder or label; that mechanism is
gone (#394). A message is handed off for extraction only when its sender
address matches a client contact's email address exactly — that match is the
entire attribution, and nothing else stands in for it. Get a contact's email
wrong and the mismatch is invisible until you go looking for it: on this
project's own first real instance, a contact was recorded as
`leonardo@visumlabs.com` while every message actually arrived from
`leo@visumlabs.com`, and nothing on screen said so. Keep every contact's
email the exact address your client sends from, not an alias, an alternate
account, or a display name you happened to type in.

**Sending has two options, and SMTP is the default.** `SMTP_HOST`/... over the
same app password is what most instances want, and the sent message is appended
to your own Sent folder over IMAP so the thread lives where you expect it.

The second option exists for one reason: **many hosting providers block outbound
SMTP entirely.** Measured on this project's own production box, every submission
port — 587, 465, 2525, to Gmail and to two unrelated providers — is refused,
while 443 answers. No amount of configuration fixes that. Setting
`GMAIL_SEND_REFRESH_TOKEN` sends over the Gmail API on HTTPS instead, with the
`gmail.send` scope and nothing else. `gmail.send` is **sensitive, not
restricted**: brand verification, no security assessment. It reuses the same
OAuth client as sign-in, like the Drive mirror does, and the refresh token comes
from the same one-time Playground exchange section 5 walks through — select
`https://www.googleapis.com/auth/gmail.send` there instead of, or alongside, the
Drive scope.

One difference from `drive.file` that matters: **`gmail.send` is sensitive, so
the consent screen must be published.** Under Testing status a project
requesting a sensitive scope issues refresh tokens that expire after seven days,
which is the trap section 1 explains you avoid by keeping sign-in to
non-sensitive scopes. If you want API sending, publish the project. If you would
rather not, use SMTP.

On the API path the Sent append is skipped, deliberately: Gmail files anything
sent through its own API into Sent by itself and dedupes by `Message-ID`, so
appending over IMAP as well would upload the whole message a second time for a
copy that is already there.

### Reusing a refresh token you already have

A refresh token is bound to the OAuth client that obtained it. Refreshing one
issued elsewhere with your sign-in client answers `401 unauthorized_client`, so
if you already hold a token for this account — obtained by another tool, in the
same Cloud project — point the API features at the client it belongs to with
`GOOGLE_API_CLIENT_ID`/`GOOGLE_API_CLIENT_SECRET`. Unset, both features use the
sign-in client, which is correct when that client also ran the consent.

That saves a consent and costs something worth stating plainly: the token's
grant is whatever the other tool asked for, which is probably wider than the
`gmail.send` and `drive.file` this application spends. Nothing here can widen a
grant — no feature names a scope anywhere, by construction — so the behaviour of
the app is identical either way. What changes is what a leak of `.env.prod`
would be worth: a broad grant makes it a mailbox and a whole Drive rather than
"send mail" and "the files this app created". On a single-user instance that can
be a reasonable trade, made deliberately. If you would rather not make it, run
the two-scope consent yourself: it is the same Playground exchange as section 5,
selecting `gmail.send` and `drive.file` and nothing else.

**A single message cannot fill the disk.** `IMAP_MAX_MESSAGE_BYTES` (25 MiB by
default) is checked against the IMAP listing's own reported size before a
message is ever fetched, so anything over it is never buffered whole — this is
a single-host deployment where the documents volume shares a disk with the
database, and the sender otherwise chooses the size. A skipped message is
still recorded, with a reason, on `/mail/contracts/[id]`: invariant 4 (AGENTS.md)
means the bytes may be dropped, but the fact that something arrived may not be.
`DOCUMENT_MAX_BYTES` (50 MiB by default) is the same idea one layer down — the
content-addressed document store's own ceiling, checked inside `storeDocument`
itself so it holds for every caller, mail included, not only for whichever one
remembered to check first.

## 5. The Drive mirror: `drive.file`, or skip it entirely

If you never set `DRIVE_MIRROR_LOCAL_ROOT` or `DRIVE_MIRROR_REFRESH_TOKEN`, the
product works with no mirror at all — this is a supported configuration, not a
degraded one, and nothing on startup or in the interface mentions the mirror when
it is unset.

**A local directory needs nothing from Google.** Set `DRIVE_MIRROR_LOCAL_ROOT` to
any directory this instance can write to — a synced folder (Syncthing, an
rclone or cloud-drive mount) works as well as a plain path on the backup volume.
Every publish writes one file under
`<DRIVE_MIRROR_LOCAL_ROOT>/<DRIVE_MIRROR_CONTRACTS_FOLDER or "Contracts">/<client legal name>/`.

**Google Drive requests only the `drive.file` scope** — access limited to files
the application itself created, never your whole Drive. It is Google's
least-privilege classification for what a mirror of documents this application
generated actually needs, and, like the sign-in scopes in section 1, it is
non-sensitive, so it never forces you out of Testing status either. The
application code has no way to request a broader scope: nothing in its
configuration accepts one.

What Drive needs that this application cannot obtain for you is
`DRIVE_MIRROR_REFRESH_TOKEN` — getting it is a one-time, human-in-the-browser step:

1. Open [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the gear icon (top right) and check **Use your own OAuth credentials**.
   Enter the same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from section 1 — the
   Drive mirror reuses that OAuth client rather than asking you to create a second
   one, since `drive.file` is non-sensitive and does not change what publishing
   status the project needs.
3. In Cloud Console, add `https://developers.google.com/oauthplayground` to that
   OAuth client's **Authorized redirect URIs** — temporarily, if you prefer; it is
   only needed for this one exchange.
4. In the Playground's left panel, find **Drive API v3** and select exactly one
   scope: `https://www.googleapis.com/auth/drive.file`. Do not select a broader
   Drive scope.
5. **Authorize APIs**, sign in with the Google account this instance's Drive
   documents should land in, and consent.
6. **Exchange authorization code for tokens.** Copy the **Refresh token** shown —
   that value is `DRIVE_MIRROR_REFRESH_TOKEN`.
7. Remove the Playground redirect URI from the OAuth client again if you added it
   temporarily in step 3.

The refresh token does not expire under Testing status as long as the consent it
came from only ever covered `drive.file` (the same non-sensitive-scope rule as
section 1) — this is exactly why the mirror reuses the sign-in OAuth client
instead of asking for a wider grant "while you're at it".

## 6. The ACP runner: nothing from Google, optional entirely

The ACP runner (#82, `docs/agent-runner.md`) needs no credential from Google at
all — it never touches this instance's sign-in or mail configuration. What it
needs, if you want it running, is a model reachable as an ACP-speaking CLI
command (`RUNNER_AGENT_COMMAND` in `.env.prod`) and its own database password
(`RUNNER_DB_PASSWORD`, generated the same way as `BETTER_AUTH_SECRET` above).

Leaving `RUNNER_AGENT_COMMAND` unset, or not running the `runner` service
in `compose.prod.yaml` at all, is a fully supported configuration: the rest of
the product works exactly the same, and nothing on startup or in the interface
mentions the runner when it is absent. Read `docs/agent-runner.md` before
configuring it — the credentials, the privilege boundary and what a self-hoster
is actually turning on are all there.

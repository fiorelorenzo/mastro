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

## 4. Not yet applicable: mail and the Drive mirror

Neither of these has a route, a worker, or a config value read anywhere in the
code as of this writing. There is nothing to set up. What follows is the shape the
design (AGENTS.md, README.md) already commits to, so you know what to expect and
why, without configuring anything that does nothing today.

**Mail: an app password over IMAP/SMTP, not the Gmail API.** When the mail worker
lands, mailbox access will be a per-provider app password (Google, or any other
IMAP/SMTP provider — the design is deliberately provider-agnostic), not OAuth and
not the Gmail API. The reason is the same Testing-status mechanics as section 1,
working against you instead of for you: `gmail.readonly` is a **restricted**
scope, not merely sensitive, so routing mail through the Gmail API would both
break weekly in Testing (the seven-day refresh-token expiry that section 1
explains you currently avoid) and require every self-hoster to pass Google's full
verification with a security assessment just to keep reading their own inbox.
IMAP/SMTP with an app password sidesteps that entirely, and works with any mail
provider, not only Google's.

**Drive mirror: `drive.file`, or skip it.** If you never configure this, the
product works with no mirror at all — it is optional. When it lands, it will
request only the `drive.file` scope, which grants access solely to files the
application itself created, never your whole Drive. `drive.file` is Google's
correct, least-privilege classification for what a mirror of documents this
application generated actually needs — not a workaround, the right scope for the
job — and, like the sign-in scopes in section 1, it is non-sensitive, so it never
forces you out of Testing status either.

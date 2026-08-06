# AGENTS.md

Orientation for AI coding agents (Claude Code, Codex, Cursor, Gemini CLI, …) and
human contributors. This file is the source of truth for _how we build_; the
[project board](https://github.com/users/fiorelorenzo/projects/8) is the source of
truth for _what we build and where it stands_.

## What this is

`mastro` is a self-hosted ledger for independent consultants who bill by the day and
whose days must be approved in writing before they are worked. See
[`README.md`](README.md) for the product framing.

There is deliberately **no SPEC.md**. The design lives in the epic descriptions on
the board, each of which carries the architecture for its area, and every issue
states its own acceptance criteria. If you find yourself wanting a spec, the epic you
are working under is missing context — say so in a comment and fix it there, rather
than starting a parallel document.

## Architecture, and the invariants that matter

**Stack.** SvelteKit (`adapter-node`) + TypeScript + Postgres 16. A separate worker
process for mailbox polling, mirror publishing and alerts. An isolated ACP runner for
agentic ingestion. Docker Compose, app bound to loopback, a reverse proxy as the only
edge. Single tenant in the sense that there is one fiscal profile and one ledger —
**not** in the sense that authentication is optional.

**Authentication and external access.** Login is **Better Auth** with Google as the
only social provider, requesting `openid email profile` and nothing more, gated by a
mandatory email allowlist. Mailbox access is **IMAP/SMTP with an app password**, not
the Gmail API, and the Drive mirror uses the `drive.file` scope. This is deliberate,
and the reason is worth knowing before someone "simplifies" it: a Google project in
_Testing_ publishing status issues refresh tokens that expire after seven days unless
the only scopes requested are a subset of name, email and profile. `gmail.readonly`
is a restricted scope, so routing mail through the Gmail API would both break weekly
in Testing and require every self-hoster to pass Google's full verification with a
security assessment to escape it. IMAP also makes the product work with any provider.
`drive.file` is neither sensitive nor restricted, and is the correct privilege anyway
since `mastro` only touches files it created.

**The domain, in one paragraph.** A `client` has `contract`s; a contract has
`rate_card`s with validity periods, and produces `work_unit`s (days) and `invoice`s.
A day's life is `proposed → approved → worked → invoiced → paid`, with the branches
`worked_without_approval`, `disputed`, `revoked`, `rejected`, `unbillable`. An
`approval` is immutable and carries the proof (channel, sender, message id, excerpt,
archived document). A `fiscal_profile` points at a **jurisdiction pack** for a period
of time. `ceiling`s come either from a pack or from a contract.

Five invariants. Breaking one is a defect even if the tests pass:

1. **No country-specific logic outside a jurisdiction pack.** No `if (country ===
'IT')` in the core, ever. If the engine needs to branch, the pack interface is
   missing a capability — extend the interface. Acceptance test: with the `generic`
   pack selected, the entire product still works, minus ceilings.
2. **Pack rules follow the money; contract rules follow the counterparty.** A revenue
   ceiling belongs to a pack and disappears when the regime changes. A clause capping
   one client's share of your income belongs to the contract and survives any change
   of regime. When unsure which one you are modelling, apply that test.
3. **Agents propose, humans confirm.** The ACP runner has no write access to the
   database. Its only output is a `proposal` carrying the verbatim excerpt it rests
   on. Nothing reaches the ledger without a human accepting it.
4. **Never keep only the extracted fields.** Every derived datum keeps its source
   document. If a client disputes a day, what counts is the original message, not the
   row.
5. **Legal strings are never translated.** Statutory citations, tax treatment codes
   and mandatory invoice annotations come from the pack and render verbatim, in the
   language the law requires, whatever the interface language is. Make this hard to
   get wrong in the type system.
6. **Access control is deny-by-default.** A new route or endpoint is protected unless
   it explicitly opts out, so forgetting is safe. An empty allowlist means nobody gets
   in, never everybody. This instance is reachable from the internet, and an open
   Google login without an allowlist lets any Google account register on it.

**State machine constraints are enforced by the database**, not by application
checks. A day on an approval-required contract cannot reach `approved` without an
`approval_id`, and a day recorded as `worked` without one lands in
`worked_without_approval` automatically. That state is a product feature, not an
error to be smoothed over.

## Build order

| Milestone | What it proves                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `v0`      | The ledger protects: no day worked without approval goes unnoticed, no ceiling is crossed blind, this year's history is loaded, and it is usable from a phone in under 30 seconds per day. |
| `v1`      | Days propose themselves from the client's own emails, without imposing a format on the client, and every proposal stays reviewable next to the excerpt that produced it.                   |

Epic order on the board is build order. Foundations, day lifecycle, invoices and
jurisdiction packs are serial: the ceiling engine cannot be written before the pack
interface exists.

## The GitHub Project is the source of truth

Current state and roadmap live on **Project #8 "Mastro roadmap"** (owner
`fiorelorenzo`), not in this file and not in a chat transcript. Keeping the board
current is part of doing the work, not paperwork at the end: it is how the state is
visible without reading session logs, so a board that lags reality is worse than no
board.

**Status is a claim about reality. Keep it true.**

- Before you write code for an issue, move it to `In Progress`. If what you are about
  to do has no issue, create one first, then start.
- Move it to `Done` only when the change is merged and verified, not when the code is
  written. Merged but something still open? Say so in a comment and leave it
  `In Progress`.
- Board fields, the same four as every other roadmap board here on purpose: `Status`
  (`Todo` / `In Progress` / `Done`), `Priority` (P0–P3), `Effort` (S/M/L/XL) and
  `Parallel` (Yes/No — whether a parallel agent can take the issue without
  colliding). Set all four on any **issue** you file. **Epics carry `Status` and
  `Priority` only**: an epic's effort is the sum of its children and its parallelism
  is a property of them, so filling those fields on a container would be a number
  nobody should trust. Never write a value that is not already an option: read the
  schema instead of guessing, and never add, rename or drop a field on this board
  alone.

**Comment when a reader would want to know.** A decision taken, an approach tried and
abandoned, a blocker hit, a surprise in the code, a finding that invalidates the issue
as written. One comment per meaningful turn in the work, not one per commit, and no
routine progress narration.

**File the work you discover.** When something real surfaces mid-task, open an issue
instead of silently widening the current change. Then say in the current issue that
you split it out, with a link.

## Conventions for a new issue

- **Title**: conventional-commit form, `type(area): imperative summary` — e.g.
  `feat(fiscal): cash and accrual duality over one ledger`. Specific beats short.
- **Body**: because there is no spec, an issue must stand alone. State the context,
  what to build, and explicit acceptance criteria. Assume the reader has not read the
  other issues.
- **Labels**: exactly one `type:*` (`feature`, `fix`, `refactor`, `test`, `chore`,
  `ci`, `docs`, `design`, `security`, `spike`), exactly one of
  `priority:P0`–`priority:P3`, and one or more `area:*`. `epic` and `flagship` are the
  only unprefixed labels. Priority lives in two places on purpose, the label and the
  board field: set both.
- **`area:*` values here**: `domain`, `fiscal`, `import`, `agent`, `auth`, `mail`,
  `drive`, `web`, `pwa`, `i18n`, `alerts`, `deploy`, `docs`. Add one only when a surface really
  is new.
- **Milestone**: `v0` or `v1`. An issue that belongs to neither is not ready to be
  filed.
- **Every issue hangs off an epic.** Epics are titled `[Epic] Name` and carry the
  `epic` label. An issue with no parent is a defect in the board.

```bash
# Read the schema, never guess an option value
gh project field-list 8 --owner fiorelorenzo --format json
gh label list -R fiorelorenzo/mastro --limit 100

# Fill these in; everything below runs as written
ISSUE=123; EPIC=456; STATUS="In Progress"     # Todo | In Progress | Done
OWNER=fiorelorenzo; REPO=mastro; PROJECT=8

PROJECT_ID=$(gh project view $PROJECT --owner $OWNER --format json --jq '.id')
STATUS_FIELD=$(gh project field-list $PROJECT --owner $OWNER --format json \
  --jq '.fields[] | select(.name=="Status") | .id')
OPTION_ID=$(gh project field-list $PROJECT --owner $OWNER --format json \
  --jq ".fields[] | select(.name==\"Status\") | .options[] | select(.name==\"$STATUS\") | .id")
ITEM_ID=$(gh project item-list $PROJECT --owner $OWNER --format json --limit 500 \
  --jq ".items[] | select(.content.number==$ISSUE) | .id")

gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$STATUS_FIELD" --single-select-option-id "$OPTION_ID"
```

## Language

- **Code, comments, identifiers, commit messages, issues, PRs and documentation:
  English.** No exceptions, including internal comments.
- **The interface is multilingual**: English and Italian at launch, through a
  compile-time type-safe i18n layer. A missing key fails the build.
- Number, date and currency formatting goes through `Intl`, never hand-rolled.
- Jurisdiction packs carry their own label bundle in every supported language.
- And again, because it is the one that gets broken: **legal strings are data, not
  copy. They are never translated.**

## Commits and branches

Conventional Commits (`feat(fiscal): ...`, `fix(import): ...`). Branch per issue,
`type/short-slug`. Never commit to `main` directly once CI exists. No secret ever
enters the repository (and `BETTER_AUTH_SECRET` belongs in the backup set, because
losing it invalidates every session): real client data, contracts and invoice documents stay out,
and test fixtures derived from real documents must be anonymised — names, tax ids and
amounts changed, structure kept.

## Local development

Requirements: Node 24 (pinned in `.nvmrc`), pnpm, Docker with the Compose plugin.

```bash
cp .env.example .env     # once; .env is never committed
pnpm install
pnpm dev                 # starts Postgres, applies migrations, then Vite on :5187
```

`pnpm dev` is the whole story: it runs `db:up` (Compose, waits for the healthcheck),
then `db:migrate`, then `vite dev`. From an empty machine it produces a working
database and a running app, and `GET /health` returns `{"status":"ok"}` only when the
database really answers.

|Command|What it does|
|---|---|
|`pnpm dev`|Database, migrations and Vite on `:5187`|
|`pnpm build` / `pnpm preview`|`adapter-node` bundle in `build/`, then run it|
|`pnpm check`|`svelte-check` (types, unused exports, a11y)|
|`pnpm lint` / `pnpm format`|Prettier check plus ESLint / rewrite in place|
|`pnpm test`|Vitest, one run|
|`pnpm db:up` / `pnpm db:down`|Postgres 16 container, loopback on `:5436`|
|`pnpm db:migrate`|Apply every pending migration|
|`pnpm db:reset`|Destroy the volume and rebuild from empty|
|`pnpm db:generate`|Generate SQL from the TypeScript schema|
|`pnpm db:generate:custom`|Empty migration to hand-write SQL into|

Ports are fixed (app `5187`, Postgres `5436`) so this project can run beside the
others on the same box. Postgres is published on `127.0.0.1` only.

### Migrations

**Drizzle ORM, with the SQL committed.** The tables live in TypeScript, one file per
area under `src/lib/server/db/schema/`, re-exported from that folder's `index.ts`;
`pnpm db:generate` turns them into numbered SQL in `drizzle/`, which is committed and
is what actually runs. `pnpm db:migrate` applies it through
`scripts/migrate.ts`, plain `node` with type stripping, so the deployed image can run
the same script on boot without dev dependencies.

**`drizzle-kit push` is not used and there is no script for it.** It diffs a live
database against the schema and would silently drop the constraints below, which the
generator cannot see.

Everything the generator cannot express — CHECK constraints, triggers, partial unique
indexes, the state-machine rules — goes in a hand-written migration from
`pnpm db:generate:custom --name=<what_it_does>`, committed next to the generated ones.
That is not a workaround: those constraints are where the invariants are enforced, so
they belong in SQL and are reviewed as SQL.

Conventions every table follows: `id` uuid, `created_at`, `updated_at`, using the
helpers in `src/lib/server/db/columns.ts`, and a trigger installing `set_updated_at()`
(migration `0000`) so an UPDATE cannot forget the timestamp:

```sql
CREATE TRIGGER <table>_set_updated_at BEFORE UPDATE ON "<table>"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Tests

Vitest, in a node environment, `*.test.ts` next to the code. Database tests use the
real database (`pnpm db:up && pnpm db:migrate` first) and do their work inside a
transaction they roll back, so the suite leaves nothing behind and does not care about
order. `src/lib/server/db/set-updated-at.test.ts` is the pattern to copy.

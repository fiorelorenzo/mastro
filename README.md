# mastro

_From the Italian **libro mastro** — the general ledger._

A self-hosted ledger for independent consultants who bill by the **day**, and whose
days have to be **approved in writing before they are worked**.

## Who this is for

You, if: you invoice on a day rate, your contracts require written pre-approval
before a day counts, you have to submit a register of worked days with every
invoice, and at least one client's payment terms, renewal clause or fiscal ceiling
is not something you want to track by memory. If you invoice hourly with no
approval step and no ceiling to watch, this is more machinery than you need — a
plain timesheet will serve you better.

## The problem

Day-rate consulting contracts increasingly say some version of this:

> The Contractor shall be entitled to payment only in respect of days that have been
> approved in advance and in writing by the Client, specifying the date, whether the
> day is full or half, and the task assigned. No act or omission of the Client,
> including knowledge or acceptance of work performed, shall constitute approval.

A day you worked without that email is worth nothing. On top of it, the same
contracts usually require you to submit a register of those days with every invoice,
renew on short fixed terms with no tacit renewal, and pay on terms that differ from
client to client.

Meanwhile, whether you can even accept the next day of work may depend on a tax
ceiling measured on cash received, and on clauses capping how much of your income a
single client may represent.

No existing tool models any of this. Timesheets (Kimai, Solidtime, Clockify, Toggl,
Harvest) record hours after the fact, and where they have approval at all it is
weekly and retrospective — the exact inverse of the requirement. Invoicing tools
cover invoice to payment but know nothing of the day that precedes it. National
e-invoicing suites stop at issuing the invoice and never look forward.

## What makes it different: approval first

Every other tool in this space starts from the day you worked and asks whether it
gets paid. `mastro` starts from the approval and asks whether a day may be worked at
all. A day's life is `proposed → approved → worked → invoiced → paid`, and the
branch that matters most is `worked_without_approval`: a day recorded without a
prior written approval does not get quietly folded into the ledger as if it were
fine, it lands in a state that says, in the data itself, "this one is a risk." That
state is enforced by database triggers, not application code that a bug or a rushed
change could bypass.

## What works today

- **Clients, contracts and rate cards.** Legal identity, notice channel, day rates,
  fixed recurring fees and hourly work, renewal that is explicit, tacit, at the
  counterparty's option or absent, payment terms that are net-N or by day N of the
  following month. Reachable at `/clients` today.
- **The day lifecycle and approval model.** The state machine above, an immutable
  `approval` record carrying the proof (channel, sender, message id, excerpt,
  archived document), and the database triggers that enforce every transition,
  including the automatic fall into `worked_without_approval`. This is built and
  tested end to end at the domain and database layer; the screen to record a day
  from a phone is on the board, not merged yet.
- **Jurisdiction packs.** A pack interface with no country-specific logic in the
  core, a `generic` pack that leaves the whole product working with no ceilings at
  all, and `it-flat-rate` and `it-standard` packs for the Italian regimes they name.
  Contract-level constraints (a clause capping one client's share of your income)
  attach to the contract and outlive any change of regime.
- **Import parsing.** A neutral `Invoice` type and format adapters, with FatturaPA
  1.2 as the first one, plus direction detection so an incoming and an outgoing
  invoice are never confused. Parsing is real and tested; writing a parsed invoice
  into the ledger is the next piece of work, not this one.
- **Sign-in.** Google OAuth through Better Auth, a mandatory email allowlist, and
  deny-by-default routing: a route is protected unless it is explicitly listed as
  public, so adding a route without thinking about auth is safe by construction.
- **English and Italian**, through a compile-time-checked i18n layer — a missing
  translation key fails the build rather than shipping a blank string. Legal
  citations and statutory figures never pass through translation; they render
  verbatim in the language the law requires.
- **A PWA.** Installable, with a service worker that precaches the app shell,
  serves already-fetched data stale-while-revalidate and marks it as such rather
  than passing a saved figure off as current, and shows an honest "you're offline"
  page instead of a broken one when there is nothing to fall back on. A new
  deployment replaces the running worker rather than pinning an old build.
- **A production deployment path.** Docker Compose with a Caddy reverse proxy
  terminating TLS, a documented backup and restore procedure that has actually been
  rehearsed, and a self-hosting guide covering every credential you need to create.

## What it deliberately does not do

It does not issue invoices, talk to any tax authority, do accounting, compute tax
due, or reconcile bank accounts. It reads what your invoicing service already issued
and tells you what it means for the work ahead. It also does not, yet, read your
contracts or approval emails for you — an ACP agent that proposes a diff for you to
confirm is designed for (agents propose, humans confirm; nothing reaches the ledger
without a human accepting it) but not built.

## Running it

Requirements: Node 24 (pinned in `.nvmrc`), pnpm, Docker with the Compose plugin.

```bash
git clone https://github.com/fiorelorenzo/mastro.git
cd mastro
cp .env.example .env     # once; .env is never committed
pnpm install
pnpm dev                 # starts Postgres, applies migrations, then Vite on :5187
```

`pnpm dev` is the whole story: it brings up Postgres via Compose, applies every
migration, and starts Vite. From a clean checkout it produces a working database
and a running app, and `GET /health` returns `{"status":"ok"}` only once the
database actually answers. Google sign-in needs a real OAuth client to go past the
sign-in screen; `docs/self-hosting.md` walks through creating one.

For running this for real, `docs/deploy.md` is the production Compose runbook (a
separate stack from the one `pnpm dev` uses, so the two never collide),
`docs/backup.md` covers backup and a rehearsed restore, and `docs/self-hosting.md`
walks through every credential a self-hoster has to create and why each one is
shaped the way it is.

Full command reference, migration conventions and the five invariants the codebase
does not bend on live in [`AGENTS.md`](AGENTS.md).

## Where the design lives

There is deliberately no SPEC.md. The design lives on the
[project board](https://github.com/users/fiorelorenzo/projects/8): each epic
carries the architecture for its area, and every issue states its own acceptance
criteria. `AGENTS.md` is the source of truth for how the codebase is built —
conventions, invariants, migration rules; the board is the source of truth for what
is built and where it stands. If an epic is missing context an implementer needed,
that is treated as a defect in the board, not a reason to start a parallel document.

## Contributing

The board carries the full breakdown, and every issue states its own acceptance
criteria. Issues labelled `parallel` on the board can be picked up independently.
Conventions live in [`AGENTS.md`](AGENTS.md).

## License

MIT — see [`LICENSE`](LICENSE).

# mastro

*From the Italian **libro mastro** — the general ledger.*

A self-hosted ledger for independent consultants who bill by the **day**, and whose
days have to be **approved in writing before they are worked**.

> **Status: early.** The design is settled and the work is broken down on the
> [project board](https://github.com/users/fiorelorenzo/projects). There is no
> runnable code yet. The board is the roadmap and the source of truth.

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

## What mastro does

- **A day ledger with proof.** Every day carries the reference to the written
  approval that authorised it, and the state `worked_without_approval` exists
  precisely so that the risk is visible rather than discovered at invoicing time.
- **Contracts as data.** Day rates, fixed recurring fees and hourly work; renewal
  that is explicit, tacit, at the counterparty's option or absent; payment terms that
  are net-N or by day N of the following month; notice periods that bound how far
  ahead anything is actually certain.
- **Ceilings as first-class citizens.** Fiscal ceilings arrive as **jurisdiction
  packs**, declarative modules that carry a country and regime's accounting basis,
  thresholds, tax treatments and invoice formats. The core contains no
  country-specific logic; a `generic` pack leaves the whole product working with no
  ceilings at all. Contract-level constraints attach to the contract and outlive any
  change of regime.
- **Import instead of integration.** Point it at a folder and it reads structured
  e-invoices deterministically (FatturaPA first, more via format adapters), skipping
  incoming invoices and never duplicating on a re-run. That is also how you load
  history on day one.
- **Agents propose, you confirm.** Contract PDFs and approval threads written in
  ordinary prose are read by an ACP agent that emits a proposed diff, never a write.
  Because a renewal clause can be ambiguous to an expert human, and a system that
  silently picks an interpretation produces wrong numbers wearing the face of right
  ones.
- **A PWA.** Installable, mobile-first, with an offline queue for recording a day and
  web push for the alerts that matter.

Interface in English and Italian. Code, comments and documentation in English.

## What it deliberately does not do

It does not issue invoices, talk to any tax authority, do accounting, compute tax
due, or reconcile bank accounts. It reads what your invoicing service already issued
and tells you what it means for the work ahead.

## Self-hosting

SvelteKit (`adapter-node`) and Postgres, single tenant, behind a reverse proxy that
terminates TLS. Deployment instructions will land with the first release.

Sign-in is Better Auth over Google, with a mandatory allowlist of permitted
addresses. Everything else it needs is deliberately chosen to avoid Google's
verification process: mail is read and sent over **IMAP/SMTP with an app password**
rather than the Gmail API, and the Drive mirror asks only for `drive.file`. You
should never have to submit your own instance for a security assessment just to read
your own inbox.

## Contributing

The board carries the full breakdown, and every issue states its own acceptance
criteria. Issues labelled `parallel` on the board can be picked up independently.
Conventions live in [`AGENTS.md`](AGENTS.md).

## License

MIT — see [`LICENSE`](LICENSE).

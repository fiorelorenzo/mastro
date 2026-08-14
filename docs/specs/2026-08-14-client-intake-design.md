# Client intake: what a client must have, how a file gets in, and where a client comes from

2026-08-14. Design, agreed before implementation. Three changes that look
separate and are not: all three are about the moment a client enters the
ledger, which today demands too much, accepts files awkwardly, and decides
on its own who the client is.

## Why these three together

Recording a client currently requires nine facts: legal name, country, tax
id, street, city, postal code, notice channel, and at least one contact.
Most of them are not knowable when you first want the row to exist — you
have a contract PDF in front of you and a name. So the form refuses, and
the way around it is to invent values, which is worse than leaving them
empty because an invented address goes onto an invoice.

Meanwhile the file that would have told the product those facts arrives
through a bare button, and when a contract PDF does name a client, the
accept path silently decides whether that client already exists and throws
away any detail the document carries that disagrees with what is on file.

## Decisions taken

Two were the owner's to make and were made:

- **A client needs a legal name and a country. Nothing else.** Everything
  else becomes optional at creation, and the refusal moves to the point of
  use.
- **The client behind an extracted contract is always an explicit choice**,
  with conflicting values shown field by field rather than resolved
  silently.

The third was decided from the code: the drop zone replaces every file
input in the product, not only the two import screens, because a second
convention for choosing a file is exactly what the design system exists to
prevent.

---

## 1. A client needs a legal name and a country

### Schema

One migration makes five columns nullable: `tax_id`, `address_line1`,
`address_city`, `address_postal_code`, `notice_channel`. The
at-least-one-contact rule stops being enforced by the form.

`tax_id` keeps its `UNIQUE` constraint. That is not an oversight: in
Postgres, `NULL` values do not collide under a unique constraint, so any
number of clients without a tax id coexist while two sharing a non-null one
are still refused by the database rather than by an application check. No
partial index is needed, and the guarantee import matching relies on is
unchanged for every client that has the field.

`matchClientByTaxId` (`src/lib/server/import/client-match.ts`) must be
corrected in the same change. It normalises both sides and compares them,
which for two absent tax ids would compare `null` with `null` and declare
two unrelated clients to be the same one. An absent tax id matches nothing,
including another absent tax id.

### A fact worth recording about `notice_channel`

Nothing reads `client.notice_channel` to decide anything. Two places
_write_ it without being told: `applyProposal`'s contract case and
`buildClientContractProposal` both default it to `'email'`, the latter with
a comment admitting that "an invoice reveals nothing about how this client
prefers to receive a legal notice".

So making it nullable is not merely permitted, it is more honest than what
is there now: both invented defaults are removed, and the column stays
empty until somebody knows the answer.

To be exact about what this change does _not_ do: there is no
notice-sending surface in the product yet. `renewalNoticeDays` and
`terminationNoticeDays` are read by the contract form, the reports page and
the alert engine, and nothing anywhere sends a renewal refusal or a
termination. When that surface is built it will need this field and must
refuse without it — but that refusal belongs to that work, not to this
change, and claiming otherwise would be inventing a reader to justify a
column.

### The refusal moves to the point of use

A pure function, `clientInvoicingGaps(client, pack)`, returns the fields
this client is missing for the invoicing the active jurisdiction pack
describes. It has three readers:

1. The **invoice detail** screen's "generate XML" action: disabled, naming
   the missing field, with a link to the client's edit screen.
2. The **client detail** screen: a completion state, the same shape
   `practice_profile` already uses for "not configured yet" (#258) rather
   than a new pattern.
3. The **FatturaPA generator**, which already throws naming the field it
   cannot fill. That stays, as the last net rather than the first: a
   generator that trusted its caller would be a generator that emits an
   invalid document.

The pack decides what is needed, so this stays inside invariant 1: the
function asks the pack whether it declares an invoice format at all, and a
`generic`-pack instance reports no gaps because it has no national format
to satisfy.

### Consequences, stated plainly

An imported invoice from a client with no tax id on file cannot be matched
by tax id. That is not a new failure mode: "no match" is a path the import
review already has, and it asks. The change makes that path reachable more
often, not less safely.

---

## 2. One drop zone, everywhere a file is chosen

`DropZone.svelte` joins `$lib/design` and replaces `FileInput` at all five
current call sites (`/import`, `/import/days`, `/invoices/[id]` receipt
upload, `/invoices/propose`, `/clients/new/from-pdf`), and absorbs the two
raw `<input type="file">` elements still in the tree — the expense receipt
in `ExpenseForm.svelte` and the proof file in `/approvals/new`.

### Shape

- A `<label>` wrapping a visually hidden but present `<input type="file">`,
  which is what `FileInput` already does. Clicking anywhere in the zone
  opens the picker; keyboard focus, Enter/Space activation and the
  accessible name stay the browser's own behaviour rather than an
  imitation.
- Drag over highlights the zone; dropping writes the files onto the input
  through a `DataTransfer`, so **the surrounding form still submits
  natively**. The drop zone is an improvement layered over something that
  already works without JavaScript, not a replacement that needs it.
- The chosen file names are listed, each removable.
- `prefers-reduced-motion` respected: the highlight is a colour and border
  change, not a transition that fights the setting.

### The part that actually needs care

`accept` is enforced by the native picker and **not** by drag and drop. A
dropped file of the wrong type must be refused with a message naming what
was expected, never silently accepted — otherwise the product's most
forgiving-looking control becomes its least honest one, and the failure
surfaces much later as an extraction that made no sense.

Multiple selection and `webkitdirectory` both stay supported, because the
invoice import takes a folder. The existing directory-picker button on
`/import` is kept: `showDirectoryPicker` gives a better experience where it
exists, and the drop zone replaces only the fallback beneath it.

### Testing

The extractable logic — matching a file against an `accept` list, merging a
drop into an existing selection, the rejection reasons — is a pure module
with unit tests, following `button-classes.ts` and `badge-variants.ts`.
Drag and drop itself is verified in a real browser with real files, because
that is the half no unit test can see.

---

## 3. Where a client comes from when a document names one

### Today

`applyProposal`'s contract case calls `getClientByTaxId` and, on a match,
attaches the contract to that client while discarding every extracted
detail; on no match it creates a client from the extracted fields. The
reviewer is never asked and never told.

### The change

The contract proposal review screen grows a client section with two modes:

- **Link an existing client** — a picker, preselected to the tax-id match
  when there is one, so the common case is one glance and no typing.
- **Create a new client** — the extracted fields, already editable on that
  screen today.

When an existing client is linked and the document's values differ from
what is stored, each differing field is shown with both values and a
checkbox, _unchecked by default_, to adopt the document's version. A
changed registered address is exactly the kind of thing that ends up on an
invoice, so it must be visible; and it must not be applied merely because a
PDF asserted it.

`applyProposal` stops guessing and takes the decision as data:

```ts
type ClientChoice =
	| { kind: 'existing'; clientId: string; updates: Partial<ClientInput> }
	| { kind: 'new'; fields: ClientInput };
```

performed inside the transaction it already opens, so a contract, its rate
cards, its clause notes and its client either all land or none do.

### Reuse, not a second vocabulary

The invoice-import lane already models this: `matchClientByTaxId` and
`ClientProposal` in `src/lib/server/import/client-match.ts`, with
`review.ts` grouping by customer so three invoices from one new client
produce one decision. The contract lane uses those types rather than
introducing parallel ones, and the conflict diff is the genuinely new
piece.

### Out of scope, deliberately

- **Invoice proposals from PDF** (#87) are scoped to an existing contract,
  so the client is already known. Nothing to choose.
- **Folder import** already has its own client-matching review screen. It
  benefits from the `matchClientByTaxId` null fix and from nothing else
  here.

---

## What could go wrong

| Risk                                           | Why it is acceptable                                  | How it is checked                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Nullable `tax_id` weakens import matching      | "No match" already asks rather than guessing          | A DB test: two clients with the same non-null tax id still rejected by name of constraint, many with `NULL` accepted         |
| A dropped file bypasses `accept`               | Refused with a reason, not accepted                   | Unit test on the matcher, plus a real drop of a wrong-typed file in a browser                                                |
| Nullable `notice_channel` breaks something     | Nothing reads it today, and the two writers invent it | Grep-verified across `src/`; a future notice surface must require it, and that is named in this document rather than assumed |
| The conflict diff silently applies a value     | Checkboxes default to unchecked                       | A DB test per branch: linked-and-untouched, linked-with-updates, created-new                                                 |
| A client with no address reaches the generator | The generator already throws naming the field         | The gap function is unit-tested against each pack, and the generate action is disabled with the reason shown                 |

## Order of work

1. The migration and `matchClientByTaxId`'s null fix, with the client form
   and its validation following — this is the change everything else sits
   on, and it is the one that must not be split across parallel work.
2. `clientInvoicingGaps` and its three readers.
3. `DropZone.svelte` and the seven call sites.
4. The client section on the contract review screen, and `ClientChoice` in
   `applyProposal`.

Steps 2, 3 and 4 are independent of each other once 1 has landed. Step 1 is
not parallel-safe: it touches the client schema, the client form, its
validation and the import matcher at once, and a wave that tried to change
a column six files read alongside seven siblings is how a whole day's work
was thrown away once already.

`scripts/seed-demo.ts` needs no change: it passes every client field
explicitly, and a caller supplying a value to a column that has become
nullable stays valid. That is worth stating because the obvious assumption
is the opposite.

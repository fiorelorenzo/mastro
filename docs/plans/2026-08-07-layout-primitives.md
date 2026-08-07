# Layout primitives and the dense pages

Step 3 of `docs/specs/2026-08-07-ui-shell-redesign.md`, issue #153. The shell (#146)
made every route reachable and the page header (#152) made every route say where it
is. What is left is the inside of the pages, which is where four routes still scroll
sideways on a phone and where a client's whole life is one uninterrupted column.

## What the spec asks for, and one correction

The spec says three primitives and no more: **Page**, **Section**, **Card**. It also
says "tables become card lists below 640px, `ChartFrame` already does exactly this for
the cash calendar; the behaviour is extracted rather than written twice."

That last sentence is wrong about the code and the plan does not follow it.
`ChartFrame` toggles between **a chart and a table**, on `matchMedia`, with a manual
override that wins once used. It has no table-to-card behaviour to extract. Reusing
its shape would also mean JavaScript deciding the layout, a flash on hydration and
nothing at all without JS.

So the fourth thing this plan builds is a **`RecordList`**, which renders the same
rows as a table above 640px and as one card per row below it, in CSS, with no
JavaScript. That is a primitive too, which makes four rather than three. It earns its
place: five hand-written `<table class="mt-4 w-full border-collapse text-sm">` blocks
exist today, four of them overflow at 390px, and every one of them would otherwise
grow its own responsive behaviour.

`DataTable` in `$lib/design/charts` stays exactly where it is and is not touched: it
is the table twin of a chart, always rendered inside a `ChartFrame`, and it answers a
different question.

## Measured, so the work has a target

At 390px on a seeded instance, with the numbers from the #152 sweep:

| route           | overflow (en / it) | what sticks out           |
| --------------- | ------------------ | ------------------------- |
| `/clients`      | 50px / 122px       | the clients table         |
| contract detail | 311px / 311px      | the rate cards table      |
| `/invoices`     | 34px / 82px        | the unpaid invoices table |
| `/invoices/new` | 29px / 29px        | the contract-picker row   |

The Italian column is the one that matters: a longer word in a header cell is what
pushes three of these over, and testing in English alone understates all of them.

## The primitives

### `Page` (`src/lib/layout/Page.svelte`)

The `<main>` wrapper, which today is `class="mx-auto max-w-3xl p-8"` copied into 35
files, with three of them disagreeing about the width. Props: `title`, `subtitle`,
`crumbs`, and an `actions` snippet, all forwarded to `PageHeader`, plus `width` which
is `'text' | 'wide'` and defaults to `text`.

`wide` exists for the two pages that carry a table with more than four columns, and it
is a named choice rather than a number so a third page cannot invent `max-w-5xl`.

### `Section` (`src/lib/layout/Section.svelte`)

A titled block: an `<h2>`, an optional `actions` snippet on the right for the create
links that live with their section, and one spacing scale. Today every page picks its
own `mt-6` or `mt-4`, and the client detail page has sections with no heading at all.

### `Card` (`src/lib/layout/Card.svelte`)

A hairline border on the page surface, using `--border-hairline` and `--surface-page`,
which already exist. No shadow, no radius beyond what the palette already sets, no new
token.

### `RecordList` (`src/lib/layout/RecordList.svelte`)

Generic over `Row`. Props: `columns` (`key`, `label`, `align`, optional `format`),
`rows`, `caption`, and an optional `rowHref` so a row can be a link, since three of
the five tables have a "view" link in the last cell today.

Above 640px it renders a `<table>`. Below, one `Card` per row: the first column as the
card's title, the rest as label-and-value pairs. Both renderings come from the same
`columns` array, so a column added to one appears in the other; that is the whole
point, and it is what a hand-written phone variant per page would not give.

Both are in the DOM and CSS hides one. The alternative, rendering one and swapping on
`matchMedia`, needs JavaScript and flashes on hydration. Row counts here are a handful
per page, so the duplicate markup costs nothing measurable.

## Tasks

Each ends with a commit. Tests are `pnpm test`, and the browser check is on **an empty
instance and a seeded one**, at 320/390/768/1440, both languages, light and dark.

### 1. The four primitives, and one page on them

Write `Page`, `Section`, `Card` and `RecordList` under `src/lib/layout/`. Apply them to
`/clients`, which is the smallest page with a table, and verify its 390px overflow is
gone: 50px in English and 122px in Italian, both to zero.

`RecordList` gets a unit test for the only logic it has that can be wrong without being
visible: a column with a `format` uses it in both renderings, and a column list with a
duplicate `key` throws rather than rendering a keyed loop with a repeated key. That
second one is not defensive programming, it is the third time this failure has cost a
blank page (#143, and the template crumbs in #152).

### 2. The client detail page

Today: one column of identity, contacts and a contracts table, with `mt-6` between
things and an `<h2 class="mt-4 text-sm font-semibold">` doing the work of a section
heading. Rebuild on `Section`, with the contracts table as a `RecordList`, and the
"new contract" link staying with its section rather than moving to the page header.

### 3. The contract detail page

The worst one: 300 lines, seven sections, three tables, 311px of overflow at 390px.
Same treatment. The three create links (rate card, clause note, expense) stay with
their sections, which is the convention #159 settled.

### 4. Invoices and ageing

`/invoices` and its table, plus `/invoices/new`'s contract picker, which overflows for
a different reason: a `button.border.px-4` in a row that does not wrap. That one is a
flex-wrap fix, not a `RecordList`.

### 5. `/day/new` on a phone

The thirty-second promise v0 makes. Nothing here overflows today, so this task is
about the form being usable one-handed: field order, target sizes, and the submit
button reachable without scrolling past the fold on a 390x844 screen. Measure it and
say the number in the pull request.

### 6. `Page` across the remaining routes

Mechanical: replace `<main class="mx-auto max-w-3xl p-8">` plus `<PageHeader>` with
`<Page>` everywhere it has not already happened. One convention, not two.

### 7. The sweep

All 35 routes, both instances, four widths, both languages, light and dark. Zero
horizontal scroll anywhere is the acceptance criterion this issue exists to meet.

## Not in this plan

Growing `/settings`, any new colour, any component library, animation, and the
`MinorUnits` branding (#168). A page that wants a fifth primitive is a page to argue
about, not a primitive to add.

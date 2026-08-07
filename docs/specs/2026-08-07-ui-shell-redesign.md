# The application shell: navigation, page structure, layout

Design for the UI redesign Lorenzo asked for on 2026-08-07: "la UI non mi piace per
niente, lo schema colori e la favicon vanno bene, ma il layout no, manca anche una
navbar (sidebar) per clienti, contratti ecc."

## The problem, measured

The global layout today is four lines: an offline banner, the language switch pushed
to the right, the page, the install prompt. There is no shell, no header, no
navigation of any kind.

- **35 routes exist. The home page links to three of them** (`/day/new`,
  `/proposals`, `/day/calendar`). Nothing anywhere links to `/clients`, `/invoices`,
  `/import`, `/mail` or `/alerts`: five whole sections reachable only by typing the
  URL.
- **`/clients` is a circular island.** The only link to it is on a client's own
  detail page, which is only reachable from `/clients`.
- **Twenty pages hand-roll the same header**: a flex row with an `<h1>` and a
  `text-sm underline` back link, copied with small variations. Pages five levels deep
  (rate card edit) carry a single "back to contract" link and no indication of where
  they are.

So this is not a styling problem. Everything past the home screen is unreachable, and
every page invents its own chrome. Both have to be fixed by the same change.

## What is not changing

The palette, the tokens and the favicon stay exactly as they are: Lorenzo said they
are fine, and `src/lib/design/palette.css` already carries `--surface-page`,
`--text-primary`, `--text-secondary`, `--border-hairline`, the status colours and the
certainty ramp, validated in light and dark by `#56`'s checker. No new colours, no
component library on top of the design system, no animation, no change to any domain
logic or to the charts.

## Information architecture

Hybrid, decided by Lorenzo: the two daily things first, then the objects, then what is
opened rarely.

| Group      | Items                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| Daily      | Today (the dashboard), Calendar                                                  |
| Objects    | Clients (contracts, rate cards, clause notes and expenses live inside), Invoices |
| Occasional | Import, Communications, Alerts (with an unread count), Settings                  |

`Settings` does not exist yet as a page. The fiscal profile, the interface language
and the alert preferences are scattered across three places today; this design gives
them one home. That is the only new route.

## The shell

**At or above 900px:** a fixed 240px sidebar on the left, scrolling independently, and
the content to its right with a 1100px maximum. The sidebar carries the product name,
the three groups, and at the bottom the signed-in address with the language switch and
sign-out.

**Below 900px:** the sidebar is gone. A fixed bottom bar carries four items (Today,
Calendar, Clients, Invoices) plus "More" for the rest. Four, because those are the
only ones opened with a phone in hand, and v0's promise is a day recorded in under
thirty seconds one-handed: an entry form behind a hamburger menu does not survive that
budget.

The active item is marked by a solid left border **and** a heavier text weight, never
by colour alone (AGENTS.md's dataviz rule applies to chrome too, and the same rule is
what `StatusIndicator` already follows).

## The page header

One component, used by all 35 routes:

```
Clients › Studio Rossi › Contratto quadro 2026        [Edit] [New rate card]
Contratto quadro 2026
From 1 Jan 2026 · tacit renewal · 30 days notice
```

Breadcrumb, title, optional subtitle carrying the facts that matter, actions on the
right. It replaces the twenty hand-rolled headers. Below 640px the breadcrumb collapses
to a single "back to <parent>" link and the actions move under the title.

The breadcrumb is data, not a guess: each route supplies its own trail through the
page's `load`, because only the loader knows a contract's client. No path parsing.

## Layout primitives

Three, and no more:

- **Page**: the padding, the maximum width, the header slot.
- **Section**: a titled block with one spacing scale, so two pages cannot disagree.
- **Card**: hairline border on the page surface, the token that already exists.

Tables become card lists below 640px. `ChartFrame` already does exactly this for the
cash calendar; the behaviour is extracted rather than written twice.

## Work, in order

1. **The shell** (`src/routes/+layout.svelte`): sidebar, bottom bar, content frame. No
   page changes, but every route becomes reachable. On its own this is the difference
   between a usable product and an unusable one.
2. **Page header and breadcrumb**: the component, then applied route by route.
3. **The dense pages**: the client detail (today one endless column of contracts, rate
   cards, clause notes and expenses, which becomes sections), the contract detail,
   `/day/new` on a phone, invoices and ageing.
4. **Settings**: the new page, collecting what is scattered.

Each step is separately shippable and separately verifiable. Step 1 alone is worth
deploying.

## Verification

Against **an empty instance and a seeded one**, at 320, 390, 768 and 1440, in light and
dark, in Italian and English:

- every route reachable from the shell in one or two clicks
- no horizontal scroll at any of those widths
- touch targets at least 44px
- the browser console clean on every screen
- greyscale screenshot to prove the active item is legible without colour

The empty instance is first on that list on purpose: it is the state every new install
starts in, nothing was exercising it, and it is what shipped a blank dashboard in
v0.1.2 (#143).

Screenshots before and after go in the pull request, with the numbers.

## Risks

- **Scope.** Touching 35 routes in one change would be unreviewable. The four steps
  above land as four pull requests, in that order.
- **The i18n catalogues.** Every new string lands in both `messages/en.json` and
  `messages/it.json`; a missing key fails the build, which is the gate working.
- **The service worker.** The shell changes what the precached shell contains. The
  offline page must keep working, and `#140`'s rule stands: never cache an
  authenticated document.

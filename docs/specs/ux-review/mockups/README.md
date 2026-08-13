# The mockup

`mastro-mockup.html` — one file, no folder, no network. Double-click it.
Everything is inside: the stylesheet, both webfont faces, every screen.

`index.html` is the same page but reading `system.css` and `fonts/` from
disk, which is the one to keep open while editing a fragment.

## What it is

Real markup, not pictures. Seven screens built from the same class contract,
with three visual directions and two colour schemes that swap live:

- the switcher at the top, or
- keys `1` `2` `3` for the direction and `d` for light/dark.

The point of the exercise is that **the markup never changes**. Only the
tokens do. If a screen needs its own CSS to survive a direction change, the
direction is not a direction and the design system has a hole in it — so far
none of them did.

The data is the real seeded instance from the review: Nordwind Logistics,
Bellani & Partners, Fermata Digitale, an invoice 34 days overdue, a day worked
without approval on 21 July, two proposals from one archived email. Today is
13 August 2026 everywhere.

## The three directions

|                               | type                                  | chrome                                        | density   |
| ----------------------------- | ------------------------------------- | --------------------------------------------- | --------- |
| **b1 Ledger**                 | system stack, nothing to load         | flat, hairlines, 2px radius, no shadow        | 36px rows |
| **b2 Ledger with confidence** | IBM Plex Sans + Plex Mono for figures | white cards on grey, soft shadow, 10px radius | 44px rows |
| **b3 Console**                | IBM Plex Mono throughout              | dark by default, 3px radius, high contrast    | 32px rows |

Status colours are the same in all three: they come from the already validated
chart palette in `src/lib/design/palette.ts` and are not up for discussion.

## Files

|                                         |                                                                     |
| --------------------------------------- | ------------------------------------------------------------------- |
| `system.css`                            | the class contract. Tokens per direction, then every component.     |
| `fonts.css`, `fonts/`                   | IBM Plex Sans (variable) and Mono, latin subset, 91 KB, SIL OFL 1.1 |
| `_shell.html`                           | the shared sidebar, copied into every desktop screen                |
| `00-components.html` … `60-states.html` | one fragment per screen                                             |
| `build.mjs`                             | assembles them; `--inline` also writes the single-file version      |

## Rebuilding

```bash
node docs/specs/ux-review/mockups/build.mjs --inline
```

Fragments are picked up by filename (`NN-name.html`), sorted, and their `<h2>`
becomes the entry in the top navigation. To add a screen, drop in a file that
starts with `<section class="g-screen" id="…">` and rebuild.

## Rules a fragment must follow

1. Only classes defined in `system.css`. If one is missing, add it there, not
   inline.
2. Inline `style` for one-off geometry only — a width, a grid span, a meter's
   percentage. Never a colour, a font, a radius, a shadow or a font size that
   is not a `var(--token)`.
3. It has to survive all three directions and both schemes. b3 is monospace at
   13px; b2 is 44px rows. A layout that only works at one density is not done.
4. Real Italian copy and the real dataset. No lorem, no "Cliente 1".
5. Real `<button>`/`<a>`, `aria-current`, `aria-pressed`, `aria-invalid` +
   `aria-describedby`, `scope="col"`, an `.sr` caption on every table. Status
   is never colour alone — every badge variant ships a glyph and keeps its
   text.

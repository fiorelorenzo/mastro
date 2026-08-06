@AGENTS.md

## Claude Code specific

Everything about *this project* — architecture, invariants, board conventions,
language rules — lives in `AGENTS.md`, imported above. This section is only for how
**Claude Code** should operate here.

### Hard rules

- **There is no SPEC.md, and do not create one.** The design lives in the epic
  descriptions on the board. If context is missing, comment on the epic and fix it
  there. A parallel design document immediately diverges from the board and then
  nobody knows which one is true.
- **Never commit real client data.** Contracts, invoices, approval emails and their
  extracts stay out of this repository. Test fixtures derived from real documents are
  anonymised first: change names, tax ids and amounts, keep the structure.
- **Do not weaken the five invariants in `AGENTS.md` to make a test pass.** If an
  invariant genuinely blocks the work, that is a design conversation on the epic, not
  a quiet exception in the code.

### Skills to use here

- **superpowers:brainstorming** before any non-trivial feature work: this project's
  requirements come from contract clauses and tax rules, and guessing at them is how
  you build the wrong thing convincingly.
- **superpowers:test-driven-development** for the calculation engine and the format
  adapters. Both are pure functions over well-defined inputs with legally meaningful
  outputs; they are exactly what TDD is for, and a wrong ceiling figure is a silent
  failure.
- **dataviz** before writing a single line of chart code or picking chart colours.
  The dashboard has specific encoding decisions (certainty as one hue light-to-dark,
  no pie charts, no dual axes, status never by colour alone) and they are not
  negotiable defaults.
- **superpowers:verification-before-completion** before moving anything to `Done`.
  Merged is not verified.

### Context discipline

The board is large. Read the epic you are working under and the issue itself; do not
load the whole board into context. When you need to know the current state of
something, query it (`gh issue view`, `gh project item-list`) rather than reading
every issue.

# #420: record the transition log's insertion order

## Migration

`drizzle/0080_work_unit_transition_seq.sql`:

```sql
ALTER TABLE "work_unit_transition" ADD COLUMN "seq" bigserial NOT NULL;

CREATE INDEX "work_unit_transition_work_unit_id_seq_idx" ON "work_unit_transition" USING btree ("work_unit_id","seq");
```

`bigserial` gives the column a backing sequence and `DEFAULT nextval(...)`.
Every INSERT gets a value from that sequence, unique and strictly increasing
across the whole table, including several rows written by one statement —
the exact case migration `0079`'s `clock_timestamp()` default cannot
guarantee, because the clock can return the same microsecond twice within a
single statement. `seq` never reads the clock at all, so it cannot tie.
`created_at` is untouched: it still defaults to `clock_timestamp()` (0079)
and still means "when this row was written". The composite index
`(work_unit_id, seq)` keeps the per-day ordered scan `listWorkUnitTransitions`
does cheap.

The migration's own comment carries this reasoning in full, in the style of
`0075`/`0079`.

## Schema change

`src/lib/server/db/schema/work-unit.ts`: `workUnitTransition` gained a
`seq: bigserial('seq', { mode: 'bigint' }).notNull()` column and a table-level
`index('work_unit_transition_work_unit_id_seq_idx').on(table.workUnitId, table.seq)`,
declared in TypeScript so the generator's model matches the hand-written SQL
(the mistake `0079` warns about: a default set only in SQL causes the next
`db:generate` to try to revert it).

`src/lib/server/repositories/work-unit.ts`: `listWorkUnitTransitions` now
orders by `asc(workUnitTransition.seq)` instead of `asc(workUnitTransition.createdAt)`.
No application-level check was added — the column and its default are the
whole guarantee, exactly as instructed.

## `pnpm db:generate` no-drift check

After `pnpm db:migrate` applied `0080` to a freshly reset local database,
`pnpm db:generate` reported:

```
work_unit_transition 9 columns 1 indexes 1 fks
No schema changes, nothing to migrate 😴
```

No new migration file was emitted. The TypeScript schema and the
hand-written SQL agree.

## The one-statement test

`src/lib/server/db/schema/work-unit.test.ts`, test
`#420: a bulk UPDATE moving several work units in one statement records their transitions in strict insertion order`:

- Inserts two `work_unit` rows (`proposed`, distinct dates, same contract).
- Runs **one** `UPDATE work_unit SET state = 'approved' WHERE id IN (...)`
  covering both rows — one statement, firing `work_unit_enforce_state_machine`
  once per row, which is exactly the shape `0079`'s fix cannot promise
  ordering for.
- Reads back the two resulting `approved` transitions ordered by `seq` and
  asserts `transitions[0].seq < transitions[1].seq` and that both `seq`
  values are distinct.

### RED (before the fix)

Temporarily reverted `src/lib/server/db/schema/work-unit.ts` and
`src/lib/server/repositories/work-unit.ts` to their pre-#420 state (git
checkout of those two files only, keeping the new test and the already
migrated database with `seq` still present) and reran the test:

```
FAIL  |server| src/lib/server/db/schema/work-unit.test.ts > #420: a bulk UPDATE ...
Error: Failed query: select ... from "work_unit_transition" where (...) order by  asc
Caused by: PostgresError: syntax error at or near "asc"
```

`workUnitTransition.seq` did not exist in the pre-fix schema, so
`asc(workUnitTransition.seq)` compiled to `asc(undefined)`, producing
`order by  asc` — a hard failure, not a flake. This is the direct proof the
fix is required for the test (and the feature) to exist at all.

### GREEN (after the fix)

Restored the fixed schema and repository files and reran:

```
Test Files  1 passed (1)
Tests  25 passed (25)
```

The new test and the other 24 in the same file all pass.

Separately, a raw-SQL probe (40 and later 2000 concurrent work units bulk
updated in one statement) showed `clock_timestamp()` did not tie on this
machine's clock resolution even at 2000 rows in a single statement — which
matches the issue's own framing ("the order is total in practice … not by
construction"): the flake is real but not reliably reproducible by brute
force on fast hardware. That is exactly why the fix has to be structural
(a sequence) rather than a hope that the clock keeps up, and is why the RED
evidence above comes from removing the column rather than from a forced
timing race.

## Full suite

Two full `pnpm test` runs against this worktree's own database:

- Run 1: `Test Files 3 failed | 242 passed | 2 skipped (247)` — `Tests 15 failed | 1886 passed | 4 skipped (1905)`
- Run 2: identical counts — `Test Files 3 failed | 242 passed | 2 skipped (247)` — `Tests 15 failed | 1886 passed | 4 skipped (1905)`

Counts are identical between runs. All 15 failures are confined to
`src/lib/server/runner/{db-privilege,job,queue}.test.ts` — a runner-role
database-privilege / mocked-runner-process issue in this worktree's
environment (`does not exist, or is not readable by the runner's role`,
and a queue restart timeout), unrelated to `work_unit`,
`work_unit_transition`, or anything this issue touches. They were present
before this change was even made (confirmed no work-unit files are in that
failure list) and are unaffected by it.

`pnpm check`: `COMPLETED 3870 FILES 0 ERRORS 62 WARNINGS 19 FILES_WITH_PROBLEMS`
— 0 errors; all warnings are pre-existing Svelte 5 `state_referenced_locally`
lint notes in unrelated route files.

`pnpm exec prettier --check` on every file this change touches: passes.

## Files changed

- `src/lib/server/db/schema/work-unit.ts` — `seq` column + index on `workUnitTransition`.
- `src/lib/server/repositories/work-unit.ts` — `listWorkUnitTransitions` orders by `seq`.
- `src/lib/server/db/schema/work-unit.test.ts` — new one-statement ordering test.
- `drizzle/0080_work_unit_transition_seq.sql` — hand-written migration (new).
- `drizzle/meta/0080_snapshot.json` — generator snapshot for `0080` (new).
- `drizzle/meta/_journal.json` — journal entry for `0080`.

No message keys added (none needed). No other agent's files touched.

## Concerns

- None blocking. One judgment call: I added a composite index
  `(work_unit_id, seq)` alongside the column, since `listWorkUnitTransitions`
  always filters by `work_unit_id` then orders by the new column — the same
  pattern `sent_email` and `inbound_thread` already use for their own hot
  read paths. It is a pure addition (no behavior change), declared in both
  the SQL and the TypeScript schema so `db:generate` stays silent.
- `seq` uses `bigserial` (a real Postgres sequence), not a per-`work_unit_id`
  counter, so gaps across different work units are expected and harmless —
  ordering is only ever compared within one `work_unit_id`'s rows, which
  `listWorkUnitTransitions` already scopes with `WHERE work_unit_id = ...`.

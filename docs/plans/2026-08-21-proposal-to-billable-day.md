# From a proposal to a billable day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the road from an accepted proposal to an invoiceable day, so a
day costs one human tap instead of one tap plus a step that does not exist.

**Architecture:** A repository helper for the missing `approved → worked`
transition, a cron-shaped sweep that applies it once a day's date has passed,
a queue row carrying the client's own words so a proposal is judged without
opening it, and a re-read that revises a pending proposal in place instead of
dropping its reading — recording a conflict row, and two alerts, when the
reading disagrees with a day already on the ledger.

**Tech Stack:** SvelteKit (adapter-node) + TypeScript + Postgres 16, Drizzle
ORM with committed SQL migrations, Vitest against the real database, Paraglide
for i18n.

**Spec:** `docs/specs/2026-08-21-proposal-to-billable-day-design.md`

## Global Constraints

- **Code, comments, identifiers, commits, issues, PRs: English.** No exceptions.
- **Interface strings go through Paraglide.** Every new key exists in **both**
  `messages/en.json` and `messages/it.json`, inserted in sorted position, never
  appended. `src/lib/i18n/catalogues.test.ts` fails on a key present in one.
- **No country-specific logic outside a jurisdiction pack.** Enforced by
  `src/lib/server/fiscal/no-country-logic.test.ts`, which also scans `.svelte`
  `<script>` blocks. A hyphenated two-letter literal (`'in-reply-to'`) needs an
  entry in that file's `NOT_PACK_IDS`.
- **State machine constraints live in the database.** The `approved → worked`
  edge already exists in `work_unit_enforce_state_machine`; do not add an
  application check for it.
- **Rolled-back-transaction tests**: use `inRolledBackTransaction`
  (`src/lib/server/db/rollback.ts`) and assert on what it **returns**. Never
  `await expect(db.transaction(...)).rejects.toThrow()`.
- **`now()` is frozen inside a transaction.** Pass explicit timestamps when
  ordering or "learned after" is the point.
- **A test runs against a database that has data in it.** Scope every
  assertion to ids the test created.
- **Two agents cannot generate a migration at the same time.** Only Task 6
  touches `drizzle/`.
- **Cron routes reuse `ALERT_CRON_TOKEN`**, as `/api/agent/run` and
  `/api/alerts/run/*` already do. No new environment variable.
- **Run only what you touch** (`pnpm exec vitest run <file>`, `pnpm exec
prettier --check <files>`). The full gate runs once at the end, in Task 8.

---

### Task 1: The missing transition helper

**Files:**

- Modify: `src/lib/server/repositories/work-unit.ts` (add after
  `markWorkUnitUnbillable`, around line 188)
- Test: `src/lib/server/repositories/work-unit.test.ts`

**Interfaces:**

- Consumes: `transitionWorkUnit(id, patch, actor, reason, tx?)` and
  `TransitionActor` from `$lib/server/db/schema` — already exported.
- Produces: `markWorkUnitWorked(id: string, actor: TransitionActor, reason:
string, tx?: DbExecutor): Promise<WorkUnitRow>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/repositories/work-unit.test.ts`:

```ts
test('an approved day is recorded worked, and the log names who and why', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const day = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-08-04', quantity: 1, scope: 'meetings' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'agreed in writing',
			tx
		);
		const approval = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				excerpt: 'confermo la giornata del 4',
				receivedAt: new Date('2026-08-03T09:00:00.000Z'),
				body: Buffer.from('confermo la giornata del 4')
			},
			tx
		);
		await transitionWorkUnit(
			day.id,
			{ state: 'approved', approvalId: approval.id },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'accepted the proposal',
			tx
		);

		const worked = await markWorkUnitWorked(
			day.id,
			{ kind: 'system' },
			'the day passed with its approval on file',
			tx
		);
		return { worked, transitions: await listWorkUnitTransitions(day.id, tx) };
	});

	expect(result.worked.state).toBe('worked');
	const last = result.transitions.at(-1);
	expect(last?.toState).toBe('worked');
	expect(last?.actor).toMatchObject({ kind: 'system' });
	expect(last?.reason).toBe('the day passed with its approval on file');
});
```

Add `markWorkUnitWorked` to the import block from `./work-unit`, and
`createApproval` from `./approval` if it is not imported already (it is — the
file's header comment says so).

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run src/lib/server/repositories/work-unit.test.ts -t 'recorded worked'`
Expected: FAIL — `markWorkUnitWorked is not a function` (or a TypeScript
resolution error naming the missing export).

- [ ] **Step 3: Write the helper**

In `src/lib/server/repositories/work-unit.ts`, directly after
`markWorkUnitUnbillable`:

```ts
/**
 * The edge the product was missing (#417's successor). `work_unit_enforce_
 * state_machine` has always allowed `approved -> worked`; nothing in the
 * application ever called it, so an accepted proposal parked a day at
 * `approved` and `listEligibleWorkUnitsForInvoicing` — which reads `worked`
 * and `disputed` — could never see it. Recording every day by hand was the
 * only road that arrived.
 *
 * Same shape as its six siblings: one field through `transitionWorkUnit`, and
 * an illegal source state is refused by the database rather than by a check
 * here. `actor` is `{ kind: 'system' }` when the settle sweep applies it and
 * `{ kind: 'human', email }` when somebody presses the button on the day
 * itself; `reason` is never optional, because the append-only log is what
 * makes an automatic transition readable afterwards.
 */
export async function markWorkUnitWorked(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'worked' }, actor, reason, tx);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run src/lib/server/repositories/work-unit.test.ts`
Expected: PASS, and the file's other tests still pass.

- [ ] **Step 5: Prove the database still refuses an illegal source**

Append:

```ts
test('a proposed day cannot be recorded worked directly', async () => {
	// `proposed -> worked` is not in the trigger's allowed-edge list: a day
	// nobody approved has to pass through `approved` or be recorded worked at
	// creation (which lands in `worked_without_approval`). The refusal is the
	// database's, which is why this asserts the constraint's own message
	// rather than an application error.
	const error = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const day = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-08-04', quantity: 1, scope: 'meetings' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded as proposed',
			tx
		);
		return rejection(
			() => markWorkUnitWorked(day.id, { kind: 'system' }, 'should not be allowed', tx),
			tx
		);
	});

	expect(error.message).toContain('illegal work_unit transition: proposed -> worked');
});
```

Import `rejection` from `$lib/server/db/pg-error`.

- [ ] **Step 6: Run both tests**

Run: `pnpm exec vitest run src/lib/server/repositories/work-unit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write src/lib/server/repositories/work-unit.ts src/lib/server/repositories/work-unit.test.ts
git add src/lib/server/repositories/work-unit.ts src/lib/server/repositories/work-unit.test.ts
git commit -m "feat(domain): record an approved day as worked"
```

---

### Task 2: The settle sweep and its cron route

**Files:**

- Create: `src/lib/server/days/settle.ts`
- Create: `src/lib/server/days/settle.test.ts`
- Create: `src/routes/api/days/settle/+server.ts`
- Modify: `src/lib/server/repositories/work-unit.ts` (add
  `listApprovedDaysBefore`)
- Modify: `scripts/scheduler.ts` (route list)
- Modify: `.github/workflows/ci.yml` (the `image` job's cron sweep)

**Interfaces:**

- Consumes: `markWorkUnitWorked` (Task 1).
- Produces: `listApprovedDaysBefore(date: string, executor?: DbExecutor):
Promise<{ id: string; date: string }[]>` and `settleApprovedDays(today:
string, executor?: DbExecutor): Promise<{ settled: number }>`.

- [ ] **Step 1: Write the failing test for the query and the boundary**

Create `src/lib/server/days/settle.test.ts`:

```ts
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { createApproval } from '$lib/server/repositories/approval';
import { createWorkUnit, transitionWorkUnit } from '$lib/server/repositories/work-unit';
import { insertContract } from '$lib/server/repositories/__fixtures__/contract';
import { settleApprovedDays } from './settle';

/** An approved day, so the sweep has something legal to move. */
async function approvedDay(
	tx: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0],
	contractId: string,
	date: string
) {
	const day = await createWorkUnit(
		{ contractId, date, quantity: 1, scope: 'meetings' },
		{ kind: 'human', email: 'lorenzo@example.com' },
		'agreed in writing',
		tx
	);
	const approval = await createApproval(
		{
			contractId,
			channel: 'email',
			sender: 'client@example.com',
			excerpt: `confermo il ${date}`,
			receivedAt: new Date('2026-08-01T09:00:00.000Z'),
			body: Buffer.from(`confermo il ${date}`)
		},
		tx
	);
	await transitionWorkUnit(
		day.id,
		{ state: 'approved', approvalId: approval.id },
		{ kind: 'human', email: 'lorenzo@example.com' },
		'accepted the proposal',
		tx
	);
	return day;
}

test('a day whose date has passed settles; today and tomorrow do not', async () => {
	// The boundary is the whole rule: a day must never become billable while
	// it is still in progress. Dates are fixed rather than relative to the
	// clock so the test says the same thing every day of the year.
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const yesterday = await approvedDay(tx, contractRow.id, '2026-08-04');
		const today = await approvedDay(tx, contractRow.id, '2026-08-05');
		const tomorrow = await approvedDay(tx, contractRow.id, '2026-08-06');

		const outcome = await settleApprovedDays('2026-08-05', tx);
		return {
			outcome,
			states: await Promise.all(
				[yesterday, today, tomorrow].map(async (day) => {
					const [row] = await tx.select().from(workUnit).where(eq(workUnit.id, day.id));
					return row.state;
				})
			)
		};
	});

	expect(result.states).toEqual(['worked', 'approved', 'approved']);
	expect(result.outcome.settled).toBe(1);
});
```

Import `eq` from `drizzle-orm` and `workUnit` from `$lib/server/db/schema`. If
`src/lib/server/repositories/__fixtures__/contract.ts` does not exist, inline
the same contract insert the neighbouring repository tests use
(`work-unit.test.ts`'s `insertContract`) into this file rather than importing
across test files.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run src/lib/server/days/settle.test.ts`
Expected: FAIL — cannot resolve `./settle`.

- [ ] **Step 3: Add the query**

In `src/lib/server/repositories/work-unit.ts`, after
`listWorkUnitsForContractOnDate`:

```ts
/**
 * Every day still `approved` whose date is strictly before `date` — the
 * settle sweep's own read (`$lib/server/days/settle.ts`).
 *
 * Strictly before, never on: a day must not become billable while it is
 * still in progress. `date` is the sweep's idea of today, passed in rather
 * than read from the clock here, so a test can name the boundary and a
 * future timezone decision has one place to change.
 */
export async function listApprovedDaysBefore(date: string, executor: DbExecutor = db) {
	return executor
		.select({ id: workUnit.id, date: workUnit.date })
		.from(workUnit)
		.where(and(eq(workUnit.state, 'approved'), lt(workUnit.date, date)))
		.orderBy(asc(workUnit.date));
}
```

Add `lt` to the `drizzle-orm` import in that file.

- [ ] **Step 4: Write the sweep**

Create `src/lib/server/days/settle.ts`:

```ts
import { db, type DbExecutor } from '$lib/server/db';
import { listApprovedDaysBefore, markWorkUnitWorked } from '$lib/server/repositories/work-unit';

export interface SettleOutcome {
	readonly settled: number;
	readonly failed: number;
}

/**
 * Records every approved day whose date has passed as `worked`.
 *
 * This is the join the product was missing. Accepting a proposal writes a
 * day at `approved` and nothing moved it on, so it could never be invoiced
 * and the only road to a billable day was recording it by hand — the step
 * that felt slow was the only one that arrived.
 *
 * The rule is deliberately narrow. Only `approved` is touched: a `proposed`
 * day carries nobody's agreement, `worked_without_approval` is already its
 * own honest state, and revoked, rejected and unbillable are decisions a
 * sweep has no business revisiting. The database's allowed-edge list refuses
 * everything else anyway, which is why there is no state check here.
 *
 * `today` is passed in, not read from a clock, so the boundary is testable
 * and a timezone decision has one place to land. The caller computes it in
 * UTC: being late is safe, being early is not.
 *
 * One day's failure does not stop the rest — the same "one bad row does not
 * stop the batch" shape the mirror and the alert engine use. A failure here
 * means the database refused a transition it had allowed a moment earlier,
 * which is worth surfacing as a count rather than a thrown sweep.
 */
export async function settleApprovedDays(
	today: string,
	executor: DbExecutor = db
): Promise<SettleOutcome> {
	const due = await listApprovedDaysBefore(today, executor);
	let settled = 0;
	let failed = 0;
	for (const day of due) {
		try {
			await markWorkUnitWorked(
				day.id,
				{ kind: 'system' },
				'the day passed with its approval on file',
				executor
			);
			settled += 1;
		} catch {
			failed += 1;
		}
	}
	return { settled, failed };
}

/** Today in UTC, as an ISO date. The sweep's own boundary, named so the
 * route and the tests agree on it. */
export function utcToday(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm exec vitest run src/lib/server/days/settle.test.ts`
Expected: PASS, `states` reading `['worked', 'approved', 'approved']`.

- [ ] **Step 6: Add a test for the states the sweep must not touch**

Append to `settle.test.ts`:

```ts
test('the sweep leaves alone every state that is not approved', async () => {
	// `proposed` is the one that matters: a day nobody agreed to must never
	// become billable on its own. The others are decisions.
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const proposed = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-08-04', quantity: 1, scope: 'unagreed' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded as proposed',
			tx
		);
		const settled = await settleApprovedDays('2026-08-05', tx);
		const [row] = await tx.select().from(workUnit).where(eq(workUnit.id, proposed.id));
		return { settled, state: row.state };
	});

	expect(result.state).toBe('proposed');
	expect(result.settled.settled).toBe(0);
});
```

- [ ] **Step 7: Run it**

Run: `pnpm exec vitest run src/lib/server/days/settle.test.ts`
Expected: PASS (two tests).

- [ ] **Step 8: Add the route**

Create `src/routes/api/days/settle/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { authorizeCronRequest } from '$lib/server/auth/cron-token';
import { env } from '$env/dynamic/private';
import { settleApprovedDays, utcToday } from '$lib/server/days/settle';
import type { RequestHandler } from './$types';

/**
 * Records approved days whose date has passed as `worked` (the design doc's
 * "the join that doesn't exist").
 *
 * Its own route rather than a step inside `/api/agent/run`: that one is the
 * extraction drain, and a ledger write hidden inside a job about something
 * else is a ledger write nobody finds again. `scripts/scheduler.test.ts`
 * keeps this path in step with the `image` job's sweep in CI, so the route
 * arrives with a caller that is not only the timer.
 *
 * `ALERT_CRON_TOKEN`, the same token `/api/agent/run` and the alert routes
 * use: cron has no session to present, and a fourth token for a fourth
 * timer-driven route would be four things to rotate for one guarantee.
 */
export const POST: RequestHandler = async ({ request }) => {
	authorizeCronRequest(request, env.ALERT_CRON_TOKEN);
	const outcome = await settleApprovedDays(utcToday());
	return json({ status: 'ok', ...outcome });
};
```

Check `src/routes/api/agent/run/+server.ts` for the exact
`authorizeCronRequest` call shape and copy it; if it reads the token
differently, follow that file rather than this snippet.

- [ ] **Step 9: Register it with the scheduler and with CI**

In `scripts/scheduler.ts`, add to the route list, following the shape of the
entries already there:

```ts
{
    path: '/api/days/settle',
    // Once an hour is enough: the only thing it waits for is a date to pass.
    everyMinutes: 60,
    token: () => process.env.ALERT_CRON_TOKEN
},
```

Match the field names of the existing entries exactly — read them first.

In `.github/workflows/ci.yml`, add `days/settle` to the `for job in ...` list
in the "Boot it and check /health" step, so the route is POSTed against the
real runtime image.

- [ ] **Step 10: Run the scheduler contract test**

Run: `pnpm exec vitest run scripts/scheduler.test.ts`
Expected: PASS. If it fails naming `/api/days/settle`, one of the two lists is
missing it — that is the test doing its job.

- [ ] **Step 11: Commit**

```bash
pnpm exec prettier --write src/lib/server/days/settle.ts src/lib/server/days/settle.test.ts src/routes/api/days/settle/+server.ts scripts/scheduler.ts src/lib/server/repositories/work-unit.ts
git add src/lib/server/days src/routes/api/days scripts/scheduler.ts .github/workflows/ci.yml src/lib/server/repositories/work-unit.ts
git commit -m "feat(domain): an approved day settles once its date has passed"
```

---

### Task 3: "Mark as worked" on the day itself

**Files:**

- Modify: `src/routes/day/[id]/+page.server.ts` (add a `worked` action beside
  `unbillable`, around line 164)
- Modify: `src/routes/day/[id]/+page.svelte`
- Modify: `messages/en.json`, `messages/it.json`

**Interfaces:**

- Consumes: `markWorkUnitWorked` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the action**

Read the `unbillable` action first and copy its shape exactly — the actor, the
reason handling, the redirect or return, and the error mapping. Then, beside
it:

```ts
	worked: async ({ params, locals }) => {
		// The manual half of the settle sweep: a day approved for today that
		// is already finished should not have to wait for the night. Same
		// helper, a human actor instead of the system one.
		await markWorkUnitWorked(
			params.id,
			{ kind: 'human', email: locals.user!.email },
			'recorded worked by hand'
		);
		return { recorded: true };
	},
```

Follow the neighbouring actions for how failures are returned (`fail(...)`
with a message) rather than inventing a second convention.

- [ ] **Step 2: Add the button**

In `src/routes/day/[id]/+page.svelte`, in the same block as the other state
actions, gated on the day being `approved`:

```svelte
{#if data.day.state === 'approved'}
	<form method="POST" action="?/worked">
		<Button type="submit" variant="primary" size="sm">{m.day_mark_worked_submit()}</Button>
	</form>
{/if}
```

Read the neighbouring forms for the `submitting()` usage and copy it.

- [ ] **Step 3: Add the strings**

Insert in sorted position in both catalogues:

- `messages/en.json`: `"day_mark_worked_submit": "Mark as worked"`
- `messages/it.json`: `"day_mark_worked_submit": "Segna come lavorata"`

- [ ] **Step 4: Type-check**

Run: `pnpm check`
Expected: 0 errors. A missing message key fails here, which is the point.

- [ ] **Step 5: Verify it in a browser**

```bash
pnpm dev
```

Plant an approved day dated today, open `/day/<id>`, press the button, and
confirm the state badge reads worked and the transition list shows the human
actor. Then check the button is absent on a day that is not `approved`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write "src/routes/day/[id]/+page.server.ts" "src/routes/day/[id]/+page.svelte" messages/en.json messages/it.json
git add "src/routes/day/[id]" messages/en.json messages/it.json
git commit -m "feat(web): mark an approved day as worked from the day itself"
```

---

### Task 4: The queue row carries the client's words

**Files:**

- Modify: `src/routes/proposals/+page.server.ts` (the row shape the load
  function returns)
- Modify: `src/routes/proposals/+page.svelte` (the row markup, around line 236)
- Modify: `messages/en.json`, `messages/it.json`
- Test: `src/routes/proposals/queue-fields.test.ts` if it exists; otherwise no
  new test file — this task's proof is the browser step.

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `excerpt` and `revised` on the queue row object.

- [ ] **Step 1: Carry the excerpt and the revised flag**

In the load function, add to each row:

```ts
excerpt: row.excerpt,
// A pending proposal whose `updated_at` has moved past `created_at` was
// rewritten by a re-read (Task 5). Accepting and rejecting both move the
// row out of `pending`, so for a pending row this comparison has exactly
// one cause. Compared with a second of tolerance because the two
// timestamps are written by different statements of one insert.
revised: row.status === 'pending' && row.updatedAt.getTime() - row.createdAt.getTime() > 1000,
```

- [ ] **Step 2: Render them**

In the row markup, under the description and above the buttons:

```svelte
<p class="excerpt">{row.excerpt}</p>
{#if row.revised}
	<Badge variant="info" label={m.proposal_queue_revised_badge()} size="sm" />
{/if}
```

Clamp the excerpt in the component's `<style>` block:

```css
.excerpt {
	margin: var(--space-2) 0 0;
	font-size: var(--text-sm);
	color: var(--text-secondary);
	display: -webkit-box;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
```

- [ ] **Step 3: Add the string**

- `messages/en.json`: `"proposal_queue_revised_badge": "Revised"`
- `messages/it.json`: `"proposal_queue_revised_badge": "Rivista"`

- [ ] **Step 4: Type-check**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 5: Verify in a browser, at both widths**

`pnpm dev`, open `/proposals` at 1400px and at 390px. The excerpt is readable
and clamped; the buttons have not moved off the row; a long excerpt does not
push the card wider than its neighbours.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src/routes/proposals/+page.server.ts src/routes/proposals/+page.svelte messages/en.json messages/it.json
git add src/routes/proposals messages/en.json messages/it.json
git commit -m "feat(web): a queue row carries the words it rests on"
```

---

### Task 5: A re-read revises a pending proposal in place

**Files:**

- Create: one hand-written migration (`pnpm db:generate:custom
--name=proposal_pending_reading_is_mutable`) replacing the
  `proposal_forbid_retrofit` trigger function. **Found while implementing Task
  4, not in the design**: that function
  (`drizzle/0060_proposal_validation_issue_constraints.sql:17-40`) currently
  refuses any UPDATE that changes `proposed_fields`, `excerpt`, `confidence`,
  `confidence_reason` or `validation_issue`, which is precisely the write this
  task exists to make. Without the migration the whole task is impossible, and
  the failure arrives as a raised exception at runtime, not at build time.

  The relaxation is narrow, and the reasoning is the one the product already
  holds: **a decision is final, a reading is not**. The identity columns
  (`document_id`, `contract_id`, `target_type`) stay immutable always, so a
  proposal can never be retargeted at another document or contract, and
  invariant 4 keeps its source. The second rule stays exactly as it is: once
  `OLD.status` is anything but `pending`, every UPDATE is still refused, so an
  accepted or rejected proposal is frozen with the words it was decided on.
  What becomes mutable is only the agent's current reading of an undecided
  proposal, which is what a re-read is. Write that reasoning into the
  migration's own comment, since in this repo a constraint is reviewed as SQL.

- Modify: `src/lib/server/repositories/proposal.ts` (replace
  `datesAlreadyDecided` with `recordedDaysByDate`, add
  `pendingDayProposalsByDate` and `reviseDayProposal`)
- Modify: `src/lib/server/agent/day-extraction.ts` (`alreadyDecided` now means
  recorded only)
- Modify: `src/lib/server/agent/day-producer.ts` (`extractionContext` and
  `writeDayProposals`)
- Test: `src/lib/server/agent/day-producer.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `recordedDaysByDate(contractId: string, executor?: DbExecutor):
Promise<Map<string, { id: string; quantity: string; state: WorkUnitState }>>`
  — a map, not a set, because Task 6 needs the recorded quantity to tell a
  disagreement from a re-read that confirms what the ledger holds, and one
  shape used by both is better than a set here and a map there;
  `pendingDayProposalsByDate(contractId: string, executor?: DbExecutor):
Promise<Map<string, ProposalRow>>`; and `reviseDayProposal(id: string,
input: { proposedFields: Record<string, unknown>; excerpt: string;
confidence: number; confidenceReason: string | null; documentId: string },
executor?: DbExecutor): Promise<ProposalRow | null>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/agent/day-producer.test.ts`:

```ts
test('a second reading rewrites the pending proposal instead of dropping it', async () => {
	// The client wrote "half a day, not one" while the proposal was still
	// waiting. Suppressing the day (which is what `datesAlreadyDecided` did)
	// kept the stale reading on screen and put the new one only in the run
	// log. The row is rewritten in place, keeping its id so a link somebody
	// has open still resolves.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const [existing] = await tx
			.insert(proposal)
			.values({
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
				excerpt: 'la giornata del 3',
				confidence: 0.8,
				status: 'pending'
			})
			.returning();

		const outcome = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'in realtà il 3 facciamo mezza giornata',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'il 3 facciamo mezza giornata',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		const [after] = await tx.select().from(proposal).where(eq(proposal.id, existing.id));
		return { outcome, after, existingId: existing.id };
	});

	// One proposal, the same one, with the new reading on it.
	expect(result.outcome.proposals).toHaveLength(1);
	expect(result.outcome.proposals[0].id).toBe(result.existingId);
	expect(result.after.proposedFields).toMatchObject({ quantity: 0.5 });
	expect(result.after.excerpt).toBe('il 3 facciamo mezza giornata');
	expect(result.after.status).toBe('pending');
	expect(result.after.updatedAt.getTime()).toBeGreaterThan(result.after.createdAt.getTime());
});
```

The `answer` helper and `seed` already exist in that file. Note the last
assertion will hold only because `created_at` and `updated_at` are written by
different statements; if it proves flaky inside one transaction, assert on the
rewritten fields alone and delete that line.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run src/lib/server/agent/day-producer.test.ts -t 'rewrites the pending proposal'`
Expected: FAIL — `proposals` has length 0, because the day is still being
rejected as "already proposed or recorded".

- [ ] **Step 3: Split the repository query**

In `src/lib/server/repositories/proposal.ts`, replace `datesAlreadyDecided`
with two functions. Keep the doc comment's reasoning and correct it:

```ts
/**
 * Dates this contract already has a *recorded* day on (#403, revised).
 *
 * The half of the old `datesAlreadyDecided` that still suppresses: a day on
 * the ledger is a decision a human made, and a re-read must not offer it
 * again. The other half — a pending proposal — is no longer suppressed but
 * rewritten in place, which is what `pendingDayProposalsByDate` below is for:
 * suppressing it kept a stale reading on screen and put the newer one only in
 * the extraction run's transcript.
 *
 * A **rejected** date is deliberately in neither: a rejection says "not this
 * proposal", not "never this day", and a re-read that understands the
 * conversation better is exactly the correction the reviewer is owed.
 */
export async function recordedDaysByDate(
	contractId: string,
	executor: DbExecutor = db
): Promise<Map<string, { id: string; quantity: string; state: WorkUnitState }>> {
	const rows = await executor
		.select({
			id: workUnit.id,
			date: workUnit.date,
			quantity: workUnit.quantity,
			state: workUnit.state
		})
		.from(workUnit)
		.where(eq(workUnit.contractId, contractId));
	// Keyed by date. Two days on one date is legal (different activities), and
	// then either is enough to answer "this date is already recorded" — the
	// last one wins, which no caller can tell apart from the first.
	return new Map(rows.map((row) => [row.date, row]));
}

/** The pending day proposals this contract holds, keyed by the date each one
 * proposes. A re-read rewrites the row it finds here rather than writing a
 * second proposal for the same day. */
export async function pendingDayProposalsByDate(
	contractId: string,
	executor: DbExecutor = db
): Promise<Map<string, ProposalRow>> {
	const rows = await executor
		.select()
		.from(proposal)
		.where(
			and(
				eq(proposal.contractId, contractId),
				eq(proposal.status, 'pending'),
				eq(proposal.targetType, 'work_unit')
			)
		);
	const byDate = new Map<string, ProposalRow>();
	for (const row of rows) {
		const date = (row.proposedFields as { date?: unknown } | null)?.date;
		if (typeof date === 'string') byDate.set(date, row);
	}
	return byDate;
}

/** Rewrites a pending proposal's reading, keeping its id. Never touches
 * `status`: a revision is not a decision. */
export async function reviseDayProposal(
	id: string,
	input: {
		proposedFields: Record<string, unknown>;
		excerpt: string;
		confidence: number;
		confidenceReason: string | null;
		documentId: string;
	},
	executor: DbExecutor = db
) {
	const [row] = await executor
		.update(proposal)
		.set({
			proposedFields: input.proposedFields,
			excerpt: input.excerpt,
			confidence: String(input.confidence),
			confidenceReason: input.confidenceReason,
			documentId: input.documentId
		})
		.where(and(eq(proposal.id, id), eq(proposal.status, 'pending')))
		.returning();
	return row ?? null;
}
```

Check `proposal.confidence`'s column type before writing `String(...)` —
follow whatever `createProposal` does with the same field.

- [ ] **Step 4: Point the validator at recorded days only**

In `src/lib/server/agent/day-extraction.ts`, the `alreadyDecided` field's doc
comment and the rejection reason both currently say "already proposed or
recorded". Change the comment to say **recorded**, and the reason string to
`` `${day.date} is already recorded on this contract` ``. Update the
assertion in `day-producer.test.ts`'s existing "offers only what is new" test
to the new string.

- [ ] **Step 5: Use both in the producer**

In `src/lib/server/agent/day-producer.ts`, `extractionContext` now reads
`recordedDaysByDate` and hands the validator its keys (`alreadyDecided: new
Set(recorded.keys())`), keeping the map itself for Task 6. `writeDayProposals`
fetches the pending map once and, per accepted day, revises or creates:

```ts
const pendingByDate = executor
	? await pendingDayProposalsByDate(source.contractId, executor)
	: await pendingDayProposalsByDate(source.contractId);

// ... inside the accepted loop, replacing the createProposal call:
const existing = pendingByDate.get(day.date);
const documentId = source.conversation?.[day.messageIndex]?.documentId ?? source.documentId;
if (existing) {
	// Rewritten, not replaced: the id is what a link somebody already has
	// open resolves to, and `status` stays `pending` because a revision is
	// not a decision.
	const revised = await reviseDayProposal(
		existing.id,
		{ proposedFields, excerpt: day.excerpt, confidence, confidenceReason, documentId },
		executor
	);
	if (revised) proposals.push(revised);
	continue;
}
proposals.push(await createProposal({/* as today */}, executor));
```

Keep `proposedFields` built exactly as it is today.

- [ ] **Step 6: Run the producer tests**

Run: `pnpm exec vitest run src/lib/server/agent/day-producer.test.ts`
Expected: PASS, including the existing "offers only what is new" test with its
updated reason string.

- [ ] **Step 7: Pin the rejected-date decision with a test**

The spec says a rejected date may be proposed again, and that this stops being
a side effect and becomes a decision on the record. Append to
`day-producer.test.ts`:

```ts
test('a date whose proposal was rejected can be proposed again', async () => {
	// A rejection says "not this proposal", not "never this day". A re-read
	// that understands the conversation better is the correction the reviewer
	// is owed, so a rejected date is in neither the recorded map nor the
	// pending map and reaches `createProposal` as if it were new.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		await tx.insert(proposal).values({
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'work_unit',
			proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
			excerpt: 'la giornata del 3',
			confidence: 0.8,
			status: 'rejected'
		});

		return proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'confermo la giornata del 3, mezza',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'la giornata del 3, mezza',
						messageIndex: 0
					}
				]
			}),
			tx
		);
	});

	// A new proposal, not a revision of the rejected one.
	expect(result.proposals).toHaveLength(1);
	expect(result.proposals[0].status).toBe('pending');
});
```

- [ ] **Step 8: Run everything that reads these functions**

Run: `pnpm exec vitest run src/lib/server/agent src/lib/server/repositories/proposal.test.ts`
Expected: PASS. `grep -rn 'datesAlreadyDecided' src/` must return nothing.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write src/lib/server/repositories/proposal.ts src/lib/server/agent/day-extraction.ts src/lib/server/agent/day-producer.ts src/lib/server/agent/day-producer.test.ts
git add src/lib/server/repositories/proposal.ts src/lib/server/agent
git commit -m "fix(agent): a re-read revises a pending proposal instead of dropping it"
```

---

### Task 6: Record a reading that disagrees with the ledger

**Files:**

- Create: `src/lib/server/db/schema/day-reading-conflict.ts`
- Modify: `src/lib/server/db/schema/index.ts` (re-export)
- Create: `src/lib/server/repositories/day-reading-conflict.ts`
- Create: `src/lib/server/repositories/day-reading-conflict.test.ts`
- Modify: `src/lib/server/agent/day-producer.ts`
- Create: one generated migration in `drizzle/` plus one hand-written one

**Interfaces:**

- Consumes: `recordedDaysByDate` (Task 5).
- Produces: `recordDayReadingConflict(input: { contractId: string; date:
string; documentId: string; extractionRunId: string | null; proposedFields:
Record<string, unknown> | null; excerpt: string | null }, executor?:
DbExecutor): Promise<void>`.

- [ ] **Step 1: Define the table**

Create `src/lib/server/db/schema/day-reading-conflict.ts`:

```ts
import { date, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';
import { document } from './document';
import { extractionRun } from './extraction-run';

/**
 * A reading of the mail that disagrees with what the ledger holds for a day.
 *
 * The producer discovers the disagreement in a moment that then passes, and
 * the alert engine is detectors querying the database — it cannot re-invoke
 * the model to rediscover it. So the reading is written down here, the same
 * shape `backup_run` and `document_mirror_run` already have: an alert whose
 * evidence is a row on a table of its own.
 *
 * One row per `(contract_id, date)`, upserted: the newest reading supersedes
 * the previous one, because what a reviewer needs is what the mail says now.
 * `proposed_fields` null means the newest reading proposes **nothing** for
 * that date — the client cancelled the day — which is a disagreement too.
 *
 * No `acknowledged_at`. Acknowledgement belongs to the alert engine, keyed by
 * `alertKey` (`alert_acknowledgement`), and a second kind of acknowledge
 * button is the mistake that table's own doc comment exists to prevent.
 */
export const dayReadingConflict = pgTable(
	'day_reading_conflict',
	{
		id: id(),
		contractId: uuid('contract_id')
			.notNull()
			.references(() => contract.id, { onDelete: 'restrict' }),
		date: date('date').notNull(),
		documentId: uuid('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'restrict' }),
		extractionRunId: uuid('extraction_run_id').references(() => extractionRun.id, {
			onDelete: 'restrict'
		}),
		proposedFields: jsonb('proposed_fields'),
		excerpt: text('excerpt'),
		...timestamps()
	},
	(table) => [unique('day_reading_conflict_contract_date_key').on(table.contractId, table.date)]
);
```

Re-export it from `src/lib/server/db/schema/index.ts` beside the others.

- [ ] **Step 2: Generate and rename the migration**

```bash
pnpm db:generate
```

Rename the generated file and its journal entry to
`0075_day_reading_conflict.sql` (follow the number `db:generate` actually
produced), the way `drizzle/0073_inbound_thread_references.sql` was renamed:
`mv` the file, then edit the `tag` in `drizzle/meta/_journal.json`.

- [ ] **Step 3: Add the updated_at trigger by hand**

```bash
pnpm db:generate:custom --name=day_reading_conflict_touch
```

Into the created file:

```sql
CREATE TRIGGER day_reading_conflict_set_updated_at BEFORE UPDATE ON "day_reading_conflict"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Apply and check**

```bash
pnpm db:migrate
docker exec mastro-db-1 psql -U mastro -d mastro -tAc "\d day_reading_conflict"
```

Expected: the table, the unique index, and the trigger.

- [ ] **Step 5: Write the failing repository test**

Create `src/lib/server/repositories/day-reading-conflict.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { dayReadingConflict } from '$lib/server/db/schema';
import { recordDayReadingConflict } from './day-reading-conflict';

test('the newest reading supersedes the previous one for the same day', async () => {
	// Upserted, not appended: what a reviewer needs is what the mail says
	// now, not every reading that ever disagreed.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractId, documentId } = await seedContractAndDocument(tx);
		await recordDayReadingConflict(
			{
				contractId,
				date: '2026-08-04',
				documentId,
				extractionRunId: null,
				proposedFields: { date: '2026-08-04', quantity: 1, scope: 'meetings' },
				excerpt: 'una giornata il 4'
			},
			tx
		);
		await recordDayReadingConflict(
			{
				contractId,
				date: '2026-08-04',
				documentId,
				extractionRunId: null,
				proposedFields: null,
				excerpt: null
			},
			tx
		);
		return tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractId));
	});

	expect(result).toHaveLength(1);
	expect(result[0].proposedFields).toBeNull();
});
```

Write `seedContractAndDocument` inline in this file, following
`work-unit.test.ts`'s own `insertContract` and `storeDocument` usage — do not
import fixtures across test files.

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm exec vitest run src/lib/server/repositories/day-reading-conflict.test.ts`
Expected: FAIL — cannot resolve `./day-reading-conflict`.

- [ ] **Step 7: Write the repository function**

Create `src/lib/server/repositories/day-reading-conflict.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { dayReadingConflict } from '$lib/server/db/schema';

export interface DayReadingConflictInput {
	readonly contractId: string;
	readonly date: string;
	readonly documentId: string;
	readonly extractionRunId: string | null;
	/** Null when the newest reading proposes nothing for this date. */
	readonly proposedFields: Record<string, unknown> | null;
	readonly excerpt: string | null;
}

/** Upserts the newest disagreeing reading for one day. */
export async function recordDayReadingConflict(
	input: DayReadingConflictInput,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.insert(dayReadingConflict)
		.values(input)
		.onConflictDoUpdate({
			target: [dayReadingConflict.contractId, dayReadingConflict.date],
			set: {
				documentId: input.documentId,
				extractionRunId: input.extractionRunId,
				proposedFields: input.proposedFields,
				excerpt: input.excerpt
			}
		});
}

/** Drops the conflict for a day, for when the ledger and the reading agree
 * again — the producer calls this so a stale row cannot keep an alert alive
 * after the disagreement is over. */
export async function clearDayReadingConflict(
	contractId: string,
	date: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.delete(dayReadingConflict)
		.where(and(eq(dayReadingConflict.contractId, contractId), eq(dayReadingConflict.date, date)));
}
```

- [ ] **Step 8: Run the test**

Run: `pnpm exec vitest run src/lib/server/repositories/day-reading-conflict.test.ts`
Expected: PASS.

- [ ] **Step 9: Write conflicts from the producer**

In `day-producer.ts`, the rejected days are already returned by
`validateDays`. For each day rejected with the "already recorded" reason,
record a conflict — but only when the reading actually differs from the
recorded day, so the ordinary "a re-read confirms what we hold" case writes
nothing:

```ts
// A reading that disagrees with a day already on the ledger is not
// suppressed information, it is a thing a reviewer needs to know: the
// ledger is not touched (that decision was theirs) and the disagreement
// is written down for the alert engine, which cannot re-invoke the model
// to rediscover it.
for (const entry of rejected) {
	if (!entry.reason.endsWith('is already recorded on this contract')) continue;
	const recorded = recordedByDate.get(entry.day.date);
	if (recorded && Number(recorded.quantity) === entry.day.quantity) {
		await clearDayReadingConflict(source.contractId, entry.day.date, executor);
		continue;
	}
	await recordDayReadingConflict(
		{
			contractId: source.contractId,
			date: entry.day.date,
			documentId: source.conversation?.[entry.day.messageIndex]?.documentId ?? source.documentId,
			extractionRunId: null,
			proposedFields: {
				date: entry.day.date,
				quantity: entry.day.quantity,
				scope: entry.day.scope
			},
			excerpt: entry.day.excerpt
		},
		executor
	);
}
```

`recordedByDate` is the map Task 5 already returns, held in
`writeDayProposals` for exactly this: the recorded quantity is what tells a
real disagreement from a re-read that confirms what the ledger holds, and the
confirming case clears any conflict row left from an earlier disagreement.

- [ ] **Step 10: Add the producer test**

Append to `day-producer.test.ts`:

```ts
test('a reading that disagrees with a recorded day writes a conflict and no proposal', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-02-03',
			quantity: 1,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		const outcome = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'il 3 era mezza giornata',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'il 3 era mezza giornata',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		const conflicts = await tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractRow.id));
		return { outcome, conflicts };
	});

	expect(result.outcome.proposals).toHaveLength(0);
	expect(result.conflicts).toHaveLength(1);
	expect(result.conflicts[0].proposedFields).toMatchObject({ quantity: 0.5 });
});
```

- [ ] **Step 11: Run the producer and repository tests**

Run: `pnpm exec vitest run src/lib/server/agent/day-producer.test.ts src/lib/server/repositories/day-reading-conflict.test.ts`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
pnpm exec prettier --write src/lib/server/db/schema/day-reading-conflict.ts src/lib/server/repositories/day-reading-conflict.ts src/lib/server/repositories/day-reading-conflict.test.ts src/lib/server/agent/day-producer.ts src/lib/server/agent/day-producer.test.ts src/lib/server/db/schema/index.ts
git add src/lib/server/db src/lib/server/repositories/day-reading-conflict.ts src/lib/server/repositories/day-reading-conflict.test.ts src/lib/server/agent drizzle
git commit -m "feat(agent): record a reading that disagrees with a recorded day"
```

---

### Task 7: The two alerts

**Files:**

- Modify: `src/lib/server/db/schema/alert.ts` (`ALERT_TYPES`)
- Create: one hand-written migration widening the `alert.type` CHECK
- Modify: `src/lib/server/alerts/types.ts` (`AlertDetail`)
- Modify: `src/lib/server/alerts/repository.ts` (the fetch)
- Modify: `src/lib/server/alerts/detectors.ts` (two detectors)
- Modify: `src/lib/server/alerts/engine.ts` (wiring)
- Modify: `src/lib/server/alerts/render.ts`, `src/lib/server/alerts/actions.ts`
- Modify: `messages/en.json`, `messages/it.json`
- Test: `src/lib/server/alerts/detectors.test.ts`

**Interfaces:**

- Consumes: the `day_reading_conflict` table (Task 6).
- Produces: `fetchDayReadingConflictRows(executor?): Promise<DayReadingConflictAlertRow[]>`,
  `detectRecordedDayContradicted(rows): Alert[]`,
  `detectPendingProposalUnconfirmed(rows): Alert[]`.

- [ ] **Step 1: Widen the alert type list and the CHECK**

Add `'recorded_day_contradicted'` and `'pending_proposal_unconfirmed'` to
`ALERT_TYPES`. Then:

```bash
pnpm db:generate:custom --name=alert_types_day_reading_conflict
```

There is **no** `alert` table: the CHECK lives on three of them, and
`drizzle/0047_alert_type_proposal_pending.sql` is the shape to follow. Write
into the generated file:

```sql
-- Widens the `alert_type` CHECK on all three tables that carry one, for the
-- two alerts that say the mail disagrees with a day the ledger holds. The
-- same metadata-only widening `proposal_pending` (0047) and
-- `agent_run_failure` (0045) established: `ALERT_TYPES` is text with a CHECK
-- precisely so a new type is never an `ALTER TYPE ... ADD VALUE`, whose new
-- label cannot be used inside the transaction that adds it.

ALTER TABLE "alert_acknowledgement" DROP CONSTRAINT "alert_acknowledgement_type_known";
ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending',
		'recorded_day_contradicted', 'pending_proposal_unconfirmed'
	));

ALTER TABLE "alert_delivery" DROP CONSTRAINT "alert_delivery_type_known";
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending',
		'recorded_day_contradicted', 'pending_proposal_unconfirmed'
	));

ALTER TABLE "alert_preference" DROP CONSTRAINT "alert_preference_type_known";
ALTER TABLE "alert_preference" ADD CONSTRAINT "alert_preference_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending',
		'recorded_day_contradicted', 'pending_proposal_unconfirmed'
	));
```

Apply with `pnpm db:migrate`, then confirm all three:

```bash
docker exec mastro-db-1 psql -U mastro -d mastro -tAc \
  "select conname from pg_constraint where conname like 'alert%type_known'"
```

- [ ] **Step 2: Write the failing detector tests**

Append to `src/lib/server/alerts/detectors.test.ts`:

```ts
describe('detectRecordedDayContradicted', () => {
	const base = {
		conflictId: 'c1',
		contractId: 'ct1',
		clientId: 'cl1',
		contractTitle: 'Contratto',
		clientLegalName: 'Visum Labs',
		date: '2026-08-04',
		readingQuantity: 0.5,
		recordedWorkUnitId: 'w1',
		recordedQuantity: 1,
		recordedState: 'worked' as const,
		pendingProposalId: null
	};

	test('fires while the reading and the recorded day disagree', () => {
		const alerts = detectRecordedDayContradicted([base]);
		expect(alerts).toHaveLength(1);
		expect(alerts[0].detail.type).toBe('recorded_day_contradicted');
		expect(alerts[0].severity).toBe('serious');
	});

	test('a day already invoiced is critical: the money has left', () => {
		const alerts = detectRecordedDayContradicted([{ ...base, recordedState: 'invoiced' }]);
		expect(alerts[0].severity).toBe('critical');
	});

	test('stops on its own once they agree', () => {
		// No acknowledgement needed: correcting the day is what silences it.
		expect(detectRecordedDayContradicted([{ ...base, readingQuantity: 1 }])).toEqual([]);
	});
});

describe('detectPendingProposalUnconfirmed', () => {
	test('fires when the newest reading proposes nothing for a pending day', () => {
		const alerts = detectPendingProposalUnconfirmed([
			{
				conflictId: 'c2',
				contractId: 'ct1',
				clientId: 'cl1',
				contractTitle: 'Contratto',
				clientLegalName: 'Visum Labs',
				date: '2026-08-04',
				readingQuantity: null,
				recordedWorkUnitId: null,
				recordedQuantity: null,
				recordedState: null,
				pendingProposalId: 'p1'
			}
		]);
		expect(alerts).toHaveLength(1);
		expect(alerts[0].severity).toBe('warning');
	});

	test('a pending proposal the reading still confirms raises nothing', () => {
		expect(
			detectPendingProposalUnconfirmed([
				{
					conflictId: 'c3',
					contractId: 'ct1',
					clientId: 'cl1',
					contractTitle: 'Contratto',
					clientLegalName: 'Visum Labs',
					date: '2026-08-04',
					readingQuantity: 0.5,
					recordedWorkUnitId: null,
					recordedQuantity: null,
					recordedState: null,
					pendingProposalId: 'p1'
				}
			])
		).toEqual([]);
	});
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm exec vitest run src/lib/server/alerts/detectors.test.ts`
Expected: FAIL — the two detectors do not exist.

- [ ] **Step 4: Add the detail members**

In `src/lib/server/alerts/types.ts`, add to `AlertDetail`:

```ts
	| {
			readonly type: 'recorded_day_contradicted';
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly date: string;
			readonly workUnitId: string;
			readonly recordedQuantity: number;
			/** Null when the newest reading proposes nothing for this date. */
			readonly readingQuantity: number | null;
	  }
	| {
			readonly type: 'pending_proposal_unconfirmed';
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly date: string;
			readonly proposalId: string;
	  }
```

- [ ] **Step 5: Write the detectors**

In `detectors.ts`, with the row interface:

```ts
export interface DayReadingConflictAlertRow {
	readonly conflictId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly date: string;
	/** Null when the newest reading proposes nothing for this date. */
	readonly readingQuantity: number | null;
	readonly recordedWorkUnitId: string | null;
	readonly recordedQuantity: number | null;
	readonly recordedState: WorkUnitState | null;
	readonly pendingProposalId: string | null;
}

/**
 * The mail now says something different from a day the ledger already holds
 * (design doc, "when a reading disagrees with the ledger"). The ledger is not
 * touched — that day was a human decision — so the only honest move is to say
 * so. Self-resolving: the row is compared against the ledger on every run, so
 * correcting the day silences the alert without an acknowledgement.
 *
 * `critical` once the day is `invoiced` or `paid`, because by then the number
 * has left the building; `serious` before that, when correcting it is still
 * free.
 */
export function detectRecordedDayContradicted(
	rows: readonly DayReadingConflictAlertRow[]
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (row.recordedWorkUnitId === null || row.recordedQuantity === null) continue;
		if (row.readingQuantity !== null && row.readingQuantity === row.recordedQuantity) continue;
		const severity =
			row.recordedState === 'invoiced' || row.recordedState === 'paid' ? 'critical' : 'serious';
		alerts.push(
			makeAlert(row.conflictId, severity, {
				type: 'recorded_day_contradicted',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				date: row.date,
				workUnitId: row.recordedWorkUnitId,
				recordedQuantity: row.recordedQuantity,
				readingQuantity: row.readingQuantity
			})
		);
	}
	return alerts;
}

/**
 * A proposal is still waiting and the newest reading of its conversation no
 * longer proposes that day at all — the client cancelled it. Not withdrawn
 * automatically: that would be the agent deciding, which invariant 3 gives to
 * a human. `warning`, because nothing is on the ledger yet.
 */
export function detectPendingProposalUnconfirmed(
	rows: readonly DayReadingConflictAlertRow[]
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (row.pendingProposalId === null || row.readingQuantity !== null) continue;
		alerts.push(
			makeAlert(row.conflictId, 'warning', {
				type: 'pending_proposal_unconfirmed',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				date: row.date,
				proposalId: row.pendingProposalId
			})
		);
	}
	return alerts;
}
```

- [ ] **Step 6: Run the detector tests**

Run: `pnpm exec vitest run src/lib/server/alerts/detectors.test.ts`
Expected: PASS.

- [ ] **Step 7: Add the query**

In `src/lib/server/alerts/repository.ts`, beside the other fetch functions:

```ts
/** The conflicts, each carried alongside what the ledger currently holds for
 * that day — which is what lets the detectors resolve themselves: they
 * compare the stored reading against this on every run, so correcting the day
 * silences the alert with no acknowledgement. */
export async function fetchDayReadingConflictRows(
	executor: DbExecutor = db
): Promise<DayReadingConflictAlertRow[]> {
	const rows = await executor
		.select({
			conflictId: dayReadingConflict.id,
			contractId: dayReadingConflict.contractId,
			clientId: client.id,
			contractTitle: contract.title,
			clientLegalName: client.legalName,
			date: dayReadingConflict.date,
			// Null when `proposed_fields` is null, which is how the producer
			// records "the newest reading proposes nothing for this date".
			readingQuantity: sql<string | null>`(${dayReadingConflict.proposedFields} ->> 'quantity')`,
			recordedWorkUnitId: workUnit.id,
			recordedQuantity: workUnit.quantity,
			recordedState: workUnit.state,
			pendingProposalId: proposal.id
		})
		.from(dayReadingConflict)
		.innerJoin(contract, eq(contract.id, dayReadingConflict.contractId))
		.innerJoin(client, eq(client.id, contract.clientId))
		.leftJoin(
			workUnit,
			and(
				eq(workUnit.contractId, dayReadingConflict.contractId),
				eq(workUnit.date, dayReadingConflict.date)
			)
		)
		.leftJoin(
			proposal,
			and(
				eq(proposal.contractId, dayReadingConflict.contractId),
				eq(proposal.targetType, 'work_unit'),
				eq(proposal.status, 'pending'),
				sql`${proposal.proposedFields} ->> 'date' = ${dayReadingConflict.date}::text`
			)
		);

	// Numeric columns come back as strings from `postgres`; the detectors
	// compare numbers, so the conversion belongs here rather than in three
	// places downstream.
	return rows.map((row) => ({
		...row,
		readingQuantity: row.readingQuantity === null ? null : Number(row.readingQuantity),
		recordedQuantity: row.recordedQuantity === null ? null : Number(row.recordedQuantity)
	}));
}
```

Two days on one date is legal, so a conflict for such a date yields two rows
here and two alerts. That is correct rather than a duplicate: each names its
own `work_unit`.

- [ ] **Step 8: Wire the engine**

Add `fetchDayReadingConflictRows(executor)` to the `Promise.all` in
`engine.ts` and both detectors to the returned array, in the same order the
list already uses.

- [ ] **Step 9: Render and act**

In `render.ts`, beside the other cases:

```ts
		case 'recorded_day_contradicted':
			return {
				title: m.alerts_recorded_day_contradicted_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body: m.alerts_recorded_day_contradicted_body(
					{
						clientLegalName: detail.clientLegalName,
						date: formatDate(detail.date, locale),
						recorded: formatDays(detail.recordedQuantity, locale),
						reading:
							detail.readingQuantity === null
								? m.alerts_recorded_day_contradicted_reading_none(undefined, { locale })
								: formatDays(detail.readingQuantity, locale)
					},
					{ locale }
				)
			};

		case 'pending_proposal_unconfirmed':
			return {
				title: m.alerts_pending_proposal_unconfirmed_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body: m.alerts_pending_proposal_unconfirmed_body(
					{ clientLegalName: detail.clientLegalName, date: formatDate(detail.date, locale) },
					{ locale }
				)
			};
```

In `actions.ts`, beside the other cases:

```ts
		case 'recorded_day_contradicted': {
			// The day itself is what to look at: correcting it is what silences
			// this, since the detector re-compares on every run.
			return {
				subjectHref: contractHref(detail.contractId, detail.clientId),
				subjectLabel: m.alerts_action_open_contract(undefined, { locale }),
				actionHref: `/day/${detail.workUnitId}`,
				actionLabel: m.alerts_action_open_day(undefined, { locale })
			};
		}

		case 'pending_proposal_unconfirmed': {
			// Nothing is on the ledger, so the action is the decision that was
			// already waiting: the proposal's own screen.
			return {
				subjectHref: contractHref(detail.contractId, detail.clientId),
				subjectLabel: m.alerts_action_open_contract(undefined, { locale }),
				actionHref: `/proposals/${detail.proposalId}`,
				actionLabel: m.alerts_action_review_proposal(undefined, { locale })
			};
		}
```

New message keys, inserted in sorted position in **both** catalogues. Grep for
`alerts_action_open_day` and `alerts_action_review_proposal` first — if either
exists, reuse it rather than adding a second label for one idea:

```json
"alerts_pending_proposal_unconfirmed_body": "{clientLegalName} no longer confirms {date} in the latest mail. The proposal is still waiting for your decision.",
"alerts_pending_proposal_unconfirmed_title": "A proposal is no longer confirmed on {contractTitle}",
"alerts_recorded_day_contradicted_body": "{date} is recorded as {recorded}, and the latest mail from {clientLegalName} reads {reading}.",
"alerts_recorded_day_contradicted_reading_none": "no day at all",
"alerts_recorded_day_contradicted_title": "The mail disagrees with a recorded day on {contractTitle}"
```

```json
"alerts_pending_proposal_unconfirmed_body": "{clientLegalName} non conferma più il {date} nell'ultima mail. La proposta è ancora in attesa della tua decisione.",
"alerts_pending_proposal_unconfirmed_title": "Una proposta non è più confermata su {contractTitle}",
"alerts_recorded_day_contradicted_body": "Il {date} è registrato come {recorded}, e l'ultima mail di {clientLegalName} dice {reading}.",
"alerts_recorded_day_contradicted_reading_none": "nessuna giornata",
"alerts_recorded_day_contradicted_title": "La posta non concorda con una giornata registrata su {contractTitle}"
```

- [ ] **Step 10: Run the alert suite and check types**

Run: `pnpm exec vitest run src/lib/server/alerts && pnpm check`
Expected: PASS and 0 errors. The compiler is what proves the five touch
points (types, detector, engine, render, actions) are all updated: a missing
`case` in a switch over a discriminated union is a type error here.

- [ ] **Step 11: Commit**

```bash
pnpm exec prettier --write src/lib/server/alerts messages/en.json messages/it.json src/lib/server/db/schema/alert.ts
git add src/lib/server/alerts src/lib/server/db messages/en.json messages/it.json drizzle
git commit -m "feat(alerts): say when the mail disagrees with a day on the ledger"
```

---

### Task 8: The gate, and the flow end to end

**Files:** none — this task changes nothing and proves everything.

**Interfaces:** consumes all of the above.

- [ ] **Step 1: The full gate**

```bash
pnpm lint && pnpm check && pnpm db:migrate && pnpm test && pnpm build
```

Expected: Prettier clean, 0 svelte-check errors, migrations applied, suite
green, build succeeds. `pnpm lint` and `pnpm check` take no path and cover the
whole project, so a stray formatting error anywhere fails them.

- [ ] **Step 2: The suite twice more**

```bash
for i in 1 2; do pnpm test 2>&1 | grep -E '^ *Tests '; done
```

Expected: the same count both times. A test that passes once and fails once is
a flake to fix now, not later.

- [ ] **Step 3: Seed the demo and re-run**

```bash
pnpm seed:demo && pnpm test 2>&1 | grep -E '^ *Tests '
```

Expected: unchanged. A test that only passes on an empty instance is broken.

- [ ] **Step 4: Drive the whole flow in a browser**

`pnpm dev`, then, in Italian and again in English:

1. `/proposals` — a pending row shows the client's words; accept it without
   opening the detail.
2. The day exists at `approved` on `/day/[id]`, linked to its approval.
3. Plant an approved day dated yesterday, POST `/api/days/settle` with
   `ALERT_CRON_TOKEN`, reload: the day reads `worked` and its transition list
   names the `system` actor with its reason.
4. `/invoices/new` for that contract now offers the day.

- [ ] **Step 5: Verify the two alerts against planted data**

Insert a `day_reading_conflict` row disagreeing with a recorded day, POST
`/api/alerts/run/digest`, and confirm the alert appears on `/alerts` with the
expected severity. Correct the day, run again, and confirm it is gone without
an acknowledgement.

- [ ] **Step 6: Commit whatever the verification changed**

Usually nothing. If a copy or layout fix came out of the browser pass, commit
it on its own:

```bash
git add -A && git commit -m "fix(web): <what the browser showed>"
```

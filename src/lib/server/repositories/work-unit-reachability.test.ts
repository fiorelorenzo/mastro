import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { workUnitState, type WorkUnitState } from '$lib/server/db/schema/work-unit';

/**
 * #370's last acceptance bullet: "every state in the work_unit enum is
 * either reachable from the interface or absent from the enum", checked
 * by a test that stays true as the enum grows rather than a snapshot of
 * today's buttons ("a test that merely lists today's actions is not the
 * durable version" — the issue's own words). `revoked` and `rejected`
 * were the two states this issue found with a database edge and zero
 * interface producers: `day/work-unit-state.ts` rendered a label for
 * either regardless, since a state only reachable by hand-written SQL
 * still needs a badge the moment a row holds it.
 *
 * The correspondence is checked two ways, both grounded in the real
 * enum and real file content rather than a hand-typed "yes, reachable"
 * list a rename could silently invalidate:
 *
 *  1. `PRODUCERS` is typed `Record<WorkUnitState, …>` against the
 *     schema's own `WorkUnitState` union, not a copy of it — a state
 *     added to (or removed from) the enum without a matching edit here
 *     fails `pnpm check` (an excess or missing property on an object
 *     literal assigned a `Record<K, V>` type). Independently of that,
 *     indexing `PRODUCERS[state]` for a state this map has no entry for
 *     throws at test-run time too, so the guarantee does not rest on
 *     type-checking having run first.
 *  2. Every producer beyond `'entry'` (the state machine trigger's own
 *     INSERT allow-list, `0012_work_unit_state_machine.sql` — `proposed`,
 *     `worked`, `worked_without_approval`) names a real route file and a
 *     substring of a real repository call, read fresh off disk on every
 *     run. A route that stops calling `disputeWorkUnit` — or renames it —
 *     fails this test, not just a comment.
 *
 * `paid` is the one documented exception. Tracing every producer for
 * this test turned up none for it: no route or repository call sets
 * `work_unit.state = 'paid'` anywhere outside a schema/repository test
 * fixture or the demo seed (`src/lib/server/seed/demo-seed.ts`) — reachable
 * only by hand-written SQL, the same shape #370 fixed for `revoked`/
 * `rejected`. Deciding how a day should actually reach `paid` (its own
 * action, or automatically the moment `getInvoiceBalance` reports the
 * invoice settled) is a real product decision #370 did not scope for, so
 * it is split out as #389 rather than folded in here. `KNOWN_GAPS` names
 * it explicitly, and the second test below pins the list to exactly that
 * one entry: growing it without a linked issue is the failure mode this
 * file exists to catch, not something it should ever pass quietly.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function fileContains(relativePath: string, needle: string): boolean {
	return readFileSync(resolve(repoRoot, relativePath), 'utf8').includes(needle);
}

type Producer =
	| { readonly kind: 'entry' }
	| {
			readonly kind: 'route';
			/** Repo-root-relative path to the `+page.server.ts` (or
			 *  equivalent) that wires this transition to an interface
			 *  action. */
			readonly file: string;
			/** A substring of the real repository call the route makes —
			 *  e.g. `'disputeWorkUnit('` — checked against the file's live
			 *  content, never assumed. */
			readonly contains: string;
			/** Human-readable label for the failure message and for anyone
			 *  reading this map to understand which screen is meant. */
			readonly via: string;
	  };

const PRODUCERS: Record<WorkUnitState, readonly Producer[]> = {
	// INSERT-legal directly (the trigger's TG_OP = 'INSERT' branch).
	// `createWorkUnit`'s `state` defaults to 'proposed' (schema/work-
	// unit.ts's column default); day/new's create action either takes
	// that default or submits 'worked' explicitly through the intent
	// radio (`work-unit-form.ts`'s `DayEntryIntent`). 'worked_without_
	// approval' is the trigger's own redirect of the latter when the
	// contract requires an approval that is not linked (#23) — the same
	// create action is what makes it reachable, just with different
	// data, not a second route.
	proposed: [{ kind: 'entry' }],
	worked: [{ kind: 'entry' }],
	worked_without_approval: [{ kind: 'entry' }],

	approved: [
		{
			kind: 'route',
			file: 'src/routes/proposals/+page.server.ts',
			contains: 'acceptProposal(',
			via: 'proposals queue accept'
		},
		{
			kind: 'route',
			file: 'src/routes/proposals/[id=uuid]/+page.server.ts',
			contains: 'acceptProposal(',
			via: 'proposal review accept'
		}
	],

	invoiced: [
		{
			kind: 'route',
			file: 'src/routes/invoices/new/+page.server.ts',
			contains: 'createInvoice(',
			via: 'invoice creation, billing every work unit on its lines'
		}
	],

	disputed: [
		{
			kind: 'route',
			file: 'src/routes/day/[id=uuid]/+page.server.ts',
			contains: 'disputeWorkUnit(',
			via: 'day detail dispute action'
		},
		{
			kind: 'route',
			file: 'src/routes/invoices/[id=uuid]/+page.server.ts',
			contains: 'disputeWorkUnit(',
			via: 'invoice detail dispute action'
		}
	],

	// #370: previously reachable only by hand-written SQL.
	revoked: [
		{
			kind: 'route',
			file: 'src/routes/day/[id=uuid]/+page.server.ts',
			contains: 'revokeWorkUnit(',
			via: 'day detail revoke action'
		}
	],
	rejected: [
		{
			kind: 'route',
			file: 'src/routes/day/[id=uuid]/+page.server.ts',
			contains: 'rejectWorkUnit(',
			via: 'day detail reject action'
		}
	],

	unbillable: [
		{
			kind: 'route',
			file: 'src/routes/day/[id=uuid]/+page.server.ts',
			contains: 'markWorkUnitUnbillable(',
			via: 'day detail unbillable action'
		},
		{
			kind: 'route',
			file: 'src/routes/alerts/+page.server.ts',
			contains: 'markWorkUnitUnbillable(',
			via: 'alerts list unbillable action'
		}
	],

	// #389: split out of this issue. No producer today.
	paid: []
};

/** States this file already knows are unreachable, each carrying the
 *  issue that tracks fixing it. Anything here must also appear with an
 *  empty producer list above — see the first test below. */
const KNOWN_GAPS: readonly { readonly state: WorkUnitState; readonly issue: string }[] = [
	{ state: 'paid', issue: '#389' }
];

test('every work_unit enum value is reachable from the interface, or is a named, filed gap', () => {
	for (const state of workUnitState.enumValues) {
		const producers = PRODUCERS[state];
		const isReachable = producers.some(
			(producer) => producer.kind === 'entry' || fileContains(producer.file, producer.contains)
		);
		const isKnownGap = KNOWN_GAPS.some((gap) => gap.state === state);

		// Reachable and listed as a gap at once would hide a producer that
		// quietly stopped being exercised — exactly the silent drift this
		// test exists to catch, so it is rejected as loudly as an
		// unreachable, undocumented state.
		expect(
			isReachable !== isKnownGap,
			isReachable && isKnownGap
				? `'${state}' has a working producer but is also listed in KNOWN_GAPS — remove it from the list`
				: `'${state}' has no interface producer and is not in KNOWN_GAPS — wire an action to it, or file an issue and add it there`
		).toBe(true);
	}
});

test('KNOWN_GAPS holds nothing beyond the one state #370 found and split into #389', () => {
	expect(KNOWN_GAPS).toEqual([{ state: 'paid', issue: '#389' }]);
});

const routeProducers = Object.entries(PRODUCERS).flatMap(([state, producers]) =>
	producers
		.filter(
			(producer): producer is Extract<Producer, { kind: 'route' }> => producer.kind === 'route'
		)
		.map((producer) => ({ state: state as WorkUnitState, producer }))
);

test.each(routeProducers)('$state <- $producer.via ($producer.file)', ({ state, producer }) => {
	expect(
		fileContains(producer.file, producer.contains),
		`expected ${producer.file} to still call ${producer.contains} for work_unit state '${state}'`
	).toBe(true);
});

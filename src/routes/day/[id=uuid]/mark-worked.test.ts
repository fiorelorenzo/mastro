// Task 3's date guard: the state-machine trigger enforces which *state*
// transitions are legal, but has no notion of *when* a day happened — that
// is an application rule, and only this action can refuse it. A day dated
// in the future must never become billable from a mis-tap, since the only
// edge out of `worked` is `worked -> invoiced` (nothing undoes it). This
// exercises `actions.worked` directly, at the boundary the button itself
// gates on: tomorrow refuses, today works, yesterday (not yet reached by
// the hourly sweep, but legitimately markable by hand) works too.
//
// This commits through the real `db` singleton the action itself always
// uses — `getWorkUnit` and `markWorkUnitWorked` never receive a `tx` from
// `actions.worked`, so there is no transaction to roll back the way the
// repository suite does, and — unlike `invoices/new/duplicate-number.test.ts`,
// whose rows can be deleted afterwards in FK order — nothing here can be
// cleaned up: `work_unit_transition_immutable` refuses DELETE on the rows
// this test's own INSERTs generate, and the `ON DELETE restrict` chain
// from `work_unit` up through `contract` to `client` follows from that.
// Every fixture row is therefore permanent, whatever database
// `DATABASE_URL` points at when this runs. Kept to one client, one
// contract and three work units — the fewest rows that still cover all
// three boundary dates — rather than a fresh client/contract per case.
import { afterAll, beforeAll, expect, test } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import { utcToday } from '$lib/server/days/settle';
import {
	createWorkUnit,
	getWorkUnit,
	transitionWorkUnit
} from '$lib/server/repositories/work-unit';
import { actions } from './+page.server';

const actor = { kind: 'human' as const, email: 'lorenzo@example.com' };

/** One client and one contract, shared by every case below — the date
 * guard under test does not care whether a written approval is on file,
 * so the contract needs none, and none of the three cases below touch
 * the same date, so one contract is never asked to hold two active work
 * units on the same day. */
let contractId: string;

beforeAll(async () => {
	const [clientRow] = await db
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await db
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '1998-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' },
			requiresPriorApproval: false
		})
		.returning();
	contractId = contractRow.id;
});

afterAll(async () => {
	await pool.end();
});

/** An `approved` day dated `date`, on the shared `contractId`. */
async function approvedDayDated(date: string): Promise<string> {
	const created = await createWorkUnit(
		{ contractId, date, quantity: 1, scope: 'worked date-guard boundary fixture' },
		actor,
		'test fixture'
	);
	await transitionWorkUnit(created.id, { state: 'approved' }, actor, 'test fixture');
	return created.id;
}

// Only `params.id` and `locals.user.email` are read by `actions.worked`
// (see `+page.server.ts`); a narrow, cast object stands in for the
// framework event SvelteKit would normally construct per request, the
// same shape `invoices/new/duplicate-number.test.ts` uses.
function actionEvent(id: string) {
	return {
		params: { id },
		locals: { user: { email: 'lorenzo@example.com' } }
	} as unknown as Parameters<typeof actions.worked>[0];
}

function addDays(date: string, delta: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

test('a day dated tomorrow refuses: the friendly error comes back and the day stays approved', async () => {
	// `today` read here, inside the test, right before it is used to date
	// the fixture and to assert against — never hoisted to module scope,
	// where a UTC-midnight rollover between module load and the action's
	// own `utcToday()` call could date this fixture as today by the time
	// the action runs.
	const today = utcToday();
	const id = await approvedDayDated(addDays(today, 1));

	const result = await actions.worked(actionEvent(id));

	expect(result).toMatchObject({
		status: 400,
		data: { workedError: m.day_detail_worked_future_error() }
	});
	const row = await getWorkUnit(id);
	expect(row?.state).toBe('approved');
});

test('a day dated today is recorded worked', async () => {
	const today = utcToday();
	const id = await approvedDayDated(today);

	const result = await actions.worked(actionEvent(id));

	expect(result).toEqual({ recorded: true });
	const row = await getWorkUnit(id);
	expect(row?.state).toBe('worked');
});

test('a day dated yesterday — not yet reached by the hourly sweep, but legitimately markable by hand — is recorded worked too', async () => {
	const today = utcToday();
	const id = await approvedDayDated(addDays(today, -1));

	const result = await actions.worked(actionEvent(id));

	expect(result).toEqual({ recorded: true });
	const row = await getWorkUnit(id);
	expect(row?.state).toBe('worked');
});

// Task 3's date guard: the state-machine trigger enforces which *state*
// transitions are legal, but has no notion of *when* a day happened — that
// is an application rule, and only this action can refuse it. A day dated
// in the future must never become billable from a mis-tap, since the only
// edge out of `worked` is `worked -> invoiced` (nothing undoes it). This
// exercises `actions.worked` directly, at the boundary the button itself
// gates on: tomorrow refuses, today works, yesterday (not yet reached by
// the hourly sweep, but legitimately markable by hand) works too.
//
// Like `invoices/new/duplicate-number.test.ts`, this commits through the
// real `db` singleton the action itself always uses — `getWorkUnit` and
// `markWorkUnitWorked` never receive a `tx` from `actions.worked`, so
// there is no transaction to roll back the way the repository suite does.
// Every fixture row therefore becomes permanent audit history in whatever
// database `DATABASE_URL` points at when this runs; the same cost that
// test already accepts, for the same reason.
import { afterAll, expect, test } from 'vitest';
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

afterAll(async () => {
	await pool.end();
});

const actor = { kind: 'human' as const, email: 'lorenzo@example.com' };

/** An `approved` day dated `date`, on a contract that needs no written
 * approval — the smallest fixture that reaches `approved`, since the date
 * guard under test does not care whether one is on file. */
async function approvedDayDated(date: string): Promise<string> {
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

	const created = await createWorkUnit(
		{ contractId: contractRow.id, date, quantity: 1, scope: 'worked date-guard boundary fixture' },
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

const today = utcToday();

test('a day dated tomorrow refuses: the friendly error comes back and the day stays approved', async () => {
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
	const id = await approvedDayDated(today);

	const result = await actions.worked(actionEvent(id));

	expect(result).toEqual({ recorded: true });
	const row = await getWorkUnit(id);
	expect(row?.state).toBe('worked');
});

test('a day dated yesterday — not yet reached by the hourly sweep, but legitimately markable by hand — is recorded worked too', async () => {
	const id = await approvedDayDated(addDays(today, -1));

	const result = await actions.worked(actionEvent(id));

	expect(result).toEqual({ recorded: true });
	const row = await getWorkUnit(id);
	expect(row?.state).toBe('worked');
});

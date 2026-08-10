import { expect, test } from 'vitest';
import {
	parseExtractedDays,
	validateDays,
	type DayExtractionContext,
	type ExtractedDay
} from './day-extraction';

const message =
	'Ciao, ti confermo il 3 febbraio e il 4 febbraio, la seconda mezza. Il 6 febbraio no.';

const context: DayExtractionContext = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	allowedQuantities: [1, 0.5],
	content: message
};

const day = (over: Partial<ExtractedDay> = {}): ExtractedDay => ({
	date: '2026-02-03',
	quantity: 1,
	scope: 'Analisi requisiti',
	excerpt: 'ti confermo il 3 febbraio',
	...over
});

test('a well-formed answer parses, including the optional notes', () => {
	const days = parseExtractedDays({
		days: [
			{
				date: '2026-02-03',
				quantity: 1,
				scope: ' Analisi ',
				excerpt: ' il 3 ',
				notes: ' da remoto '
			},
			{ date: '2026-02-04', quantity: 0.5, scope: 'Revisione', excerpt: 'il 4 mezza' }
		]
	});
	expect(days).toEqual([
		{ date: '2026-02-03', quantity: 1, scope: 'Analisi', excerpt: 'il 3', notes: 'da remoto' },
		{ date: '2026-02-04', quantity: 0.5, scope: 'Revisione', excerpt: 'il 4 mezza' }
	]);
});

test('a malformed answer throws naming the day, rather than being repaired', () => {
	// Every one of these is something a model actually does, and none of
	// them is safe to guess at: a day shown to a human has to be what the
	// message said, not what the parser assumed it meant.
	expect(() => parseExtractedDays({})).toThrow(/days is not an array/);
	expect(() => parseExtractedDays({ days: [{ ...day(), date: '3 February' }] })).toThrow(
		/day 0 has no YYYY-MM-DD date/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), quantity: 'one' }] })).toThrow(
		/day 0 has no numeric quantity/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), excerpt: '  ' }] })).toThrow(
		/day 0 has no excerpt/
	);
	// A missing scope is not malformed: plenty of approvals say only "ok
	// for Thursday", and a scope invented to fill the field is worse than
	// an empty one a reviewer completes.
	expect(parseExtractedDays({ days: [{ ...day(), scope: undefined }] })[0].scope).toBe('');
});

test('a day that is not a real date is refused, shape notwithstanding', () => {
	// 2026-02-31 passes the regex and is not a day that exists.
	const { accepted, rejected } = validateDays([day({ date: '2026-02-31' })], context);
	expect(accepted).toEqual([]);
	expect(rejected[0].reason).toMatch(/not a real date/);
});

test('a day outside the contract term is refused at both ends', () => {
	const { accepted, rejected } = validateDays(
		[day({ date: '2025-12-31' }), day({ date: '2027-01-01' })],
		context
	);
	expect(accepted).toEqual([]);
	expect(rejected.map((r) => r.reason)).toEqual([
		expect.stringMatching(/before the contract starts/),
		expect.stringMatching(/after the contract ends/)
	]);
});

test('an open-ended contract accepts a day after its start with no upper bound', () => {
	const { accepted } = validateDays([day({ date: '2030-06-01' })], { ...context, endsOn: null });
	expect(accepted).toHaveLength(1);
});

test('a quantity the rate cards do not sell is refused, and any positive one passes when there are none', () => {
	expect(validateDays([day({ quantity: 0.25 })], context).rejected[0].reason).toMatch(
		/not one this contract's rate cards sell/
	);
	expect(validateDays([day({ quantity: 0 })], context).rejected[0].reason).toMatch(
		/is not positive/
	);
	expect(
		validateDays([day({ quantity: 0.25 })], { ...context, allowedQuantities: [] }).accepted
	).toHaveLength(1);
});

test('the same date twice keeps the first and refuses the second', () => {
	// A model asked for "Thursday and Friday, Friday half" sometimes emits
	// Friday twice, once full and once half. Two work units on one day is
	// not what the message said.
	const { accepted, rejected } = validateDays(
		[day({ date: '2026-02-06', quantity: 1 }), day({ date: '2026-02-06', quantity: 0.5 })],
		context
	);
	expect(accepted).toHaveLength(1);
	expect(accepted[0].quantity).toBe(1);
	expect(rejected[0].reason).toMatch(/appears twice/);
});

test('a message that approves nothing yields nothing, not an empty proposal', () => {
	expect(validateDays(parseExtractedDays({ days: [] }), context)).toEqual({
		accepted: [],
		rejected: []
	});
});

test('an excerpt that is not verbatim in the message is refused', () => {
	// The failure invariant 4 cannot tolerate: a plausible paraphrase shown
	// to a reviewer as if the client had written it.
	const { accepted, rejected } = validateDays(
		[day({ excerpt: 'the client agreed to three days' })],
		context
	);
	expect(accepted).toEqual([]);
	expect(rejected[0].reason).toMatch(/not verbatim in the message/);
});

test('a verbatim excerpt too short to read as evidence is refused', () => {
	// Asked for the shortest span that justifies a day, a model will hand
	// back "3". It is verbatim, and it tells a reviewer nothing.
	expect(validateDays([day({ excerpt: '3' })], context).rejected[0].reason).toMatch(
		/too short to be evidence/
	);
});

test('an excerpt whose whitespace was reflowed still counts as verbatim', () => {
	const { accepted } = validateDays([day({ excerpt: 'ti confermo   il 3\n febbraio' })], context);
	expect(accepted).toHaveLength(1);
});

test('a too-short excerpt widens to the message-level span rather than losing the day', () => {
	// Claude answers "3" for the first of "il 3 febbraio e il 4 febbraio"
	// often enough to matter. Throwing the day away over it costs the user
	// a day's billing; showing the whole approval sentence instead costs
	// precision and keeps the evidence honest.
	const { accepted, rejected } = validateDays([day({ excerpt: '3' })], {
		...context,
		fallbackExcerpt: 'ti confermo il 3 febbraio e il 4 febbraio'
	});
	expect(rejected).toEqual([]);
	expect(accepted[0].excerpt).toBe('ti confermo il 3 febbraio e il 4 febbraio');
});

test('widening never invents: a fallback that is not verbatim leaves the day refused', () => {
	const { accepted, rejected } = validateDays([day({ excerpt: '3' })], {
		...context,
		fallbackExcerpt: 'the client approved two days in February'
	});
	expect(accepted).toEqual([]);
	expect(rejected[0].reason).toMatch(/too short to be evidence/);
});

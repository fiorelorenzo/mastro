import { expect, test } from 'vitest';
import {
	dayConfidence,
	dayExtractionInstructions,
	parseExtractedDays,
	validateDays,
	yearRolloverFlag,
	YEAR_ROLLOVER_CONFIDENCE_CAP,
	type DayExtractionContext,
	type ExtractedDay
} from './day-extraction';

const message =
	'Ciao, ti confermo il 3 febbraio e il 4 febbraio, la seconda mezza. Il 6 febbraio no.';

const context: DayExtractionContext = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	messageDate: '2026-02-02',
	allowedQuantities: [1, 0.5],
	content: message
};

const day = (over: Partial<ExtractedDay> = {}): ExtractedDay => ({
	date: '2026-02-03',
	quantity: 1,
	scope: 'Analisi requisiti',
	excerpt: 'ti confermo il 3 febbraio',
	messageIndex: 0,
	...over
});

test('a well-formed answer parses, including the optional notes and each day\u2019s message index', () => {
	// Two messages, so the second day's messageIndex actually says
	// something: it points at the reply, not the offer.
	const days = parseExtractedDays(
		{
			days: [
				{
					date: '2026-02-03',
					quantity: 1,
					scope: ' Analisi ',
					excerpt: ' il 3 ',
					notes: ' da remoto ',
					messageIndex: 0
				},
				{
					date: '2026-02-04',
					quantity: 0.5,
					scope: 'Revisione',
					excerpt: 'il 4 mezza',
					messageIndex: 1
				}
			]
		},
		2
	);
	expect(days).toEqual([
		{
			date: '2026-02-03',
			quantity: 1,
			scope: 'Analisi',
			excerpt: 'il 3',
			notes: 'da remoto',
			messageIndex: 0
		},
		{
			date: '2026-02-04',
			quantity: 0.5,
			scope: 'Revisione',
			excerpt: 'il 4 mezza',
			messageIndex: 1
		}
	]);
});

test('a malformed answer throws naming the day, rather than being repaired', () => {
	// Every one of these is something a model actually does, and none of
	// them is safe to guess at: a day shown to a human has to be what the
	// message said, not what the parser assumed it meant.
	expect(() => parseExtractedDays({}, 1)).toThrow(/days is not an array/);
	expect(() => parseExtractedDays({ days: [{ ...day(), date: '3 February' }] }, 1)).toThrow(
		/day 0 has no YYYY-MM-DD date/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), quantity: 'one' }] }, 1)).toThrow(
		/day 0 has no numeric quantity/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), excerpt: '  ' }] }, 1)).toThrow(
		/day 0 has no excerpt/
	);
	// A missing scope is not malformed: plenty of approvals say only "ok
	// for Thursday", and a scope invented to fill the field is worse than
	// an empty one a reviewer completes.
	expect(parseExtractedDays({ days: [{ ...day(), scope: undefined }] }, 1)[0].scope).toBe('');
});

test('a message index out of range for the conversation given is rejected, not clamped', () => {
	// #400: the model naming a message that does not exist has not
	// understood the conversation it was given, the same failure this
	// function already refuses to paper over for every other field.
	// Negative, non-integer and beyond-range all count as invalid.
	expect(() => parseExtractedDays({ days: [{ ...day(), messageIndex: 2 }] }, 2)).toThrow(
		/day 0 has no valid messageIndex \(0\.\.1\)/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), messageIndex: -1 }] }, 1)).toThrow(
		/no valid messageIndex/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), messageIndex: 0.5 }] }, 1)).toThrow(
		/no valid messageIndex/
	);
	expect(() => parseExtractedDays({ days: [{ ...day(), messageIndex: undefined }] }, 1)).toThrow(
		/no valid messageIndex/
	);
	// In range for the conversation actually given still passes.
	expect(parseExtractedDays({ days: [{ ...day(), messageIndex: 1 }] }, 2)[0].messageIndex).toBe(1);
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
	// The documented no-days answer #397 made the parser accept:
	// {"proposedFields":{"days":[]},"excerpt":"","confidence":1}.
	expect(validateDays(parseExtractedDays({ days: [] }, 1), context)).toEqual({
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

test('a date in a different calendar year than the message is flagged, not rejected', () => {
	const { accepted, rejected } = validateDays(
		[
			day({ date: '2026-12-29' }),
			day({ date: '2027-01-01', excerpt: 'ti confermo il 3 febbraio' })
		],
		{ ...context, messageDate: '2026-12-15', endsOn: null }
	);
	expect(rejected).toEqual([]);
	expect(accepted[0].flagReason).toBeNull();
	expect(accepted[1].flagReason).toMatch(/different calendar year/);
});

test('a date more than 60 days before the message date is flagged', () => {
	const { accepted } = validateDays([day({ date: '2026-02-03' })], {
		...context,
		startsOn: '2025-01-01',
		messageDate: '2026-06-01'
	});
	expect(accepted[0].flagReason).toMatch(/more than 60 days before/);
});

test('a date within 60 days, same year, is not flagged', () => {
	const { accepted } = validateDays([day({ date: '2026-02-03' })], {
		...context,
		messageDate: '2026-02-02'
	});
	expect(accepted[0].flagReason).toBeNull();
});

test('yearRolloverFlag is a pure date comparison, no model involved', () => {
	expect(yearRolloverFlag('2025-12-29', '2026-12-15')).toMatch(/different calendar year/);
	expect(yearRolloverFlag('2026-01-01', '2026-12-15')).toMatch(/more than 60 days before/);
	expect(yearRolloverFlag('2026-12-10', '2026-12-15')).toBeNull();
	// Forward into next year is still flagged: the guard is a flag, not a
	// verdict, and a correct rollover deserves the same second look as a
	// wrong one.
	expect(yearRolloverFlag('2027-01-01', '2026-12-15')).toMatch(/different calendar year/);
});

test('dayConfidence never raises confidence, and folds the guard reason onto the model\u2019s own', () => {
	const flagged = { ...day(), flagReason: 'a reason from the guard' };
	const clean = { ...day(), flagReason: null };

	expect(dayConfidence(clean, 0.9, undefined)).toEqual({ confidence: 0.9, confidenceReason: null });
	expect(dayConfidence(clean, 0.9, 'model doubt')).toEqual({
		confidence: 0.9,
		confidenceReason: 'model doubt'
	});
	expect(dayConfidence(flagged, 0.95, undefined)).toEqual({
		confidence: YEAR_ROLLOVER_CONFIDENCE_CAP,
		confidenceReason: 'a reason from the guard'
	});
	expect(dayConfidence(flagged, 0.1, 'model doubt')).toEqual({
		confidence: 0.1,
		confidenceReason: 'model doubt; a reason from the guard'
	});
});

test('a one-message conversation still anchors relative dates on that message\u2019s own date', () => {
	// #400: rewritten to describe a conversation, but a list of one has to
	// keep producing what the prompt produced before this change.
	const prompt = dayExtractionInstructions([
		{ documentId: 'doc-1', sentAt: '2026-02-02', from: 'leo@example.com', body: message }
	]);
	expect(prompt).toMatch(/conversation of 1 message,/);
	expect(prompt).toMatch(/message 0, sent 2026-02-02 by leo@example\.com/);
	expect(prompt).toMatch(/--- message N, DATE, FROM ---/);
	expect(prompt).toMatch(/"messageIndex":0/);
});

test('the prompt describes every message of a longer conversation, 0-based', () => {
	const prompt = dayExtractionInstructions([
		{ documentId: 'doc-1', sentAt: '2026-08-03', from: 'client@example.com', body: 'offer' },
		{ documentId: 'doc-2', sentAt: '2026-08-04', from: 'owner@example.com', body: 'confermo' },
		{ documentId: 'doc-3', sentAt: '2026-08-04', from: 'client@example.com', body: 'grazie' }
	]);
	expect(prompt).toMatch(/conversation of 3 messages,/);
	expect(prompt).toMatch(/message 0, sent 2026-08-03 by client@example\.com/);
	expect(prompt).toMatch(/message 1, sent 2026-08-04 by owner@example\.com/);
	expect(prompt).toMatch(/message 2, sent 2026-08-04 by client@example\.com/);
});

test('the prompt teaches a day mentioned twice is reported once, against the message that establishes it', () => {
	const prompt = dayExtractionInstructions([
		{ documentId: 'doc-1', sentAt: '2026-08-03', from: 'a@example.com', body: 'x' }
	]);
	expect(prompt).toMatch(/A day mentioned in more than one message is one day/);
	expect(prompt).toMatch(/Quoting is not a new statement/);
});

test('the prompt teaches that a passing mention names no allocation, and that a written acceptance raises confidence', () => {
	const prompt = dayExtractionInstructions([
		{ documentId: 'doc-1', sentAt: '2026-08-03', from: 'a@example.com', body: 'x' }
	]);
	expect(prompt).toMatch(/An allocation is a date or period, an activity, and an agreement/);
	expect(prompt).toMatch(/a domani per la kickoff call/);
	expect(prompt).toMatch(/raise your confidence rather than lowering it/);
});

test('the prompt keeps every rule that was already right', () => {
	const prompt = dayExtractionInstructions([
		{ documentId: 'doc-1', sentAt: '2026-08-03', from: 'a@example.com', body: 'x' }
	]);
	// Year-rollover caution, still there.
	expect(prompt).toMatch(/a date whose year you had to guess/);
	// "Next week" semantics, still there.
	expect(prompt).toMatch(/"Next week" means the week after the one containing that message/);
	// An excluded day is still not reported.
	expect(prompt).toMatch(/A day the conversation excludes/);
	// Never invent a day, still there.
	expect(prompt).toMatch(/Never invent a day the conversation does not mention/);
	// The documented no-days answer #397 made the parser accept.
	expect(prompt).toContain('{"proposedFields":{"days":[]},"excerpt":"","confidence":1}');
});

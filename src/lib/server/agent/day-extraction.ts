// #85: everything about reading days out of an approval message that does
// not need a model. The model's only job is to find the spans and say what
// they mean; deciding whether the answer is usable is this file's, and it
// is pure so it can be tested exhaustively without a network call.
//
// The split matters because a model will confidently return 31 February,
// a quantity the contract's rate card does not sell, or a date six months
// outside the contract's term. None of those are prompt problems.

/** One day as the model reports it, before anything has been checked. */
export interface ExtractedDay {
	readonly date: string;
	readonly quantity: number;
	readonly scope: string;
	readonly excerpt: string;
	readonly notes?: string;
}

/** The shortest excerpt that can still be read as evidence. A model asked
 * for "the shortest span" will hand back "3", which is verbatim and
 * useless: a reviewer seeing it next to a proposed day learns nothing
 * about whether the message really said so. */
const MINIMUM_EXCERPT_LENGTH = 12;

export interface DayExtractionContext {
	/** The contract's own term, so a day outside it is refused rather than proposed. */
	readonly startsOn: string;
	readonly endsOn: string | null;
	/**
	 * What the contract's rate cards actually sell, e.g. `[1, 0.5]`. A
	 * model that reports a third of a day on a contract with no such rate
	 * is not proposing something a human can accept: `createWorkUnit`
	 * would take it, and the invoice built from it later would have no
	 * price. Empty means the contract has no rate card yet, and then any
	 * positive quantity is allowed through for a human to judge.
	 */
	readonly allowedQuantities: readonly number[];
	/**
	 * The message itself. Every excerpt is checked against it, because a
	 * paraphrased excerpt is the one failure invariant 4 cannot tolerate:
	 * the whole point of keeping the source is that the span shown next to
	 * a proposed day is what the client actually wrote.
	 */
	readonly content: string;
	/**
	 * The message-level span the model gave for the approval as a whole.
	 * When a day's own excerpt is verbatim but too short to read as
	 * evidence — Claude answers `"3"` for the first of "le giornate del 3
	 * e 4 febbraio" often enough to matter — the day is kept and shown
	 * against this wider span instead of being thrown away. Widening is
	 * safe in a way that inventing is not: this is still the client's own
	 * words, just more of them.
	 */
	readonly fallbackExcerpt?: string;
}

export interface RejectedDay {
	readonly day: ExtractedDay;
	readonly reason: string;
}

export interface ValidatedDays {
	readonly accepted: readonly ExtractedDay[];
	readonly rejected: readonly RejectedDay[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instructions the model is given. Absolute dates only: resolving
 * "Thursday" against the message date is the one piece of reasoning a
 * model does better than a regex, and the one piece this file cannot
 * check afterwards, so it happens there and is verified by the corpus
 * rather than by a unit test.
 *
 * `messageDate` is interpolated rather than left to the model to infer,
 * because an email's own date is a fact the producer already holds and a
 * model asked to guess "today" will use its training cutoff.
 */
export function dayExtractionInstructions(messageDate: string): string {
	return [
		'You read one message and report the working days it approves, for a consultant who bills by the day.',
		`The message was sent on ${messageDate}. Resolve every relative date ("Thursday", "next week", "tomorrow") against that date.`,
		'',
		'Answer with JSON and nothing else, in exactly this shape:',
		'{"proposedFields":{"days":[{"date":"YYYY-MM-DD","quantity":1,"scope":"...","excerpt":"..."}]},"excerpt":"...","confidence":0.0}',
		'',
		'Rules:',
		'- One entry per day. A range covers every working day in it, Monday to Friday, one entry each.',
		'- quantity is the fraction of a day: 1 for a full day, 0.5 for a half day.',
		'- scope is what the day is for, in the message\u2019s own words, short.',
		'- Each day\u2019s excerpt is the shortest verbatim span from the message that justifies both its date and its quantity. Copy it exactly, do not paraphrase.',
		'- The top-level excerpt is the verbatim span covering the whole approval.',
		'- confidence is your own, between 0 and 1.',
		'- "Next week" means the week after the one containing the message date, even when the message was sent early in the week. "This week" means the one containing it.',
		'- A day the message excludes ("except Wednesday", "not Friday") is not reported at all.',
		'- If the message approves no days, answer {"proposedFields":{"days":[]},"excerpt":"","confidence":1}.',
		'- Never invent a day the message does not mention.'
	].join('\n');
}

/**
 * Reads the model's `proposedFields` into days, or throws naming what was
 * wrong. Never repairs: a model that answered the wrong shape has not
 * understood the task, and guessing on its behalf is how a wrong day
 * reaches a human looking plausible.
 */
export function parseExtractedDays(proposedFields: Record<string, unknown>): ExtractedDay[] {
	const { days } = proposedFields;
	if (!Array.isArray(days)) throw new Error("model response's proposedFields.days is not an array");

	return days.map((raw, index) => {
		if (typeof raw !== 'object' || raw === null) {
			throw new Error(`day ${index} is not an object`);
		}
		const { date, quantity, scope, excerpt, notes } = raw as Record<string, unknown>;
		if (typeof date !== 'string' || !ISO_DATE.test(date)) {
			throw new Error(`day ${index} has no YYYY-MM-DD date`);
		}
		if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
			throw new Error(`day ${index} has no numeric quantity`);
		}
		// An approval often says only "ok for Thursday". A scope invented to
		// satisfy a schema is worse than an empty one a human fills in, so
		// this accepts a missing scope and the review screen asks for it.
		if (scope !== undefined && scope !== null && typeof scope !== 'string') {
			throw new Error(`day ${index} has a non-string scope`);
		}
		if (typeof excerpt !== 'string' || excerpt.trim() === '') {
			throw new Error(`day ${index} has no excerpt`);
		}
		if (notes !== undefined && notes !== null && typeof notes !== 'string') {
			throw new Error(`day ${index} has a non-string notes`);
		}
		return {
			date,
			quantity,
			scope: typeof scope === 'string' ? scope.trim() : '',
			excerpt: excerpt.trim(),
			...(typeof notes === 'string' && notes.trim() !== '' ? { notes: notes.trim() } : {})
		};
	});
}

/**
 * Splits the model's days into the ones a human can be shown and the ones
 * that are wrong on their face, with the reason recorded rather than
 * dropped. A rejected day is not silently discarded: the corpus scores
 * them, and a producer logs them, because a model that keeps proposing
 * days outside the contract's term is a prompt problem worth seeing.
 */
export function validateDays(
	days: readonly ExtractedDay[],
	context: DayExtractionContext
): ValidatedDays {
	const accepted: ExtractedDay[] = [];
	const rejected: RejectedDay[] = [];
	const seen = new Set<string>();

	for (const raw of days) {
		const day = widenShortExcerpt(raw, context);
		const reason = rejectionReason(day, context, seen);
		if (reason) {
			rejected.push({ day, reason });
			continue;
		}
		seen.add(day.date);
		accepted.push(day);
	}
	return { accepted, rejected };
}

/** A day whose own excerpt is verbatim but too short falls back to the
 * message-level span, when that one is itself usable. Only length is
 * forgiven this way: a paraphrase is still refused, because the point of
 * the excerpt is that the client wrote it. */
function widenShortExcerpt(day: ExtractedDay, context: DayExtractionContext): ExtractedDay {
	if (day.excerpt.length >= MINIMUM_EXCERPT_LENGTH) return day;
	const fallback = context.fallbackExcerpt?.trim() ?? '';
	if (fallback.length < MINIMUM_EXCERPT_LENGTH) return day;
	if (!normalise(context.content).includes(normalise(fallback))) return day;
	return { ...day, excerpt: fallback };
}

function rejectionReason(
	day: ExtractedDay,
	context: DayExtractionContext,
	seen: ReadonlySet<string>
): string | null {
	// `2026-02-31` matches the shape and is not a date. Round-tripping
	// through Date is the cheapest way to find out, and the only one that
	// gets February right in a leap year.
	const parsed = new Date(`${day.date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day.date) {
		return `${day.date} is not a real date`;
	}
	if (seen.has(day.date)) return `${day.date} appears twice`;
	if (day.date < context.startsOn) return `${day.date} is before the contract starts`;
	if (context.endsOn !== null && day.date > context.endsOn) {
		return `${day.date} is after the contract ends`;
	}
	if (day.quantity <= 0) return `quantity ${day.quantity} is not positive`;
	if (day.excerpt.length < MINIMUM_EXCERPT_LENGTH) {
		return `excerpt ${JSON.stringify(day.excerpt)} is too short to be evidence`;
	}
	if (!normalise(context.content).includes(normalise(day.excerpt))) {
		return `excerpt ${JSON.stringify(day.excerpt)} is not verbatim in the message`;
	}
	if (context.allowedQuantities.length > 0 && !context.allowedQuantities.includes(day.quantity)) {
		return `quantity ${day.quantity} is not one this contract's rate cards sell`;
	}
	return null;
}

/** Whitespace is the one difference worth forgiving: a model reflowing a
 * wrapped line is still quoting. Anything else it changed is a paraphrase.
 */
function normalise(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

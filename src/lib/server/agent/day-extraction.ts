// #85: everything about reading days out of an approval message that does
// not need a model. The model's only job is to find the spans and say what
// they mean; deciding whether the answer is usable is this file's, and it
// is pure so it can be tested exhaustively without a network call.
//
// The split matters because a model will confidently return 31 February,
// a quantity the contract's rate card does not sell, or a date six months
// outside the contract's term. None of those are prompt problems.

import type { ConversationMessage } from '$lib/server/mail/conversation';

/** One day as the model reports it, before anything has been checked. */
export interface ExtractedDay {
	readonly date: string;
	readonly quantity: number;
	readonly scope: string;
	readonly excerpt: string;
	readonly notes?: string;
	/**
	 * Which message of the conversation this day's evidence rests on,
	 * 0-based into the list `dayExtractionInstructions` described (#400).
	 * The Polymarket allocation is the case that makes this necessary: the
	 * offer naming the date and the activity is message 0, the owner's
	 * "confermo" is message 1, and a proposal has to point at the offer,
	 * not always at whichever message is newest.
	 */
	readonly messageIndex: number;
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
	 * When the message was sent — the anchor every relative date in it
	 * resolves against (the model's job, in the prompt), and what
	 * `yearRolloverFlag` below measures a date's distance from (this
	 * file's job, in code).
	 */
	readonly messageDate: string;
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
	/**
	 * Dates this contract already has a *recorded* day on. Optional because
	 * most callers extract a conversation for the first time and there is
	 * nothing to collide with; supplied by `writeDayProposals`, which reads
	 * `recordedDaysByDate` off the ledger.
	 *
	 * A re-read of a conversation is now normal (#403): a reply arriving in
	 * an exchange already extracted re-reads the whole thing, because that
	 * is the only way the new day is understood beside the offer it
	 * answers. Everything the earlier pass got right therefore comes back,
	 * and `seen` below only dedupes within one extraction. The ledger is the
	 * only thing that knows across them.
	 *
	 * A day with a *pending* proposal is deliberately not in here (Task 5):
	 * suppressing it kept a stale reading on screen, so it is now let
	 * through and `writeDayProposals` rewrites the existing proposal in
	 * place instead of suppressing or duplicating it.
	 */
	readonly alreadyDecided?: ReadonlySet<string>;
}

/**
 * Why a day was rejected, as a stable value a caller can branch on —
 * `day-producer.ts`'s "already recorded" conflict check is the reason this
 * exists, and the day-import module's own discriminated
 * `DayImportRejectReason` (`import/day-import.ts`) is the shape this
 * follows. `'decided_while_rereading'` is the one code `rejectionReason`
 * below never returns: `day-producer.ts` adds it itself, for the day whose
 * revise lost a race with a human decision mid-run.
 */
export type DayRejectionCode =
	| 'invalid_date'
	| 'duplicate_in_reading'
	| 'already_recorded'
	| 'before_contract_start'
	| 'after_contract_end'
	| 'non_positive_quantity'
	| 'excerpt_too_short'
	| 'excerpt_not_verbatim'
	| 'quantity_not_sold'
	| 'decided_while_rereading';

export interface RejectedDay {
	readonly day: ExtractedDay;
	/** For programmatic dispatch. Never parse `reason` to answer the same
	 * question — that couples a caller's branching to this file's wording. */
	readonly code: DayRejectionCode;
	/** The rejection explained in prose, for a human or a log. Display
	 * only. */
	readonly reason: string;
}

export interface AcceptedDay extends ExtractedDay {
	/**
	 * Set when `yearRolloverFlag` catches this date — never cleared by
	 * anything downstream, including a high model confidence. `null` means
	 * the code-level guard found nothing to say, not that it was skipped.
	 */
	readonly flagReason: string | null;
}

export interface ValidatedDays {
	readonly accepted: readonly AcceptedDay[];
	readonly rejected: readonly RejectedDay[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far before the message date, in days, an extracted date can sit
 * before `yearRolloverFlag` treats it as suspicious rather than a plain
 * late confirmation. Loose on purpose: this is a flag, not a fact, and a
 * false positive costs a human a glance, not a wrong ledger entry.
 */
export const YEAR_ROLLOVER_LOOKBACK_DAYS = 60;

/**
 * Below this, a proposal is not something to hand a human as settled —
 * the line #244 draws between "the model believes this" and "a human
 * should look before this becomes a day". The review screen (#243) is
 * the consumer of the number; this file only ever produces it.
 */
export const CONFIDENCE_NEEDS_REVIEW_THRESHOLD = 0.5;

/**
 * The ceiling a day's confidence is capped at once `yearRolloverFlag`
 * catches it — always below `CONFIDENCE_NEEDS_REVIEW_THRESHOLD`, so a
 * flagged day can never read as settled merely because the model itself
 * was sure.
 */
export const YEAR_ROLLOVER_CONFIDENCE_CAP = 0.2;

/**
 * The trial's second dangerous failure (#244): "confermo dal 29 dicembre
 * al 2 gennaio", sent 15 December, answered 2025-12-29 instead of
 * 2026-12-29 — the right days, the wrong year, silently. Telling the
 * model to be careful is not a guarantee, so this is code, not a prompt
 * rule: a date in a different calendar year from the message, or more
 * than `YEAR_ROLLOVER_LOOKBACK_DAYS` days before it, is flagged. Never
 * rejected — a rollover into next year is usually correct, the same way
 * a late confirmation of last month usually is — just never silently
 * accepted as settled either.
 */
export function yearRolloverFlag(date: string, messageDate: string): string | null {
	if (date.slice(0, 4) !== messageDate.slice(0, 4)) {
		return `${date} falls in a different calendar year than the message (${messageDate})`;
	}
	const daysBefore =
		(Date.parse(`${messageDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
	if (daysBefore > YEAR_ROLLOVER_LOOKBACK_DAYS) {
		return `${date} is more than ${YEAR_ROLLOVER_LOOKBACK_DAYS} days before the message date (${messageDate})`;
	}
	return null;
}

/**
 * The confidence and reason a day's own proposal actually carries,
 * folding the model's own answer together with the year-rollover guard:
 * the guard can only make a day more cautious, never override it back to
 * settled. Shared by the producer (`day-producer.ts`) and the corpus
 * scorer (`scripts/score-day-corpus.ts`), so what the corpus reports as
 * "flagged" is exactly what a proposal would actually carry.
 */
export function dayConfidence(
	day: AcceptedDay,
	candidateConfidence: number,
	candidateReason: string | null | undefined
): { confidence: number; confidenceReason: string | null } {
	if (day.flagReason === null) {
		return { confidence: candidateConfidence, confidenceReason: candidateReason ?? null };
	}
	return {
		confidence: Math.min(candidateConfidence, YEAR_ROLLOVER_CONFIDENCE_CAP),
		confidenceReason: candidateReason ? `${candidateReason}; ${day.flagReason}` : day.flagReason
	};
}

/**
 * The instructions the model is given. Absolute dates only: resolving
 * "Thursday" against the message it appears in is the one piece of
 * reasoning a model does better than a regex, and the one piece this file
 * cannot check afterwards, so it happens there and is verified by the
 * corpus rather than by a unit test.
 *
 * `messages` is the conversation `content` renders, oldest first, each
 * with its own `sentAt` interpolated here rather than left to the model
 * to infer — an email's own date is a fact the producer already holds and
 * a model asked to guess "today" will use its training cutoff. A
 * one-message conversation is just a list of one: nothing below changes
 * shape when `messages.length === 1`.
 *
 * #400: the first real ingestion read three conversations one message at
 * a time and got it wrong in both directions on the same afternoon — "a
 * domani per la kickoff call" read as an approval because nothing told
 * the model a reply naming no date and no activity confirms nothing, and
 * a written offer answered by a written "confermo" scored no higher than
 * a guess because nothing told the model that a second party's agreement
 * is what turns an offer into an approval. A reply quoting its parent
 * also re-stated the parent's own sentence, which is where the duplicate
 * came from. All three are taught below rather than left for the model to
 * infer on its own.
 */
export function dayExtractionInstructions(messages: readonly ConversationMessage[]): string {
	const roster = messages
		.map(
			(m, i) =>
				`  message ${i}, sent ${m.sentAt}${m.from ? ` by ${m.from}` : ''}${
					m.mine ? ' (the consultant, whose ledger this is)' : ''
				}`
		)
		.join('\n');
	const plural = messages.length === 1 ? '' : 's';
	return [
		`You read a conversation of ${messages.length} message${plural}, oldest first, and report the working days it approves, for a consultant who bills by the day.`,
		'The content you were given renders the whole conversation as one text. Each message starts with a line in exactly this form: "--- message N, DATE, FROM ---", where N is its 0-based position below:',
		roster,
		'Resolve every relative date ("Thursday", "next week", "tomorrow") a message contains against that message\'s own DATE above, never a different message\'s.',
		'',
		'Treat the conversation as one thing to understand, not one message judged at a time:',
		'- A day mentioned in more than one message is one day. Report it once, against the message whose own wording actually establishes it — normally the first message to name it — not once per message that repeats or quotes it.',
		'- Quoting is not a new statement. A reply that echoes an earlier message underneath a signature, or a later message that quotes everything above it ("Grazie!" followed by the whole thread so far), is history reappearing, not a second approval. If wording you already used for a day appears again later in the conversation, that is why — do not report the day again.',
		'- An allocation is a date or period, an activity, and an agreement. All three have to be there. A message that only names a date, or only an activity, with nothing that agrees to it, approves nothing: "a domani per la kickoff call" and the reply "A domani per il kickoff!" name no allocation and confirm nothing, however specific they read.',
		'- The strongest evidence this product can get is an offer that names a date (or period) and an activity, met by the other side\u2019s own agreement in a later message ("confermo", "tutto ok", "ok"). When you see that shape, raise your confidence rather than lowering it — a written offer plus a written acceptance is exactly the mechanism a billing-by-confirmation contract is built on. If the date itself is the only loose part (a week rather than a single day, a range rather than a date), say so in confidenceReason instead of lowering confidence over an allocation that was, in every other respect, agreed to in writing.',
		'- Some messages are the consultant\u2019s own, marked above. They are here because an approval often needs them - a client who writes "confermo l\u2019allocazione, rispondi con un ok" is approving the day, and the consultant\u2019s "tutto ok, confermo" is the ok that was asked for - so read them as part of the agreement. But the consultant cannot approve their own work: a day named only in the consultant\u2019s own messages, with nothing from the client agreeing to it anywhere in the conversation, approves nothing. Report it only when the client\u2019s own words are part of the evidence.',
		'- An assignment that is confirmed but open-ended is worth exactly one day, at low confidence, not silence. A message confirming work "effective from your next working day following your onboarding on Thursday, August 13th" names no count and no end, but it does confirm that work starts, and the first working day after the named date is a real, checkable guess. Propose that one day, put the reason it is uncertain in confidenceReason, and stop there: a reviewer can correct one low-confidence day, and cannot correct a day nobody proposed. Do not extrapolate a second, a week, or a month from it.',
		'',
		'Answer with JSON and nothing else, in exactly this shape:',
		'{"proposedFields":{"days":[{"date":"YYYY-MM-DD","quantity":1,"scope":"...","excerpt":"...","messageIndex":0}]},"excerpt":"...","confidence":0.0,"confidenceReason":"..."}',
		'',
		'Rules:',
		'- One entry per day. A range covers every working day in it, Monday to Friday, one entry each.',
		'- messageIndex is the 0-based position, from the list above, of the message whose own wording is this day\u2019s evidence — the message that names the date and the activity, even when a later message is the one that agrees to it.',
		'- quantity is the fraction of a day: 1 for a full day, 0.5 for a half day.',
		'- scope is what the day is for, in the message\u2019s own words, short.',
		"- Each day's excerpt is the shortest verbatim span, from the message messageIndex points at, that justifies both its date and its quantity. Copy it exactly, do not paraphrase.",
		'- The top-level excerpt is the verbatim span covering the whole approval; when the offer and the agreement are in different messages, quote enough of both to show the exchange.',
		'- confidence is your own, between 0 and 1. Lower it \u2014 well below 0.5 \u2014 whenever you are not sure the days above are what actually happened: a date whose year you had to guess (a bare day-and-month far from the message date, a range that could cross into a different year), a relative reference ("next week", "gioved\u00ec") with nothing in the message to anchor it against that message\u2019s own date, or wording that reads as non-committal rather than a firm approval ("vediamo come va", "we\u2019ll see", "ti aggiorno io") even if a day is mentioned nearby.',
		'- confidenceReason is a short, specific reason for a lowered confidence \u2014 what exactly made you unsure, not a restatement of the number. Omit it, or leave it empty, when confidence is high.',
		'- "Next week" means the week after the one containing that message\u2019s own date, even when the message was sent early in the week. "This week" means the one containing it.',
		'- A day the conversation excludes ("except Wednesday", "not Friday") is not reported at all.',
		'- If the conversation approves no days, answer {"proposedFields":{"days":[]},"excerpt":"","confidence":1}.',
		'- Never invent a day the conversation does not mention.'
	].join('\n');
}

/**
 * Reads the model's `proposedFields` into days, or throws naming what was
 * wrong. Never repairs: a model that answered the wrong shape has not
 * understood the task, and guessing on its behalf is how a wrong day
 * reaches a human looking plausible.
 *
 * `messageCount` is the length of the conversation `dayExtractionInstructions`
 * described — the valid range for each day's `messageIndex`. A model that
 * names a message outside it has not understood the conversation it was
 * given, the same failure this function already refuses to paper over for
 * every other field (#400).
 */
export function parseExtractedDays(
	proposedFields: Record<string, unknown>,
	messageCount: number
): ExtractedDay[] {
	const { days } = proposedFields;
	if (!Array.isArray(days)) throw new Error("model response's proposedFields.days is not an array");

	return days.map((raw, index) => {
		if (typeof raw !== 'object' || raw === null) {
			throw new Error(`day ${index} is not an object`);
		}
		const { date, quantity, scope, excerpt, notes, messageIndex } = raw as Record<string, unknown>;
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
		if (
			typeof messageIndex !== 'number' ||
			!Number.isInteger(messageIndex) ||
			messageIndex < 0 ||
			messageIndex >= messageCount
		) {
			throw new Error(`day ${index} has no valid messageIndex (0..${messageCount - 1})`);
		}
		return {
			date,
			quantity,
			scope: typeof scope === 'string' ? scope.trim() : '',
			excerpt: excerpt.trim(),
			messageIndex,
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
	const accepted: AcceptedDay[] = [];
	const rejected: RejectedDay[] = [];
	const seen = new Set<string>();

	for (const raw of days) {
		const day = widenShortExcerpt(raw, context);
		const rejection = rejectionReason(day, context, seen);
		if (rejection) {
			rejected.push({ day, code: rejection.code, reason: rejection.reason });
			continue;
		}
		seen.add(day.date);
		accepted.push({ ...day, flagReason: yearRolloverFlag(day.date, context.messageDate) });
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
): { code: DayRejectionCode; reason: string } | null {
	// `2026-02-31` matches the shape and is not a date. Round-tripping
	// through Date is the cheapest way to find out, and the only one that
	// gets February right in a leap year.
	const parsed = new Date(`${day.date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day.date) {
		return { code: 'invalid_date', reason: `${day.date} is not a real date` };
	}
	if (seen.has(day.date)) {
		return { code: 'duplicate_in_reading', reason: `${day.date} appears twice` };
	}
	// Already on the ledger, from an earlier read of this same conversation
	// (#403). Reported rather than dropped: the run's own outcome names it,
	// so a re-read that found nothing new says so instead of looking idle.
	if (context.alreadyDecided?.has(day.date)) {
		return {
			code: 'already_recorded',
			reason: `${day.date} is already recorded on this contract`
		};
	}
	if (day.date < context.startsOn) {
		return {
			code: 'before_contract_start',
			reason: `${day.date} is before the contract starts`
		};
	}
	if (context.endsOn !== null && day.date > context.endsOn) {
		return { code: 'after_contract_end', reason: `${day.date} is after the contract ends` };
	}
	if (day.quantity <= 0) {
		return {
			code: 'non_positive_quantity',
			reason: `quantity ${day.quantity} is not positive`
		};
	}
	if (day.excerpt.length < MINIMUM_EXCERPT_LENGTH) {
		return {
			code: 'excerpt_too_short',
			reason: `excerpt ${JSON.stringify(day.excerpt)} is too short to be evidence`
		};
	}
	if (!normalise(context.content).includes(normalise(day.excerpt))) {
		return {
			code: 'excerpt_not_verbatim',
			reason: `excerpt ${JSON.stringify(day.excerpt)} is not verbatim in the message`
		};
	}
	if (context.allowedQuantities.length > 0 && !context.allowedQuantities.includes(day.quantity)) {
		return {
			code: 'quantity_not_sold',
			reason: `quantity ${day.quantity} is not one this contract's rate cards sell`
		};
	}
	return null;
}

/** Whitespace is the one difference worth forgiving: a model reflowing a
 * wrapped line is still quoting. Anything else it changed is a paraphrase.
 */
function normalise(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

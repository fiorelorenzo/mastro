// Turning archived messages back into the exchange they came from (#400).
//
// Extraction used to read one message at a time, which on the first real
// mailbox produced three proposals for one day. Two reasons, and both are
// properties of email rather than of the prompt:
//
//   * A reply quotes its parent, so the same sentence is offered to the
//     model again and again and looks new every time.
//   * An approval can span two messages. The Polymarket half-day is the
//     case that settles it: the client offers the allocation in one
//     message and the owner accepts in the next, so neither message on its
//     own contains an approval, and no amount of prompt work can find one
//     in a fragment that does not hold it.
//
// So the unit handed to a model is the conversation. This module does the
// two jobs that requires: grouping messages into conversations, and
// removing the quoted history that made a reply look like a new statement.

/**
 * Strips quoted history and signatures from a plain-text mail body.
 *
 * Deliberately conservative, and deliberately not a parser. Everything it
 * removes is something whose presence in the *sent* text is a convention
 * every mail client follows, and nothing it removes can carry a statement
 * the sender is making for the first time:
 *
 *   * `> ` quoted lines, at any depth.
 *   * The attribution line that introduces them, in the shapes Gmail and
 *     Apple Mail produce in English and Italian. Kept narrow on purpose: a
 *     line that merely mentions a date is not an attribution, and a false
 *     positive here deletes real content.
 *   * Everything after a `-- ` signature delimiter (RFC 3676 §4.3).
 *
 * What it does not attempt: Outlook's `From:`-block quoting, HTML parts,
 * or `On ... wrote:` split across two lines. Those degrade to quoted text
 * surviving, which the prompt is told to expect and ignore, rather than to
 * content being eaten - which is the failure worth avoiding, because a
 * deleted sentence is a day nobody proposes and nobody knows was there.
 */
export function stripQuotedHistory(body: string): string {
	const lines = body.split(/\r?\n/);
	const kept: string[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];

		// RFC 3676 signature delimiter: exactly "-- ", and everything after
		// it belongs to the signature.
		if (line.trimEnd() === '--' || line === '-- ') break;

		if (/^\s*>/.test(line)) {
			// A quoted block. The attribution line that introduced it is the
			// line above, which is already in `kept`, so drop it there rather
			// than trying to look ahead from it.
			while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
			if (kept.length > 0 && isAttributionLine(kept[kept.length - 1])) {
				kept.pop();
				// Gmail wraps a long attribution across two lines, so the
				// colon-bearing half that just matched can be the tail of one
				// that began above it. Exactly one more line, and only when it
				// opens like an attribution and does not end like a sentence -
				// tight on purpose, because the cost of over-reaching here is a
				// deleted confirmation rather than a stray line the prompt is
				// already told to ignore.
				const previous = kept[kept.length - 1]?.trim();
				if (previous && /^(Il giorno|On)\b/.test(previous) && !/[.!?]$/.test(previous)) {
					kept.pop();
				}
			}
			continue;
		}

		kept.push(line);
	}

	return kept.join('\n').trim();
}

/**
 * Whether a line is the "X wrote:" introduction to a quoted block.
 *
 * Anchored on the shapes actually observed in this mailbox rather than on a
 * general grammar: Gmail's English and Italian forms, and Apple Mail's
 * Italian one. Each requires both a date-ish prefix and a trailing colon,
 * because that pair is what makes it an attribution rather than a sentence.
 */
function isAttributionLine(line: string): boolean {
	const text = line.trim();
	if (!text.endsWith(':') && !text.endsWith('scritto:') && !text.endsWith('wrote:')) return false;
	return (
		/\bwrote:\s*$/i.test(text) ||
		/\bha scritto:\s*$/i.test(text) ||
		/^On\b.*\bat\b.*:\s*$/i.test(text) ||
		/^Il giorno\b.*:\s*$/i.test(text)
	);
}

/** One message of a conversation, in the order it was sent. */
// The shape itself lives in `$lib/server/runner/types` - the wire contract
// the runner reads - and is re-exported here because this module is where
// callers building a conversation already look (#409).
import type { ConversationMessage } from '$lib/server/runner/types';

export type { ConversationMessage };

/**
 * Renders a conversation as the single `content` string the runner passes
 * through untouched.
 *
 * A visible separator carrying the index, the date and the sender, because
 * the model is asked to say which message a day came from and cannot do
 * that against an undifferentiated wall of text.
 *
 * The index is 0-based, matching exactly the `messageIndex` the model must
 * answer with. It read better 1-based and that was the wrong trade: a
 * header numbered from one beside a JSON field numbered from zero is an
 * off-by-one handed to the model for free, and the model is the one party
 * here that cannot be code-reviewed.
 */
export function renderConversation(messages: readonly ConversationMessage[]): string {
	return messages
		.map(
			(message, index) =>
				// The sender is named, and named as mine when it is mine (#409):
				// the model is asked whose agreement it is looking at, and an
				// address alone does not answer that for a reader who has never
				// seen this mailbox before.
				`--- message ${index}, ${message.sentAt}, ${message.from}${
					message.mine ? ' (the consultant, whose ledger this is)' : ''
				} ---\n${message.body}`
		)
		.join('\n\n');
}

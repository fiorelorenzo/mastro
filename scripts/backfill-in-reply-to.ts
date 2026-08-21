// A one-off: fills `inbound_thread.in_reply_to` for messages archived
// before that column existed (#407).
//
// Extraction reads a conversation, not a message (#400), and it walks
// `In-Reply-To` to find one. Every message archived before v0.16.0 has no
// parent recorded — measured on the live instance, 501 rows of 502 — so a
// re-read of that mail groups nothing and each message goes to the model
// alone, which is the exact shape #400 replaced. The Polymarket half-day
// is the case that shows it: the offer and its acceptance are two
// messages, and neither approves a day by itself.
//
// The source is the archived original, which is kept precisely so a
// derived field can be rebuilt from it (invariant 4). Nothing here parses
// mail a second way: `parseMessage` is the poller's own header parser, and
// the value is stored in the shape the poller stores it in — angle
// brackets included — because grouping compares it to `message_id` and two
// spellings of one address would silently never match.
//
// Idempotent, and safe to run twice: it only reads rows whose
// `in_reply_to` is still null, and a message that genuinely has no parent
// (the first of its thread) simply stays null. That is also why this is
// not a migration: filling it needs the blob store and an RFC822 parser,
// neither of which SQL has.
//
// Plain `node` with type stripping, same as `scripts/migrate.ts`, so the
// runtime image can run it without dev dependencies.

import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { readBlob } from '../src/lib/server/documents/blob-store.ts';
import { parseMessage } from '../src/lib/server/mail/headers.ts';
import { log } from '../src/lib/server/log/logger.ts';

function databaseUrl(): string {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	// `--env-file-if-exists` fills gaps but never overrides, and a
	// supervisor-launched process inherits an environment that may hold
	// another checkout's URL (AGENTS.md). Reading the file explicitly here
	// would be worse, not better: it would override the environment the
	// operator deliberately set. So this only reads `.env` when nothing is
	// set at all, which is the local case.
	try {
		const parsed = parseEnv(readFileSync('.env', 'utf8')) as Record<string, string>;
		if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
	} catch {
		// No .env, which is normal in the image.
	}
	throw new Error('DATABASE_URL is not set');
}

const storageRoot = process.env.DOCUMENT_STORAGE_ROOT ?? 'data/documents';
const sql = postgres(databaseUrl(), { max: 1 });

try {
	const rows = await sql<{ id: string; hash: string }[]>`
		SELECT t.id, d.hash
		FROM inbound_thread t
		JOIN document d ON d.id = t.document_id
		WHERE t.in_reply_to IS NULL AND t.document_id IS NOT NULL
	`;

	let filled = 0;
	let noParent = 0;
	let unreadable = 0;

	for (const row of rows) {
		let bytes: Buffer;
		try {
			bytes = await readBlob(storageRoot, row.hash);
		} catch {
			// A database restored without its documents directory, or a blob
			// that never landed (#313). One message that cannot be read must
			// not stop the rest: the field stays null, which is the state it
			// is already in.
			unreadable += 1;
			continue;
		}
		const inReplyTo = parseMessage(bytes).headers.get('in-reply-to')?.trim() ?? null;
		if (!inReplyTo) {
			noParent += 1;
			continue;
		}
		await sql`UPDATE inbound_thread SET in_reply_to = ${inReplyTo} WHERE id = ${row.id}`;
		filled += 1;
	}

	log.info('in_reply_to backfilled', {
		context: { considered: rows.length, filled, noParent, unreadable }
	});
} finally {
	await sql.end();
}

// Backfills `inbound_thread.sender_address` for every row written before
// that column existed (#394) — 407 of them on the live instance, 405 of
// them from mail. Attribution now happens only by matching the sender
// against `client_contact.email` (#380, #394), and the re-attribution pass
// (#388) can only reconsider a row it can read an address off of, so
// without this backfill the change does not reach the data that motivated
// it: a contact recorded as `leonardo@visumlabs.com` sitting next to 407
// archived messages actually sent from `leo@visumlabs.com`, with nothing
// anywhere saying so.
//
// Deliberately not an IMAP re-fetch. The poller's UID cursor has already
// moved past these messages, and a 30-day lookback window will never offer
// them again — the only place the sender still exists is the archived copy
// invariant 4 promises every one of them has. `readDocumentBytes` reads
// those bytes back off disk, `parseMessage` (`src/lib/server/mail/
// headers.ts`) unfolds the header block the same way every other reader of
// an archived message does — headers.ts's own comment is why this script
// does not grow a second folding parser next to it — and `normaliseAddress`
// (`src/lib/server/mail/attribute.ts`) turns the raw `From` value into the
// lower-cased address `client_contact.email` is compared against, the same
// function `mail/poll.ts` and `reattributeKnownSenders` already use.
//
// Idempotent and safe to run twice: `listInboundThreadsMissingSenderAddress`
// (`src/lib/server/repositories/inbound-thread.ts`) only ever selects rows
// where `sender_address is null`, so a row this run already wrote is gone
// from the next run's candidate set, and a row it could not recover an
// address for is simply retried, at no cost beyond the retry itself.
//
// What this script does not do: call `reattributeKnownSenders`. Writing an
// address and deciding what to do with it are two different jobs — the
// second one already runs on every poll (`pollMailboxTarget` in
// `mail/poll.ts`), so a newly-recovered address is picked up there, not
// here. A script that also mutated attribution would be running that job a
// second time for no reason beyond convenience.
//
// Runs under plain `node` (type stripping), like `scripts/migrate.ts` and
// `scripts/seed-demo.ts`: the deployed image can run it once, after the
// migration that added the column, with no dev dependency and no build
// step. `seed-lib-resolve.ts` is the same loader hook `seed-demo.ts` uses
// to load `$lib`-aliased, extensionless-relative-import modules under
// plain Node's ESM resolver — see that file's header for the full
// explanation of why a static top-level `$lib` import would not work here.
import { register } from 'node:module';
import { log } from '../src/lib/server/log/logger.ts';

register('./seed-lib-resolve.ts', import.meta.url);

// Dynamic, not static: `register()` above only takes effect for
// resolutions that happen after it runs, so a static top-level import of
// any `$lib`-aliased module here — which is every module this script
// needs — would already have failed to resolve under plain Node's loader
// before this file's own body started executing (same constraint
// `seed-demo.ts` documents in its header).

const { client: pool } = await import('$lib/server/db');
const { listInboundThreadsMissingSenderAddress, setInboundThreadSenderAddress } =
	await import('../src/lib/server/repositories/inbound-thread.ts');
const { readDocumentBytes } = await import('../src/lib/server/repositories/document.ts');
const { parseMessage } = await import('../src/lib/server/mail/headers.ts');
const { normaliseAddress } = await import('../src/lib/server/mail/attribute.ts');

try {
	const rows = await listInboundThreadsMissingSenderAddress();

	let updated = 0;
	let noFromHeader = 0;
	let noDocument = 0;

	for (const row of rows) {
		if (!row.documentId || !row.documentHash) {
			// Nothing was archived (a skipped, oversized message) or the
			// document row this one pointed at no longer resolves. Either
			// way there are no bytes to read the sender out of.
			noDocument += 1;
			continue;
		}

		let bytes: Buffer;
		try {
			bytes = await readDocumentBytes({ hash: row.documentHash });
		} catch (error) {
			// `readBlob` throws when the file for this hash is missing —
			// the same "nothing to read" outcome as no document at all, so
			// it is counted the same way. Anything other than a missing
			// file is a real problem with the store this run should stop
			// and surface, not paper over as one more unrecoverable row.
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			noDocument += 1;
			continue;
		}

		const { headers } = parseMessage(bytes);
		const address = normaliseAddress(headers.get('from') ?? null);
		if (!address) {
			noFromHeader += 1;
			continue;
		}

		await setInboundThreadSenderAddress(row.id, address);
		updated += 1;
	}

	log.info('sender address backfill complete', {
		candidates: rows.length,
		updated,
		noFromHeader,
		noDocument
	});
} finally {
	await pool.end();
}

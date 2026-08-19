// #343's other proof, alongside `mail/poll-lock.test.ts` (the concurrency
// guard's own unit tests): the `pollNow` action never depends on
// `IMAP_POLL_CRON_TOKEN`. Two independent checks, on purpose — a
// structural one (the source never imports `cron-token.ts` or calls
// `authorizeCronRequest`; the file's own doc comment names both in prose,
// explaining why it does not use them, which is why the check below is
// against import/call syntax rather than a bare word match) and a
// behavioural one (a real call, against this environment's genuinely
// unconfigured mailbox — see `.env`, no `IMAP_*` key at all — resolves
// with the friendly "not configured" outcome rather than the bare 401
// `authorizeCronRequest` throws for a missing token). Neither on its own
// would rule out a future edit reintroducing a token dependency in a
// branch this environment never takes; together they do.
import { readFileSync } from 'node:fs';
import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { imapConfiguredInEnv } from '$lib/server/mail/config';
import { actions } from './+page.server';

const SOURCE_PATH = new URL('./+page.server.ts', import.meta.url);

function actionEvent() {
	// `pollNow` reads nothing off the event — no form fields, no
	// `locals.user` — session authorisation already happened in
	// `hooks.server.ts` before any action runs, and the poll itself needs
	// no "who triggered it" beyond that (`pollMailboxesOnce` records one
	// account-wide run row, not a per-user one). An empty object stands in
	// for the full `RequestEvent` SvelteKit would normally construct.
	return {} as unknown as Parameters<typeof actions.pollNow>[0];
}

test("the action never imports the cron-token module or calls its authorisation helper (this file's own doc comment is prose explaining why, not code that does it, so the check below is against imports and call syntax specifically, not a bare word match)", () => {
	const source = readFileSync(SOURCE_PATH, 'utf-8');
	expect(source).not.toMatch(/from ['"].*cron-token['"]/);
	expect(source).not.toMatch(/authorizeCronRequest\(/);
	expect(source).not.toMatch(/env\.IMAP_POLL_CRON_TOKEN/);
});

/*
 * Deliberately asserts on what is invariant rather than on this machine's
 * `.env`. The first version of this test asserted the not-configured
 * outcome specifically, because the checkout it was written in had no
 * `IMAP_*` key — and it failed the moment real credentials were put in
 * `.env` to exercise the button in a browser, which is the same trap
 * AGENTS.md describes for a suite that only passes on an empty database.
 *
 * What must hold either way: the action reaches a decision of its own and
 * never the cron token's bare 401. A configured mailbox polls, an
 * unconfigured one refuses politely, and both are its own decision.
 */
test('the action reaches its own decision whether or not a mailbox is configured, and never the cron 401', async () => {
	expect(process.env.IMAP_POLL_CRON_TOKEN).toBeFalsy();

	let result: unknown;
	try {
		result = await actions.pollNow(actionEvent());
	} catch (err) {
		// `authorizeCronRequest` is the only thing in this codebase that
		// throws a bare `error(401)` for a missing token — if the action
		// depended on it, this is what would be thrown here instead of a
		// friendly `fail()` return.
		if (isHttpError(err) && err.status === 401) {
			expect.fail("pollNow threw the cron token's own 401 — it must never depend on that token");
		}
		throw err;
	}

	// `imapConfiguredInEnv()`, not `process.env`: the app reads configuration
	// through `$env/dynamic/private`, which Vite populates from `.env` and
	// which is not the same object as `process.env` under vitest. Asking the
	// app what it thinks is configured is also the only reading that cannot
	// disagree with what the action just did.
	if (imapConfiguredInEnv()) {
		// Configured: a real poll, whose own result says how it went.
		expect(result).toMatchObject({ pollNow: { ok: true } });
	} else {
		expect(result).toMatchObject({
			status: 400,
			data: { pollNow: { ok: false, reason: 'not_configured' } }
		});
	}
});

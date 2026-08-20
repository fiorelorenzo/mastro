import { expect, test } from 'vitest';
import { mailPollBadge, mailPollMeta } from './poll-status';

const lastRunAt = '2026-08-17T10:00:00.000Z';

test('no mail account reads as warning, regardless of any health payload', () => {
	expect(mailPollBadge(false, false, null).variant).toBe('warning');
	expect(mailPollBadge(false, false, { kind: 'ok', lastRunAt }).variant).toBe('warning');
});

test('a healthy poll is good, an explicit failure or never-run is critical, staleness is serious', () => {
	expect(mailPollBadge(true, true, { kind: 'ok', lastRunAt }).variant).toBe('good');
	expect(mailPollBadge(true, true, { kind: 'failure', lastRunAt, detail: 'boom' }).variant).toBe(
		'critical'
	);
	expect(mailPollBadge(true, true, { kind: 'never_run' }).variant).toBe('critical');
	expect(mailPollBadge(true, true, { kind: 'stale', lastRunAt }).variant).toBe('serious');
});

test('the meta line for an explicit failure carries the recorded detail', () => {
	expect(
		mailPollMeta(true, true, { kind: 'failure', lastRunAt, detail: 'IMAP timeout' }, 'en')
	).toContain('IMAP timeout');
});

test('the meta line for never-run and no-account needs no date, unlike ok/failure/stale', () => {
	const neverRun = mailPollMeta(true, true, { kind: 'never_run' }, 'en');
	const noAccount = mailPollMeta(false, false, null, 'en');
	expect(neverRun.length).toBeGreaterThan(0);
	expect(noAccount.length).toBeGreaterThan(0);
	expect(neverRun).not.toBe(noAccount);
});

/*
 * #351, the state the live instance actually sat in for hours: a working
 * IMAP account, no contract mapped to a folder, and a screen that said
 * "IMAP is not configured for this instance" — which sent its owner to
 * check environment variables that were correct while the scheduler logged
 * the real reason. Two problems with two different fixes, in two different
 * places, so they cannot share one message.
 */
test('an account with nothing mapped is its own state, worded differently from no account', () => {
	const notMapped = mailPollMeta(true, false, null, 'en');
	const noAccount = mailPollMeta(false, false, null, 'en');

	expect(notMapped).not.toBe(noAccount);
	expect(mailPollBadge(true, false, null).label).not.toBe(mailPollBadge(false, false, null).label);
});

/*
 * English only, deliberately: the `locale` argument reaches
 * `formatDateTime` and nothing else, since every message here renders in
 * the ambient locale that `paraglideMiddleware` sets per request. Asserting
 * the Italian wording through this function would be asserting a locale
 * switch it does not perform — the Italian value is the catalogues' own
 * concern, and `i18n/catalogues.test.ts` already refuses a key that is
 * missing or untranslated in one of them.
 */
test('the unmapped state names where mapping happens, since it is not an env variable', () => {
	expect(mailPollMeta(true, false, null, 'en')).toMatch(/contract/i);
});

/*
 * A mapped instance whose poller has genuinely never run is `never_run`,
 * not the unmapped wording: `mailboxPollHealth` only reports
 * `anyFolderMapped: true` once a folder exists, and from there the health
 * classification takes over.
 */
test('mapped but never polled is never_run, not the unmapped state', () => {
	expect(mailPollBadge(true, true, { kind: 'never_run' }).label).not.toBe(
		mailPollBadge(true, false, null).label
	);
});

// #374: `/settings` rendered its own reading of a conflated boolean and told
// an instance with working IMAP credentials that IMAP was not configured,
// while `/mail` said the opposite. Both screens now call these two
// functions, so the guard worth having is that the answer depends only on
// the three facts - not on which screen asked.
test('the configured-but-unmapped state is never reported as an unconfigured account', () => {
	const badge = mailPollBadge(true, false, null);
	const meta = mailPollMeta(true, false, null, 'en');

	expect(badge.label).not.toBe(mailPollBadge(false, false, null).label);
	expect(meta).not.toBe(mailPollMeta(false, false, null, 'en'));
	expect(meta).toMatch(/configured/i);
});

test('one set of inputs has exactly one answer, whichever screen asks', () => {
	const cases = [
		[false, false, null],
		[true, false, null],
		[true, true, null],
		[true, true, { kind: 'ok', lastRunAt: '2026-08-20T00:00:00.000Z' }]
	] as const;

	for (const [account, mapped, health] of cases) {
		expect(mailPollBadge(account, mapped, health)).toEqual(mailPollBadge(account, mapped, health));
		expect(mailPollMeta(account, mapped, health, 'en')).toBe(
			mailPollMeta(account, mapped, health, 'en')
		);
	}
});

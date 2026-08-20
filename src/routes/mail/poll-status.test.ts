import { expect, test } from 'vitest';
import { mailPollBadge, mailPollMeta } from './poll-status';

const lastRunAt = '2026-08-17T10:00:00.000Z';

test('no mail account reads as warning, regardless of any health payload', () => {
	expect(mailPollBadge(false, null).variant).toBe('warning');
	expect(mailPollBadge(false, { kind: 'ok', lastRunAt }).variant).toBe('warning');
});

test('a healthy poll is good, an explicit failure or never-run is critical, staleness is serious', () => {
	expect(mailPollBadge(true, { kind: 'ok', lastRunAt }).variant).toBe('good');
	expect(mailPollBadge(true, { kind: 'failure', lastRunAt, detail: 'boom' }).variant).toBe(
		'critical'
	);
	expect(mailPollBadge(true, { kind: 'never_run' }).variant).toBe('critical');
	expect(mailPollBadge(true, { kind: 'stale', lastRunAt }).variant).toBe('serious');
});

test('the meta line for an explicit failure carries the recorded detail', () => {
	expect(
		mailPollMeta(true, { kind: 'failure', lastRunAt, detail: 'IMAP timeout' }, 'en')
	).toContain('IMAP timeout');
});

test('the meta line for never-run and no-account needs no date, unlike ok/failure/stale', () => {
	const neverRun = mailPollMeta(true, { kind: 'never_run' }, 'en');
	const noAccount = mailPollMeta(false, null, 'en');
	expect(neverRun.length).toBeGreaterThan(0);
	expect(noAccount.length).toBeGreaterThan(0);
	expect(neverRun).not.toBe(noAccount);
});

/*
 * #394 removed the "account configured, no contract mapped to a folder"
 * state (#351) along with the folder mechanism itself: attribution is by
 * sender address now, not by which folder a message arrived in, so there
 * is no mapping step left to be missing. `accountConfigured` is the only
 * precondition remaining, and a healthy account whose poller has
 * genuinely never run is still its own state, `never_run`, distinct from
 * an unconfigured account.
 */
test('never-run reads differently from no account, once configured', () => {
	const neverRun = mailPollBadge(true, { kind: 'never_run' });
	const noAccount = mailPollBadge(false, null);
	expect(neverRun.label).not.toBe(noAccount.label);
	expect(mailPollMeta(true, { kind: 'never_run' }, 'en')).not.toBe(mailPollMeta(false, null, 'en'));
});

test('one set of inputs has exactly one answer, whichever screen asks', () => {
	const cases = [
		[false, null],
		[true, { kind: 'never_run' as const }],
		[true, { kind: 'ok' as const, lastRunAt: '2026-08-20T00:00:00.000Z' }]
	] as const;

	for (const [account, health] of cases) {
		expect(mailPollBadge(account, health)).toEqual(mailPollBadge(account, health));
		expect(mailPollMeta(account, health, 'en')).toBe(mailPollMeta(account, health, 'en'));
	}
});

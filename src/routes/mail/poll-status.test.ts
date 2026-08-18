import { expect, test } from 'vitest';
import { mailPollBadge, mailPollMeta } from './poll-status';

const lastRunAt = '2026-08-17T10:00:00.000Z';

test('not configured reads as warning, regardless of any health payload', () => {
	expect(mailPollBadge(false, null).variant).toBe('warning');
	expect(mailPollBadge(false, { kind: 'ok', lastRunAt }).variant).toBe('warning');
});

test('configured but no health payload reads the same as not configured', () => {
	expect(mailPollBadge(true, null).variant).toBe('warning');
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

test('the meta line for never-run and not-configured needs no date, unlike ok/failure/stale', () => {
	const neverRun = mailPollMeta(true, { kind: 'never_run' }, 'en');
	const notConfigured = mailPollMeta(false, null, 'en');
	expect(neverRun.length).toBeGreaterThan(0);
	expect(notConfigured.length).toBeGreaterThan(0);
	expect(neverRun).not.toBe(notConfigured);
});

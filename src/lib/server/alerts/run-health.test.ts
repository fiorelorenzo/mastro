import { expect, test } from 'vitest';
import { detectMailboxPollFailure } from './detectors';
import { classifyRun } from './run-health';

const asOf = new Date('2026-08-07T12:00:00.000Z');

test('a healthy run with no alerts classifies as ok, carrying the latest row', () => {
	const latest = { status: 'success' as const, detail: null, createdAt: asOf };
	expect(classifyRun(latest, [])).toEqual({
		kind: 'ok',
		lastRunAt: asOf.toISOString(),
		detail: null
	});
});

test('detectMailboxPollFailure never_run reduces to never_run, dropping the null run row', () => {
	const alerts = detectMailboxPollFailure(true, null, asOf);
	expect(classifyRun(null, alerts)).toEqual({ kind: 'never_run' });
});

test('detectMailboxPollFailure failure reduces to failure, keeping when and the recorded detail', () => {
	const latest = {
		status: 'failure' as const,
		detail: 'connect ECONNREFUSED 127.0.0.1:993',
		createdAt: new Date('2026-08-07T11:55:00.000Z')
	};
	const alerts = detectMailboxPollFailure(true, latest, asOf);
	expect(classifyRun(latest, alerts)).toEqual({
		kind: 'failure',
		lastRunAt: latest.createdAt.toISOString(),
		detail: latest.detail
	});
});

test('detectMailboxPollFailure stale reduces to stale, at the exact same 3-hour boundary the detector fires at', () => {
	const latest = {
		status: 'success' as const,
		detail: null,
		createdAt: new Date('2026-08-07T08:30:00.000Z') // 3.5h before asOf
	};
	const alerts = detectMailboxPollFailure(true, latest, asOf);
	expect(classifyRun(latest, alerts)).toEqual({
		kind: 'stale',
		lastRunAt: latest.createdAt.toISOString()
	});
});

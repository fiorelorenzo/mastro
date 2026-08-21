import { expect, test } from 'vitest';
import {
	finishPollProgress,
	readPollProgress,
	reportPollPhase,
	startPollProgress
} from './poll-progress';

test('a phase reported after the log closed is ignored', () => {
	// The poller and the lock both report, and the lock closes the log in a
	// `finally`. A stray late report - a phase written by something that
	// outlived its own poll - must not make a finished log read as running,
	// because the client stops asking only when `running` goes false.
	startPollProgress();
	reportPollPhase('connecting');
	finishPollProgress('done', 4);

	reportPollPhase('listing', 9, 9);

	const progress = readPollProgress();
	expect(progress.running).toBe(false);
	expect(progress.steps.map((step) => step.phase)).toEqual(['connecting', 'done']);
});

test('each poll gets its own sequence, so a client can tell one from the next', () => {
	// What a client compares to know it is looking at a new poll rather than
	// the same one one phase further. Two polls that happen to reach the same
	// phase with the same counts are otherwise indistinguishable.
	startPollProgress();
	reportPollPhase('connecting');
	const first = readPollProgress();
	finishPollProgress('done');

	startPollProgress();
	const second = readPollProgress();

	expect(second.sequence).toBeGreaterThan(first.sequence);
	expect(second.steps).toEqual([]);
	finishPollProgress('done');
});

test('the log is bounded, so a long-lived process cannot grow it without limit', () => {
	// This lives in module state for the life of the process. The phase list
	// is short by construction today, but a caller reporting per message
	// rather than per phase is a one-line change away, and the cost of being
	// wrong here is memory that is never reclaimed.
	startPollProgress();
	for (let index = 0; index < 500; index += 1) reportPollPhase('archived', index);
	finishPollProgress('done');

	const progress = readPollProgress();
	expect(progress.steps.length).toBeLessThanOrEqual(64);
	// And the ones it kept are the first ones, not a window that slid: the
	// beginning of a poll is what explains the rest of it.
	expect(progress.steps[0]).toMatchObject({ phase: 'archived', count: 0 });
});

test('a failure is a terminal phase, not a log that stops talking', () => {
	startPollProgress();
	reportPollPhase('connecting');
	finishPollProgress('failed');

	const progress = readPollProgress();
	expect(progress.running).toBe(false);
	expect(progress.steps.at(-1)?.phase).toBe('failed');
});

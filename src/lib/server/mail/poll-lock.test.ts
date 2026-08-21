import { expect, test } from 'vitest';
import { MailPollAlreadyInFlightError, runExclusiveMailPoll } from './poll-lock';
import { readPollProgress, reportPollPhase } from './poll-progress';

test('a second call while the first is still pending is rejected before it ever runs its own function', async () => {
	const { promise: first, resolve: resolveFirst } = Promise.withResolvers<string>();
	const firstCall = runExclusiveMailPoll(() => first);

	let secondCallStarted = false;
	const second = runExclusiveMailPoll(async () => {
		secondCallStarted = true;
		return 'unreachable';
	});

	await expect(second).rejects.toBeInstanceOf(MailPollAlreadyInFlightError);
	// The rejection above is what proves this, but assert on the flag too:
	// a lock that let `fn` start and only failed afterwards would still
	// reject the promise, silently opening the second IMAP connection set
	// this bound exists to prevent.
	expect(secondCallStarted).toBe(false);

	resolveFirst('done');
	expect(await firstCall).toBe('done');
});

test('the lock releases once the in-flight call settles, success or failure, so one bad poll never wedges every later one', async () => {
	await expect(
		runExclusiveMailPoll(async () => {
			throw new Error('a poll can genuinely fail');
		})
	).rejects.toThrow('a poll can genuinely fail');

	// A prior call throwing must still clear the flag — otherwise every
	// poll after the first failure would be permanently refused.
	await expect(runExclusiveMailPoll(async () => 'ok')).resolves.toBe('ok');
});

test('two calls that do not overlap in time both run, in order', async () => {
	const order: string[] = [];
	await runExclusiveMailPoll(async () => {
		order.push('a');
	});
	await runExclusiveMailPoll(async () => {
		order.push('b');
	});
	expect(order).toEqual(['a', 'b']);
});

test('the losing press does not wipe the log of the poll it lost to (#405)', async () => {
	// The lock starts the progress log, so a second press has to be refused
	// *before* that happens: a reader watching phases scroll past would
	// otherwise see them vanish because somebody pressed the button in
	// another tab, and the poll they were watching is still running.
	const { promise: first, resolve: resolveFirst } = Promise.withResolvers<string>();
	const firstCall = runExclusiveMailPoll(async () => {
		reportPollPhase('connecting');
		reportPollPhase('listing', 3, 40);
		return first;
	});
	// Let the phases above be reported before the second press arrives.
	await Promise.resolve();
	await Promise.resolve();

	await expect(runExclusiveMailPoll(async () => 'unreachable')).rejects.toBeInstanceOf(
		MailPollAlreadyInFlightError
	);

	const during = readPollProgress();
	expect(during.running).toBe(true);
	expect(during.steps.map((step) => step.phase)).toEqual(['connecting', 'listing']);

	resolveFirst('done');
	await firstCall;
});

test('a poll whose function throws leaves a closed log, not one that reads as running (#405)', async () => {
	// `pollMailboxesOnce` reports its own terminal phase because it is the
	// only thing that knows a connection failure is a returned status rather
	// than a thrown error. This is the other case: something threw outright,
	// and the client polling for progress must be able to stop.
	await expect(
		runExclusiveMailPoll(async () => {
			reportPollPhase('connecting');
			throw new Error('imap exploded');
		})
	).rejects.toThrow('imap exploded');

	const after = readPollProgress();
	expect(after.running).toBe(false);
	expect(after.steps.at(-1)?.phase).toBe('failed');
});

import { expect, test } from 'vitest';
import { MailPollAlreadyInFlightError, runExclusiveMailPoll } from './poll-lock';

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

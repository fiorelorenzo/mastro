import { isHttpError } from '@sveltejs/kit';
import { expect, test, vi } from 'vitest';
import { authorizeCronRequest } from './cron-token';

function requestWithBearer(token: string | null): Request {
	const headers = token === null ? undefined : { authorization: `Bearer ${token}` };
	return new Request('http://localhost/api/mail/poll', { method: 'POST', headers });
}

/** Both the status and the body must be identical across every rejection
 * path — that sameness is the property #304 exists to guarantee, so each
 * failing case below is asserted against this one shape rather than
 * against a bespoke expectation of its own. */
function expectBareUnauthorized(err: unknown): void {
	if (!isHttpError(err, 401)) throw new Error('expected authorizeCronRequest to throw a 401');
	expect(err.body).toEqual({ message: 'Error: 401' });
}

test('the correct token passes', () => {
	expect(() =>
		authorizeCronRequest(
			requestWithBearer('correct-horse-battery-staple'),
			'correct-horse-battery-staple',
			'ALERT_CRON_TOKEN'
		)
	).not.toThrow();
});

test('a wrong token of the same length fails', () => {
	const expected = 'correct-horse-battery-staple';
	const wrongSameLength = 'wrong-donkey-battery-staple!';
	expect(wrongSameLength.length).toBe(expected.length);

	try {
		authorizeCronRequest(requestWithBearer(wrongSameLength), expected, 'ALERT_CRON_TOKEN');
		expect.fail('expected authorizeCronRequest to throw');
	} catch (err) {
		expectBareUnauthorized(err);
	}
});

test('a wrong token of a different length fails with the byte-identical status and body as a same-length wrong token', () => {
	const expected = 'correct-horse-battery-staple';

	let sameLengthError: unknown;
	try {
		authorizeCronRequest(
			requestWithBearer('wrong-donkey-battery-staple!'),
			expected,
			'ALERT_CRON_TOKEN'
		);
	} catch (err) {
		sameLengthError = err;
	}

	let differentLengthError: unknown;
	try {
		authorizeCronRequest(requestWithBearer('short'), expected, 'ALERT_CRON_TOKEN');
	} catch (err) {
		differentLengthError = err;
	}

	expectBareUnauthorized(sameLengthError);
	expectBareUnauthorized(differentLengthError);
	expect(differentLengthError).toEqual(sameLengthError);
});

test('an unset variable yields the same response as a wrong token, and logs server-side instead of naming the variable to the caller', () => {
	const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
	try {
		let unsetError: unknown;
		try {
			authorizeCronRequest(requestWithBearer('anything'), undefined, 'ALERT_CRON_TOKEN');
		} catch (err) {
			unsetError = err;
		}

		let wrongTokenError: unknown;
		try {
			authorizeCronRequest(requestWithBearer('anything'), 'the-real-token', 'ALERT_CRON_TOKEN');
		} catch (err) {
			wrongTokenError = err;
		}

		expectBareUnauthorized(unsetError);
		expect(unsetError).toEqual(wrongTokenError);

		// The variable name reaches the server log, never the response body.
		expect(consoleLog).toHaveBeenCalledTimes(1);
		const [line] = consoleLog.mock.calls[0] as [string];
		const logged = JSON.parse(line);
		expect(logged.level).toBe('error');
		expect(logged.msg).toBe('authorizeCronRequest: cron token is not set on this instance');
		expect(logged.context).toEqual({ varName: 'ALERT_CRON_TOKEN' });
	} finally {
		consoleLog.mockRestore();
	}
});

test('a missing Authorization header fails the same way as a present but wrong one', () => {
	try {
		authorizeCronRequest(requestWithBearer(null), 'the-real-token', 'ALERT_CRON_TOKEN');
		expect.fail('expected authorizeCronRequest to throw');
	} catch (err) {
		expectBareUnauthorized(err);
	}
});

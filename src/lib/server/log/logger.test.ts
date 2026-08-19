import { expect, test, vi } from 'vitest';
import { buildLogRecord, log } from './logger';

test('builds one record with a timestamp, the level and the message', () => {
	const now = new Date('2026-08-19T04:07:00.000Z');
	expect(buildLogRecord('info', 'scheduler: mail poll ok', undefined, now)).toEqual({
		time: '2026-08-19T04:07:00.000Z',
		level: 'info',
		msg: 'scheduler: mail poll ok'
	});
});

test('carries a context object, so a line stays joinable to the run it belongs to', () => {
	const record = buildLogRecord('info', 'runner: processing', { jobId: 'a-1' });
	expect(record.context).toEqual({ jobId: 'a-1' });
});

test('omits an empty context entirely rather than writing `{}`', () => {
	expect(buildLogRecord('warn', 'no folders configured', {}).context).toBeUndefined();
});

test('redacts a DATABASE_URL-shaped context value wherever it arrives', () => {
	const record = buildLogRecord('error', 'connect failed', {
		anyKeyAtAll: 'postgres://mastro:hunter2@localhost:5436/mastro'
	});
	const value = (record.context as Record<string, unknown>).anyKeyAtAll as string;
	expect(value).not.toContain('hunter2');
	expect(value).toContain('postgres://');
	expect(value).toContain('localhost:5436/mastro');
});

test('redacts a DATABASE_URL-shaped value embedded in a longer message', () => {
	const record = buildLogRecord('error', 'ignored', {
		detail: 'connect ECONNREFUSED postgres://mastro:hunter2@localhost:5436/mastro'
	});
	const value = (record.context as Record<string, unknown>).detail as string;
	expect(value).not.toContain('hunter2');
	expect(value).toContain('ECONNREFUSED');
});

test('redacts a bearer token, whatever key it arrives under', () => {
	const record = buildLogRecord('error', 'unauthorised', {
		somethingUnexpected: 'Bearer sK7g3ha0F1pQz9mN2xLw8vT4rY6bC5dJ'
	});
	expect((record.context as Record<string, unknown>).somethingUnexpected).toBe('Bearer [redacted]');
});

test('redacts an opaque API-key-shaped token with no separators', () => {
	const record = buildLogRecord('warn', 'unexpected token', {
		key: 'sK7g3ha0F1pQz9mN2xLw8vT4rY6bC5dJ9pQ'
	});
	expect((record.context as Record<string, unknown>).key).toBe('[redacted]');
});

test('redacts nested and array context values, not just the top level', () => {
	const record = buildLogRecord('error', 'nested', {
		request: {
			headers: { authorization: 'Bearer sK7g3ha0F1pQz9mN2xLw8vT4rY6bC5dJ' },
			urls: ['postgres://mastro:hunter2@localhost:5436/mastro']
		}
	});
	const request = (record.context as Record<string, unknown>).request as {
		headers: { authorization: string };
		urls: string[];
	};
	expect(request.headers.authorization).toBe('Bearer [redacted]');
	expect(request.urls[0]).not.toContain('hunter2');
});

test('unpacks a caught Error into name, message and stack, redacting the message', () => {
	const record = buildLogRecord('error', 'health: database unreachable', {
		error: new Error('connect postgres://mastro:hunter2@localhost:5436/mastro failed')
	});
	const error = (record.context as Record<string, unknown>).error as {
		name: string;
		message: string;
	};
	expect(error.name).toBe('Error');
	expect(error.message).not.toContain('hunter2');
});

test('never redacts a UUID — the run/job id every call site is asked to carry', () => {
	const jobId = crypto.randomUUID();
	const record = buildLogRecord('info', 'runner: processing', { jobId, filename: `${jobId}.json` });
	expect((record.context as Record<string, unknown>).jobId).toBe(jobId);
	expect((record.context as Record<string, unknown>).filename).toBe(`${jobId}.json`);
});

test('leaves an ordinary short word or sentence alone', () => {
	const record = buildLogRecord('info', 'scheduler: mail poll ok', {
		body: '{"status":"skipped","reason":"no folders configured"}'
	});
	expect((record.context as Record<string, unknown>).body).toBe(
		'{"status":"skipped","reason":"no folders configured"}'
	);
});

test('log.* emits exactly one JSON line per call, to stdout', () => {
	const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
	try {
		log.info('scheduler: starting', { baseUrl: 'http://web:3000' });
		expect(spy).toHaveBeenCalledTimes(1);
		const [line] = spy.mock.calls[0] as [string];
		expect(line).not.toContain('\n');
		const parsed = JSON.parse(line);
		expect(parsed.level).toBe('info');
		expect(parsed.msg).toBe('scheduler: starting');
		expect(parsed.context).toEqual({ baseUrl: 'http://web:3000' });
		expect(() => new Date(parsed.time).toISOString()).not.toThrow();
	} finally {
		spy.mockRestore();
	}
});

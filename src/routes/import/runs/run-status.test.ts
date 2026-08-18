import { describe, expect, test } from 'vitest';
import type { RetryBlockReason } from '$lib/extraction/retry-eligibility';
import {
	coalesceEvents,
	isTerminalRunStatus,
	retryBlockReasonMessage,
	runDurationSeconds,
	runEventKindBadge,
	runStatusBadge,
	targetTypeLabel,
	type RunEventKindValue
} from './run-status';

test('applied and failed are the only terminal statuses', () => {
	expect(isTerminalRunStatus('queued')).toBe(false);
	expect(isTerminalRunStatus('running')).toBe(false);
	expect(isTerminalRunStatus('extracted')).toBe(false);
	expect(isTerminalRunStatus('applied')).toBe(true);
	expect(isTerminalRunStatus('failed')).toBe(true);
});

test('extracted reads as warning, the gap the design doc names — not info like running, not critical like failed', () => {
	expect(runStatusBadge('running').variant).toBe('info');
	expect(runStatusBadge('extracted').variant).toBe('warning');
	expect(runStatusBadge('failed').variant).toBe('critical');
});

test('failed is the only run status badged critical', () => {
	for (const status of ['queued', 'running', 'extracted', 'applied'] as const) {
		expect(runStatusBadge(status).variant).not.toBe('critical');
	}
});

test('an error event is the only transcript kind badged critical', () => {
	for (const kind of ['message', 'thought', 'tool_call', 'plan', 'stop'] as const) {
		expect(runEventKindBadge(kind).variant).not.toBe('critical');
	}
	expect(runEventKindBadge('error').variant).toBe('critical');
});

test('a known target type reads as prose; an unknown one falls back to the raw value', () => {
	expect(targetTypeLabel('contract')).not.toBe('contract');
	expect(targetTypeLabel('some_future_target')).toBe('some_future_target');
});

test('a terminal run measures enqueued-to-finished, ignoring how much later "now" is', () => {
	const run = {
		enqueuedAt: new Date('2026-08-15T09:57:00Z'),
		finishedAt: new Date('2026-08-15T09:57:30Z')
	};
	expect(runDurationSeconds(run, new Date('2026-08-15T10:30:00Z'))).toBe(30);
});

test('a still-moving run measures enqueued-to-now, since it has no finishedAt yet', () => {
	const run = { enqueuedAt: new Date('2026-08-15T09:57:00Z'), finishedAt: null };
	expect(runDurationSeconds(run, new Date('2026-08-15T09:57:45Z'))).toBe(45);
});

test('duration never reads negative, even given a now earlier than enqueuedAt', () => {
	const run = { enqueuedAt: new Date('2026-08-15T09:57:00Z'), finishedAt: null };
	expect(runDurationSeconds(run, new Date('2026-08-15T09:56:00Z'))).toBe(0);
});

describe('coalesceEvents', () => {
	const ev = (seq: number, kind: RunEventKindValue, payload: string) => ({
		seq,
		at: `2026-08-15T17:55:0${seq}.000Z`,
		kind,
		payload
	});

	// The real shape the first contract extraction produced: one JSON
	// answer shredded into chunks by the model's own streaming.
	test('joins consecutive chunks of one kind into the reply they are', () => {
		const blocks = coalesceEvents([
			ev(0, 'message', '```json\n{"'),
			ev(1, 'message', 'propos'),
			ev(2, 'message', 'edFields'),
			ev(3, 'message', '":{}}')
		]);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].payload).toBe('```json\n{"proposedFields":{}}');
		expect(blocks[0].parts).toBe(4);
	});

	// A tool call between two sentences happened between them, and a
	// transcript that hid that would misreport the order.
	test('a different kind in the middle breaks the block', () => {
		const blocks = coalesceEvents([
			ev(0, 'message', 'reading '),
			ev(1, 'tool_call', '{"name":"read"}'),
			ev(2, 'message', 'done')
		]);

		expect(blocks.map((b) => b.kind)).toEqual(['message', 'tool_call', 'message']);
		expect(blocks.map((b) => b.payload)).toEqual(['reading ', '{"name":"read"}', 'done']);
	});

	test('a block is stamped with the moment it began, not the moment it ended', () => {
		const blocks = coalesceEvents([ev(0, 'thought', 'one'), ev(1, 'thought', 'two')]);

		expect(blocks[0].seq).toBe(0);
		expect(blocks[0].at).toBe('2026-08-15T17:55:00.000Z');
	});

	test('no events, no blocks', () => {
		expect(coalesceEvents([])).toEqual([]);
	});
});

test('every retry block reason gets its own explicit sentence, not a fallthrough default', () => {
	const reasons: readonly RetryBlockReason[] = [
		'not_failed',
		'kind_unknown',
		'kind_not_retryable',
		'attempts_exhausted',
		'already_has_proposals',
		'source_missing'
	];
	const messages = reasons.map(retryBlockReasonMessage);
	expect(messages.every((message) => typeof message === 'string' && message.length > 0)).toBe(true);
	expect(new Set(messages).size).toBe(reasons.length);
});

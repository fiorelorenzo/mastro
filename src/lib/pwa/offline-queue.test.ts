import { expect, test } from 'vitest';
import {
	classifyReplay,
	extractRejectionMessage,
	queueSeverity,
	type QueuedDay
} from './offline-queue';

test('a redirect result classifies as synced', () => {
	expect(classifyReplay({ type: 'redirect', status: 303 })).toBe('synced');
});

test('a success result classifies as synced', () => {
	expect(classifyReplay({ type: 'success', status: 200 })).toBe('synced');
});

test('an error with no status — fetch itself threw — classifies as offline', () => {
	expect(classifyReplay({ type: 'error' })).toBe('offline');
});

test('a failure result classifies as rejected', () => {
	expect(classifyReplay({ type: 'failure', status: 400 })).toBe('rejected');
});

test('an error carrying an HTTP status (an unexpected 500) classifies as rejected, not offline', () => {
	expect(classifyReplay({ type: 'error', status: 500 })).toBe('rejected');
});

test('extractRejectionMessage joins every field error from a failure result', () => {
	const message = extractRejectionMessage({
		type: 'failure',
		status: 400,
		data: {
			errors: {
				date: 'A day is already recorded for this contract on this date.',
				contractId: 'Choose a valid contract.'
			}
		}
	});
	expect(message).toBe(
		'A day is already recorded for this contract on this date. Choose a valid contract.'
	);
});

test('extractRejectionMessage returns null for a non-failure result', () => {
	expect(extractRejectionMessage({ type: 'error', status: 500 })).toBeNull();
});

test('extractRejectionMessage returns null when a failure carries no structured errors', () => {
	expect(extractRejectionMessage({ type: 'failure', status: 400 })).toBeNull();
	expect(extractRejectionMessage({ type: 'failure', status: 400, data: {} })).toBeNull();
	expect(
		extractRejectionMessage({ type: 'failure', status: 400, data: { errors: null } })
	).toBeNull();
});

function entry(status: QueuedDay['status']): QueuedDay {
	return { id: status, queuedAt: '2026-08-14T00:00:00.000Z', fields: {}, status };
}

test('queueSeverity is warning for a queue with only pending/syncing entries', () => {
	expect(queueSeverity([entry('pending'), entry('syncing')])).toBe('warning');
});

test('queueSeverity escalates to critical the moment any entry has failed', () => {
	expect(queueSeverity([entry('pending'), entry('failed')])).toBe('critical');
});

test('queueSeverity is warning for an empty queue', () => {
	expect(queueSeverity([])).toBe('warning');
});

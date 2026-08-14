import { expect, test } from 'vitest';
import {
	TOAST_DEFAULT_DURATION_MS,
	TOAST_MIN_DURATION_MS,
	dismissToast,
	pushToast,
	resolveToastDuration,
	toastPoliteness,
	toastRole,
	type ToastRecord
} from './toast';

function record(id: string, tone: ToastRecord['tone'] = 'neutral'): ToastRecord {
	return { id, tone, message: `message ${id}` };
}

test('danger is the only tone that interrupts (role=alert, assertive); neutral/success are ambient', () => {
	expect(toastRole('neutral')).toBe('status');
	expect(toastRole('success')).toBe('status');
	expect(toastRole('danger')).toBe('alert');
	expect(toastPoliteness('neutral')).toBe('polite');
	expect(toastPoliteness('success')).toBe('polite');
	expect(toastPoliteness('danger')).toBe('assertive');
});

test('pushToast appends under the stack limit', () => {
	const stack = pushToast([record('a'), record('b')], record('c'), 4);
	expect(stack.map((t) => t.id)).toEqual(['a', 'b', 'c']);
});

test('pushToast evicts the oldest once the stack exceeds its limit', () => {
	const stack = pushToast([record('a'), record('b'), record('c')], record('d'), 3);
	expect(stack.map((t) => t.id)).toEqual(['b', 'c', 'd']);
});

test('dismissToast removes exactly the matching toast', () => {
	const stack = dismissToast([record('a'), record('b'), record('c')], 'b');
	expect(stack.map((t) => t.id)).toEqual(['a', 'c']);
});

test('dismissToast is a no-op when the id is already gone', () => {
	const existing = [record('a')];
	expect(dismissToast(existing, 'gone').map((t) => t.id)).toEqual(['a']);
});

test('an unspecified duration resolves to the default', () => {
	expect(resolveToastDuration(undefined)).toBe(TOAST_DEFAULT_DURATION_MS);
});

test('an explicit null opts out of auto-dismiss entirely', () => {
	expect(resolveToastDuration(null)).toBeNull();
});

test('an explicit duration above the floor is honoured verbatim', () => {
	expect(resolveToastDuration(9000)).toBe(9000);
});

test('an explicit duration below the floor is raised to the floor', () => {
	expect(resolveToastDuration(200)).toBe(TOAST_MIN_DURATION_MS);
});

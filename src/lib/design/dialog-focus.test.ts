import { expect, test } from 'vitest';
import { isDismissKey, nextTrappedIndex, tabDirection } from './dialog-focus';

test('Tab with no modifier moves forward, Shift+Tab moves backward', () => {
	expect(tabDirection('Tab', false)).toBe(1);
	expect(tabDirection('Tab', true)).toBe(-1);
});

test('every other key is ignored by the trap', () => {
	expect(tabDirection('Escape', false)).toBe(0);
	expect(tabDirection('Enter', false)).toBe(0);
	expect(tabDirection('a', false)).toBe(0);
});

test('Tab from the last focusable element wraps to the first', () => {
	expect(nextTrappedIndex(3, 2, 1)).toBe(0);
});

test('Shift+Tab from the first focusable element wraps to the last', () => {
	expect(nextTrappedIndex(3, 0, -1)).toBe(2);
});

test('Tab and Shift+Tab walk the middle of the list normally', () => {
	expect(nextTrappedIndex(3, 0, 1)).toBe(1);
	expect(nextTrappedIndex(3, 1, 1)).toBe(2);
	expect(nextTrappedIndex(3, 2, -1)).toBe(1);
});

test('no current focus (-1, e.g. focus landed on the backdrop) starts from the first element', () => {
	expect(nextTrappedIndex(3, -1, 1)).toBe(1);
});

test('an empty container has nothing to focus', () => {
	expect(nextTrappedIndex(0, 0, 1)).toBe(-1);
});

test('a single focusable element traps on itself both directions', () => {
	expect(nextTrappedIndex(1, 0, 1)).toBe(0);
	expect(nextTrappedIndex(1, 0, -1)).toBe(0);
});

test('Escape is the dismiss key and nothing else is', () => {
	expect(isDismissKey('Escape')).toBe(true);
	expect(isDismissKey('Enter')).toBe(false);
	expect(isDismissKey('Tab')).toBe(false);
});

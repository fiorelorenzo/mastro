import { describe, expect, test } from 'vitest';
import { keyToDirection, nextEnabledIndex, type SegmentedOption } from './segmented-control';

describe('keyToDirection', () => {
	test.each([
		['ArrowRight', 1],
		['ArrowDown', 1],
		['ArrowLeft', -1],
		['ArrowUp', -1],
		['Enter', 0],
		['Tab', 0],
		[' ', 0]
	] as const)('%s -> %s', (key, expected) => {
		expect(keyToDirection(key)).toBe(expected);
	});
});

describe('nextEnabledIndex', () => {
	const chartTable: SegmentedOption[] = [{ value: 'chart' }, { value: 'table' }];

	test('moves forward and wraps past the last option', () => {
		expect(nextEnabledIndex(chartTable, 0, 1)).toBe(1);
		expect(nextEnabledIndex(chartTable, 1, 1)).toBe(0);
	});

	test('moves backward and wraps past the first option', () => {
		expect(nextEnabledIndex(chartTable, 0, -1)).toBe(1);
		expect(nextEnabledIndex(chartTable, 1, -1)).toBe(0);
	});

	test('skips a disabled option in either direction', () => {
		const withDisabled: SegmentedOption[] = [
			{ value: 'a' },
			{ value: 'b', disabled: true },
			{ value: 'c' }
		];
		expect(nextEnabledIndex(withDisabled, 0, 1)).toBe(2);
		expect(nextEnabledIndex(withDisabled, 2, -1)).toBe(0);
	});

	test('stays on the current option when every option is disabled', () => {
		const allDisabled: SegmentedOption[] = [
			{ value: 'a', disabled: true },
			{ value: 'b', disabled: true }
		];
		expect(nextEnabledIndex(allDisabled, 0, 1)).toBe(0);
		expect(nextEnabledIndex(allDisabled, 1, -1)).toBe(1);
	});

	test('an empty option list is a no-op', () => {
		expect(nextEnabledIndex([], 0, 1)).toBe(0);
	});

	test('a single enabled option is its own neighbour in both directions', () => {
		const one: SegmentedOption[] = [{ value: 'only' }];
		expect(nextEnabledIndex(one, 0, 1)).toBe(0);
		expect(nextEnabledIndex(one, 0, -1)).toBe(0);
	});
});

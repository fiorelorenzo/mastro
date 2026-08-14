import { expect, test } from 'vitest';
import { skeletonLineWidths } from './skeleton';

test('zero or negative lines draw nothing', () => {
	expect(skeletonLineWidths(0)).toEqual([]);
	expect(skeletonLineWidths(-1)).toEqual([]);
});

test('a single line stays full width — it has no "last line" distinct from itself', () => {
	expect(skeletonLineWidths(1)).toEqual([100]);
});

test('every line but the last is full width; the last is shortened', () => {
	expect(skeletonLineWidths(3)).toEqual([100, 100, 60]);
});

test('two lines: the first full, the second (and last) shortened', () => {
	expect(skeletonLineWidths(2)).toEqual([100, 60]);
});

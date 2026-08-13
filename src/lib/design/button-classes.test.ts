import { expect, test } from 'vitest';
import {
	buttonAriaBusy,
	buttonClasses,
	isButtonBlocked,
	type ButtonSize,
	type ButtonVariant
} from './button-classes';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'tertiary', 'danger'];
const SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

test.each(VARIANTS.flatMap((variant) => SIZES.map((size) => [variant, size] as const)))(
	'variant %s at size %s maps to btn btn--%s btn--%s',
	(variant, size) => {
		expect(buttonClasses(variant, size)).toBe(`btn btn--${variant} btn--${size}`);
	}
);

test('loading forces the blocked state even when disabled was never set', () => {
	expect(isButtonBlocked(false, true)).toBe(true);
});

test('disabled alone also blocks, independent of loading', () => {
	expect(isButtonBlocked(true, false)).toBe(true);
});

test('neither disabled nor loading leaves the button interactive', () => {
	expect(isButtonBlocked(false, false)).toBe(false);
});

test('aria-busy is the literal string "true" while loading, never "false"', () => {
	expect(buttonAriaBusy(true)).toBe('true');
	expect(buttonAriaBusy(false)).toBeUndefined();
});

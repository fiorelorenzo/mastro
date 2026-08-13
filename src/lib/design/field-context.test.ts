// resolveControlState is the actual merge logic every wrapped control
// (Input, Textarea, Select, SegmentedControl) runs to decide its id,
// aria-invalid and aria-describedby. This is what proves a field with an
// error announces it: an ancestor Field in an invalid state, with nothing
// overridden explicitly, resolves straight to aria-invalid=true and the
// error message's id.

import { describe, expect, test } from 'vitest';
import { parseAriaInvalid, resolveControlState, type FieldState } from './field-context';

describe('resolveControlState', () => {
	test('outside any Field, an unset control is valid with no id and no description', () => {
		expect(resolveControlState(undefined, {})).toEqual({
			id: undefined,
			invalid: false,
			describedBy: undefined,
			required: false
		});
	});

	test('inside a valid Field, a control inherits its id but stays valid', () => {
		const field: FieldState = {
			id: 'scope',
			invalid: false,
			describedBy: 'scope-hint',
			required: true
		};
		expect(resolveControlState(field, {})).toEqual({
			id: 'scope',
			invalid: false,
			describedBy: 'scope-hint',
			required: true
		});
	});

	test('inside an invalid Field, a control inherits aria-invalid=true and the error id — with nothing spread by hand', () => {
		const field: FieldState = {
			id: 'email',
			invalid: true,
			describedBy: 'email-error',
			required: false
		};
		expect(resolveControlState(field, {})).toEqual({
			id: 'email',
			invalid: true,
			describedBy: 'email-error',
			required: false
		});
	});

	test('an explicit prop always wins over the ancestor Field, field by field', () => {
		const field: FieldState = {
			id: 'email',
			invalid: true,
			describedBy: 'email-error',
			required: false
		};
		expect(
			resolveControlState(field, {
				id: 'custom-id',
				invalid: false,
				describedBy: 'custom-hint',
				required: true
			})
		).toEqual({ id: 'custom-id', invalid: false, describedBy: 'custom-hint', required: true });
	});

	test('a partial override only replaces the fields given, inheriting the rest', () => {
		const field: FieldState = {
			id: 'email',
			invalid: true,
			describedBy: 'email-error',
			required: false
		};
		expect(resolveControlState(field, { invalid: false })).toEqual({
			id: 'email',
			invalid: false,
			describedBy: 'email-error',
			required: false
		});
	});
});

describe('parseAriaInvalid', () => {
	test.each([
		[true, true],
		['true', true],
		['grammar', true],
		['spelling', true],
		[false, false],
		['false', false]
	] as const)('%s -> %s', (value, expected) => {
		expect(parseAriaInvalid(value)).toBe(expected);
	});

	test('no aria-invalid at all stays unset, not false — so a control inside a Field still inherits it', () => {
		expect(parseAriaInvalid(undefined)).toBeUndefined();
		expect(parseAriaInvalid(null)).toBeUndefined();
	});

	test('this is what makes an Input inside an invalid Field with no aria-invalid prop still announce it', () => {
		const field: FieldState = {
			id: 'email',
			invalid: true,
			describedBy: 'email-error',
			required: false
		};
		const explicitInvalid = parseAriaInvalid(undefined);
		expect(resolveControlState(field, { invalid: explicitInvalid }).invalid).toBe(true);
	});
});

import { describe, expect, test } from 'vitest';
import { countryOptions } from './country-picker';

describe('countryOptions', () => {
	test('lists every ISO 3166-1 alpha-2 country exactly once', () => {
		const options = countryOptions('en');
		expect(options.length).toBe(249);
		expect(new Set(options.map((option) => option.code)).size).toBe(options.length);
		for (const option of options) expect(option.code).toMatch(/^[A-Z]{2}$/);
	});

	test('labels each country in the requested locale', () => {
		const en = countryOptions('en');
		const it = countryOptions('it');
		expect(en.find((option) => option.code === 'IT')?.name).toBe('Italy');
		expect(it.find((option) => option.code === 'IT')?.name).toBe('Italia');
		expect(en.find((option) => option.code === 'FR')?.name).toBe('France');
		expect(it.find((option) => option.code === 'DE')?.name).toBe('Germania');
	});

	test('sorts by the localized name, not by code', () => {
		const it = countryOptions('it');
		const names = it.map((option) => option.name);
		const sorted = [...names].sort((a, b) => new Intl.Collator('it').compare(a, b));
		expect(names).toEqual(sorted);
		// Name-driven, not code-driven: Albania (AL) sorts before Italia (IT)
		// in Italian, even though its code comes after IT's alphabetically.
		expect(names.indexOf('Albania')).toBeLessThan(names.indexOf('Italia'));
	});
});

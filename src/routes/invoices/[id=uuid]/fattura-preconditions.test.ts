import { expect, test } from 'vitest';
import { fatturaBlockers } from './fattura-preconditions';

const ALL_PRESENT = {
	clientFieldGaps: [],
	hasPracticeProfile: true,
	hasFiscalPack: true
} as const;

test('nothing blocks generation when every precondition is satisfied', () => {
	expect(fatturaBlockers(ALL_PRESENT)).toEqual([]);
});

test('missing client fields alone produce a clientFields blocker naming them', () => {
	expect(fatturaBlockers({ ...ALL_PRESENT, clientFieldGaps: ['taxId', 'addressCity'] })).toEqual([
		{ kind: 'clientFields', fields: ['taxId', 'addressCity'] }
	]);
});

test('no practice profile blocks even when the client and pack are fine', () => {
	expect(fatturaBlockers({ ...ALL_PRESENT, hasPracticeProfile: false })).toEqual([
		{ kind: 'practiceProfile' }
	]);
});

test('no fiscal pack blocks even when the client and practice profile are fine — #371, the gap list must not go empty here', () => {
	expect(fatturaBlockers({ ...ALL_PRESENT, hasFiscalPack: false })).toEqual([
		{ kind: 'fiscalPack' }
	]);
});

test('every precondition can block at once, each named once, in a stable order', () => {
	expect(
		fatturaBlockers({
			clientFieldGaps: ['taxId'],
			hasPracticeProfile: false,
			hasFiscalPack: false
		})
	).toEqual([
		{ kind: 'clientFields', fields: ['taxId'] },
		{ kind: 'practiceProfile' },
		{ kind: 'fiscalPack' }
	]);
});

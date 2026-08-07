import { expect, test } from 'vitest';
import { parseDayEntryForm } from './work-unit-form';

const CONTRACT_ID = '11111111-1111-1111-1111-111111111111';
const APPROVAL_ID = '22222222-2222-2222-2222-222222222222';
const WORK_UNIT_ID = '33333333-3333-3333-3333-333333333333';

function validForm(overrides: Record<string, string> = {}): FormData {
	const formData = new FormData();
	const fields: Record<string, string> = {
		date: '2024-06-10',
		quantity: '1',
		scope: 'Migrated the API.',
		contractId: CONTRACT_ID,
		approvalId: '',
		workUnitId: WORK_UNIT_ID,
		...overrides
	};
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return formData;
}

const validContractIds = new Set([CONTRACT_ID]);
const approvalIdsByContract = new Map([[CONTRACT_ID, new Set([APPROVAL_ID])]]);

test("#62: a well-formed workUnitId becomes the created day's id", () => {
	const result = parseDayEntryForm(validForm(), validContractIds, approvalIdsByContract);
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.input.id).toBe(WORK_UNIT_ID);
});

test('#62: a missing workUnitId is not a validation error — the database assigns one instead', () => {
	const formData = validForm();
	formData.delete('workUnitId');
	const result = parseDayEntryForm(formData, validContractIds, approvalIdsByContract);
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.input.id).toBeUndefined();
});

test('#62: a malformed workUnitId is dropped rather than trusted, and is not a validation error', () => {
	const result = parseDayEntryForm(
		validForm({ workUnitId: 'not-a-uuid' }),
		validContractIds,
		approvalIdsByContract
	);
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.input.id).toBeUndefined();
});

test('#62: values echoes the raw workUnitId back for a validation failure, so a retry keeps the same id', () => {
	const result = parseDayEntryForm(
		validForm({ scope: '' }),
		validContractIds,
		approvalIdsByContract
	);
	expect(result.ok).toBe(false);
	expect(result.values.workUnitId).toBe(WORK_UNIT_ID);
});

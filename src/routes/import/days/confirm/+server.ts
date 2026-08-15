// The only endpoint in the day-import pipeline that writes anything
// (#224, mirroring `routes/import/invoices/confirm/+server.ts`'s role for the
// invoice one). The file and the confirmed column mapping are resent
// exactly as `/import/days/analyze` last saw them and re-parsed here from
// scratch (`day-import-request.ts`, shared with the analyze endpoint) —
// never trusting whatever the review screen computed a moment (or a
// browser round trip) ago — so what gets written is the dry run
// recomputed against the database's current state, not a stale snapshot a
// concurrent import or a day typed by hand in between could have
// invalidated. Only the rows still `'valid'` after that recomputation are
// ever persisted; every rejected reason comes back again too, so the
// "done" screen's counts are never a stale copy of what the review stage
// showed a moment before.
import { json, text } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { buildDayImportReview, isDayImportMappingComplete } from '$lib/server/import/day-import';
import {
	persistDayImportBatch,
	type PersistDayImportRow
} from '$lib/server/import/day-import-persist';
import {
	candidateClientsForDayImport,
	existingStateByKeyForDayImport,
	isDayImportColumnMapping,
	parseDayImportFile,
	rateCardsForContracts
} from '$lib/server/import/day-import-request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const formData = await request.formData();
	const fileEntry = formData.get('file');
	if (!(fileEntry instanceof File)) {
		return text(m.import_days_missing_file(), { status: 400 });
	}
	const filename = fileEntry.name;

	const mappingRaw = formData.get('mapping');
	if (typeof mappingRaw !== 'string') {
		return text('Expected a "mapping" field', { status: 400 });
	}
	let mappingParsed: unknown;
	try {
		mappingParsed = JSON.parse(mappingRaw);
	} catch {
		return text('Malformed JSON in "mapping"', { status: 400 });
	}
	if (!isDayImportColumnMapping(mappingParsed) || !isDayImportMappingComplete(mappingParsed)) {
		return text(m.import_days_mapping_incomplete(), { status: 400 });
	}
	const mapping = mappingParsed;

	const parsed = parseDayImportFile(await fileEntry.text());
	if (!parsed) {
		return text(m.import_days_empty_file(), { status: 422 });
	}
	const { dataRows } = parsed;

	const clients = await candidateClientsForDayImport();
	const activeContractIds = new Set(
		clients.flatMap((clientRow) => clientRow.activeContracts.map((contractRow) => contractRow.id))
	);
	const [rateCardsByContractId, existingStateByKey] = await Promise.all([
		rateCardsForContracts(activeContractIds),
		existingStateByKeyForDayImport(dataRows, mapping, activeContractIds)
	]);

	const review = buildDayImportReview(
		dataRows,
		mapping,
		clients,
		rateCardsByContractId,
		existingStateByKey
	);
	const rejected = review.outcomes.filter((outcome) => outcome.kind === 'rejected');
	const validRows: PersistDayImportRow[] = review.outcomes
		.filter((outcome) => outcome.kind === 'valid')
		.map((outcome) => ({
			rowNumber: outcome.rowNumber,
			contractId: outcome.contractId,
			date: outcome.date,
			quantity: outcome.quantity,
			scope: outcome.scope,
			requestedState: outcome.requestedState
		}));

	const actor = { kind: 'human' as const, email: locals.user!.email };
	const outcomes = await persistDayImportBatch(validRows, filename, actor);

	return json({
		filename,
		totalRows: review.totalRows,
		rejected,
		created: outcomes.filter((outcome) => outcome.kind === 'created'),
		alreadyRecorded: outcomes.filter((outcome) => outcome.kind === 'already_recorded'),
		failed: outcomes.filter((outcome) => outcome.kind === 'failed')
	});
};

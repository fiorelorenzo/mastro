// Read-only half of the day-import pipeline (#224, mirroring
// `routes/import/invoices/analyze/+server.ts`'s role for the invoice one): parses
// the uploaded file and, once a column mapping is confirmed, computes the
// dry-run review the client renders. Never inserts, updates or deletes a
// row — every candidate client/contract, rate card and already-recorded
// day is read here (`day-import-request.ts`) and handed to the pure
// `buildDayImportReview`, never mutated.
//
// Two shapes come back depending on whether `mapping` was sent yet: no
// `mapping` field means "just tell me what columns this file has", so the
// response is `headers`/`sampleRows`/`suggestedMapping` for the mapping
// step to render; a `mapping` field means "here is what I picked, show me
// the dry run", so the response is the full per-row outcome list.
import { json, text } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import {
	buildDayImportReview,
	isDayImportMappingComplete,
	suggestDayImportColumnMapping
} from '$lib/server/import/day-import';
import {
	candidateClientsForDayImport,
	existingStateByKeyForDayImport,
	isDayImportColumnMapping,
	parseDayImportFile,
	rateCardsForContracts
} from '$lib/server/import/day-import-request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const fileEntry = formData.get('file');
	if (!(fileEntry instanceof File)) {
		return text(m.import_days_missing_file(), { status: 400 });
	}

	const parsed = parseDayImportFile(await fileEntry.text());
	if (!parsed) {
		return text(m.import_days_empty_file(), { status: 422 });
	}
	const { headerRow, dataRows } = parsed;

	const mappingRaw = formData.get('mapping');
	if (typeof mappingRaw !== 'string') {
		return json({
			kind: 'needs_mapping',
			headers: headerRow,
			sampleRows: dataRows.slice(0, 5),
			suggestedMapping: suggestDayImportColumnMapping(headerRow)
		});
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
	return json({ kind: 'review', totalRows: review.totalRows, outcomes: review.outcomes });
};

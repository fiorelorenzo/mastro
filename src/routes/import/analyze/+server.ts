// Read-only half of the import pipeline (#47: "nothing is written until
// the user confirms"). Takes the files the client already scanned and
// expanded (folder walk, zip expansion and `.p7m` unwrapping all happen in
// the browser — see `$lib/import/scan.ts`, #43), parses each one, and
// computes the review the client renders. Never inserts, updates or
// deletes a row.
import { json, text } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { db } from '$lib/server/db';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import type { ImportableFile } from '$lib/server/import/adapter';
import { accountHolderTaxId } from '$lib/server/import/config';
import { defaultAdapterRegistry } from '$lib/server/import/registry';
import { buildReview } from '$lib/server/import/review';
import { listClients } from '$lib/server/repositories/client';
import type { RequestHandler } from './$types';

function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const files: ImportableFile[] = [];
	for (const entry of formData.getAll('file')) {
		if (!(entry instanceof File)) continue;
		files.push({ filename: entry.name, content: new Uint8Array(await entry.arrayBuffer()) });
	}

	const activePeriod = await resolveActiveFiscalPack(db, todayIsoDate());
	if (!activePeriod) {
		return text(m.import_no_active_pack(), { status: 422 });
	}

	const clients = (await listClients()).map((row) => ({
		id: row.id,
		taxId: row.taxId,
		legalName: row.legalName
	}));

	const review = buildReview(
		files,
		activePeriod.pack,
		defaultAdapterRegistry,
		accountHolderTaxId,
		clients
	);

	return json(review);
};

// #82/#81: the one decision the runner makes for itself rather than
// trusting a caller's say-so — which model a document's contract is
// allowed to reach. `resolveProvider` is the whole boundary: it runs to
// completion (one scoped database read, no network, no subprocess) before
// `job.ts` ever touches a model object, so a hosted refusal always
// happens strictly before anything that could reach a network could run.

import { getHostedExtractionConsentDocumentId, type RunnerDb } from './db.ts';
import { HostedExtractionRefused } from './errors.ts';
import type { ExtractionProvider } from './types.ts';

/**
 * `undefined` or `'local'` always resolves to `'local'` — the default
 * every contract starts in and stays in until a human archives consent
 * (#81). `'hosted'` resolves to `'hosted'` only when `contractId`'s
 * `hosted_extraction_consent_document_id` is non-null; otherwise this
 * throws `HostedExtractionRefused` — never a silent fallback to local,
 * which would hide a caller's bug asking for hosted in the first place.
 */
export async function resolveProvider(
	sql: RunnerDb,
	contractId: string,
	requestedProvider: ExtractionProvider | undefined
): Promise<ExtractionProvider> {
	if (requestedProvider !== 'hosted') return 'local';

	const consentDocumentId = await getHostedExtractionConsentDocumentId(sql, contractId);
	if (consentDocumentId === null) {
		throw new HostedExtractionRefused(contractId);
	}
	return 'hosted';
}

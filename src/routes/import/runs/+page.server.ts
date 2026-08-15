/**
 * The registry (#278, `docs/specs/2026-08-15-extraction-runs-design.md`,
 * "The registry (C)"): every extraction run, newest first, so a job that
 * keeps failing every five minutes is visible instead of silently retried
 * off-screen — the v0.6.5 incident the design doc opens with. No
 * pagination beyond the flat limit `listExtractionRuns` already takes:
 * the registry is meant to be short enough to read in full.
 */
import { listExtractionRuns } from '$lib/server/repositories/extraction-run';
import type { PageServerLoad } from './$types';

const REGISTRY_LIMIT = 50;

export const load: PageServerLoad = async () => {
	return { runs: await listExtractionRuns(REGISTRY_LIMIT) };
};

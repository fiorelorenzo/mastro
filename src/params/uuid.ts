import type { ParamMatcher } from '@sveltejs/kit';
import { isUuid } from '$lib/uuid';

/**
 * SvelteKit resolves this matcher before any loader runs, so a route segment
 * declared `[id=uuid]` answers 404 for a malformed id with no loader change
 * at all, and a route added later gets the same behaviour just by using the
 * same matcher — see #390. Without it, the segment reaches the loader as an
 * ordinary string, the loader hands it straight to a query, and Postgres's
 * own rejection of a malformed uuid surfaces as an uncaught 500.
 */
export const match: ParamMatcher = (param) => isUuid(param);

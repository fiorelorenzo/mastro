import { expect, test } from 'vitest';
import { isEndpointRoute, isPublicRoute, PUBLIC_ROUTE_IDS } from './route-guard';

// The reviewable public list this test guards. Changing it here is the
// deliberate act that has to accompany making a new route public in
// route-guard.ts: the two are asserted equal below, so editing one without
// the other fails the suite.
const EXPECTED_PUBLIC_ROUTE_IDS = new Set([
	'/api/auth/[...all]',
	'/sign-in',
	'/sign-in/google',
	'/health',
	'/api/alerts/run/[job]',
	'/api/mail/poll',
	'/offline'
]);

function routeIdFromLeafFile(path: string): string {
	return (
		path.replace(/^\/src\/routes/, '').replace(/\/\+(page\.svelte|server\.(js|ts))$/, '') || '/'
	);
}

const pageFiles = import.meta.glob('/src/routes/**/+page.svelte');
const endpointFiles = import.meta.glob('/src/routes/**/+server.{js,ts}');
const discoveredRouteIds = new Set(
	[...Object.keys(pageFiles), ...Object.keys(endpointFiles)].map(routeIdFromLeafFile)
);

test('the public route list is exactly what is deliberately public', () => {
	expect(PUBLIC_ROUTE_IDS).toEqual(EXPECTED_PUBLIC_ROUTE_IDS);
});

test('every route discovered under src/routes is protected unless it is on the public list', () => {
	// Guards against the enumeration itself silently finding nothing: a glob
	// that stops matching would otherwise make this test vacuously pass.
	expect(discoveredRouteIds.size).toBeGreaterThan(0);
	for (const routeId of discoveredRouteIds) {
		expect(isPublicRoute(routeId)).toBe(EXPECTED_PUBLIC_ROUTE_IDS.has(routeId));
	}
});

test('a route with no matching file passes through (static asset or 404, never app data)', () => {
	expect(isPublicRoute(null)).toBe(true);
});

test('the Better Auth mount is classified as an endpoint, so a rejection there is a 401', () => {
	expect(isEndpointRoute('/api/auth/[...all]')).toBe(true);
});

test('/health is classified as an endpoint', () => {
	expect(isEndpointRoute('/health')).toBe(true);
});

test('a page route is not classified as an endpoint', () => {
	expect(isEndpointRoute('/')).toBe(false);
});

test('a route id with no matching file is not classified as an endpoint', () => {
	expect(isEndpointRoute('/does-not-exist')).toBe(false);
});

test('the sign-in page and its Google button are both public, and nothing else under /sign-in is', () => {
	expect(isPublicRoute('/sign-in')).toBe(true);
	expect(isPublicRoute('/sign-in/google')).toBe(true);
	// A route added under /sign-in later is protected like everything else:
	// the list is exact ids, never a prefix match (#54).
	expect(isPublicRoute('/sign-in/something-new')).toBe(false);
});

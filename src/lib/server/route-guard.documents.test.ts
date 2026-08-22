import { expect, test } from 'vitest';
import { isPublicRoute } from './route-guard';

/** #187: the document download is evidence behind a session. Deny by
 * default already covers it, and this pins that nobody adds it to the
 * public list later while wiring a share link. */
test('the document download is not public', () => {
	expect(isPublicRoute('/documents/[id=uuid]')).toBe(false);
});

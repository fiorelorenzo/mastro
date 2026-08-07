import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

/**
 * Navigation hrefs are plain strings by contract: the nav model in `items.ts`
 * and a breadcrumb trail from a `load` both carry `string`, not the literal
 * route ids `resolve()` is typed against. The values are exactly the app's own
 * routes, so this is a type-level widening of an otherwise valid call.
 *
 * It lives here, once, because three components need it in lockstep, and a
 * cast repeated at every call site is a cast nobody reviews.
 */
export function appHref(href: string): ResolvedPathname {
	return (resolve as (path: string) => string)(href) as ResolvedPathname;
}

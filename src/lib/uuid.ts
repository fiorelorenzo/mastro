// Every primary key in this database is a Postgres `uuid`
// (`$lib/server/db/columns.ts`). Shared, not server-only, because both
// `src/params/uuid.ts` (a route matcher, bundled for client-side navigation
// too) and `$lib/server/params.ts` (a loader helper) need the exact same
// definition of "looks like a uuid" — see #390.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 4122 textual form, case-insensitive. */
export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

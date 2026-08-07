/**
 * One step of a breadcrumb trail: where it goes, and what it is called.
 *
 * A trail carries the page's **ancestors only**, never the page itself: the
 * page is the title right below the trail, and repeating it there says
 * nothing. That is also what makes the phone collapse exact rather than a
 * guess, since the last crumb is by definition the parent.
 *
 * The label is a string, not a message function, because only a `load` knows
 * which client a contract belongs to. Trails are built server-side, where the
 * locale of the request is already resolved.
 */
export interface Crumb {
	readonly href: string;
	readonly label: string;
}

/**
 * The subtitle line: the few facts that matter about this record, joined.
 *
 * Callers assemble it from optional pieces (a date that may be open-ended, a
 * notice period a contract may not have), so anything missing is dropped
 * rather than rendered as an empty gap between two separators.
 */
export function factLine(parts: readonly (string | null | undefined)[]): string {
	return parts
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join(' · ');
}

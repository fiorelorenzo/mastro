/**
 * Field's id contract: one id for the control, and — only for the pieces a
 * given field actually has — a `<hint>`/`<error>` id derived from it, joined
 * into `aria-describedby`. Kept separate from Field.svelte so it is testable
 * without mounting a component (see field-ids.test.ts). The id itself comes
 * from the caller or from Svelte's own `$props.id()` rune, which is already
 * guaranteed unique per component instance and stable across SSR/hydration —
 * this module only owns what gets derived from it, not the id itself.
 */

export interface FieldIds {
	readonly controlId: string;
	readonly hintId: string | undefined;
	readonly errorId: string | undefined;
	/** Space-joined hint/error ids, hint first, or undefined if the field has neither. */
	readonly describedBy: string | undefined;
}

export function computeFieldIds(options: {
	readonly id: string;
	readonly hasHint: boolean;
	readonly hasError: boolean;
}): FieldIds {
	const { id, hasHint, hasError } = options;
	const hintId = hasHint ? `${id}-hint` : undefined;
	const errorId = hasError ? `${id}-error` : undefined;
	const describedBy = [hintId, errorId].filter((part): part is string => part !== undefined).join(' ') || undefined;
	return { controlId: id, hintId, errorId, describedBy };
}

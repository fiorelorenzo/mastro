import { getContext, setContext } from 'svelte';

/**
 * The channel Field uses to hand its control the id and aria state it
 * computed, so Input/Textarea/Select/SegmentedControl only ever have to ask
 * for it instead of the caller remembering to spread `id`/`aria-invalid`/
 * `aria-describedby` by hand — see Field.svelte's header for why that
 * matters. Checkbox and Radio deliberately do not read this: their label
 * sits beside the box, not above it, so Field's label-above-control chrome
 * does not fit them, and they own their own id/aria wiring instead (see
 * their own file headers).
 */
export interface FieldState {
	readonly id: string;
	readonly invalid: boolean;
	readonly describedBy: string | undefined;
	readonly required: boolean;
}

const KEY = Symbol('mastro.design.field');

export function provideField(state: FieldState): void {
	setContext(KEY, state);
}

export function useField(): FieldState | undefined {
	return getContext(KEY);
}

/**
 * What every wrapped control actually resolves its id/aria-invalid/
 * aria-describedby/required from: whatever the caller passed explicitly,
 * falling back to the ancestor Field's state, falling back to the control's
 * own default. Explicit always wins, so a control used outside any Field —
 * or one that wants to override an ancestor Field — still works. Pure and
 * exported so it is testable without a component tree (field-context.test.ts
 * exercises exactly this function, not a stand-in for it).
 */
export function resolveControlState(
	field: FieldState | undefined,
	explicit: {
		readonly id?: string;
		readonly invalid?: boolean;
		readonly describedBy?: string;
		readonly required?: boolean;
	}
): { id: string | undefined; invalid: boolean; describedBy: string | undefined; required: boolean } {
	return {
		id: explicit.id ?? field?.id,
		invalid: explicit.invalid ?? field?.invalid ?? false,
		describedBy: explicit.describedBy ?? field?.describedBy,
		required: explicit.required ?? field?.required ?? false
	};
}

/**
 * Normalizes the native `aria-invalid` attribute's shape (boolean, its
 * string forms, or the WAI-ARIA `'grammar'`/`'spelling'` values) into the
 * true/false/unset `resolveControlState` expects. Unset (`null`/`undefined`,
 * i.e. the caller passed no `aria-invalid` at all) stays unset rather than
 * becoming `false` — coercing it to `false` would make every control inside
 * a `<Field>` override the ancestor's invalid state by doing nothing, which
 * defeats the whole point of the wiring. Input, Textarea and Select all
 * parse their `aria-invalid` prop through this before calling
 * `resolveControlState`.
 */
export function parseAriaInvalid(
	value: boolean | 'true' | 'false' | 'grammar' | 'spelling' | null | undefined
): boolean | undefined {
	if (value === null || value === undefined) return undefined;
	return value === true || value === 'true' || value === 'grammar' || value === 'spelling';
}

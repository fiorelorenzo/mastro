import type { LocalizedString } from '$lib/paraglide/runtime';
import type { LegalString } from '$lib/legal/legal-string';

/** `T`, unless it is a `LegalString`, in which case nothing is. */
type Forbidden<T> = T extends LegalString ? never : T;

/** The shape every compiled Paraglide message function has. */
type Message<Inputs, Options> = (inputs: Inputs, options?: Options) => LocalizedString;

/**
 * Calls a compiled Paraglide message function. This is the sanctioned entry
 * point for interpolating a value into translated copy: it refuses at
 * compile time to accept a `LegalString` in any input slot, because a legal
 * string must never pass through the translation layer (AGENTS.md
 * invariant 5). A statutory citation or mandatory annotation renders through
 * `LegalText` instead, never through here.
 *
 * The constraint on `Supplied` is self-referential on purpose: Paraglide
 * types an interpolation slot as `NonNullable<unknown>`, wide enough that a
 * `LegalString` would satisfy it silently. Checking each supplied value
 * against its own inferred type, instead of against that already-wide
 * declared type, is what makes the rejection trigger.
 */
export function translate<
	Inputs extends Record<string, unknown>,
	Options,
	Supplied extends { [Key in keyof Inputs]: Forbidden<Supplied[Key]> }
>(message: Message<Inputs, Options>, inputs: Supplied, options?: Options): LocalizedString {
	return message(inputs as unknown as Inputs, options);
}

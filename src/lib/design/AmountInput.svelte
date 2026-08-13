<script lang="ts">
	/*
	 * AmountInput.svelte — the one place a person types money (#203).
	 * Composes Field (label/hint/error/aria wiring) with Input (`numeric`:
	 * tabular, right-aligned, monospaced — the look every input in the
	 * product should share); this file adds only what is unique to money
	 * entry.
	 *
	 * `value` is a plain string, the same convention every form in this
	 * product already uses for its `*FormValues` (see e.g.
	 * `expense-form.ts`'s `ExpenseFormValues`): the raw text the visitor
	 * typed, echoed back verbatim on a failed submission so a genuine typo
	 * is never silently dropped. Parsing that string into money remains
	 * the server's job, through `decimalStringToMinorUnits`
	 * (`$lib/server/import/decimal.ts`) at submission time — this
	 * component only has to agree with it about what counts as a valid
	 * amount, which is why both read the exact same `parseDecimalString`
	 * from `$lib/decimal`, never a second hand-rolled regex.
	 *
	 * On blur, a value that parses is re-rendered to its canonical form
	 * for the active locale (`formatDecimalString`): typing `"700"` shows
	 * back `"700,00"` in Italian, closing the loop #203 was about — what
	 * the interface prints and what its own inputs accept are now
	 * provably the same reading. A value that does not parse is left
	 * exactly as typed; the mid-edit text `"700,"` is never mangled, and
	 * the caller's own `error` (the server's authoritative verdict, after
	 * a submission) still renders through Field regardless.
	 *
	 * Seeding `value` from a stored amount takes two entry points, never
	 * one that would accept either unit and silently be wrong for the
	 * other (see the comment on `MinorUnits` in `$lib/money`):
	 * `minorUnitsToDecimalString` (`$lib/money`) for a `MinorUnits` field
	 * (`expense.amount`, `invoice.*`), `majorUnitsToDecimalString`
	 * (`$lib/decimal`) for a major-unit one (`rate_card.amount`).
	 */
	import { getLocale, type Locale } from '$lib/paraglide/runtime';
	import { formatDecimalString } from '$lib/decimal';
	import Field from './Field.svelte';
	import Input from './Input.svelte';

	let {
		id,
		label,
		name,
		value = $bindable(''),
		currency,
		locale,
		hint,
		error,
		required = false,
		disabled = false,
		size = 'md'
	}: {
		id?: string;
		label: string;
		name?: string;
		value?: string;
		currency: string;
		/** Defaults to the active interface locale; set explicitly only
		 *  when the field must read a locale other than the viewer's own. */
		locale?: Locale;
		hint?: string;
		error?: string;
		required?: boolean;
		disabled?: boolean;
		size?: 'md' | 'lg';
	} = $props();

	const activeLocale = $derived(locale ?? getLocale());

	function handleBlur() {
		if (!value.trim()) return;
		const canonical = formatDecimalString(value, currency, activeLocale);
		if (canonical !== null) value = canonical;
	}
</script>

<Field {label} {hint} {error} {required} {id}>
	<Input
		type="text"
		inputmode="decimal"
		bind:value
		{name}
		{required}
		{disabled}
		{size}
		numeric
		onblur={handleBlur}
	/>
</Field>

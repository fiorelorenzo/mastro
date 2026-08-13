<script lang="ts">
	/*
	 * Amount.svelte — the one way money gets printed (#199, #203). Three
	 * sizes cover every place a figure appears: `figure` is the one number
	 * per screen that matters (a dashboard headline, an invoice total),
	 * `md` is a table cell — right-aligned and tabular, so a column's
	 * decimal points line up regardless of how many digits each row has —
	 * and `inline` sits inside a sentence at its surrounding size. Every
	 * size renders through `formatAmountValue`, which is `formatAmount`/
	 * `formatMinorUnits` from `$lib/i18n/format.ts` underneath: nothing
	 * here ever concatenates a currency symbol or a separator by hand.
	 *
	 * `minorUnits`/`major` are mutually exclusive props with incompatible
	 * branded types (see `amount-format.ts` and the comment on
	 * `MinorUnits` in `$lib/money`) — `rate_card.amount` is a plain major-
	 * unit decimal, everything else this product stores in money is
	 * `MinorUnits`, and handing this component the wrong one is a compile
	 * error rather than a onscreen figure that is 100x too small or large.
	 */
	import { getLocale, type Locale } from '$lib/paraglide/runtime';
	import { formatAmountValue, type AmountSize, type AmountValue } from './amount-format';

	type Props = AmountValue & {
		currency: string;
		size: AmountSize;
		/** Defaults to the active interface locale; set explicitly only to
		 *  render a figure in a locale other than the viewer's own. */
		locale?: Locale;
	};

	let { currency, size, locale, minorUnits, major }: Props = $props();

	const activeLocale = $derived(locale ?? getLocale());
	const value = $derived((minorUnits !== undefined ? { minorUnits } : { major }) as AmountValue);
	const text = $derived(formatAmountValue(value, currency, activeLocale));
</script>

<span class="amount amount--{size}">{text}</span>

<style>
	/* Tabular figures and the product's number face everywhere money
	   appears — declared here rather than assumed from a page-level
	   `.tabular` utility, so the component is correct on its own. */
	.amount {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}
	/* The one figure per screen that matters: largest step on the type
	   scale, bold, tight leading — block so it never gets crowded onto a
	   shared line with something else. */
	.amount--figure {
		display: block;
		font-size: var(--text-3xl);
		font-weight: var(--weight-bold);
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	/* A table cell. Block + right-aligned so the component owns its own
	   end-alignment — a caller only has to place it inside the cell, not
	   also remember `text-align: right` on the `<td>`. */
	.amount--md {
		display: block;
		text-align: right;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
	}
	/* Inline sits inside a sentence at whatever size/weight already
	   applies there — nothing to override. */
</style>

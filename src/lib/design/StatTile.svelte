<!--
	A single number + label + optional note, no chart chrome (mockup's
	`.stat`/`.stat-label`/`.stat-value`/`.stat-sub`). Shared across the
	dashboard's "this week" strip, the invoices stats row and the contract
	page's own stat row — a compact metric never gets a bespoke markup a
	second time. This component renders exactly one tile; the caller lays
	out however many it needs in its own CSS grid (`repeat(N, minmax(0,
	1fr))`), since the right N differs per page.
-->
<script lang="ts">
	let {
		label,
		value,
		sub
	}: {
		label: string;
		/** Pre-formatted — this component never formats money, dates or
		 * percentages itself; see `$lib/i18n/format` for that. */
		value: string;
		sub?: string;
	} = $props();
</script>

<div class="stat">
	<span class="label">{label}</span>
	<span class="value">{value}</span>
	{#if sub}<span class="sub">{sub}</span>{/if}
</div>

<style>
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-xl);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
</style>

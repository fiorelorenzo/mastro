<script lang="ts">
	import type { StatusLevel } from '../palette';

	let {
		level,
		label
	}: {
		level: StatusLevel;
		/** No default on purpose: a status color never renders without the text that explains it. */
		label: string;
	} = $props();
</script>

<!--
	The structural guarantee behind "status is never colour alone": there is
	no prop that renders just the dot. Every level also carries its own
	outline shape (circle / triangle / diamond / square) and glyph, so the
	distinction survives grayscale print and full-severity colour blindness
	even before the label is read.
-->
<span class="status status-{level}">
	<svg class="glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
		{#if level === 'good'}
			<circle cx="8" cy="8" r="7" />
			<path class="glyph-mark" d="M4.5 8.3 6.8 10.8 11.5 5.3" />
		{:else if level === 'warning'}
			<path d="M8 1.3 15 14.3H1Z" />
			<path class="glyph-mark" d="M8 6.3V9.8" />
			<circle class="glyph-mark" cx="8" cy="12" r="0.9" stroke="none" fill="currentColor" />
		{:else if level === 'serious'}
			<path d="M8 1 14.5 8 8 15 1.5 8Z" />
			<path class="glyph-mark" d="M8 5V9" />
			<circle class="glyph-mark" cx="8" cy="11.5" r="0.9" stroke="none" fill="currentColor" />
		{:else}
			<rect x="1.5" y="1.5" width="13" height="13" rx="2" />
			<path class="glyph-mark" d="M5.5 5.5 10.5 10.5M10.5 5.5 5.5 10.5" />
		{/if}
	</svg>
	<span class="label">{label}</span>
</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--status-color);
	}
	.status-good {
		--status-color: var(--status-good);
	}
	.status-warning {
		--status-color: var(--status-warning);
	}
	.status-serious {
		--status-color: var(--status-serious);
	}
	.status-critical {
		--status-color: var(--status-critical);
	}
	.glyph {
		flex: none;
		fill: none;
		stroke: var(--status-color);
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.glyph-mark {
		stroke: var(--status-color);
	}
	.label {
		color: var(--text-primary);
		font-size: 0.875rem;
	}
</style>

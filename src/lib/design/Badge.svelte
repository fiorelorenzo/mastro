<script lang="ts">
	import { BADGE_GLYPH, type BadgeSize, type BadgeVariant } from './badge-variants';

	let {
		variant,
		label,
		size = 'md'
	}: {
		variant: BadgeVariant;
		/** No default on purpose: the same guarantee `StatusIndicator` makes
		 *  for the chart status scale — a badge never renders without the
		 *  text that explains it, colour and glyph are reinforcement, not
		 *  the whole message. */
		label: string;
		size?: BadgeSize;
	} = $props();
</script>

<!--
	Consolidates three previously unrelated pills (the sidebar's hairline
	nav count, the dashboard's filled proposals pill, and DayStateBadge's
	glyph-plus-label pattern — ux-review #57) into one shape. Every variant,
	`count` included, carries its own glyph character next to its colour
	(see badge-variants.ts): colour is never the only thing distinguishing
	one badge from another.
-->
<span class="badge badge-{variant} size-{size}">
	<span class="glyph" aria-hidden="true">{BADGE_GLYPH[variant]}</span>
	<span class="text">{label}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		padding: 0.125rem 0.4375rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		color: var(--text-secondary);
		background: var(--surface-2);
		white-space: nowrap;
		line-height: 1.5;
	}
	.size-sm {
		font-size: var(--text-2xs);
		padding: 0.0625rem 0.375rem;
		gap: var(--space-1);
	}
	.glyph {
		flex: none;
		font-size: 0.75em;
		line-height: 1;
	}
	.text {
		line-height: 1.2;
	}

	/* `neutral` is the base style above with no modifier — the plain,
	   uncoloured badge (a draft, an inactive row). */

	.badge-info {
		color: var(--color-primary);
		border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}
	.badge-good {
		color: var(--status-good);
		border-color: color-mix(in srgb, var(--status-good) 45%, transparent);
		background: color-mix(in srgb, var(--status-good) 10%, transparent);
	}
	.badge-warning {
		/* status-warning alone is too light against a tinted background to
		   hold text contrast, so it is mixed toward the page ink — the same
		   move system.css's mockup makes for this exact reason. */
		color: color-mix(in srgb, var(--status-warning) 78%, var(--text-primary));
		border-color: color-mix(in srgb, var(--status-warning) 55%, transparent);
		background: color-mix(in srgb, var(--status-warning) 14%, transparent);
	}
	.badge-serious {
		color: color-mix(in srgb, var(--status-serious) 80%, var(--text-primary));
		border-color: color-mix(in srgb, var(--status-serious) 55%, transparent);
		background: color-mix(in srgb, var(--status-serious) 14%, transparent);
	}
	.badge-critical {
		color: var(--color-danger);
		border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
	}
	/* `count` is one fixed identity, not a colour a caller can vary: it
	   replaces both the old hairline nav pill and the old filled dashboard
	   pill with a single look, radius-full and solid, so a raw quantity
	   reads the same everywhere (ux-review #57). */
	.badge-count {
		border-radius: var(--radius-full);
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-ink);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		min-width: 1.25rem;
		justify-content: center;
		padding-inline: 0.375rem;
	}
</style>

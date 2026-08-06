<!--
	Renders a `LegalString` verbatim. No locale, no translation call, no
	fallback: the value already is what the law requires, so this component
	is the entire contract (AGENTS.md invariant 5).
-->
<script lang="ts">
	import type { LegalString } from './legal-string';

	let { value }: { value: LegalString } = $props();
</script>

<span>{value}</span>

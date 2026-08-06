<!--
	Renders a `LegalText` verbatim. No locale, no translation call, no
	fallback: the text already is what the law requires, so this component
	is the entire contract (AGENTS.md invariant 5). `lang` is set to the
	text's own language, not the interface locale, so a screen reader
	pronounces it correctly even when it disagrees with the surrounding page.
-->
<script lang="ts">
	import type { LegalText } from './legal-text';

	let { value }: { value: LegalText } = $props();
</script>

<span lang={value.language}>{value.text}</span>

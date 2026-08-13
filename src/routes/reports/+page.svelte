<!--
	Cash calendar and client concentration (#58, #59), moved here by #234
	— see `+page.server.ts`'s header comment for why. Two sections, each
	carrying the anchor id the dashboard's own footer links point at
	(`#cassa-per-mese`, `#concentrazione-clienti`).
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import CashCalendarChart from '$lib/dashboard/CashCalendarChart.svelte';
	import ConcentrationChart from '$lib/dashboard/ConcentrationChart.svelte';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{m.dashboard_reports_heading()} — mastro</title></svelte:head>

<Page title={m.dashboard_reports_heading()} width="wide">
	<div id="cassa-per-mese">
		<Section title={m.dashboard_cash_calendar_heading()}>
			<CashCalendarChart
				months={data.cashCalendar.months}
				to={data.cashCalendar.to}
				markers={data.cashCalendar.markers}
				assumptions={data.cashCalendar.assumptions}
			/>
		</Section>
	</div>

	<div id="concentrazione-clienti">
		<Section title={m.dashboard_concentration_heading()}>
			<ConcentrationChart
				byClient={data.concentration.byClient}
				total={data.concentration.total}
				shareCeilings={data.concentration.shareCeilings}
			/>
		</Section>
	</div>
</Page>

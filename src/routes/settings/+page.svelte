<!--
	Settings (#246): "is my instance healthy," answerable in one screen,
	direction B2's own drawing of it (docs/specs/ux-review/mockups/
	mastro-mockup.html, "7 — Impostazioni, stato di salute del sistema").
	One list, one row per concern, each carrying a state (a `Badge`, never
	colour alone) and the action that fixes it when it can be wrong — the
	shape `alerts/+page.svelte`'s own `.alert-list` already established
	for "a row that can be acted on," reused here instead of a second,
	slightly different list convention.

	Every health row (backup, mail polling, the extraction runner) reads
	`+page.server.ts`'s own `classifyRun`, which is a reducer over the
	alert engine's own `detect*Failure` output — never a second
	"is this stale" computation that could disagree with #74's.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatBytes, formatDate, formatDateTime } from '$lib/i18n/format';
	import Badge from '$lib/design/Badge.svelte';
	import type { BadgeVariant } from '$lib/design/badge-variants';
	import Button from '$lib/design/Button.svelte';
	import { SegmentedControl } from '$lib/design';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { mailPollBadge, mailPollMeta } from '../mail/poll-status';
	import { pushSubscriptionStore } from '$lib/pwa/push.svelte';
	import { theme } from '$lib/theme.svelte';
	import type { ThemePreference } from '$lib/theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const locale = $derived(getLocale());

	onMount(() => {
		pushSubscriptionStore.init();
	});

	async function enablePush() {
		if (data.vapidPublicKey) await pushSubscriptionStore.subscribe(data.vapidPublicKey);
	}

	const themeOptions = $derived([
		{ value: 'system', label: m.theme_option_system() },
		{ value: 'light', label: m.theme_option_light() },
		{ value: 'dark', label: m.theme_option_dark() }
	]);

	// SegmentedControl binds a plain `string`; narrow back to the branded
	// preference type on write, `theme.ts`'s own default protects against
	// anything else ever reaching the store.
	let themePreference = $state<string>(theme.preference);
	$effect(() => theme.set(themePreference as ThemePreference));

	type HealthKind = 'ok' | 'failure' | 'stale' | 'never_run';

	function healthBadge(kind: HealthKind): { variant: BadgeVariant; label: string } {
		switch (kind) {
			case 'ok':
				return { variant: 'good', label: m.settings_health_status_ok() };
			case 'failure':
				return { variant: 'critical', label: m.settings_health_status_failed() };
			case 'stale':
				return { variant: 'serious', label: m.settings_health_status_stale() };
			case 'never_run':
				return { variant: 'critical', label: m.settings_health_status_never_run() };
		}
	}

	function configuredBadge(configured: boolean): { variant: BadgeVariant; label: string } {
		return configured
			? { variant: 'good', label: m.settings_health_status_configured() }
			: { variant: 'warning', label: m.settings_health_status_not_configured() };
	}

	const fiscalBadge = $derived(configuredBadge(data.fiscalProfile !== null));
	const practiceBadge = $derived(configuredBadge(data.practiceProfile !== null));
	const backupBadge = $derived(healthBadge(data.backup.kind));
	// The mail row's badge and its sentence, from the same two functions
	// `/mail` renders (#374) — never a local reading of the payload.
	const mailPoll = $derived(
		mailPollBadge(data.mail.accountConfigured, data.mail.anyFolderMapped, data.mail.health)
	);
	const mailMeta = $derived(
		mailPollMeta(data.mail.accountConfigured, data.mail.anyFolderMapped, data.mail.health, locale)
	);
	const runnerBadge = $derived(
		data.runner.configured ? healthBadge(data.runner.health!.kind) : configuredBadge(false)
	);

	// `backup_run.detail` on a successful run is the archive's size in
	// bytes as a plain integer string (`scripts/backup.sh`) — parsed
	// defensively so a row written before that convention (or by hand)
	// degrades to "no size known" instead of rendering "NaN".
	const backupSizeLabel = $derived.by(() => {
		if (data.backup.kind !== 'ok' || data.backup.detail === null) return null;
		const bytes = Number(data.backup.detail);
		return Number.isFinite(bytes) ? formatBytes(bytes, locale) : null;
	});

	const pushStatus = $derived.by((): { variant: BadgeVariant; label: string } => {
		if (!data.vapidPublicKey) {
			return { variant: 'warning', label: m.settings_health_status_not_configured() };
		}
		if (pushSubscriptionStore.status === 'unsupported') {
			return { variant: 'neutral', label: m.settings_push_status_unsupported() };
		}
		if (pushSubscriptionStore.status === 'ios-needs-install') {
			return { variant: 'info', label: m.settings_push_status_ios_needs_install() };
		}
		return pushSubscriptionStore.subscribed
			? { variant: 'good', label: m.settings_push_status_active() }
			: { variant: 'info', label: m.settings_push_status_inactive() };
	});
</script>

<svelte:head><title>{m.settings_page_title()}</title></svelte:head>

<!--
	Grouped, required-first (#375). This was one flat list of ten rows in
	which a mandatory fiscal profile, a read-only backup readout, a
	developer reference page and a per-device toggle all rendered as the
	same shape in no particular order, so nothing said which of them a new
	instance has to fill in before it can work.

	Four groups, in the order a person needs them: what the ledger cannot
	compute without, then how work arrives, then what is true of the
	instance, then what belongs to the browser in your hand. The design
	system row is gone from here entirely - it is developer documentation,
	not a setting, and `/design` is still there for whoever wants it.
-->
<Page title={m.settings_heading()}>
	<Section title={m.settings_group_required()}>
		<p class="group-note">{m.settings_group_required_note()}</p>
		<ul class="rows">
			<!-- ── fiscal profile ─────────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_fiscal_heading()}</p>
					<p class="row-meta">
						{#if data.fiscalProfile}
							{m.settings_fiscal_active({
								pack: data.fiscalProfile.displayName[locale],
								date: formatDate(data.fiscalProfile.validFrom, locale)
							})}
						{:else}
							{m.settings_fiscal_none()}
						{/if}
					</p>
				</div>
				<div class="row-actions">
					<Badge variant={fiscalBadge.variant} label={fiscalBadge.label} size="sm" />
					<Button href={resolve('/settings/fiscal')} variant="tertiary" size="sm">
						{m.settings_fiscal_manage_link()}
					</Button>
				</div>
			</li>

			<!-- ── practice profile ───────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_practice_heading()}</p>
					<p class="row-meta">
						{#if data.practiceProfile}
							{m.settings_practice_summary({
								legalName: data.practiceProfile.legalName,
								taxId: data.practiceProfile.taxId
							})}
						{:else}
							{m.settings_practice_empty_notice()}
						{/if}
					</p>
				</div>
				<div class="row-actions">
					<Badge variant={practiceBadge.variant} label={practiceBadge.label} size="sm" />
					<Button href={resolve('/settings/practice')} variant="tertiary" size="sm">
						{m.settings_practice_manage_link()}
					</Button>
				</div>
			</li>
		</ul>
	</Section>

	<Section title={m.settings_group_ingestion()}>
		<p class="group-note">{m.settings_group_ingestion_note()}</p>
		<ul class="rows">
			<!-- ── mail polling ────────────────────────────────────────────────
		     Badge and meta come from `mail/poll-status.ts`, the two functions
		     `/mail` and `/mail/contracts/[id]` already render (#374). This row
		     used to ask `pollingConfigured`, the conflated
		     account-and-folder boolean, and told an instance with working
		     credentials that IMAP was unconfigured - while `/mail` two clicks
		     away said the opposite. One implementation now answers for all
		     three, so they cannot disagree again. -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_mail_heading()}</p>
					<p class="row-meta">{mailMeta}</p>
				</div>
				<div class="row-actions">
					<Badge variant={mailPoll.variant} label={mailPoll.label} size="sm" />
					<!-- Always offered, deliberately: the state that most needs this
				     link is "configured, nothing mapped", which is exactly the
				     state the old condition hid it in. -->
					<Button href={resolve('/mail')} variant="tertiary" size="sm">
						{m.settings_mail_open_link()}
					</Button>
				</div>
			</li>

			<!-- ── extraction runner ──────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_runner_heading()}</p>
					<p class="row-meta">
						{#if !data.runner.configured}
							{m.settings_runner_not_configured_meta()}
						{:else if data.runner.health!.kind === 'ok'}
							{m.settings_runner_ok_meta({
								date: formatDateTime(data.runner.health!.lastRunAt, locale)
							})}
						{:else if data.runner.health!.kind === 'failure'}
							{m.settings_runner_failure_meta({
								date: formatDateTime(data.runner.health!.lastRunAt, locale),
								detail: data.runner.health!.detail ?? ''
							})}
						{:else if data.runner.health!.kind === 'stale'}
							{m.settings_runner_stale_meta({
								date: formatDateTime(data.runner.health!.lastRunAt, locale)
							})}
						{:else}
							{m.settings_runner_never_run_meta()}
						{/if}
					</p>
				</div>
				<div class="row-actions">
					<Badge variant={runnerBadge.variant} label={runnerBadge.label} size="sm" />
					{#if data.runner.configured}
						<Button href={resolve('/proposals')} variant="tertiary" size="sm">
							{m.settings_runner_review_link()}
						</Button>
					{/if}
				</div>
			</li>
		</ul>
	</Section>

	<Section title={m.settings_group_operations()}>
		<p class="group-note">{m.settings_group_operations_note()}</p>
		<ul class="rows">
			<!-- ── last backup ────────────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_backup_heading()}</p>
					<p class="row-meta">
						{#if data.backup.kind === 'ok'}
							{m.settings_backup_ok_meta({
								date: formatDateTime(data.backup.lastRunAt, locale),
								size: backupSizeLabel ?? '—'
							})}
						{:else if data.backup.kind === 'failure'}
							{m.settings_backup_failure_meta({
								date: formatDateTime(data.backup.lastRunAt, locale),
								detail: data.backup.detail ?? ''
							})}
						{:else if data.backup.kind === 'stale'}
							{m.settings_backup_stale_meta({
								date: formatDateTime(data.backup.lastRunAt, locale)
							})}
						{:else}
							{m.settings_backup_never_run_meta()}
						{/if}
					</p>
				</div>
				<div class="row-actions">
					<Badge variant={backupBadge.variant} label={backupBadge.label} size="sm" />
				</div>
			</li>
			<!-- ── conservazione sostitutiva reminder (#262) ──────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_conservazione_heading()}</p>
					<p class="row-meta">{m.settings_conservazione_note()}</p>
				</div>
				<div class="row-actions">
					<a
						href="https://ivaservizi.agenziaentrate.gov.it/portale/"
						target="_blank"
						rel="noreferrer"
						class="external-link"
					>
						{m.settings_conservazione_link()}
					</a>
				</div>
			</li>
		</ul>
	</Section>

	<Section title={m.settings_group_device()}>
		<p class="group-note">{m.settings_group_device_note()}</p>
		<ul class="rows">
			<!-- ── push notifications ─────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_push_heading()}</p>
					<p class="row-meta">
						{#if !data.vapidPublicKey}
							{m.settings_push_not_configured_meta()}
						{:else if pushSubscriptionStore.status === 'unsupported'}
							{m.alerts_settings_push_unsupported()}
						{:else if pushSubscriptionStore.status === 'ios-needs-install'}
							{m.alerts_settings_push_ios_hint()}
						{:else if pushSubscriptionStore.subscribed}
							{m.alerts_settings_push_subscribed_status()}
						{:else}
							{m.alerts_settings_push_not_subscribed_status()}
							{#if pushSubscriptionStore.permissionDenied}
								<br />{m.alerts_settings_push_permission_denied()}
							{/if}
						{/if}
					</p>
				</div>
				<div class="row-actions">
					<Badge variant={pushStatus.variant} label={pushStatus.label} size="sm" />
					{#if data.vapidPublicKey && pushSubscriptionStore.status === 'supported'}
						{#if pushSubscriptionStore.subscribed}
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={pushSubscriptionStore.busy}
								onclick={() => pushSubscriptionStore.unsubscribe()}
							>
								{m.alerts_settings_push_disable_button()}
							</Button>
						{:else}
							<Button
								type="button"
								variant="primary"
								size="sm"
								disabled={pushSubscriptionStore.busy}
								onclick={enablePush}
							>
								{m.alerts_settings_push_enable_button()}
							</Button>
						{/if}
					{/if}
					<Button href={resolve('/alerts/settings')} variant="tertiary" size="sm">
						{m.settings_alerts_link()}
					</Button>
				</div>
			</li>

			<!-- ── theme ───────────────────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_appearance_heading()}</p>
				</div>
				<div class="row-actions">
					<SegmentedControl
						label={m.theme_switch_label()}
						options={themeOptions}
						bind:value={themePreference}
						size="md"
					/>
				</div>
			</li>

			<!-- ── language ────────────────────────────────────────────────── -->
			<li class="row">
				<div class="row-main">
					<p class="row-title">{m.settings_language_heading()}</p>
				</div>
				<div class="row-actions">
					<LanguageSwitch />
				</div>
			</li>
		</ul>
	</Section>
</Page>

<style>
	.rows {
		margin-top: var(--space-4);
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
	}
	.row:last-child {
		border-bottom: none;
	}
	.row-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		/* Takes the free space rather than shrinking to its text: without
		   this a row whose action is a long link (the conservazione
		   reminder) gives the action most of the width and wraps its own
		   explanation into a narrow column. */
		flex: 1 1 auto;
	}
	.row-title {
		margin: 0;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.row-meta {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	/* The one line under each group heading that says what the group is for
	   and whether it is optional (#375). Sits above the rows, not inside
	   them, because it describes the group and not any one setting. */
	.group-note {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		/* Shrinkable, but never below its own min-content width: `flex: none`
		   let a long link take the width the row's explanation needed, and
		   `min-width: 0` let the column collapse until a badge overlapped
		   the text beside it. This wraps the label instead. */
		flex: 0 1 auto;
		justify-content: flex-end;
	}
	.external-link {
		/* Short enough to stay on one line now that the label says what it
		   does rather than describing the destination. */
		white-space: nowrap;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-primary);
		text-decoration: underline;
	}
	@media (max-width: 639px) {
		.row {
			flex-direction: column;
			align-items: stretch;
		}
		.row-actions {
			justify-content: flex-start;
		}
	}
</style>

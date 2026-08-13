// Renders one `Alert` into the title/body pair used by both the push
// notification (#63) and each line of the weekly digest (#75) — the one
// place alert copy is written, so the two channels never disagree about
// what the same alert says. Ceiling amounts are deliberately rendered as
// a percentage only (`formatPercent`), never a currency figure:
// `EvaluatedCeiling`/`Ceiling` (fiscal/pack.ts) carry `currentValue`/
// `limitValue` as bare `MinorUnits` with no currency of their own — every
// fixture in `fiscal/` assumes EUR, but baking that assumption into new
// delivery copy is exactly the kind of thing #74's "no alert hardcoded to
// a country" is about, so this file does not.
//
// Notifications are generated outside any request, with nobody to ask for
// a language preference — the same situation `contract.templateLanguage`
// solves by defaulting to `'en'` (AGENTS.md). `DELIVERY_LOCALE` makes that
// explicit and greppable rather than an implicit default buried in a
// function signature.

import * as m from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';
import { formatDate, formatDays, formatPercent } from '$lib/i18n/format';
import type { Alert } from './types';

export const DELIVERY_LOCALE: Locale = 'en';

export interface AlertMessage {
	readonly title: string;
	readonly body: string;
}

function renewalTypeLabel(
	renewalType: 'explicit' | 'counterparty_option' | 'tacit',
	locale: Locale
): string {
	if (renewalType === 'explicit') return m.alerts_renewal_type_explicit(undefined, { locale });
	if (renewalType === 'counterparty_option')
		return m.alerts_renewal_type_counterparty_option(undefined, { locale });
	return m.alerts_renewal_type_tacit(undefined, { locale });
}

/** One alert, rendered in `locale` — `DELIVERY_LOCALE` for push/digest,
 * the ambient interface locale for the `/alerts` page itself. */
export function alertMessage(alert: Alert, locale: Locale): AlertMessage {
	const detail = alert.detail;
	switch (detail.type) {
		case 'contract_expiring':
			return {
				title: m.alerts_contract_expiring_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body:
					detail.daysUntilEnd >= 0
						? m.alerts_contract_expiring_body_upcoming(
								{
									clientLegalName: detail.clientLegalName,
									endsOn: formatDate(detail.endsOn, locale),
									days: formatDays(detail.daysUntilEnd, locale)
								},
								{ locale }
							)
						: m.alerts_contract_expiring_body_past(
								{
									clientLegalName: detail.clientLegalName,
									endsOn: formatDate(detail.endsOn, locale),
									days: formatDays(-detail.daysUntilEnd, locale)
								},
								{ locale }
							)
			};

		case 'renewal_window_open':
			return {
				title: m.alerts_renewal_window_open_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body: m.alerts_renewal_window_open_body(
					{
						clientLegalName: detail.clientLegalName,
						endsOn: formatDate(detail.endsOn, locale),
						renewalType: renewalTypeLabel(detail.renewalType, locale),
						days: formatDays(detail.daysUntilEnd, locale)
					},
					{ locale }
				)
			};

		case 'worked_without_approval':
			return {
				title: m.alerts_worked_without_approval_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body: m.alerts_worked_without_approval_body(
					{ clientLegalName: detail.clientLegalName, date: formatDate(detail.date, locale) },
					{ locale }
				)
			};

		case 'approval_unactioned':
			return {
				title: m.alerts_approval_unactioned_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body: m.alerts_approval_unactioned_body(
					{
						clientLegalName: detail.clientLegalName,
						receivedAt: formatDate(detail.receivedAt, locale),
						days: formatDays(detail.daysUnactioned, locale)
					},
					{ locale }
				)
			};

		case 'invoice_overdue':
			return {
				title: m.alerts_invoice_overdue_title({ invoiceNumber: detail.invoiceNumber }, { locale }),
				body: m.alerts_invoice_overdue_body(
					{
						clientLegalName: detail.clientLegalName,
						contractTitle: detail.contractTitle,
						dueDate: formatDate(detail.dueDate, locale),
						days: formatDays(detail.daysLate, locale)
					},
					{ locale }
				)
			};

		case 'billable_period_closed':
			return {
				title: m.alerts_billable_period_closed_title(
					{ contractTitle: detail.contractTitle },
					{ locale }
				),
				body: m.alerts_billable_period_closed_body(
					{
						clientLegalName: detail.clientLegalName,
						periodEnd: formatDate(detail.periodEnd, locale),
						days: formatDays(detail.dayCount, locale)
					},
					{ locale }
				)
			};

		case 'ceiling_approaching':
			return {
				title: m.alerts_ceiling_approaching_title(
					{ ceilingLabel: detail.ceilingLabel[locale] },
					{ locale }
				),
				body: m.alerts_ceiling_approaching_body(
					{
						usageRatio: formatPercent(detail.usageRatio, locale),
						consequence: detail.consequence[locale]
					},
					{ locale }
				)
			};

		case 'year_end_overrun_risk': {
			const overshootRatio = detail.projectedValue / detail.limitValue;
			return {
				title: m.alerts_year_end_overrun_risk_title(
					{ ceilingLabel: detail.ceilingLabel[locale] },
					{ locale }
				),
				body: m.alerts_year_end_overrun_risk_body(
					{
						usageRatio: formatPercent(overshootRatio, locale),
						periodEnd: formatDate(detail.periodEnd, locale),
						consequence: detail.consequence[locale]
					},
					{ locale }
				)
			};
		}

		case 'backup_failure':
			return {
				title: m.alerts_backup_failure_title(undefined, { locale }),
				body:
					detail.reason === 'never_run'
						? m.alerts_backup_failure_body_never_run(undefined, { locale })
						: detail.reason === 'failure'
							? m.alerts_backup_failure_body_failure({ detail: detail.detail ?? '' }, { locale })
							: m.alerts_backup_failure_body_stale(
									{ lastRunAt: detail.lastRunAt ? formatDate(detail.lastRunAt, locale) : '' },
									{ locale }
								)
			};

		case 'mirror_failure':
			return {
				title: m.alerts_mirror_failure_title({ contractTitle: detail.contractTitle }, { locale }),
				body:
					detail.reason === 'failure'
						? m.alerts_mirror_failure_body_failure(
								{ clientLegalName: detail.clientLegalName, detail: detail.detail ?? '' },
								{ locale }
							)
						: m.alerts_mirror_failure_body_stale(
								{ clientLegalName: detail.clientLegalName },
								{ locale }
							)
			};

		case 'mailbox_poll_failure':
			return {
				title: m.alerts_mailbox_poll_failure_title(undefined, { locale }),
				body:
					detail.reason === 'never_run'
						? m.alerts_mailbox_poll_failure_body_never_run(undefined, { locale })
						: detail.reason === 'failure'
							? m.alerts_mailbox_poll_failure_body_failure(
									{ detail: detail.detail ?? '' },
									{ locale }
								)
							: m.alerts_mailbox_poll_failure_body_stale(
									{ lastRunAt: detail.lastRunAt ? formatDate(detail.lastRunAt, locale) : '' },
									{ locale }
								)
			};

		case 'agent_run_failure':
			return {
				title: m.alerts_agent_run_failure_title(undefined, { locale }),
				body:
					detail.reason === 'never_run'
						? m.alerts_agent_run_failure_body_never_run(undefined, { locale })
						: detail.reason === 'failure'
							? m.alerts_agent_run_failure_body_failure({ detail: detail.detail ?? '' }, { locale })
							: m.alerts_agent_run_failure_body_stale(
									{ lastRunAt: detail.lastRunAt ? formatDate(detail.lastRunAt, locale) : '' },
									{ locale }
								)
			};
	}
}

// The mapping the #220 fix exists for: what to click, and where it goes,
// for every alert kind — as data, not as a hand-written `{#if}` chain in
// `+page.svelte`. Before this file, `alerts/+page.svelte` rendered the
// title and the body text and threw every id `types.ts` already carries
// away; the only action offered was acknowledging, a severity-rank
// silencer that never touches the thing the alert is about.
//
// `alertResolution`'s `switch` has no `default` and returns `AlertResolution`
// unconditionally: dropping a case, or widening `AlertType`
// (`db/schema/alert.ts`) without adding one here, is a compile error, the
// same guarantee `render.ts`'s own `alertMessage` switch already gives the
// title/body copy. `actions.test.ts` walks `ALERT_TYPES` and additionally
// proves every case actually returns non-empty hrefs and distinct labels —
// belt and braces, since a `case` that returns `{ subjectHref: '', ... }`
// would still satisfy the type checker.
//
// Every href is a plain string, not `resolve()` from `$app/paths`: this
// module lives beside `detectors.ts` and `render.ts`, both hand-verifiable
// against a fixture with no SvelteKit request context in the loop, and
// this keeps that property rather than pulling in the route manifest.
//
// Two kinds have no per-instance page to link to, by inspection rather
// than oversight:
//   - `ceiling_approaching` / `year_end_overrun_risk`: a ceiling is shown
//     only as a dashboard widget (`routes/CeilingMeter.svelte`, `#57`),
//     with no id on the DOM and no per-ceiling route — both go to `/`, the
//     one screen a ceiling is ever visible on.
//   - `backup_failure` / `mailbox_poll_failure` / `agent_run_failure`:
//     global, subject-less conditions (`alertKey`'s `'global'`) whose only
//     actionable surface is `/settings` — the review's #246 gives that
//     screen an actual mail/backup/scheduler health section; until then
//     it is still the right place to send someone.
// Both are reported in the #220 PR description rather than solved with an
// invented route this issue was never asked to build.

import * as m from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';
import { formatDate } from '$lib/i18n/format';
import type { AlertDetail } from './types';

export interface AlertResolution {
	/** Deep link to the thing the alert is about. */
	readonly subjectHref: string;
	readonly subjectLabel: string;
	/** The action that actually resolves the alert — never "hide it". */
	readonly actionHref: string;
	readonly actionLabel: string;
}

function contractHref(contractId: string, clientId: string): string {
	return `/clients/${clientId}/contracts/${contractId}`;
}

/** One alert, resolved to where it links and what it offers — the table
 * `#220` asks for, exhaustive over `AlertDetail` at the type level: a
 * `switch` with no `default` on a discriminated union fails to compile,
 * not just to test, the moment a case goes unhandled. */
export function alertResolution(detail: AlertDetail, locale: Locale): AlertResolution {
	switch (detail.type) {
		case 'contract_expiring':
		case 'renewal_window_open': {
			const href = contractHref(detail.contractId, detail.clientId);
			return {
				subjectHref: href,
				subjectLabel: m.alerts_action_open_contract(undefined, { locale }),
				actionHref: `${href}/edit`,
				actionLabel: m.alerts_action_update_contract(undefined, { locale })
			};
		}

		case 'worked_without_approval': {
			// The day itself carries the linking form already (`day/[id]`); the
			// primary action is `approvals/new` (#210) so a day with *no*
			// approval on file at all — not just one not yet linked — is one
			// click from the form that records one and links it in the same
			// transaction.
			const dayHref = `/day/${detail.workUnitId}`;
			return {
				subjectHref: dayHref,
				subjectLabel: m.alerts_action_open_day(
					{ date: formatDate(detail.date, locale) },
					{ locale }
				),
				actionHref: `/approvals/new?contractId=${detail.contractId}&workUnitId=${detail.workUnitId}`,
				actionLabel: m.alerts_action_link_approval(undefined, { locale })
			};
		}

		case 'approval_unactioned': {
			// The approval has no page of its own; the resolving action is
			// recording the day it authorises, prefilled via `day/new`'s
			// `?contractId=&approvalId=` (this fix's own addition to that route).
			return {
				subjectHref: contractHref(detail.contractId, detail.clientId),
				subjectLabel: m.alerts_action_open_contract(undefined, { locale }),
				actionHref: `/day/new?contractId=${detail.contractId}&approvalId=${detail.approvalId}`,
				actionLabel: m.alerts_action_record_day(undefined, { locale })
			};
		}

		case 'proposal_pending': {
			// The review queue's own detail screen (`routes/proposals/[id]`) is
			// the one place a proposal is decided; subject and action collapse
			// onto it, the same shape ceiling/system-health alerts already use
			// for "one real screen".
			const href = `/proposals/${detail.proposalId}`;
			const label = m.alerts_action_review_proposal(undefined, { locale });
			return { subjectHref: href, subjectLabel: label, actionHref: href, actionLabel: label };
		}

		case 'invoice_overdue': {
			const href = `/invoices/${detail.invoiceId}`;
			return {
				subjectHref: href,
				subjectLabel: m.alerts_action_open_invoice({ number: detail.invoiceNumber }, { locale }),
				actionHref: `${href}/remind`,
				actionLabel: m.alerts_action_send_reminder(undefined, { locale })
			};
		}

		case 'billable_period_closed': {
			return {
				subjectHref: contractHref(detail.contractId, detail.clientId),
				subjectLabel: m.alerts_action_open_contract(undefined, { locale }),
				actionHref: `/invoices/new?contractId=${detail.contractId}`,
				actionLabel: m.alerts_action_create_invoice(undefined, { locale })
			};
		}

		case 'ceiling_approaching':
		case 'year_end_overrun_risk': {
			const label = m.alerts_action_open_dashboard(undefined, { locale });
			return { subjectHref: '/', subjectLabel: label, actionHref: '/', actionLabel: label };
		}

		case 'backup_failure':
		case 'mailbox_poll_failure':
		case 'agent_run_failure': {
			const label = m.alerts_action_open_settings(undefined, { locale });
			return {
				subjectHref: '/settings',
				subjectLabel: label,
				actionHref: '/settings',
				actionLabel: label
			};
		}

		case 'mirror_failure': {
			// No per-document viewer exists (`documents/[id]/+server.ts` is a
			// raw file GET, not a page) and Drive reconfiguration has no
			// settings UI either (#220's own gap to report) — the contract the
			// document belongs to is the closest real place to send someone.
			const href = contractHref(detail.contractId, detail.clientId);
			const label = m.alerts_action_open_contract(undefined, { locale });
			return { subjectHref: href, subjectLabel: label, actionHref: href, actionLabel: label };
		}
	}
}

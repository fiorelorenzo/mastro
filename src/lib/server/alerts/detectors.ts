// The alert set itself (#74, epic #13): pure functions over already-
// fetched rows, exactly the split `fiscal/certainty.ts` establishes for
// the calculation engine and `fiscal/forecast.ts` mirrors for the
// database side — `repository.ts` is this module's `forecast.ts`. Every
// function here is hand-verifiable against a fixture built in code, with
// no database in the loop, which is the point: "every alert fires on a
// constructed fixture at the right moment" (#74's acceptance) is a
// property of this file, tested directly in `detectors.test.ts`.

import { daysLate, isOverdue } from '$lib/server/domain/invoice';
import type { EvaluatedCeiling } from '$lib/server/fiscal/ceiling';
import type { InvoicingCadence } from '$lib/server/db/schema/contract';
import type { WorkUnitState } from '$lib/server/db/schema/work-unit';
import {
	AGENT_RUN_STALE_HOURS,
	APPROVAL_UNACTIONED_CRITICAL_DAYS,
	APPROVAL_UNACTIONED_SERIOUS_DAYS,
	APPROVAL_UNACTIONED_WARNING_DAYS,
	BACKUP_STALE_HOURS,
	BILLABLE_PERIOD_CRITICAL_DAYS,
	BILLABLE_PERIOD_SERIOUS_DAYS,
	CEILING_SERIOUS_RATIO,
	CONTRACT_DEADLINE_CRITICAL_DAYS,
	CONTRACT_DEADLINE_SERIOUS_DAYS,
	CONTRACT_DEADLINE_WARNING_DAYS,
	INVOICE_OVERDUE_CRITICAL_DAYS,
	INVOICE_OVERDUE_SERIOUS_DAYS,
	MAILBOX_POLL_STALE_HOURS,
	MIRROR_STALE_HOURS,
	OVERRUN_CRITICAL_RATIO,
	OVERRUN_SERIOUS_RATIO,
	PROPOSAL_PENDING_CRITICAL_DAYS,
	PROPOSAL_PENDING_SERIOUS_DAYS,
	PROPOSAL_PENDING_WARNING_DAYS,
	WORKED_WITHOUT_APPROVAL_CRITICAL_DAYS
} from './thresholds';
import { makeAlert, type Alert, type AlertSeverity } from './types';

function asOfMidnight(asOfDate: string): Date {
	return new Date(`${asOfDate}T00:00:00Z`);
}

/** Calendar days from today (`asOfDate`) until `targetDate` — positive
 * while still in the future, zero on the day itself, negative once past.
 * `daysLate(due, today)` already computes `today - due` at UTC midnight
 * (`domain/invoice.ts`); this is the same figure the other way round. */
function daysUntil(targetDate: string, asOfDate: string): number {
	return -daysLate(targetDate, asOfMidnight(asOfDate));
}

function hoursSince(from: Date, asOf: Date): number {
	return (asOf.getTime() - from.getTime()) / 3_600_000;
}

/** `contract_expiring` and `renewal_window_open` share this scale: how
 * urgent a given number of days until `endsOn` is does not depend on
 * which of the two is asking. Once `daysUntilEnd` goes negative — the end
 * date has passed with nobody updating the contract — it stays `critical`
 * rather than falling silent, per #74's "a condition that stops being
 * true stops alerting" read the other way: this condition has not
 * stopped, nobody has acted on it. */
function severityForDaysUntilEnd(daysUntilEnd: number): AlertSeverity | null {
	if (daysUntilEnd > CONTRACT_DEADLINE_WARNING_DAYS) return null;
	if (daysUntilEnd <= CONTRACT_DEADLINE_CRITICAL_DAYS) return 'critical';
	if (daysUntilEnd <= CONTRACT_DEADLINE_SERIOUS_DAYS) return 'serious';
	return 'warning';
}

/** `approval_unactioned` and `billable_period_closed` share this shape:
 * nothing until `warningAt`, then a three-step climb — parametrised
 * rather than duplicated per caller. */
function severityForDaysElapsed(
	daysElapsed: number,
	warningAt: number,
	seriousAt: number,
	criticalAt: number
): AlertSeverity | null {
	if (daysElapsed < warningAt) return null;
	if (daysElapsed >= criticalAt) return 'critical';
	if (daysElapsed >= seriousAt) return 'serious';
	return 'warning';
}

export interface ContractDeadlineRow {
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly endsOn: string;
	readonly renewalType: 'none' | 'explicit' | 'counterparty_option' | 'tacit';
	readonly renewalNoticeDays: number | null;
}

/** Fires for every active contract with an end date, once that date is
 * within `CONTRACT_DEADLINE_WARNING_DAYS` — regardless of renewal type,
 * including `'none'`: a fixed-term engagement with no renewal clause at
 * all still needs to be seen ending. */
export function detectContractExpiring(
	rows: readonly ContractDeadlineRow[],
	asOfDate: string
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		const daysUntilEnd = daysUntil(row.endsOn, asOfDate);
		const severity = severityForDaysUntilEnd(daysUntilEnd);
		if (severity === null) continue;
		alerts.push(
			makeAlert(row.contractId, severity, {
				type: 'contract_expiring',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				endsOn: row.endsOn,
				daysUntilEnd
			})
		);
	}
	return alerts;
}

/** Fires once a renewal or refusal decision is actually due: from
 * `renewalNoticeDays` before `endsOn` up to `endsOn` itself, for every
 * renewal type except `'none'` (which has no such window — covered by
 * `detectContractExpiring` alone). A row whose `renewalNoticeDays` is
 * null is skipped rather than treated as zero: the database requires it
 * to be set for every non-`'none'` renewal type, so a null here means the
 * row is stale or the invariant was bypassed, neither of which this
 * function should guess its way through. */
export function detectRenewalWindowOpen(
	rows: readonly ContractDeadlineRow[],
	asOfDate: string
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (row.renewalType === 'none' || row.renewalNoticeDays === null) continue;
		const daysUntilEnd = daysUntil(row.endsOn, asOfDate);
		const daysUntilWindowOpens = daysUntilEnd - row.renewalNoticeDays;
		if (daysUntilWindowOpens > 0 || daysUntilEnd < 0) continue;
		const severity = severityForDaysUntilEnd(daysUntilEnd) ?? 'warning';
		alerts.push(
			makeAlert(row.contractId, severity, {
				type: 'renewal_window_open',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				endsOn: row.endsOn,
				renewalType: row.renewalType,
				daysUntilEnd
			})
		);
	}
	return alerts;
}

export interface WorkedWithoutApprovalRow {
	readonly workUnitId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly date: string;
	readonly sinceAt: string;
}

/** Every day currently sitting in `worked_without_approval` — never
 * `warning`: the moment this state is reached the practitioner already
 * has exposure (work done with no written authorisation on file), which
 * #23's database trigger already treats as the one state the product
 * must make unmistakable. It does not stay at one severity forever
 * though (#229): unresolved for `WORKED_WITHOUT_APPROVAL_CRITICAL_DAYS`
 * or longer, it steps up to `critical`. Before this, every occurrence was
 * hardcoded `critical` from the instant it was reached, which reads as
 * "always the worst it can be" but actually meant delivery dedup
 * (`state.ts`'s `covers`, keyed on severity rank) never saw a rank higher
 * than the one already delivered — a risk raised once never fired again,
 * whatever happened to it afterwards. Escalating through
 * `severityForDaysElapsed`, the same mechanism `approval_unactioned`
 * already uses below, is the fix: an unresolved risk earns a strictly
 * higher rank as it ages, which is exactly what clears the dedup and
 * raises it again. */
export function detectWorkedWithoutApproval(
	rows: readonly WorkedWithoutApprovalRow[],
	asOfDate: string
): Alert[] {
	return rows.map((row) => {
		const daysUnresolved = daysLate(row.sinceAt.slice(0, 10), asOfMidnight(asOfDate));
		const severity: AlertSeverity =
			daysUnresolved >= WORKED_WITHOUT_APPROVAL_CRITICAL_DAYS ? 'critical' : 'serious';
		return makeAlert(row.workUnitId, severity, {
			type: 'worked_without_approval',
			workUnitId: row.workUnitId,
			contractId: row.contractId,
			clientId: row.clientId,
			contractTitle: row.contractTitle,
			clientLegalName: row.clientLegalName,
			date: row.date,
			sinceAt: row.sinceAt
		});
	});
}

export interface ApprovalUnactionedRow {
	readonly approvalId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly receivedAt: Date;
}

/** Fires once an approval has sat on file for `APPROVAL_UNACTIONED_
 * WARNING_DAYS` with no `work_unit` pointing back at it — the mirror
 * image of "worked without approval": permission on record, nothing
 * logged yet. A same-day gap is normal (approval for future work usually
 * arrives before the work does), which is exactly why this does not fire
 * immediately. */
export function detectApprovalUnactioned(
	rows: readonly ApprovalUnactionedRow[],
	asOfDate: string
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		const receivedAtDate = row.receivedAt.toISOString().slice(0, 10);
		const daysUnactioned = daysLate(receivedAtDate, asOfMidnight(asOfDate));
		const severity = severityForDaysElapsed(
			daysUnactioned,
			APPROVAL_UNACTIONED_WARNING_DAYS,
			APPROVAL_UNACTIONED_SERIOUS_DAYS,
			APPROVAL_UNACTIONED_CRITICAL_DAYS
		);
		if (severity === null) continue;
		alerts.push(
			makeAlert(row.approvalId, severity, {
				type: 'approval_unactioned',
				approvalId: row.approvalId,
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				receivedAt: row.receivedAt.toISOString(),
				daysUnactioned
			})
		);
	}
	return alerts;
}

export interface ProposalPendingRow {
	readonly proposalId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly createdAt: Date;
}

/** Fires once a proposal has sat `pending` for `PROPOSAL_PENDING_
 * WARNING_DAYS` with nobody deciding it (#229) — invariant 3's "agents
 * propose, humans confirm" is the entire point of the ingestion loop, and
 * a proposal nobody looks at defeats it exactly as much as an approval
 * nobody actions defeats the day it should have unblocked, which is why
 * this reuses `severityForDaysElapsed` at `approval_unactioned`'s own
 * figures rather than inventing a second cadence for what is the same
 * kind of neglect. */
export function detectProposalPending(
	rows: readonly ProposalPendingRow[],
	asOfDate: string
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		const createdAtDate = row.createdAt.toISOString().slice(0, 10);
		const daysPending = daysLate(createdAtDate, asOfMidnight(asOfDate));
		const severity = severityForDaysElapsed(
			daysPending,
			PROPOSAL_PENDING_WARNING_DAYS,
			PROPOSAL_PENDING_SERIOUS_DAYS,
			PROPOSAL_PENDING_CRITICAL_DAYS
		);
		if (severity === null) continue;
		alerts.push(
			makeAlert(row.proposalId, severity, {
				type: 'proposal_pending',
				proposalId: row.proposalId,
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				createdAt: row.createdAt.toISOString(),
				daysPending
			})
		);
	}
	return alerts;
}

export interface InvoiceOverdueRow {
	readonly invoiceId: string;
	readonly invoiceNumber: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly dueDate: string;
	readonly settledOn: string | null;
	readonly total: number;
	readonly currency: string;
}

/** Reuses `domain/invoice.ts`'s `isOverdue`/`daysLate` (#27) rather than
 * re-deriving "late" from `dueDate`/`settledOn` here — the ageing table
 * and this alert must never be able to disagree about which invoice is
 * overdue. Severity bands mirror `routes/invoices/status.ts`'s
 * `ageingStatus` (see `thresholds.ts`). */
export function detectInvoiceOverdue(
	rows: readonly InvoiceOverdueRow[],
	asOfDate: string
): Alert[] {
	const today = asOfMidnight(asOfDate);
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (!isOverdue(row.dueDate, row.settledOn, today)) continue;
		const late = daysLate(row.dueDate, today);
		const severity: AlertSeverity =
			late >= INVOICE_OVERDUE_CRITICAL_DAYS
				? 'critical'
				: late >= INVOICE_OVERDUE_SERIOUS_DAYS
					? 'serious'
					: 'warning';
		alerts.push(
			makeAlert(row.invoiceId, severity, {
				type: 'invoice_overdue',
				invoiceId: row.invoiceId,
				invoiceNumber: row.invoiceNumber,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				dueDate: row.dueDate,
				daysLate: late,
				total: row.total,
				currency: row.currency
			})
		);
	}
	return alerts;
}

function isoDate(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The start of the calendar period `asOfDate` currently falls in, for a
 * periodic invoicing cadence — `null` for `'on_completion'`, which has no
 * period to close. Calendar-aligned (Jan/Apr/Jul/Oct for quarterly,
 * January for annual), not anchored to the contract's own `startsOn`:
 * "monthly invoicing" ordinarily means calendar months regardless of when
 * the engagement began. */
export function currentPeriodStart(cadence: InvoicingCadence, asOfDate: string): string | null {
	if (cadence === 'on_completion') return null;
	const [year, month] = asOfDate.split('-').map(Number);
	if (cadence === 'monthly') return isoDate(year, month, 1);
	if (cadence === 'quarterly') return isoDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
	return isoDate(year, 1, 1);
}

function addDaysIso(dateIso: string, days: number): string {
	const date = new Date(`${dateIso}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export interface BillablePeriodRow {
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly invoicingCadence: InvoicingCadence;
	/** Dates of every `worked`/`disputed` day on this contract not yet on
	 * an invoice line (`listEligibleWorkUnitsForInvoicing`) — non-empty,
	 * the caller (`repository.ts`) has already filtered out contracts with
	 * nothing eligible. */
	readonly eligibleDates: readonly string[];
}

/** Fires when at least one already-recorded, still-unbilled day predates
 * the invoicing period currently open — meaning a whole period boundary
 * has passed with billable work sitting uninvoiced on the other side of
 * it. `'on_completion'` contracts never fire this: there is no period to
 * close, by design (they bill on completion, not on a cadence).
 *
 * Severity scales with the age of the *oldest* unbilled day, not with
 * how long the current period has been open: the current period's start
 * always resets to the top of the calendar month/quarter/year, which
 * would otherwise cap this alert at `warning` forever for a day that has
 * sat unbilled across several period boundaries — exactly the "fires
 * daily forever at the same severity" #74 warns against, just at the
 * wrong end of the scale. */
export function detectBillablePeriodClosed(
	rows: readonly BillablePeriodRow[],
	asOfDate: string
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		const currentStart = currentPeriodStart(row.invoicingCadence, asOfDate);
		if (currentStart === null) continue;
		const eligibleBeforeCurrentPeriod = row.eligibleDates.filter((date) => date < currentStart);
		if (eligibleBeforeCurrentPeriod.length === 0) continue;
		const oldestEligible = eligibleBeforeCurrentPeriod.reduce((min, date) =>
			date < min ? date : min
		);
		const daysSinceOldestEligible = daysLate(oldestEligible, asOfMidnight(asOfDate));
		const severity =
			severityForDaysElapsed(
				daysSinceOldestEligible,
				0,
				BILLABLE_PERIOD_SERIOUS_DAYS,
				BILLABLE_PERIOD_CRITICAL_DAYS
			) ?? 'warning';
		alerts.push(
			makeAlert(row.contractId, severity, {
				type: 'billable_period_closed',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				periodEnd: addDaysIso(currentStart, -1),
				dayCount: eligibleBeforeCurrentPeriod.length
			})
		);
	}
	return alerts;
}

/** `ceiling_approaching`'s severity from the evaluated ceiling alone: not
 * firing at all is `activeAlertLevels` being empty — that gate, and the
 * ratios it fires at, come entirely from the pack or the contract that
 * declared the ceiling, never from this file (invariant 1/2). */
function severityForCeiling(evaluated: EvaluatedCeiling): AlertSeverity | null {
	if (evaluated.activeAlertLevels.length === 0) return null;
	if (evaluated.crossed) return 'critical';
	const deepestRatio = Math.max(...evaluated.activeAlertLevels.map((level) => level.ratio));
	return deepestRatio >= CEILING_SERIOUS_RATIO ? 'serious' : 'warning';
}

/** One alert per ceiling — pack or contract origin, identically, per
 * invariant 2 — currently at or past any of its own configured alert
 * levels. Reads `fiscal/ceiling-status.ts`'s `evaluateActiveCeilings`
 * output directly; nothing here recomputes a ratio or a period. */
export function detectCeilingApproaching(evaluatedCeilings: readonly EvaluatedCeiling[]): Alert[] {
	const alerts: Alert[] = [];
	for (const evaluated of evaluatedCeilings) {
		const severity = severityForCeiling(evaluated);
		if (severity === null) continue;
		alerts.push(
			makeAlert(evaluated.ceiling.id, severity, {
				type: 'ceiling_approaching',
				ceilingId: evaluated.ceiling.id,
				ceilingLabel: evaluated.ceiling.label,
				consequence: evaluated.ceiling.consequence,
				usageRatio: evaluated.usageRatio,
				currentValue: evaluated.currentValue,
				limitValue: evaluated.limitValue
			})
		);
	}
	return alerts;
}

export interface YearEndOverrunInput {
	readonly evaluated: EvaluatedCeiling;
	/** `forecastCommitted`'s figure over the ceiling's own remaining period. */
	readonly committed: number;
	/** `forecastProjected`'s figure over the same window. */
	readonly projected: number;
}

/** Forward-looking, distinct from `ceiling_approaching`: fires when
 * collected-so-far plus everything still committed and projected for the
 * rest of the period would land past the limit, even though the ceiling
 * has not actually been crossed yet (`!evaluated.crossed` — once it has,
 * `ceiling_approaching` already carries the `critical` alert, and this
 * would be a second, redundant one for the same fact). `repository.ts`
 * only builds this input for `all_clients`, cash-basis ceilings:
 * `forecastCommitted`/`forecastProjected` have no per-client perimeter to
 * filter by, and an accrual-basis ceiling already counts an issued-unpaid
 * invoice in `currentValue`, so adding `committed`'s own issued-unpaid
 * figure on top would double it. */
export function detectYearEndOverrunRisk(inputs: readonly YearEndOverrunInput[]): Alert[] {
	const alerts: Alert[] = [];
	for (const { evaluated, committed, projected } of inputs) {
		if (evaluated.crossed || evaluated.limitValue <= 0) continue;
		const projectedTotal = evaluated.currentValue + committed + projected;
		if (projectedTotal <= evaluated.limitValue) continue;
		const overshootRatio = projectedTotal / evaluated.limitValue;
		const severity: AlertSeverity =
			overshootRatio >= OVERRUN_CRITICAL_RATIO
				? 'critical'
				: overshootRatio >= OVERRUN_SERIOUS_RATIO
					? 'serious'
					: 'warning';
		alerts.push(
			makeAlert(evaluated.ceiling.id, severity, {
				type: 'year_end_overrun_risk',
				ceilingId: evaluated.ceiling.id,
				ceilingLabel: evaluated.ceiling.label,
				consequence: evaluated.ceiling.consequence,
				projectedValue: projectedTotal,
				limitValue: evaluated.limitValue,
				periodEnd: evaluated.period.to
			})
		);
	}
	return alerts;
}

export interface BackupRunRow {
	readonly status: 'success' | 'failure';
	readonly detail: string | null;
	readonly createdAt: Date;
}

/** The two-part check `docs/backup.md` specifies for #74: an explicit
 * failure (the latest run, `'failure'` beats any older run's status,
 * `'success'` clears it — "a condition that stops being true stops
 * alerting"), or staleness (no run at all, or nothing in `BACKUP_
 * STALE_HOURS` — the job did not run, which produces no failure row to
 * read, hence the separate check). At most one alert: this is a single
 * global condition, not per-contract or per-client. */
export function detectBackupFailure(latestRun: BackupRunRow | null, asOfDate: Date): Alert[] {
	if (latestRun === null) {
		return [
			makeAlert('global', 'critical', {
				type: 'backup_failure',
				reason: 'never_run',
				detail: null,
				lastRunAt: null
			})
		];
	}
	if (latestRun.status === 'failure') {
		return [
			makeAlert('global', 'critical', {
				type: 'backup_failure',
				reason: 'failure',
				detail: latestRun.detail,
				lastRunAt: latestRun.createdAt.toISOString()
			})
		];
	}
	if (hoursSince(latestRun.createdAt, asOfDate) > BACKUP_STALE_HOURS) {
		return [
			makeAlert('global', 'serious', {
				type: 'backup_failure',
				reason: 'stale',
				detail: null,
				lastRunAt: latestRun.createdAt.toISOString()
			})
		];
	}
	return [];
}

export interface MirrorCandidateRow {
	readonly documentId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly createdAt: Date;
	readonly latestRun: {
		readonly status: 'success' | 'failure';
		readonly detail: string | null;
		readonly createdAt: Date;
	} | null;
}

/** The same two-part check as `detectBackupFailure`, per document rather
 * than global: `repository.ts` only calls this with documents still
 * unmirrored (`remote_file_id IS NULL`), so the condition — and the
 * alert — disappears the instant a publish actually succeeds, with no
 * acknowledgement needed for the ordinary case. `repository.ts` also
 * gates the whole call on a mirror target being configured at all: no
 * mirror configured is a supported "no mirror" configuration (`drive/
 * config.ts`), never a failure to alert on. */
export function detectMirrorFailure(rows: readonly MirrorCandidateRow[], asOfDate: Date): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (row.latestRun !== null && row.latestRun.status === 'failure') {
			alerts.push(
				makeAlert(row.documentId, 'critical', {
					type: 'mirror_failure',
					documentId: row.documentId,
					contractId: row.contractId,
					clientId: row.clientId,
					contractTitle: row.contractTitle,
					clientLegalName: row.clientLegalName,
					reason: 'failure',
					detail: row.latestRun.detail,
					since: row.latestRun.createdAt.toISOString()
				})
			);
			continue;
		}
		if (hoursSince(row.createdAt, asOfDate) > MIRROR_STALE_HOURS) {
			alerts.push(
				makeAlert(row.documentId, 'serious', {
					type: 'mirror_failure',
					documentId: row.documentId,
					contractId: row.contractId,
					clientId: row.clientId,
					contractTitle: row.contractTitle,
					clientLegalName: row.clientLegalName,
					reason: 'stale',
					detail: null,
					since: row.createdAt.toISOString()
				})
			);
		}
	}
	return alerts;
}

export interface MailboxPollRunRow {
	readonly status: 'success' | 'failure';
	readonly detail: string | null;
	readonly createdAt: Date;
}

/** The same two-part check as `detectBackupFailure` (#84 follows that
 * table's own instruction to reuse the pattern), gated first on
 * `pollingConfigured` - true only when the mail account is configured
 * (`repository.ts`'s `fetchLatestMailboxPollRun`) - the same "not
 * configured is never a failure to alert on" gate `detectMirrorFailure`
 * gets from `mirrorConfigured`, so an instance that has not opted into
 * mail ingestion yet never sees a spurious "never run" alert. Attribution
 * of an inbound message to a contract is a separate concern (#394,
 * `sender_address`), not a precondition of the poller running at all. */
export function detectMailboxPollFailure(
	pollingConfigured: boolean,
	latestRun: MailboxPollRunRow | null,
	asOfDate: Date
): Alert[] {
	if (!pollingConfigured) return [];
	if (latestRun === null) {
		return [
			makeAlert('global', 'critical', {
				type: 'mailbox_poll_failure',
				reason: 'never_run',
				detail: null,
				lastRunAt: null
			})
		];
	}
	if (latestRun.status === 'failure') {
		return [
			makeAlert('global', 'critical', {
				type: 'mailbox_poll_failure',
				reason: 'failure',
				detail: latestRun.detail,
				lastRunAt: latestRun.createdAt.toISOString()
			})
		];
	}
	if (hoursSince(latestRun.createdAt, asOfDate) > MAILBOX_POLL_STALE_HOURS) {
		return [
			makeAlert('global', 'serious', {
				type: 'mailbox_poll_failure',
				reason: 'stale',
				detail: null,
				lastRunAt: latestRun.createdAt.toISOString()
			})
		];
	}
	return [];
}

export interface AgentRunRow {
	readonly status: 'success' | 'failure';
	readonly detail: string | null;
	readonly createdAt: Date;
}

/** The same two-part check as `detectBackupFailure` — unconditional, no
 * "configured" gate: unlike mail polling, draining completed jobs and
 * enqueueing new extractions (#85) needs no per-instance setup, so an
 * instance where the scheduler (#222) has simply never called
 * `/api/agent/run` yet is exactly the `never_run` case, not a false
 * positive to suppress. */
export function detectAgentRunFailure(latestRun: AgentRunRow | null, asOfDate: Date): Alert[] {
	if (latestRun === null) {
		return [
			makeAlert('global', 'critical', {
				type: 'agent_run_failure',
				reason: 'never_run',
				detail: null,
				lastRunAt: null
			})
		];
	}
	if (latestRun.status === 'failure') {
		return [
			makeAlert('global', 'critical', {
				type: 'agent_run_failure',
				reason: 'failure',
				detail: latestRun.detail,
				lastRunAt: latestRun.createdAt.toISOString()
			})
		];
	}
	if (hoursSince(latestRun.createdAt, asOfDate) > AGENT_RUN_STALE_HOURS) {
		return [
			makeAlert('global', 'serious', {
				type: 'agent_run_failure',
				reason: 'stale',
				detail: null,
				lastRunAt: latestRun.createdAt.toISOString()
			})
		];
	}
	return [];
}

export interface DayReadingConflictAlertRow {
	readonly conflictId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly contractTitle: string;
	readonly clientLegalName: string;
	readonly date: string;
	/** Null when the newest reading proposes nothing for this date. */
	readonly readingQuantity: number | null;
	readonly recordedWorkUnitId: string | null;
	readonly recordedQuantity: number | null;
	readonly recordedState: WorkUnitState | null;
	readonly pendingProposalId: string | null;
}

/**
 * The mail now says something different from a day the ledger already holds
 * (design doc, "when a reading disagrees with the ledger"). The ledger is not
 * touched — that day was a human decision — so the only honest move is to say
 * so. Self-resolving: the row is compared against the ledger on every run, so
 * correcting the day silences the alert without an acknowledgement.
 *
 * `critical` once the day is `invoiced` or `paid`, because by then the number
 * has left the building; `serious` before that, when correcting it is still
 * free.
 */
export function detectRecordedDayContradicted(
	rows: readonly DayReadingConflictAlertRow[]
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (row.recordedWorkUnitId === null || row.recordedQuantity === null) continue;
		if (row.readingQuantity !== null && row.readingQuantity === row.recordedQuantity) continue;
		const severity =
			row.recordedState === 'invoiced' || row.recordedState === 'paid' ? 'critical' : 'serious';
		alerts.push(
			makeAlert(row.recordedWorkUnitId, severity, {
				type: 'recorded_day_contradicted',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				date: row.date,
				workUnitId: row.recordedWorkUnitId,
				recordedQuantity: row.recordedQuantity,
				readingQuantity: row.readingQuantity
			})
		);
	}
	return alerts;
}

/**
 * A proposal is still waiting and the newest reading of its conversation no
 * longer proposes that day at all — the client cancelled it. Not withdrawn
 * automatically: that would be the agent deciding, which invariant 3 gives to
 * a human. `warning`, because nothing is on the ledger yet.
 */
export function detectPendingProposalUnconfirmed(
	rows: readonly DayReadingConflictAlertRow[]
): Alert[] {
	const alerts: Alert[] = [];
	for (const row of rows) {
		if (row.pendingProposalId === null || row.readingQuantity !== null) continue;
		alerts.push(
			makeAlert(row.pendingProposalId, 'warning', {
				type: 'pending_proposal_unconfirmed',
				contractId: row.contractId,
				clientId: row.clientId,
				contractTitle: row.contractTitle,
				clientLegalName: row.clientLegalName,
				date: row.date,
				proposalId: row.pendingProposalId
			})
		);
	}
	return alerts;
}

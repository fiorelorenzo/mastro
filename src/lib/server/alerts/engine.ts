// The alert engine's one entry point (#74): a plain function, `detectAlerts`,
// that anything can call — a route, a script, a test, the future worker
// process AGENTS.md describes and this repo does not build yet. Nothing
// here is a job, a queue or a scheduled task; see `dispatch.ts` for the
// two functions ("push", "digest") that actually deliver something, and
// `src/routes/api/alerts/run/[job]/+server.ts` for the one thing in this
// PR that lets a cron entry drive them in production.

import { db, type DbExecutor } from '$lib/server/db';
import { mirrorConfigFromEnv } from '$lib/server/drive/config';
import {
	detectApprovalUnactioned,
	detectBackupFailure,
	detectBillablePeriodClosed,
	detectCeilingApproaching,
	detectContractExpiring,
	detectInvoiceOverdue,
	detectMirrorFailure,
	detectRenewalWindowOpen,
	detectWorkedWithoutApproval,
	detectYearEndOverrunRisk
} from './detectors';
import {
	fetchApprovalUnactionedRows,
	fetchContractsForBillablePeriod,
	fetchContractsForDeadlineAlerts,
	fetchEvaluatedCeilings,
	fetchInvoiceOverdueRows,
	fetchLatestBackupRun,
	fetchMirrorFailureRows,
	fetchWorkedWithoutApprovalRows,
	fetchYearEndOverrunInputs
} from './repository';
import { covers, listAcknowledgements, listDeliveries } from './state';
import { SEVERITY_RANK, type Alert } from './types';

/**
 * Every currently active alert, across every type — a fresh query every
 * time, per #74's central design constraint: nothing here depends on a
 * background job having run, and a condition that has stopped being true
 * simply does not appear, with no flag anywhere to clear. `asOfDate` is
 * an explicit ISO date rather than `new Date()` read internally, so a
 * test (or a digest re-run for a specific day) can pin it.
 */
export async function detectAlerts(asOfDate: string, executor: DbExecutor = db): Promise<Alert[]> {
	const asOfInstant = new Date(`${asOfDate}T00:00:00Z`);

	const [
		deadlineRows,
		billableRows,
		workedWithoutApprovalRows,
		approvalRows,
		invoiceRows,
		evaluatedCeilings,
		latestBackupRun,
		mirrorRows
	] = await Promise.all([
		fetchContractsForDeadlineAlerts(executor),
		fetchContractsForBillablePeriod(executor),
		fetchWorkedWithoutApprovalRows(executor),
		fetchApprovalUnactionedRows(executor),
		fetchInvoiceOverdueRows(),
		fetchEvaluatedCeilings(asOfDate, executor),
		fetchLatestBackupRun(executor),
		fetchMirrorFailureRows(mirrorConfigFromEnv() !== null, executor)
	]);

	const yearEndInputs = await fetchYearEndOverrunInputs(evaluatedCeilings, asOfDate, executor);

	return [
		...detectContractExpiring(deadlineRows, asOfDate),
		...detectRenewalWindowOpen(deadlineRows, asOfDate),
		...detectWorkedWithoutApproval(workedWithoutApprovalRows),
		...detectApprovalUnactioned(approvalRows, asOfDate),
		...detectInvoiceOverdue(invoiceRows, asOfDate),
		...detectBillablePeriodClosed(billableRows, asOfDate),
		...detectCeilingApproaching(evaluatedCeilings),
		...detectYearEndOverrunRisk(yearEndInputs),
		...detectBackupFailure(latestBackupRun, asOfInstant),
		...detectMirrorFailure(mirrorRows, asOfInstant)
	];
}

export interface ActiveAlert extends Alert {
	/** Currently suppressed from delivery by an acknowledgement that still
	 * covers this severity — never hidden from this list, per #74's
	 * "acknowledging is not resolving": the dashboard reads this flag to
	 * badge the row, not to filter it out. */
	readonly acknowledged: boolean;
	readonly acknowledgedAt: string | null;
	readonly acknowledgedBy: string | null;
	/** Already sent, at this severity or higher, through push or digest. */
	readonly delivered: boolean;
}

/**
 * Every active alert, annotated with acknowledgement and delivery state —
 * the one query `/alerts` (and any future dashboard widget) reads.
 * Sorted most severe first, so the page never needs its own severity
 * comparator to decide what leads.
 */
export async function listActiveAlerts(
	asOfDate: string,
	executor: DbExecutor = db
): Promise<ActiveAlert[]> {
	const [alerts, acknowledgements, deliveries] = await Promise.all([
		detectAlerts(asOfDate, executor),
		listAcknowledgements(executor),
		listDeliveries(executor)
	]);

	return alerts
		.map((alert) => {
			const ack = acknowledgements.get(alert.key);
			return {
				...alert,
				acknowledged: covers(ack, alert.severity),
				acknowledgedAt: ack ? ack.acknowledgedAt.toISOString() : null,
				acknowledgedBy: ack ? ack.acknowledgedBy : null,
				delivered: covers(deliveries.get(alert.key), alert.severity)
			};
		})
		.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

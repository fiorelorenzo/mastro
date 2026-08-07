// The database side of the alert engine (#74) — fetches exactly the rows
// each pure detector in `detectors.ts` needs, mirroring the split
// `fiscal/forecast.ts` makes for `fiscal/certainty.ts`. Every function
// here either reads an existing, already-tested query surface
// (`listWorkedWithoutApprovalEvents`, `listUnpaidInvoices`,
// `listEligibleWorkUnitsForInvoicing`, `evaluateActiveCeilings`,
// `forecastCommitted`/`forecastProjected`) or is a small, direct query
// this feature is the first to need.

import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	approval,
	backupRun,
	client,
	contract,
	document,
	documentMirrorRun,
	mailboxPollRun,
	workUnit
} from '$lib/server/db/schema';
import { forecastCommitted, forecastProjected } from '$lib/server/fiscal/forecast';
import type { EvaluatedCeiling } from '$lib/server/fiscal/ceiling';
import { evaluateActiveCeilings } from '$lib/server/fiscal/ceiling-status';
import { listUnpaidInvoices } from '$lib/server/repositories/invoice';
import {
	listEligibleWorkUnitsForInvoicing,
	listWorkedWithoutApprovalEvents
} from '$lib/server/repositories/work-unit';
import type {
	ApprovalUnactionedRow,
	BackupRunRow,
	BillablePeriodRow,
	ContractDeadlineRow,
	InvoiceOverdueRow,
	MailboxPollRunRow,
	MirrorCandidateRow,
	WorkedWithoutApprovalRow,
	YearEndOverrunInput
} from './detectors';

/** Every active contract with an end date — the shared feed
 * `detectContractExpiring` and `detectRenewalWindowOpen` both read; a
 * draft has no deadline in force yet, and a terminated/expired one's
 * deadline has already been acted on. */
export async function fetchContractsForDeadlineAlerts(
	executor: DbExecutor = db
): Promise<ContractDeadlineRow[]> {
	const rows = await executor
		.select({
			contractId: contract.id,
			contractTitle: contract.title,
			clientLegalName: client.legalName,
			endsOn: contract.endsOn,
			renewalType: contract.renewalType,
			renewalNoticeDays: contract.renewalNoticeDays
		})
		.from(contract)
		.innerJoin(client, eq(contract.clientId, client.id))
		.where(and(eq(contract.status, 'active'), isNotNull(contract.endsOn)));
	return rows.filter((row): row is typeof row & { endsOn: string } => row.endsOn !== null);
}

/** Every active, periodically-invoiced contract that has at least one
 * already-recorded day still unbilled — the eligibility itself is
 * `listEligibleWorkUnitsForInvoicing` (#26), never recomputed here; this
 * only adds which contracts are worth asking and shapes the result for
 * `detectBillablePeriodClosed`. */
export async function fetchContractsForBillablePeriod(
	executor: DbExecutor = db
): Promise<BillablePeriodRow[]> {
	const contracts = await executor
		.select({
			contractId: contract.id,
			contractTitle: contract.title,
			clientLegalName: client.legalName,
			invoicingCadence: contract.invoicingCadence
		})
		.from(contract)
		.innerJoin(client, eq(contract.clientId, client.id))
		.where(and(eq(contract.status, 'active'), ne(contract.invoicingCadence, 'on_completion')));

	const withEligibility = await Promise.all(
		contracts.map(async (row) => ({
			...row,
			eligibleDates: (await listEligibleWorkUnitsForInvoicing(row.contractId, executor)).map(
				(unit) => unit.date
			)
		}))
	);
	return withEligibility.filter((row) => row.eligibleDates.length > 0);
}

/** Every day currently in `worked_without_approval`, each with the
 * instant it (most recently) entered that state — `listWorkedWithoutApprovalEvents`
 * is #23's own feed for this, unfiltered here so a unit that recovered
 * and somehow re-entered is still keyed off its latest entry. Filtering
 * to the current state, rather than trusting the event feed alone, is
 * what makes a recovered day (`late approval` — #23) stop alerting: the
 * event that put it at risk is still on the log, the row just is not
 * `worked_without_approval` any more. */
export async function fetchWorkedWithoutApprovalRows(
	executor: DbExecutor = db
): Promise<WorkedWithoutApprovalRow[]> {
	const events = await listWorkedWithoutApprovalEvents(undefined, executor);
	if (events.length === 0) return [];

	const sinceByUnit = new Map<string, Date>();
	for (const event of events) sinceByUnit.set(event.workUnitId, event.createdAt);

	const rows = await executor
		.select({
			workUnitId: workUnit.id,
			contractId: contract.id,
			contractTitle: contract.title,
			clientLegalName: client.legalName,
			date: workUnit.date
		})
		.from(workUnit)
		.innerJoin(contract, eq(workUnit.contractId, contract.id))
		.innerJoin(client, eq(contract.clientId, client.id))
		.where(
			and(
				inArray(workUnit.id, [...sinceByUnit.keys()]),
				eq(workUnit.state, 'worked_without_approval')
			)
		);

	return rows.map((row) => ({
		...row,
		sinceAt: sinceByUnit.get(row.workUnitId)!.toISOString()
	}));
}

/** Every approval with no `work_unit` pointing back at it via
 * `approval_id` — the left join's whole purpose: `work_unit.id IS NULL`
 * is "nothing links here yet", true for a brand new approval and for one
 * whose day was later revoked and never relinked, identically. */
export async function fetchApprovalUnactionedRows(
	executor: DbExecutor = db
): Promise<ApprovalUnactionedRow[]> {
	return executor
		.select({
			approvalId: approval.id,
			contractId: contract.id,
			contractTitle: contract.title,
			clientLegalName: client.legalName,
			receivedAt: approval.receivedAt
		})
		.from(approval)
		.innerJoin(contract, eq(approval.contractId, contract.id))
		.innerJoin(client, eq(contract.clientId, client.id))
		.leftJoin(workUnit, eq(workUnit.approvalId, approval.id))
		.where(isNull(workUnit.id));
}

/** Every unpaid invoice, reusing #29's own ageing-table query
 * (`listUnpaidInvoices`) rather than a second one — `detectInvoiceOverdue`
 * decides which of these are actually overdue, this only fetches the
 * candidates. */
export async function fetchInvoiceOverdueRows(): Promise<InvoiceOverdueRow[]> {
	const rows = await listUnpaidInvoices();
	return rows.map((row) => ({
		invoiceId: row.invoice.id,
		invoiceNumber: row.invoice.number,
		contractTitle: row.contractTitle,
		clientLegalName: row.clientLegalName,
		dueDate: row.invoice.dueDate,
		paidOn: row.invoice.paidOn,
		total: row.invoice.total,
		currency: row.invoice.currency
	}));
}

/** Every ceiling in force, evaluated — #36/#37's own query surface
 * (`evaluateActiveCeilings`), read directly by both
 * `detectCeilingApproaching` and (via `fetchYearEndOverrunInputs` below)
 * `detectYearEndOverrunRisk`. */
export async function fetchEvaluatedCeilings(
	asOfDate: string,
	executor: DbExecutor = db
): Promise<EvaluatedCeiling[]> {
	return evaluateActiveCeilings(asOfDate, executor);
}

/** The committed/projected figures `detectYearEndOverrunRisk` adds on top
 * of each ceiling's own `currentValue`, computed over the ceiling's own
 * remaining period (`[period.from, period.to)` — the same window
 * `currentValue` was summed over, so nothing here reads a different slice
 * of the ledger than the ceiling itself did).
 *
 * Scoped to `all_clients`, cash-basis ceilings only: `forecastCommitted`/
 * `forecastProjected` (#38) have no perimeter to filter to one client, and
 * an `invoiced_calendar_year` (accrual) ceiling already counts an
 * issued-unpaid invoice inside `currentValue`, so adding `committed`'s own
 * issued-unpaid figure again would double it. A single-client, percentage-
 * share contract ceiling is still fully covered by `ceiling_approaching`,
 * which reads `currentValue` alone. */
export async function fetchYearEndOverrunInputs(
	evaluatedCeilings: readonly EvaluatedCeiling[],
	asOfDate: string,
	executor: DbExecutor = db
): Promise<YearEndOverrunInput[]> {
	const candidates = evaluatedCeilings.filter(
		(evaluated) =>
			evaluated.ceiling.perimeter.kind === 'all_clients' &&
			evaluated.ceiling.basis !== 'invoiced_calendar_year'
	);
	return Promise.all(
		candidates.map(async (evaluated) => {
			const [committed, projected] = await Promise.all([
				forecastCommitted(asOfDate, evaluated.period.from, evaluated.period.to, executor),
				forecastProjected(asOfDate, evaluated.period.from, evaluated.period.to, executor)
			]);
			return { evaluated, committed: committed.amount, projected: projected.amount };
		})
	);
}

/** The most recent backup attempt, or `null` if none has ever been
 * recorded — `detectBackupFailure`'s only input. */
export async function fetchLatestBackupRun(
	executor: DbExecutor = db
): Promise<BackupRunRow | null> {
	const [row] = await executor
		.select({ status: backupRun.status, detail: backupRun.detail, createdAt: backupRun.createdAt })
		.from(backupRun)
		.orderBy(desc(backupRun.createdAt))
		.limit(1);
	return row ?? null;
}

/** Every document still unmirrored (`remote_file_id IS NULL`), each with
 * its own most recent publish attempt if it has one. `mirrorConfigured`
 * is passed in rather than read here (`engine.ts` resolves it once, via
 * `mirrorConfigFromEnv() !== null`) so this function stays a plain query
 * over its arguments, exercised directly in tests without env
 * gymnastics — `false` is `drive/config.ts`'s own "no mirror configured"
 * support, never a failure to alert on. */
export async function fetchMirrorFailureRows(
	mirrorConfigured: boolean,
	executor: DbExecutor = db
): Promise<MirrorCandidateRow[]> {
	if (!mirrorConfigured) return [];

	const documents = await executor
		.select({
			documentId: document.id,
			createdAt: document.createdAt,
			contractTitle: contract.title,
			clientLegalName: client.legalName
		})
		.from(document)
		.innerJoin(contract, eq(document.contractId, contract.id))
		.innerJoin(client, eq(contract.clientId, client.id))
		.where(isNull(document.remoteFileId));
	if (documents.length === 0) return [];

	const runs = await executor
		.select({
			documentId: documentMirrorRun.documentId,
			status: documentMirrorRun.status,
			detail: documentMirrorRun.detail,
			createdAt: documentMirrorRun.createdAt
		})
		.from(documentMirrorRun)
		.where(
			inArray(
				documentMirrorRun.documentId,
				documents.map((doc) => doc.documentId)
			)
		)
		.orderBy(desc(documentMirrorRun.createdAt));

	const latestByDocument = new Map<string, (typeof runs)[number]>();
	for (const run of runs) {
		if (!latestByDocument.has(run.documentId)) latestByDocument.set(run.documentId, run);
	}

	return documents.map((doc) => ({
		...doc,
		latestRun: latestByDocument.get(doc.documentId) ?? null
	}));
}

/** `mailAccountConfigured` is resolved once by the caller (`engine.ts`,
 * via a safe probe of the mail env vars) the same way `mirrorConfigured`
 * is `mirrorConfigFromEnv() !== null` — an env check has no business
 * inside a DB query function. Combined here with whether any contract
 * actually has a folder mapped (`contract.mail_folder`): polling counts
 * as "configured" only when both an account to connect with and at
 * least one contract to poll for exist — `detectMailboxPollFailure`'s
 * own gate, so an instance that has not opted into mail ingestion at
 * all never sees a spurious "never run" alert. */
export async function fetchLatestMailboxPollRun(
	mailAccountConfigured: boolean,
	executor: DbExecutor = db
): Promise<{ pollingConfigured: boolean; latestRun: MailboxPollRunRow | null }> {
	if (!mailAccountConfigured) return { pollingConfigured: false, latestRun: null };

	const [anyMapped] = await executor
		.select({ id: contract.id })
		.from(contract)
		.where(isNotNull(contract.mailFolder))
		.limit(1);
	if (!anyMapped) return { pollingConfigured: false, latestRun: null };

	const [row] = await executor
		.select({
			status: mailboxPollRun.status,
			detail: mailboxPollRun.detail,
			createdAt: mailboxPollRun.createdAt
		})
		.from(mailboxPollRun)
		.orderBy(desc(mailboxPollRun.createdAt))
		.limit(1);
	return { pollingConfigured: true, latestRun: row ?? null };
}

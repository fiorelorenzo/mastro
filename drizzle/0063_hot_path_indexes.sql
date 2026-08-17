-- Custom SQL migration file, put your code below! --

-- #310: Postgres never creates an index for a foreign key on its own,
-- and a composite index only serves a query whose WHERE clause matches
-- its leading columns — so every index below names the exact query it
-- exists for. If that query is ever removed or reshaped, re-check
-- whether the index still earns its keep before assuming it does.

-- `listPaymentsForInvoice` (`src/lib/server/repositories/invoice.ts:320-329`):
-- `WHERE payment.invoice_id = $1 ORDER BY date, created_at`. Called once
-- per invoice row by `listInvoicesForContract`
-- (`src/lib/server/repositories/invoice.ts:577-588`), so the contract
-- detail page's invoice feed runs it N times for an N-invoice contract.
CREATE INDEX "payment_invoice_id_idx" ON "payment" USING btree ("invoice_id");

-- `listProposals` and `countPendingProposals`
-- (`src/lib/server/repositories/proposal.ts:99-104,114-122`):
-- `WHERE proposal.status = $1`. Every tab of the review queue (pending,
-- accepted, rejected) calls one of these, plus the tab badge's count.
CREATE INDEX "proposal_status_idx" ON "proposal" USING btree ("status");

-- `listProposalsForDocument` (`src/lib/server/repositories/proposal.ts:107-109`):
-- `WHERE proposal.document_id = $1`. Called once per inbound message in
-- the enqueue loop's dedup guard (`src/lib/server/agent/enqueue.ts:30`)
-- and once per sibling search in `approvalForDocument`
-- (`src/lib/server/repositories/proposal.ts:591`).
CREATE INDEX "proposal_document_id_idx" ON "proposal" USING btree ("document_id");

-- `getInboundThreadForDocument`
-- (`src/lib/server/repositories/inbound-thread.ts:47-53`):
-- `WHERE inbound_thread.document_id = $1`. Called from the proposal
-- detail load (`src/routes/proposals/[id]/+page.server.ts:404`) and
-- from `approvalForDocument` (`src/lib/server/repositories/proposal.ts:597`).
CREATE INDEX "inbound_thread_document_id_idx" ON "inbound_thread" USING btree ("document_id");

-- Three call sites share `work_unit.state`, so the index leads with
-- `state` rather than `contract_id`:
--  - `fetchApprovedWorkUnits` (`src/lib/server/fiscal/forecast.ts:38-46`):
--    `WHERE state = 'approved' AND invoice_line_id IS NULL`, no contract
--    in scope — the raw material for every certainty figure
--    (`forecastRevenue`, `forecastCommitted`, `monthlyBuckets`).
--  - `buildRegister` (`src/lib/server/repositories/register.ts:38-59`):
--    `WHERE contract_id = $1 AND date BETWEEN $2 AND $3 AND state IN
--    ('invoiced', 'disputed', 'paid')` — the per-contract day list #70's
--    register renders.
--  - `listEligibleWorkUnitsForInvoicing`
--    (`src/lib/server/repositories/work-unit.ts:309-323`): `WHERE
--    contract_id = $1 AND state IN ('worked', 'disputed') AND
--    invoice_line_id IS NULL` — the day list `/invoices/new` builds
--    lines from.
-- A short `IN` list on the leading column still lets Postgres apply
-- `contract_id` as a second index condition per value, so one
-- `(state, contract_id)` index serves the state-only shape and the
-- state-plus-contract shape both; `(contract_id, state)` would not have
-- served `fetchApprovedWorkUnits`, which never filters on contract_id.
CREATE INDEX "work_unit_state_contract_id_idx" ON "work_unit" USING btree ("state", "contract_id");

-- `listApprovalsForContract` (`src/lib/server/repositories/approval.ts:176-182`):
-- `WHERE approval.contract_id = $1 ORDER BY received_at`. The contract
-- detail page's approval history feed.
CREATE INDEX "approval_contract_id_idx" ON "approval" USING btree ("contract_id");

-- `listExpensesForContract` (`src/lib/server/repositories/expense.ts:24-29`):
-- `WHERE expense.contract_id = $1`, and `listEligibleExpensesForRebilling`
-- (`src/lib/server/repositories/expense.ts:35-47`): `WHERE contract_id =
-- $1 AND reimbursable = true AND invoice_line_id IS NULL` — the rebill
-- picker `/invoices/new` builds expense lines from. #310 names this
-- column `invoice_id`; the actual FK is `invoice_line_id` (`expense` has
-- no `invoice_id` column — it rebills onto `invoice_line`, the same
-- indirection `work_unit` uses). `listExpensesForInvoiceLine`
-- (`src/lib/server/repositories/expense.ts:57-62`), the only reader that
-- filters `invoice_line_id` alone with no `contract_id`, has no caller
-- anywhere in the app yet, so it is left unindexed per #310's "do not
-- add an index for a query that does not exist yet".
CREATE INDEX "expense_contract_id_invoice_line_id_idx" ON "expense" USING btree ("contract_id", "invoice_line_id");

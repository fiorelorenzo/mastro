# Issue #393: mirror queues documents it cannot publish, and hides the failures

## Fix 1: the queue no longer offers what the publisher structurally cannot take

`listUnmirroredDocuments` (`src/lib/server/repositories/document-mirror.ts`) now filters
on `isNotNull(document.contractId)` in addition to `isNull(document.remoteFileId)`.

**Where the filter went and why:** in the queue, not the publisher. `getDocumentMirrorContext`
already requires a contract through its `innerJoin(contract, ...).innerJoin(client, ...)`
because publishing needs a client legal name to build the target folder
(`resolveMirrorFolder`). A document whose `contract_id` is still null is not "unmirrored",
it is "not yet attributable" — `contract_id` was made nullable on purpose (#380) for the
window between a message arriving and someone claiming it. The queue is the honest place
for this filter because a document with no contract is not a candidate to try and fail,
it is not a candidate at all; putting the filter only in the publisher would still let the
queue hand out documents nobody can place, one per doomed lookup.

**Visibility for what got excluded:** `countUnattributedPendingDocuments` (same file)
counts documents that are unmirrored specifically *because* they are unattributed. The
publish route (`src/routes/api/drive/publish/+server.ts`) now returns this as
`unattributed` alongside `published`/`failed`, so a self-hoster whose upload does not show
up in Drive can see why instead of it merely being missing from every count.

I deliberately left `fetchMirrorFailureRows` (`alerts/repository.ts`) untouched: its
`innerJoin(contract, ...)` already achieves the same exclusion, and that is correct
behaviour for that query — an unattributed document has never been offered to the
publisher, so it must never be a `mirror_failure` alert candidate either (that would be
noise about a state the attribution workflow, not the mirror, is responsible for). The
existing `alerts/detectors.test.ts` and `alerts/repository.test.ts` suites still pass
unchanged, confirming no behaviour drift there.

## Fix 2: a publish failure is now recorded even when it throws before `publishDocument`'s own `try`

`publishDocument` (`src/lib/server/drive/publish.ts`) now wraps its entire body —
including `getDocumentMirrorContext` returning `null` and the `document ${id} not found`
throw that follows — inside the single `try/catch` that already recorded `target.publish`
failures. Before this fix that `try` started only around `target.publish`; the
"not found" throw happened earlier and was caught by `publishAllPending`'s outer catch,
which records nothing, so `document_mirror_run` never learned the attempt happened. That
is exactly the hole the issue and its own doc comment on `recordMirrorRun` describe.

The failure detail follows the existing shape unchanged:
`error instanceof Error ? error.message : String(error)`.

## What an all-unattributed run now reports, and what the alert engine makes of it

With Fix 1 in place, a run where every pending document is unattributed sees an empty
batch from `listUnmirroredDocuments`, so `publishAllPending` returns `[]`. The publish
route then reports `{ status: 'ok', published: 0, failed: 0, unattributed: N }` instead
of `{ status: 'partial_failure', published: 0, failed: 407 }` — no code change was needed
in the route's status logic itself, since `failures.length > 0` is naturally false when
nothing was tried. The alert engine's `document_mirror_run`-based `mirror_failure`
detector sees no new failure rows for these documents (there is nothing to alert on: they
were never attempted), and `fetchMirrorFailureRows`'s own join means it never considered
them candidates either, before or after this fix — consistent with the issue's
production finding that this query already returns 0 for the 407 unattributed rows.
Attribution remains visible instead through the new `unattributed` count.

## Tests, RED then GREEN

All new tests were run against the pre-fix code first (by temporarily reverting the
relevant production change) to confirm they fail for the right reason, then against the
fix to confirm they pass.

- `src/lib/server/repositories/document-mirror.test.ts`
  - `listUnmirroredDocuments excludes a document with no contract_id, even though its remote_file_id is null`
    — RED: without the filter, the unattributed document appeared in the batch
    (`pendingIds` contained it). GREEN: filtered out after the fix.
  - `countUnattributedPendingDocuments counts unmirrored documents with no contract_id, not attributed ones`
    — RED: function did not exist. GREEN: counts the unattributed row, and the count drops
    by one after `claimDocumentForContract` attributes it, proving attribution requires no
    manual mirror-side step.
- `src/lib/server/drive/publish.test.ts`
  - `publishDocument records a failure run for an unattributed document called directly, the throw-before-try path`
    — RED: with the original `try` scope, the `document ${id} not found` error propagated
    out of `publishDocument` (it threw, rather than returning `{ ok: false }`), and no
    `document_mirror_run` row was written. GREEN: returns `{ ok: false, detail: '...not found' }`
    and a `failure` row is recorded.
  - `publishAllPending never offers an unattributed document to the publisher, and reports no failures for it`
    — RED: without Fix 1, this document reached `publishDocument`, which threw
    "not found", producing a `{ ok: false }` outcome from `publishAllPending`'s outer
    catch and no run row (`getLatestMirrorRun` returned nothing despite a failure having
    occurred) — the exact silent-failure shape the issue describes. GREEN: `outcomes`
    is `[]`, `remoteFileId` stays null, and no run row is written because the document
    was never offered at all.

Full local run: `npx vitest run src/lib/server/repositories/document-mirror.test.ts
src/lib/server/drive/publish.test.ts src/lib/server/alerts` → 116 passed, 1 skipped
(pre-existing skip, unrelated to this change), 0 failed.

`pnpm check`: 0 errors (62 pre-existing warnings across unrelated Svelte files, not
introduced by this change). `pnpm exec prettier --check` on all five changed files: clean.

## Files changed

- `src/lib/server/repositories/document-mirror.ts` — attribution filter + count helper.
- `src/lib/server/repositories/document-mirror.test.ts` — new tests for both.
- `src/lib/server/drive/publish.ts` — `publishDocument` try/catch widened.
- `src/lib/server/drive/publish.test.ts` — new tests for throw-before-try and
  all-unattributed batch.
- `src/routes/api/drive/publish/+server.ts` — `unattributed` count in the response.

No migration, no i18n message keys, no changes to `google-drive-target.ts`.

## Concerns

- I did not modify `fetchMirrorFailureRows` in `alerts/repository.ts` even though the
  issue's first comment names it as a third place carrying the same assumption. I judged
  its current behaviour (excluding unattributed documents from `mirror_failure`
  candidates) to already be correct rather than a bug to fix, since alerting on a document
  nobody has attributed yet would misattribute a human attribution gap as a mirror defect.
  If the orchestrator or a reviewer disagrees and wants a shared, explicitly named
  predicate exported from `document-mirror.ts` and reused there for documentation
  purposes (not behaviour change), that is a small follow-up.
- The `unattributed` field on the publish route response is new API surface with no
  existing consumer; nothing currently reads it. It exists to satisfy the acceptance
  criterion that an unattributed document must be "visible ... with the reason, not
  merely missing" without inventing a UI surface this issue did not ask for.

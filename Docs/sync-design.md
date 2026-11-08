# Sync design: what exists, and the recommended path to the cloud

Written 2026-10-13 alongside the first sync tool (Liberty → Teabox catch-up). Root
`CLAUDE.md`'s roadmap (Phase 2 backup, Phase 3 cross-store aggregate) is the context;
this note is the "how", and should be updated as those phases land.

## What exists now: Liberty → Teabox reconcile

`Docs/Migrations/liberty-etl/scripts/sync.ts` (`npm run sync`, README §"Catching up
with a live Liberty"). One-way, source-authoritative, idempotent:

- **Full diff by natural key, every run** — no watermark, no change log. Each record
  carries its origin (`Account.legacyId`, `Payout.legacyId`, `LIB-` SKUs, `lib-`
  transaction ids); anything without one is *Teabox-native*.
- **Ownership rule** — the source wins on rows it originated, unless Teabox has changed
  that row itself; then it's a *conflict*, reported and left alone. Teabox-native rows
  are never touched. Nothing is deleted.
- **Derived state is recomputed, not replayed** — balances = source's unpaid ledger +
  native credits − native payouts, so a payout made in both systems surfaces as a
  negative balance instead of silently netting out.
- **Every applied run is a `SyncRun` row** (source, as-of, counts, conflicts) plus a
  report file; dry runs write only the report.

Tested by rolling a scratch copy back a day and planting conflicts (see the 0.2.0
release notes): restores the day exactly; second run is a no-op.

## The cloud question: journal, snapshot, or both?

These solve **different problems**, so the answer is "both, for different jobs" — but
only one of them is a sync mechanism.

| | Whole-DB snapshot to blob ("Save Backup") | Journal / outbox queue |
|---|---|---|
| Solves | Disaster recovery: the shop PC dies | Cross-store visibility (Phase 3) |
| Unit | One 1.5 GB file, versioned | One row per local write, monotonic per-store sequence |
| Restore | Copy the file back. Trivially correct | Replay into an aggregate. Needs care |
| As a sync path | **Poor**: merging whole databases means diffing ~1M rows per upload and resolving conflicts after the fact | **Good**: small, ordered, append-only, and naturally offline-tolerant |

**Recommendation:**

1. **Do the snapshot (Phase 2) first, and keep it out of the sync path.** Use SQLite's
   online backup API (or `VACUUM INTO`) to a timestamped file, then upload it to object
   storage with retention. Add a "Save Backup" button plus a nightly schedule. The
   deliverable is a **tested restore**. It's simple, independent of everything else,
   and it's what saves the shop on a bad day.
2. **For the cloud aggregate (Phase 3), use an outbox journal written in the same
   transaction as each business write.** It has a per-store sequence number (not a
   clock), and a background pusher sends rows whenever it's online. Write it at the
   service layer (intake, checkout, payout, item edit), not by tailing SQLite's WAL.
   The WAL is page-level and gets checkpointed away (root `CLAUDE.md`).
3. **Keep a reconcile pass, this tool's pattern, as the safety net.** Journals drift:
   a bug in one writer, a lost batch, a restore from backup. Periodically diff the
   cloud aggregate against the store by natural key. That's exactly what `sync.ts`
   does today, with the same ownership rule: each store owns its rows, the cloud is
   read-only. A snapshot can feed the diff (reconcile against yesterday's backup in
   the cloud, with no load on the shop PC).

So: snapshot for safety, journal for freshness, reconcile for truth. What carries over
from today's tool as-is: origin markers on every row, the "owner wins / report,
don't overwrite" conflict rule, recompute-don't-replay for derived numbers, and the
`SyncRun` log.

**Don't build:** two-way merge (no store ever writes another store's data, which is
the whole point of the Phase 3 design), CDC off the SQLite file, or "upload the DB and
migrate it into the cloud database" as the steady-state path.

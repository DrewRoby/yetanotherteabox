// Account numbers and item tag numbers, the way Hidden Treasures' staff know them from
// Liberty: an account is its CLIENT.ACCOUNT (e.g. 4545 — not CLIENT_ID), and an item is
// "<ACCOUNT>-<ITEM_NUM>" (ITEM_NUM is numbered per account, CLIENT.NEXT_ITEM_NUM).
// Teabox columns: Account.accountNumber / nextItemNumber, Item.tagAccountNumber /
// accountItemNumber (see server/prisma/schema.prisma).
//
// One idempotent pass, shared by `migrate` (fresh load), `sync` (catch-up) and
// `backfill-tag-numbers` (a database loaded before these columns existed):
// - Liberty accounts take their Liberty number. A Teabox-native account (or the
//   built-in STORE account) keeps its number unless a Liberty account claims it, in
//   which case it moves above the highest number in use — Liberty wins, the same
//   origin rule as the sync's.
// - Migrated (LIB-) items take "<ACCOUNT>-<ITEM_NUM>" of the client that owns them, or —
//   store-owned items — of the one client their ledger credits (the account they were
//   tagged under before becoming the store's). Neither → no tag number (the UI shows
//   the SKU).
// - Teabox-native items keep their tag number (it's printed) unless their account was
//   renumbered and the tag still carries the old number; those, and any that would
//   duplicate another item's, get the account's next number.
// - Account.nextItemNumber = past Liberty's NEXT_ITEM_NUM and every number in use.
import type { LibertyClientRow, LibertyItemRow } from "../extract/liberty";

const CHUNK = 300;
// Same rule as the server's nextAccountNumber (server/src/services/accounts.service.ts):
// new numbers continue the first run with no gap over this, skipping Liberty's reserved
// high numbers (5000, 7000, 800xx store buckets, 999999 "Cash Sales", ...).
const ACCOUNT_NUMBER_GAP = 100;
function nextFreeInFirstRun(taken: Set<number>): number {
  const sorted = [...taken].sort((x, y) => x - y);
  if (!sorted.length) return 1;
  let i = 0;
  while (i + 1 < sorted.length && sorted[i + 1] - sorted[i] <= ACCOUNT_NUMBER_GAP) i++;
  return sorted[i] + 1;
}

type Tag = { a: number | null; n: number | null };
const key = (a: number, n: number) => `${a}-${n}`;

export interface NumberingResult {
  accountsRenumbered: number;
  nativeAccountsMoved: string[]; // "Name: 12 → 4546"
  libItemsUpdated: number;
  libItemsWithoutTag: number;
  nativeItemsRenumbered: number;
  nextItemNumbersUpdated: number;
}

export async function assignLibertyNumbers(
  prisma: any,
  opts: {
    storeId: string;
    clients: Pick<LibertyClientRow, "CLIENT_ID" | "ACCOUNT" | "NEXT_ITEM_NUM">[];
    libItems: Pick<LibertyItemRow, "ITEM_ID" | "ITEM_NUM">[];
    ownerClientIdByItemId: Map<number, number>;
    ledgerClientIdByItemId: Map<number, number>;
    dryRun: boolean;
  }
): Promise<NumberingResult> {
  const { storeId, dryRun } = opts;
  const accountNumberByClient = new Map(opts.clients.map((c) => [c.CLIENT_ID, c.ACCOUNT]));
  const nextItemByAccountNumber = new Map(opts.clients.map((c) => [c.ACCOUNT, c.NEXT_ITEM_NUM ?? 1]));

  // ---- Accounts ----
  const accounts: { id: string; name: string; legacyId: string | null; accountNumber: number | null; nextItemNumber: number }[] =
    (
      await prisma.$queryRawUnsafe(
        `SELECT "id", "name", "legacyId", "accountNumber", "nextItemNumber" FROM "Account" WHERE "storeId" = ? ORDER BY "accountNumber", "createdAt"`,
        storeId
      )
    ).map((a: any) => ({ ...a, accountNumber: a.accountNumber == null ? null : Number(a.accountNumber), nextItemNumber: Number(a.nextItemNumber) }));
  const target = new Map<string, number>();
  for (const a of accounts) {
    const clientId = a.legacyId?.startsWith("liberty:") ? Number(a.legacyId.slice(8)) : null;
    const n = clientId != null ? accountNumberByClient.get(clientId) : undefined;
    if (n != null) target.set(a.id, n);
  }
  const taken = new Set(target.values());
  const nativeAccountsMoved: string[] = [];
  const keeping = accounts.filter((a) => !target.has(a.id) && a.accountNumber != null && !taken.has(a.accountNumber));
  for (const a of keeping) {
    target.set(a.id, a.accountNumber!);
    taken.add(a.accountNumber!);
  }
  for (const a of accounts) {
    if (target.has(a.id)) continue;
    const n = nextFreeInFirstRun(taken);
    target.set(a.id, n);
    taken.add(n);
    if (a.accountNumber != null) nativeAccountsMoved.push(`${a.name}: ${a.accountNumber} → ${n}`);
  }
  const renumbered = accounts.filter((a) => a.accountNumber !== target.get(a.id));
  const oldNumberById = new Map(accounts.map((a) => [a.id, a.accountNumber]));

  // ---- Migrated items ----
  const libTagByItemId = new Map<number, Tag>();
  for (const li of opts.libItems) {
    const clientId = opts.ownerClientIdByItemId.get(li.ITEM_ID) ?? opts.ledgerClientIdByItemId.get(li.ITEM_ID);
    const a = clientId != null ? accountNumberByClient.get(clientId) : undefined;
    libTagByItemId.set(li.ITEM_ID, a != null && li.ITEM_NUM != null ? { a, n: li.ITEM_NUM } : { a: null, n: null });
  }
  const tbItems: { id: string; sku: string; itemNumber: number; accountId: string; a: number | null; n: number | null }[] = (
    await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "itemNumber", "accountId", "tagAccountNumber" AS a, "accountItemNumber" AS n
       FROM "Item" WHERE "storeId" = ? ORDER BY "itemNumber"`,
      storeId
    )
  ).map((i: any) => ({ ...i, itemNumber: Number(i.itemNumber), a: i.a == null ? null : Number(i.a), n: i.n == null ? null : Number(i.n) }));

  const updates: { id: string; a: number | null; n: number | null }[] = [];
  const used = new Set<string>();
  const maxSeq = new Map<number, number>();
  const use = (a: number, n: number) => {
    used.add(key(a, n));
    maxSeq.set(a, Math.max(maxSeq.get(a) ?? 0, n));
  };
  let libItemsWithoutTag = 0;
  const native: typeof tbItems = [];
  for (const i of tbItems) {
    if (!i.sku.startsWith("LIB-")) {
      native.push(i);
      continue;
    }
    const t = libTagByItemId.get(i.itemNumber) ?? { a: null, n: null };
    if (t.a == null) libItemsWithoutTag++;
    else use(t.a, t.n!);
    if (t.a !== i.a || t.n !== i.n) updates.push({ id: i.id, ...t });
  }
  const libItemsUpdated = updates.length;

  // ---- Teabox-native items ----
  const pending: typeof native = [];
  for (const i of native) {
    const accountMoved = oldNumberById.get(i.accountId) !== target.get(i.accountId);
    const stale = i.a == null || (accountMoved && i.a === oldNumberById.get(i.accountId));
    if (stale || used.has(key(i.a!, i.n!))) pending.push(i);
    else use(i.a!, i.n!);
  }
  const nextSeq = (a: number) => Math.max(nextItemByAccountNumber.get(a) ?? 1, (maxSeq.get(a) ?? 0) + 1);
  for (const i of pending) {
    const a = target.get(i.accountId)!;
    const n = nextSeq(a);
    use(a, n);
    updates.push({ id: i.id, a, n });
  }

  // ---- Account.nextItemNumber ----
  const nextUpdates: { id: string; next: number }[] = [];
  for (const acc of accounts) {
    const a = target.get(acc.id)!;
    const keepCurrent = acc.accountNumber === a ? acc.nextItemNumber : 1;
    const next = Math.max(keepCurrent, nextSeq(a));
    if (next !== acc.nextItemNumber) nextUpdates.push({ id: acc.id, next });
  }

  const result: NumberingResult = {
    accountsRenumbered: renumbered.length,
    nativeAccountsMoved,
    libItemsUpdated,
    libItemsWithoutTag,
    nativeItemsRenumbered: pending.length,
    nextItemNumbersUpdated: nextUpdates.length,
  };
  if (dryRun) return result;

  // Accounts: clear first so a swap of numbers can't trip the (storeId, accountNumber) unique index.
  await prisma.$transaction([
    ...renumbered.map((a) => prisma.$executeRawUnsafe(`UPDATE "Account" SET "accountNumber" = NULL WHERE "id" = ?`, a.id)),
    ...renumbered.map((a) =>
      prisma.$executeRawUnsafe(`UPDATE "Account" SET "accountNumber" = ? WHERE "id" = ?`, target.get(a.id), a.id)
    ),
    ...nextUpdates.map((u) => prisma.$executeRawUnsafe(`UPDATE "Account" SET "nextItemNumber" = ? WHERE "id" = ?`, u.next, u.id)),
  ]);

  // Items, through a staging table (a real table — Prisma may use different pooled
  // connections per statement, and TEMP tables are per-connection).
  if (updates.length) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_tag_numbers"`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "_tag_numbers" ("id" TEXT PRIMARY KEY, "a" INTEGER, "n" INTEGER)`);
    const inserts = [];
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      inserts.push(
        prisma.$executeRawUnsafe(
          `INSERT INTO "_tag_numbers" ("id", "a", "n") VALUES ${chunk.map(() => "(?, ?, ?)").join(",")}`,
          ...chunk.flatMap((u) => [u.id, u.a, u.n])
        )
      );
    }
    await prisma.$transaction(inserts);
    await prisma.$executeRawUnsafe(`
      UPDATE "Item" SET
        "tagAccountNumber" = (SELECT t."a" FROM "_tag_numbers" t WHERE t."id" = "Item"."id"),
        "accountItemNumber" = (SELECT t."n" FROM "_tag_numbers" t WHERE t."id" = "Item"."id")
      WHERE "id" IN (SELECT "id" FROM "_tag_numbers")`);
    await prisma.$executeRawUnsafe(`DROP TABLE "_tag_numbers"`);
  }
  return result;
}

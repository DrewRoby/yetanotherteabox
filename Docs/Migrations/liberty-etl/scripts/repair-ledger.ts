// One-off, in-place repair of a database loaded by an earlier `npm run migrate`
// (2026-10-12 — see spec §3.1's CLIENT_TRANS and PAYOUT notes). `migrate.ts` now gets
// all of this right on a fresh load; this script fixes an existing one without
// re-migrating, so anything entered in Teabox since is kept.
//
//   TEABOX_DATABASE_URL="file:<db>" npm run repair-ledger -- [--dry-run]
//
// 1. Account.currentBalance: the first load summed every payable ledger row (lifetime
//    earnings) instead of only rows no payout has settled. New balance =
//    current − lifetime sum + unpaid sum, so credits/payouts made in Teabox since the
//    load carry through untouched. Also stamps Account.legacyId = "liberty:<CLIENT_ID>".
// 2. Payouts: Liberty "N" (not bank-reconciled) payouts are written checks → PAID
//    (paidAt = createdAt); every Liberty payout gets method (CASH/CHECK) + check number.
// 3. Items: per-item split (consignorPercent = 100 − PRICE_CODE.STORE_PCT),
//    donateIfUnsold (DONATE_IND), tagPrintedAt (TAG_PRINTED_TS, only where Teabox has
//    none of its own).
//
// Teabox accounts don't carry their Liberty CLIENT_ID (until this script), so the link
// is rebuilt from what does: item ownership (CLIENT_ITEM ↔ Item.itemNumber) and payouts
// (PAYOUT_ID = Payout.payoutNumber). Accounts that can't be linked that way, or link
// ambiguously, are reported and left alone. Idempotent: a re-run recomputes the same
// values (the lifetime backout only applies to accounts not yet stamped with legacyId).
import "dotenv/config";
import { closePool } from "../extract/db";
import { fetchClientBalances, fetchClientItemLinks, fetchItems, fetchPayouts } from "../extract/liberty";
import { mapPayoutMethod } from "../transform/crosswalks";
import { prisma } from "../load/prisma";

const dryRun = process.argv.includes("--dry-run");
const BALANCE_BEARING = new Set(["CONSIGNOR", "VENDOR", "BOOTH_OWNER"]);
const cents = (v: number) => Math.round(v * 100) / 100;

async function stage(table: string, columns: string[], rows: unknown[][], chunk = 2000) {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${table}" (${columns.map((c, i) => `"${c}"${i === 0 ? " TEXT PRIMARY KEY" : ""}`).join(", ")})`);
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const placeholders = part.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    await prisma.$executeRawUnsafe(`INSERT INTO "${table}" VALUES ${placeholders}`, ...part.flat());
  }
}

async function main() {
  console.log(`Target: ${process.env.TEABOX_DATABASE_URL}${dryRun ? " (dry run)" : ""}`);
  const [balances, clientItems, payouts, libItems] = await Promise.all([
    fetchClientBalances(),
    fetchClientItemLinks(),
    fetchPayouts(),
    fetchItems(),
  ]);

  // ---- Link Liberty clients to Teabox accounts ----
  const tbItems: { itemNumber: number; accountId: string }[] = await prisma.$queryRaw`
    SELECT "itemNumber", "accountId" FROM "Item" WHERE "sku" LIKE 'LIB-%'`;
  const accountByItemNumber = new Map(tbItems.map((i) => [i.itemNumber, i.accountId]));
  const tbPayouts: { payoutNumber: number; accountId: string; status: string }[] = await prisma.$queryRaw`
    SELECT "payoutNumber", "accountId", "status" FROM "Payout"`;
  const accountByPayoutNumber = new Map(tbPayouts.map((p) => [p.payoutNumber, p.accountId]));

  const votes = new Map<number, Map<string, number>>();
  const vote = (clientId: number, accountId: string | undefined) => {
    if (!accountId) return;
    const m = votes.get(clientId) ?? new Map<string, number>();
    m.set(accountId, (m.get(accountId) ?? 0) + 1);
    votes.set(clientId, m);
  };
  for (const ci of clientItems) vote(ci.CLIENT_ID, accountByItemNumber.get(ci.ITEM_ID));
  for (const p of payouts) vote(p.CLIENT_ID, accountByPayoutNumber.get(p.PAYOUT_ID));

  const accountByClient = new Map<number, string>();
  let ambiguousClients = 0;
  for (const [clientId, m] of votes) {
    if (m.size === 1) accountByClient.set(clientId, [...m.keys()][0]);
    else ambiguousClients++;
  }
  // An account claimed by two clients can't be trusted either.
  const claims = new Map<string, number[]>();
  for (const [c, a] of accountByClient) claims.set(a, [...(claims.get(a) ?? []), c]);
  let sharedAccounts = 0;
  for (const [a, cs] of claims) {
    if (cs.length > 1) {
      sharedAccounts++;
      for (const c of cs) accountByClient.delete(c);
    }
  }

  // ---- Balances ----
  const accounts: { id: string; accountType: string; isStoreAccount: boolean; currentBalance: number; legacyId: string | null }[] =
    await prisma.account.findMany({
    select: { id: true, accountType: true, isStoreAccount: true, currentBalance: true, legacyId: true },
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const balanceByClient = new Map(balances.map((b) => [b.CLIENT_ID, b]));
  const balanceRows: unknown[][] = [];
  let before = 0;
  let after = 0;
  let notBackedOut = 0;
  let drift = 0;
  for (const [clientId, accountId] of accountByClient) {
    const acct = accountById.get(accountId)!;
    const legacyId = `liberty:${clientId}`;
    let newBalance = acct.currentBalance;
    if (BALANCE_BEARING.has(acct.accountType) && !acct.isStoreAccount) {
      const b = balanceByClient.get(clientId);
      if (acct.legacyId === legacyId) {
        notBackedOut++; // already repaired
      } else {
        const lifetime = b?.lifetime ?? 0;
        // The first load set exactly `lifetime`; anything else is activity since
        // (Teabox checkout credits / payouts) — or a Liberty restore newer than the load.
        if (Math.abs(acct.currentBalance - lifetime) > 0.005) drift++;
        newBalance = cents(acct.currentBalance - lifetime + (b?.balance ?? 0));
      }
      before += acct.currentBalance;
      after += newBalance;
    }
    balanceRows.push([accountId, newBalance, legacyId]);
  }
  const linked = new Set(accountByClient.values());
  const unlinkedOwed = accounts.filter(
    (a) => BALANCE_BEARING.has(a.accountType) && !a.isStoreAccount && a.currentBalance !== 0 && !linked.has(a.id)
  );

  // ---- Payouts ----
  const statusByNumber = new Map(tbPayouts.map((p) => [p.payoutNumber, p.status]));
  const payoutRows: unknown[][] = [];
  let checksToPaid = 0;
  for (const p of payouts) {
    if (!statusByNumber.has(p.PAYOUT_ID)) continue;
    const method = mapPayoutMethod(p.PAYMENT_ACT_ID);
    const toPaid = p.RECONCILE_STATUS === "N" && statusByNumber.get(p.PAYOUT_ID) === "REQUESTED";
    if (toPaid) checksToPaid++;
    payoutRows.push([String(p.PAYOUT_ID), method, method === "CHECK" ? p.CHECK_NUM?.trim() || null : null, toPaid ? 1 : 0]);
  }

  // ---- Items ----
  const tbItemNumbers = new Set(tbItems.map((i) => i.itemNumber));
  const itemRows: unknown[][] = [];
  for (const i of libItems) {
    if (!tbItemNumbers.has(i.ITEM_ID)) continue;
    itemRows.push([
      String(i.ITEM_ID),
      i.STORE_PCT != null ? 100 - i.STORE_PCT : null,
      i.DONATE_IND != null ? (i.DONATE_IND === 1 ? 1 : 0) : null,
      i.TAG_PRINTED_TS ? i.TAG_PRINTED_TS.getTime() : null,
    ]);
  }

  console.log(
    `Linked ${accountByClient.size} Liberty clients to accounts (${ambiguousClients} ambiguous, ${sharedAccounts} accounts claimed twice — skipped).`
  );
  console.log(
    `Balances (balance-bearing accounts): $${cents(before).toLocaleString()} → $${cents(after).toLocaleString()}` +
      ` (${drift} with activity since the load carried through, ${notBackedOut} already repaired).`
  );
  console.log(
    `Unlinked balance-bearing accounts still holding a balance: ${unlinkedOwed.length}` +
      ` ($${cents(unlinkedOwed.reduce((t, a) => t + a.currentBalance, 0)).toLocaleString()}) — left unchanged:` +
      ` with no Liberty items or payouts nothing was ever paid out, so lifetime = unpaid already.`
  );
  console.log(`Payouts: ${payoutRows.length} get method/check #; ${checksToPaid} unreconciled checks REQUESTED → PAID.`);
  console.log(`Items: ${itemRows.length} get split / donate flag / tag-printed date.`);
  if (dryRun) return;

  await stage("_repair_acct", ["id", "balance", "legacyId"], balanceRows);
  await prisma.$executeRawUnsafe(`
    UPDATE "Account" SET
      "currentBalance" = (SELECT r."balance" FROM "_repair_acct" r WHERE r."id" = "Account"."id"),
      "legacyId" = (SELECT r."legacyId" FROM "_repair_acct" r WHERE r."id" = "Account"."id")
    WHERE "id" IN (SELECT "id" FROM "_repair_acct")`);

  await stage("_repair_payout", ["num", "method", "checkNumber", "toPaid"], payoutRows);
  await prisma.$executeRawUnsafe(`
    UPDATE "Payout" SET
      "method" = (SELECT r."method" FROM "_repair_payout" r WHERE r."num" = CAST("Payout"."payoutNumber" AS TEXT)),
      "checkNumber" = (SELECT r."checkNumber" FROM "_repair_payout" r WHERE r."num" = CAST("Payout"."payoutNumber" AS TEXT))
    WHERE CAST("payoutNumber" AS TEXT) IN (SELECT "num" FROM "_repair_payout")`);
  await prisma.$executeRawUnsafe(`
    UPDATE "Payout" SET "status" = 'PAID', "paidAt" = "createdAt"
    WHERE "status" = 'REQUESTED' AND CAST("payoutNumber" AS TEXT) IN (SELECT "num" FROM "_repair_payout" WHERE "toPaid" = 1)`);

  await stage("_repair_item", ["num", "pct", "donate", "tagAt"], itemRows);
  await prisma.$executeRawUnsafe(`
    UPDATE "Item" SET
      "consignorPercent" = (SELECT r."pct" FROM "_repair_item" r WHERE r."num" = CAST("Item"."itemNumber" AS TEXT)),
      "donateIfUnsold" = (SELECT r."donate" FROM "_repair_item" r WHERE r."num" = CAST("Item"."itemNumber" AS TEXT)),
      "tagPrintedAt" = COALESCE("tagPrintedAt", (SELECT r."tagAt" FROM "_repair_item" r WHERE r."num" = CAST("Item"."itemNumber" AS TEXT)))
    WHERE "sku" LIKE 'LIB-%' AND CAST("itemNumber" AS TEXT) IN (SELECT "num" FROM "_repair_item")`);

  for (const t of ["_repair_acct", "_repair_payout", "_repair_item"]) await prisma.$executeRawUnsafe(`DROP TABLE "${t}"`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closePool();
  });

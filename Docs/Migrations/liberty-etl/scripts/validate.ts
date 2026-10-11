// Checks the migrated scratch DB against the invariants in
// ../../sql_server_data_model_migration_spec.md §5. Run after every load, not just
// once, per the spec's own recommendation.
import "dotenv/config";
import { prisma } from "../load/prisma";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  OK   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const store = await prisma.store.findFirstOrThrow();

  // 1. Exactly one STORE-type Account per Store.
  const storeAccounts = await prisma.account.count({ where: { storeId: store.id, accountType: "STORE" } });
  check("exactly one STORE account", storeAccounts === 1, `found ${storeAccounts}`);

  // 2. Every Item.accountId resolves to an Account with the same storeId.
  const orphanItems = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*) as n FROM Item i
    LEFT JOIN Account a ON i.accountId = a.id AND a.storeId = i.storeId
    WHERE a.id IS NULL;
  `;
  check("every Item.accountId matches storeId", Number(orphanItems[0].n) === 0, `${orphanItems[0].n} orphaned`);

  // 4. DONOR/STORE accounts have currentBalance = 0 and no Payout rows.
  const badBalance = await prisma.account.count({
    where: { accountType: { in: ["DONOR", "STORE"] }, currentBalance: { not: 0 } },
  });
  check("DONOR/STORE accounts have currentBalance = 0", badBalance === 0, `${badBalance} violating`);
  const flaggedWithBalance = await prisma.account.count({ where: { isStoreAccount: true, currentBalance: { not: 0 } } });
  check("isStoreAccount accounts have currentBalance = 0", flaggedWithBalance === 0, `${flaggedWithBalance} violating`);
  const donorStorePayouts = await prisma.payout.count({
    where: { account: { accountType: { in: ["DONOR", "STORE"] } } },
  });
  check("no Payout rows against DONOR/STORE accounts", donorStorePayouts === 0, `${donorStorePayouts} found`);

  // 6. No duplicate sku (DB UNIQUE would have already rejected this at load time —
  // this just confirms the count matches, i.e. nothing silently deduped/failed).
  const itemCount = await prisma.item.count();
  const distinctSkus = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT sku) as n FROM Item;`;
  check("no duplicate sku", Number(distinctSkus[0].n) === itemCount, `${itemCount} items, ${distinctSkus[0].n} distinct skus`);
  // ...and every SKU encodes its own itemNumber — Teabox pads to 6 digits, migrated
  // Liberty SKUs don't ("LIB-81519"):
  // new intakes number from max(itemNumber) + 1, so this is what keeps a future SKU
  // from colliding with a migrated one.
  const mismatched = await prisma.$queryRaw<{ n: bigint | number }[]>`
    SELECT COUNT(*) AS n FROM Item
    WHERE sku NOT LIKE ('%-' || printf('%06d', itemNumber)) AND sku NOT LIKE ('%-' || itemNumber);`;
  check("every SKU encodes its itemNumber", Number(mismatched[0].n) === 0, `${Number(mismatched[0].n)} mismatched`);
  const numbering = await prisma.$queryRaw<{ itemPrefix: string; itemStartNumber: number; maxItemNumber: number }[]>`
    SELECT s.itemPrefix, s.itemStartNumber, MAX(i.itemNumber) AS maxItemNumber
    FROM Store s LEFT JOIN Item i ON i.storeId = s.id GROUP BY s.id;`;
  for (const s of numbering) {
    const next = Math.max(Number(s.maxItemNumber ?? 0) + 1, Number(s.itemStartNumber));
    console.log(`  Next new item: ${s.itemPrefix}-${String(next).padStart(6, "0")}`);
  }

  // Itemized payouts: lines sum to the payout amount. Compared by magnitude because
  // transformPayout stores |PAYOUT_AMT| while lines keep Liberty's signs (236 Liberty
  // payouts are negative reversals).
  const lineSumMismatches = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*) AS n FROM Payout p
    JOIN (SELECT payoutId, SUM(amount) AS s FROM PayoutLine GROUP BY payoutId) l ON l.payoutId = p.id
    WHERE ABS(ABS(l.s) - p.amount) > 0.005;`;
  const itemizedPayouts = await prisma.payout.count({ where: { lines: { some: {} } } });
  const payoutCount = await prisma.payout.count();
  check(
    "itemized payouts' lines sum to the payout amount",
    Number(lineSumMismatches[0].n) === 0,
    `${Number(lineSumMismatches[0].n)} mismatched; ${itemizedPayouts} of ${payoutCount} payouts itemized`
  );
  const soldWithoutLastSale = await prisma.account.count({
    where: { lastSaleAt: null, items: { some: { sales: { some: {} } } } },
  });
  check("every account with a sale has lastSaleAt", soldWithoutLastSale === 0, `${soldWithoutLastSale} missing`);

  // 8. Item.status defaults — never silently AVAILABLE for ambiguous source states.
  // (Enforced in transform/crosswalks.ts's mapItemStatus; this just reports the
  // resulting distribution for a human sanity check.)
  const statusCounts = await prisma.item.groupBy({ by: ["status"], _count: true });
  console.log("  Item.status distribution:", statusCounts.map((s: any) => `${s.status}=${s._count}`).join(", "));

  // 9. splitPercent direction sanity — report the distribution rather than assert;
  // a shop-owner spot-check against real payout history is the real check (spec §5.9).
  const splitCounts = await prisma.account.groupBy({
    by: ["splitPercent"],
    _count: true,
    where: { accountType: { in: ["CONSIGNOR", "VENDOR"] } },
    orderBy: { _count: { splitPercent: "desc" } },
    take: 10,
  });
  console.log(
    "  Account.splitPercent distribution (consignor's share, top 10):",
    splitCounts.map((s: any) => `${s.splitPercent}%=${s._count}`).join(", ")
  );

  const balanceStats = await prisma.account.aggregate({
    where: { accountType: { in: ["CONSIGNOR", "VENDOR"] }, isStoreAccount: false },
    _sum: { currentBalance: true },
    _count: true,
  });
  console.log(
    `  ${balanceStats._count} balance-bearing accounts, total currentBalance = $${balanceStats._sum.currentBalance?.toFixed(2)}`
  );

  console.log(failures === 0 ? "\nAll invariant checks passed." : `\n${failures} invariant check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

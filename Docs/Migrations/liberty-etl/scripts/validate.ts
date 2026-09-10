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
  const donorStorePayouts = await prisma.payout.count({
    where: { account: { accountType: { in: ["DONOR", "STORE"] } } },
  });
  check("no Payout rows against DONOR/STORE accounts", donorStorePayouts === 0, `${donorStorePayouts} found`);

  // 6. No duplicate sku (DB UNIQUE would have already rejected this at load time —
  // this just confirms the count matches, i.e. nothing silently deduped/failed).
  const itemCount = await prisma.item.count();
  const distinctSkus = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT sku) as n FROM Item;`;
  check("no duplicate sku", Number(distinctSkus[0].n) === itemCount, `${itemCount} items, ${distinctSkus[0].n} distinct skus`);

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
    where: { accountType: { in: ["CONSIGNOR", "VENDOR"] } },
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

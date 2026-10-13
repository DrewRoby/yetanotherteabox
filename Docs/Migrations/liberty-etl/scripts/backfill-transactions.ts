// One-off, in-place: stamps Sale.transactionId ("lib-<SALE_HDR.SALE_ID>") on sales that
// an earlier `npm run migrate` loaded before that column existed, so Reports can count
// tickets instead of lines. Safe to re-run — only touches migrated (LIB-) sales whose
// transactionId is still null. `migrate.ts` sets it directly for any fresh load.
//
//   TEABOX_DATABASE_URL="file:<db>" npm run backfill-transactions -- [--dry-run]
//
// Teabox kept no Liberty sale id, so each Sale is matched to its SALE_DETAIL by the
// item (a LIB- item's itemNumber is Liberty's ITEM_ID) plus the sale timestamp; an item
// with exactly one sale on each side matches on the item alone.
import "dotenv/config";
import { closePool } from "../extract/db";
import { fetchInventorySaleDetails } from "../extract/liberty";
import { prisma } from "../load/prisma";

const dryRun = process.argv.includes("--dry-run");
const CHUNK = 500;

async function main() {
  console.log(`Target: ${process.env.TEABOX_DATABASE_URL}${dryRun ? " (dry run)" : ""}`);
  const details = await fetchInventorySaleDetails();
  const byItemAndTs = new Map<string, number>();
  const byItem = new Map<number, number[]>();
  for (const d of details) {
    byItemAndTs.set(`${d.ITEM_ID}|${d.SALE_TS.getTime()}`, d.SALE_ID);
    byItem.set(d.ITEM_ID, [...(byItem.get(d.ITEM_ID) ?? []), d.SALE_ID]);
  }

  const sales = await prisma.$queryRaw<{ id: string; itemNumber: number; saleDate: bigint | number }[]>`
    SELECT s."id", i."itemNumber", s."saleDate" FROM "Sale" s JOIN "Item" i ON i."id" = s."itemId"
    WHERE i."sku" LIKE 'LIB-%' AND s."transactionId" IS NULL`;
  const salesPerItem = new Map<number, number>();
  for (const s of sales) salesPerItem.set(s.itemNumber, (salesPerItem.get(s.itemNumber) ?? 0) + 1);

  const updates: { id: string; tx: string }[] = [];
  let byTimestamp = 0;
  let byItemOnly = 0;
  for (const s of sales) {
    let saleId = byItemAndTs.get(`${s.itemNumber}|${Number(s.saleDate)}`);
    if (saleId != null) byTimestamp++;
    else {
      const candidates = byItem.get(s.itemNumber);
      if (candidates?.length === 1 && salesPerItem.get(s.itemNumber) === 1) {
        saleId = candidates[0];
        byItemOnly++;
      }
    }
    if (saleId != null) updates.push({ id: s.id, tx: `lib-${saleId}` });
  }
  const tickets = new Set(updates.map((u) => u.tx)).size;
  console.log(
    `${details.length} Liberty sale lines; ${sales.length} migrated sales without a ticket; ` +
      `matched ${updates.length} (${byTimestamp} by item+time, ${byItemOnly} by item only) into ${tickets} tickets; ` +
      `${sales.length - updates.length} unmatched (stay null — counted as one ticket each).`
  );
  if (dryRun || updates.length === 0) return;

  // A real (not TEMP) staging table: Prisma may run statements on different pooled
  // connections, and a temp table is per-connection.
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_tx_backfill"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "_tx_backfill" ("id" TEXT PRIMARY KEY, "tx" TEXT NOT NULL)`);
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const values = chunk.map(() => "(?, ?)").join(",");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_tx_backfill" ("id", "tx") VALUES ${values}`,
      ...chunk.flatMap((u) => [u.id, u.tx])
    );
  }
  const changed = await prisma.$executeRawUnsafe(`
    UPDATE "Sale" SET "transactionId" = (SELECT b."tx" FROM "_tx_backfill" b WHERE b."id" = "Sale"."id")
    WHERE "id" IN (SELECT "id" FROM "_tx_backfill")`);
  await prisma.$executeRawUnsafe(`DROP TABLE "_tx_backfill"`);
  console.log(`Updated ${changed} Sale rows.`);
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

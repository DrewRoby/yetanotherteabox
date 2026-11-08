// In place, idempotent: gives a Teabox database migrated before 2026-11-07 Liberty's
// account numbers (CLIENT.ACCOUNT) and item tag numbers ("<ACCOUNT>-<ITEM_NUM>") — see
// load/numbers.ts for the rules. `migrate` and `sync` run the same pass themselves, so
// this is only needed once per older database (safe to re-run).
//
//   TEABOX_DATABASE_URL="file:<db>" npm run backfill-tag-numbers -- [--dry-run]
//
// Run `npx prisma migrate deploy` (server/) against the database first, so the columns exist.
import "dotenv/config";
import { closePool } from "../extract/db";
import {
  fetchClientItemLinks,
  fetchItems,
  fetchLedgerClientOfStoreItems,
  fetchOrdinaryClients,
} from "../extract/liberty";
import { assignLibertyNumbers } from "../load/numbers";
import { prisma } from "../load/prisma";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`Target: ${process.env.TEABOX_DATABASE_URL}${dryRun ? " (dry run)" : ""}`);
  const [clients, items, links, ledger] = await Promise.all([
    fetchOrdinaryClients(),
    fetchItems(),
    fetchClientItemLinks(),
    fetchLedgerClientOfStoreItems(),
  ]);
  console.log(`Liberty: ${clients.length} clients, ${items.length} items, ${ledger.length} store-owned items traced through the ledger.`);
  const store = await prisma.store.findFirstOrThrow();
  const t0 = Date.now();
  const result = await assignLibertyNumbers(prisma, {
    storeId: store.id,
    clients,
    libItems: items,
    ownerClientIdByItemId: new Map(links.map((l) => [l.ITEM_ID, l.CLIENT_ID])),
    ledgerClientIdByItemId: new Map(ledger.map((l) => [l.ITEM_ID, l.CLIENT_ID])),
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(`${dryRun ? "Would have taken" : "Took"} ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
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

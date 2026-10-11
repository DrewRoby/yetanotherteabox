// Test migration: Liberty (Hidden Treasures) -> a scratch Teabox SQLite DB.
//
// Scope (per the migration plan, confirmed with the user 2026-09-07): full
// historical archive. Liberty's CLIENT_TYPE_ID=3 ("Store Account") rows come in as
// accounts flagged isStoreAccount (decided 2026-10-11, see
// ../reports/client_type_3_review.md). Excludes only CLIENT_ID 101508 (corrupted ~$2B
// ledger balance, see the spec §3.1) and its items/sales/payouts.
//
// Usage: npm run migrate   (reads .env; the scratch DB must already have migrations
// applied — see README.md)
import "dotenv/config";
import * as crypto from "crypto";
import { loadStoreConfig } from "../config/loadStoreConfig";
import {
  fetchStore,
  fetchOrdinaryClients,
  fetchPrimaryAddresses,
  fetchPrimaryPhones,
  fetchPrimaryEmails,
  fetchPriceCodeStorePct,
  fetchPaymentActs,
  fetchClientBalances,
  fetchClientItemLinks,
  fetchCategoryList,
  fetchCategories,
  fetchBrandSizeAttrs,
  fetchItems,
  fetchItemStatuses,
  fetchInventorySaleDetails,
  fetchPrimarySalePaymentTypes,
  fetchPayouts,
  fetchPayoutLines,
} from "../extract/liberty";
import { closePool } from "../extract/db";
import { transformClientToAccount, AccountLookups } from "../transform/account";
import { transformItem, ItemLookups } from "../transform/item";
import { transformSaleDetail } from "../transform/sale";
import { transformPayout, transformPayoutLine } from "../transform/payout";
import { prisma } from "../load/prisma";
import { createManyChunked } from "../load/batch";
import { applyUsersAndRoles } from "../load/users";

// The next "round" number strictly above n, rounding up at the leading digit:
// 13059 -> 20000, 1162674 -> 2000000, 999 -> 1000. Used for items.startNumber: auto,
// so the first Teabox tag number is visibly past anything the old system issued.
function nextRoundNumberAbove(n: number): number {
  if (n < 1) return 1;
  const unit = 10 ** Math.floor(Math.log10(n));
  return (Math.floor(n / unit) + 1) * unit;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}


async function main() {
  const t0 = Date.now();

  const config = loadStoreConfig();

  const existingStore = await prisma.store.findFirst();
  if (existingStore) {
    throw new Error(
      `Target DB already has a Store ("${existingStore.name}") — this script is not idempotent by design ` +
        `(re-running would duplicate data). Delete scratch-teabox.db and re-run 'prisma migrate deploy' ` +
        `against it (see README.md) before migrating again.`
    );
  }

  console.log("Fetching Liberty source data...");
  const [
    libertyStore,
    clients,
    addresses,
    phones,
    emails,
    priceCodes,
    paymentActs,
    balances,
    clientItemLinks,
    categoryList,
    categories,
    brandSizeAttrs,
    items,
    itemStatuses,
    saleDetails,
    salePaymentTypes,
    payouts,
    payoutLines,
  ] = await Promise.all([
    fetchStore(),
    fetchOrdinaryClients(),
    fetchPrimaryAddresses(),
    fetchPrimaryPhones(),
    fetchPrimaryEmails(),
    fetchPriceCodeStorePct(),
    fetchPaymentActs(),
    fetchClientBalances(),
    fetchClientItemLinks(),
    fetchCategoryList(),
    fetchCategories(),
    fetchBrandSizeAttrs(),
    fetchItems(),
    fetchItemStatuses(),
    fetchInventorySaleDetails(),
    fetchPrimarySalePaymentTypes(),
    fetchPayouts(),
    fetchPayoutLines(),
  ]);
  await closePool();
  console.log(
    `Fetched: ${clients.length} clients, ${items.length} items, ${saleDetails.length} sale lines, ${payouts.length} payouts, ` +
      `${payoutLines.length} payout lines.`
  );

  // ---- Store + STORE account ----
  // Identity comes from config/store.yaml (the owner's own account of the shop's
  // name/address), not Liberty's own STORE table free text — kept only as a fallback.
  const storeId = newId("store");
  const storeAccountId = newId("acct");
  const libertyStoreAddress = [libertyStore.ADDRESS_1, [libertyStore.CITY, libertyStore.STATE].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");

  const maxLibertyItemId = items.reduce((max, i) => Math.max(max, i.ITEM_ID), 0);
  const itemStartNumber =
    config.items.startNumber === "auto" ? nextRoundNumberAbove(maxLibertyItemId) : config.items.startNumber;
  await prisma.store.create({
    data: {
      id: storeId,
      name: config.store.name || libertyStore.STORE_NAME?.trim() || "Hidden Treasures",
      location: config.store.location || libertyStoreAddress || null,
      ...(config.items.prefix ? { itemPrefix: config.items.prefix } : {}),
      ...(itemStartNumber ? { itemStartNumber } : {}),
    },
  });
  if (config.items.prefix || itemStartNumber) {
    console.log(
      `New items will be tagged ${config.items.prefix ?? "(default prefix)"}-${itemStartNumber ?? "(default start)"} onward ` +
        `(highest Liberty ITEM_ID: ${maxLibertyItemId}).`
    );
  }
  await prisma.account.create({
    data: { id: storeAccountId, storeId, accountType: "STORE", name: "Store-Owned Inventory" },
  });
  console.log(`Created Store + STORE account.`);

  // ---- Accounts (ordinary clients only — see file header) ----
  const accountLookups: AccountLookups = {
    addressByClientId: new Map(addresses.map((a) => [a.CLIENT_ID, a])),
    phoneByClientId: new Map(phones.map((p) => [p.CLIENT_ID, p.PHONE_NUMBER])),
    emailByClientId: new Map(emails.map((e) => [e.CLIENT_ID, e.EMAIL_ADDR])),
    storePctByPriceCodeId: new Map(priceCodes.map((p) => [p.PRICE_CODE_ID, p.STORE_PCT])),
    paymentActNameById: new Map(paymentActs.map((p) => [p.PAYMENT_ACT_ID, p.BANK_NAME])),
    balanceByClientId: new Map(balances.map((b) => [b.CLIENT_ID, b.balance])),
  };

  const accountIdByClientId = new Map<number, string>();
  const accountRows = clients.map((client) => {
    const t = transformClientToAccount(client, accountLookups);
    const id = newId("acct");
    accountIdByClientId.set(client.CLIENT_ID, id);
    return {
      id,
      storeId,
      accountType: t.accountType,
      isStoreAccount: t.isStoreAccount,
      name: t.name,
      phone: t.phone,
      email: t.email,
      mailingAddress: t.mailingAddress,
      paymentMethod: t.paymentMethod,
      splitPercent: t.splitPercent,
      currentBalance: t.currentBalance,
      ...(t.createdAt ? { createdAt: t.createdAt } : {}),
    };
  });
  await createManyChunked((data) => prisma.account.createMany({ data }), accountRows, 1000, "accounts");
  console.log(`Created ${accountRows.length} Account rows.`);

  // ---- Items ----
  const itemLookups: ItemLookups = {
    itemStatusDescById: new Map(itemStatuses.map((s) => [s.STATUS_ID, s.STATUS_DESC])),
    categoryByCategoryListId: new Map(
      categoryList.map((c) => [c.CATEGORY_LIST_ID, { category: c.CAT_L1_NAME, subcategory: c.CAT_L3_NAME }])
    ),
    categoryNameById: new Map(categories.map((c) => [c.CATEGORY_ID, c.CATEGORY_NAME])),
    brandByItemId: new Map(brandSizeAttrs.filter((a) => a.ATTR_TYPE_DESC.includes("Brand") && a.ATTR_TYPE_VALUE).map((a) => [a.ITEM_ID, a.ATTR_TYPE_VALUE!])),
    sizeByItemId: new Map(brandSizeAttrs.filter((a) => a.ATTR_TYPE_DESC.includes("Size") && a.ATTR_TYPE_VALUE).map((a) => [a.ITEM_ID, a.ATTR_TYPE_VALUE!])),
    ownerClientIdByItemId: new Map(clientItemLinks.map((l) => [l.ITEM_ID, l.CLIENT_ID])),
  };

  const itemIdByLibertyItemId = new Map<number, string>();
  const itemRows: any[] = [];
  let skippedForExcludedOwner = 0;

  for (const item of items) {
    const t = transformItem(item, itemLookups);
    let accountId: string;
    if (t.ownerClientId == null) {
      accountId = storeAccountId;
    } else {
      const mapped = accountIdByClientId.get(t.ownerClientId);
      if (!mapped) {
        // Owned by the excluded corrupted-ledger account (CLIENT_ID 101508) — skip.
        skippedForExcludedOwner++;
        continue;
      }
      accountId = mapped;
    }
    const id = newId("item");
    itemIdByLibertyItemId.set(t.libertyItemId, id);
    itemRows.push({
      id,
      sku: t.sku,
      // Liberty's own ITEM_ID — the number already in the migrated "LIB-" SKU. Teabox
      // numbers new items one past the store's highest itemNumber (never below
      // Store.itemStartNumber), and every SKU encodes its own number, so keeping the
      // two equal is what guarantees a new SKU can never collide with a migrated one.
      itemNumber: t.libertyItemId,
      description: t.description,
      category: t.category,
      subcategory: t.subcategory,
      brand: t.brand,
      size: t.size,
      condition: t.condition,
      consignmentType: t.consignmentType,
      status: t.status,
      intakeDate: t.intakeDate,
      price: t.price,
      cost: t.cost,
      accountId,
      storeId,
    });
  }
  await createManyChunked((data) => prisma.item.createMany({ data }), itemRows, 2000, "items");
  console.log(`Created ${itemRows.length} Item rows (${skippedForExcludedOwner} skipped — owned by an excluded account).`);

  // ---- Sales ----
  const paymentTypeIdBySaleId = new Map(salePaymentTypes.map((p) => [p.SALE_ID, p.PAYMENT_TYPE_ID]));
  const saleRows: any[] = [];
  const salesByLibertyItemId = new Map<number, { id: string; saleDate: Date }[]>();
  let skippedSalesForUnmigratedItem = 0;
  for (const detail of saleDetails) {
    const itemId = itemIdByLibertyItemId.get(detail.ITEM_ID);
    if (!itemId) {
      skippedSalesForUnmigratedItem++;
      continue;
    }
    const t = transformSaleDetail(detail, paymentTypeIdBySaleId);
    const saleId = newId("sale");
    saleRows.push({
      id: saleId,
      itemId,
      salePrice: t.salePrice,
      saleDate: t.saleDate,
      paymentType: t.paymentType,
      storeId,
    });
    const forItem = salesByLibertyItemId.get(detail.ITEM_ID) ?? [];
    forItem.push({ id: saleId, saleDate: t.saleDate });
    salesByLibertyItemId.set(detail.ITEM_ID, forItem);
  }
  await createManyChunked((data) => prisma.sale.createMany({ data }), saleRows, 2000, "sales");
  console.log(`Created ${saleRows.length} Sale rows (${skippedSalesForUnmigratedItem} skipped — item not in this batch).`);

  // Account.lastSaleAt — same backfill SQL as the 20261010221750 schema migration.
  await prisma.$executeRawUnsafe(`
    UPDATE "Account" SET "lastSaleAt" = (
      SELECT MAX(s."saleDate") FROM "Item" i JOIN "Sale" s ON s."itemId" = i."id" WHERE i."accountId" = "Account"."id"
    );`);
  console.log("Stamped Account.lastSaleAt.");

  // ---- Payouts ----
  const payoutRows: any[] = [];
  const payoutIdByLibertyPayoutId = new Map<number, string>();
  let skippedPayoutsForExcludedOwner = 0;
  // A SALE line names an item, not a sale; an item sold more than once (sold,
  // returned, resold) gets the sale closest in time to Liberty's credit transaction.
  const nearestSaleId = (libertyItemId: number, transTs: Date | null): string | null => {
    const sales = salesByLibertyItemId.get(libertyItemId);
    if (!sales?.length) return null;
    if (sales.length === 1 || !transTs) return sales[0].id;
    const ts = transTs.getTime();
    return sales.reduce((best, s) =>
      Math.abs(s.saleDate.getTime() - ts) < Math.abs(best.saleDate.getTime() - ts) ? s : best
    ).id;
  };
  for (const payout of payouts) {
    const accountId = accountIdByClientId.get(payout.CLIENT_ID);
    if (!accountId) {
      skippedPayoutsForExcludedOwner++;
      continue;
    }
    const t = transformPayout(payout);
    const payoutId = newId("payout");
    payoutIdByLibertyPayoutId.set(payout.PAYOUT_ID, payoutId);
    payoutRows.push({
      id: payoutId,
      // Liberty's own payout number — what the shop's old check-detail reports and
      // records reference. New Teabox payouts continue from the highest one.
      payoutNumber: payout.PAYOUT_ID,
      accountId,
      amount: t.amount,
      status: t.status,
      createdAt: t.createdAt,
      paidAt: t.paidAt,
    });
  }
  await createManyChunked((data) => prisma.payout.createMany({ data }), payoutRows, 2000, "payouts");
  console.log(`Created ${payoutRows.length} Payout rows (${skippedPayoutsForExcludedOwner} skipped — excluded owner).`);

  // ---- PayoutLines (Liberty's per-check itemization, CLIENT_TRANS.PAYOUT_ID) ----
  const payoutLineRows: any[] = [];
  let skippedLinesForUnmigratedPayout = 0;
  for (const line of payoutLines) {
    const payoutId = payoutIdByLibertyPayoutId.get(line.PAYOUT_ID);
    if (!payoutId) {
      skippedLinesForUnmigratedPayout++;
      continue;
    }
    const t = transformPayoutLine(line);
    const itemId = t.libertyItemId != null ? itemIdByLibertyItemId.get(t.libertyItemId) ?? null : null;
    payoutLineRows.push({
      id: newId("pline"),
      payoutId,
      lineType: t.lineType,
      itemId,
      saleId: t.lineType === "SALE" && t.libertyItemId != null ? nearestSaleId(t.libertyItemId, t.transTs) : null,
      description: t.description,
      amount: t.amount,
    });
  }
  await createManyChunked((data) => prisma.payoutLine.createMany({ data }), payoutLineRows, 2000, "payout lines");
  console.log(
    `Created ${payoutLineRows.length} PayoutLine rows (${skippedLinesForUnmigratedPayout} skipped — payout not in this batch).`
  );

  // ---- Users & UserRoles (config/store.yaml — see its header comment) ----
  const accountIdByName = new Map<string, string>(
    [...accountRows, { id: storeAccountId, name: "Store-Owned Inventory" }].map((a) => [a.name.trim().toLowerCase(), a.id])
  );
  const userResult = await applyUsersAndRoles(storeId, config, accountIdByName);

  console.log(`Created ${userResult.usersCreated.length} User login(s), granted ${userResult.rolesGranted.length} role(s).`);
  if (userResult.unmatchedAccounts.length) {
    console.warn(
      `WARNING: ${userResult.unmatchedAccounts.length} config role entr${userResult.unmatchedAccounts.length === 1 ? "y" : "ies"} ` +
        `could not be matched to a migrated Account by name and were skipped:\n  ${userResult.unmatchedAccounts.join("\n  ")}`
    );
  }

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${seconds}s.`);
  console.log(`Summary: ${accountRows.length} accounts, ${itemRows.length} items, ${saleRows.length} sales, ${payoutRows.length} payouts.`);

  console.log("\n=== LOGINS CREATED (passwords as set in config/store.yaml) ===");
  for (const u of userResult.usersCreated) {
    const role = userResult.rolesGranted.find((r) => r.email === u.email)?.role ?? "";
    console.log(`  ${role.padEnd(12)} ${u.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

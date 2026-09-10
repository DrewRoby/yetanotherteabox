// Test migration: Liberty (Hidden Treasures) -> a scratch Teabox SQLite DB.
//
// Scope (per the migration plan, confirmed with the user 2026-09-07): full
// historical archive. Excludes, for this batch, the ~46 CLIENT_TYPE_ID=3 ("Store
// Account") rows pending the shop owner's review (see
// ../reports/client_type_3_review.md) and CLIENT_ID 101508 (corrupted ~$2B ledger
// balance, see the spec §3.1) — their items/sales/payouts will follow once that
// review comes back. Everything else — ordinary Client/Retail Vendor accounts,
// Items, Sales, Payouts — is migrated now.
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
} from "../extract/liberty";
import { closePool } from "../extract/db";
import { transformClientToAccount, AccountLookups } from "../transform/account";
import { transformItem, ItemLookups } from "../transform/item";
import { transformSaleDetail } from "../transform/sale";
import { transformPayout } from "../transform/payout";
import { prisma } from "../load/prisma";
import { createManyChunked } from "../load/batch";
import { applyUsersAndRoles } from "../load/users";

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
  ]);
  await closePool();
  console.log(
    `Fetched: ${clients.length} clients, ${items.length} items, ${saleDetails.length} sale lines, ${payouts.length} payouts.`
  );

  // ---- Store + STORE account ----
  // Identity comes from config/store.yaml (the owner's own account of the shop's
  // name/address), not Liberty's own STORE table free text — kept only as a fallback.
  const storeId = newId("store");
  const storeAccountId = newId("acct");
  const libertyStoreAddress = [libertyStore.ADDRESS_1, [libertyStore.CITY, libertyStore.STATE].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");

  await prisma.store.create({
    data: {
      id: storeId,
      name: config.store.name || libertyStore.STORE_NAME?.trim() || "Hidden Treasures",
      location: config.store.location || libertyStoreAddress || null,
    },
  });
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
      name: t.name,
      phone: t.phone,
      email: t.email,
      mailingAddress: t.mailingAddress,
      paymentMethod: t.paymentMethod,
      splitPercent: t.splitPercent,
      currentBalance: t.currentBalance,
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
        // Owned by an excluded CLIENT_TYPE_ID=3 (or the corrupted) account — skip for this batch.
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
  let skippedSalesForUnmigratedItem = 0;
  for (const detail of saleDetails) {
    const itemId = itemIdByLibertyItemId.get(detail.ITEM_ID);
    if (!itemId) {
      skippedSalesForUnmigratedItem++;
      continue;
    }
    const t = transformSaleDetail(detail, paymentTypeIdBySaleId);
    saleRows.push({
      id: newId("sale"),
      itemId,
      salePrice: t.salePrice,
      saleDate: t.saleDate,
      paymentType: t.paymentType,
      storeId,
    });
  }
  await createManyChunked((data) => prisma.sale.createMany({ data }), saleRows, 2000, "sales");
  console.log(`Created ${saleRows.length} Sale rows (${skippedSalesForUnmigratedItem} skipped — item not in this batch).`);

  // ---- Payouts ----
  const payoutRows: any[] = [];
  let skippedPayoutsForExcludedOwner = 0;
  for (const payout of payouts) {
    const accountId = accountIdByClientId.get(payout.CLIENT_ID);
    if (!accountId) {
      skippedPayoutsForExcludedOwner++;
      continue;
    }
    const t = transformPayout(payout);
    payoutRows.push({
      id: newId("payout"),
      accountId,
      amount: t.amount,
      status: t.status,
      createdAt: t.createdAt,
      paidAt: t.paidAt,
    });
  }
  await createManyChunked((data) => prisma.payout.createMany({ data }), payoutRows, 2000, "payouts");
  console.log(`Created ${payoutRows.length} Payout rows (${skippedPayoutsForExcludedOwner} skipped — excluded owner).`);

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

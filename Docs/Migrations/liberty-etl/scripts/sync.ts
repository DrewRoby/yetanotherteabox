// Liberty → Teabox catch-up sync (reconcile). Brings a Teabox database that was
// migrated from a Liberty snapshot up to date with a *live* Liberty database — the shop
// keeps ringing sales into Liberty between the snapshot and cutover. Same RWD schema
// either way, so the source can be the shop's own SQL Server Express or a fresh backup
// restored locally. See Docs/sync-design.md for how this fits the later cloud sync.
//
//   npm run sync -- --source config/liberty-source.env --check     # connect + report lag only
//   npm run sync -- --source config/liberty-source.env --dry-run   # full diff + report, writes nothing to Teabox
//   npm run sync -- --source config/liberty-source.env             # apply
//
// How it works: every run is a full diff by natural key, not a watermark — Liberty
// doesn't timestamp everything that matters (a voided payout, an item moved between
// clients), and at ~1M rows a full extract takes about a minute. Keys: Account.legacyId
// = "liberty:<CLIENT_ID>", Item.itemNumber = ITEM_ID (LIB- SKUs), Sale = (ITEM_ID,
// SALE_TS), Payout.legacyId = "liberty:<PAYOUT_ID>". Rules:
// - **Liberty is never written to.** Only SELECTs; use a read-only login (`report`).
// - Liberty wins for data it owns (Liberty-origin rows), *unless Teabox has changed that
//   row itself* (an item edited/repriced/sold in Teabox, or an Inventory Audit decision
//   applied) — then it's a conflict: reported, not overwritten.
// - Teabox-native rows (HT- items, POS sales, payouts made in Teabox) are never touched,
//   except a Teabox payout whose number a new Liberty payout claims, which is renumbered.
// - Balances: Liberty's unpaid ledger + Teabox-native sale credits − Teabox-native
//   payouts, recomputed every run (so a payout made in both systems shows up negative).
// - Nothing is deleted. A Liberty-origin sale that vanished from Liberty is reported.
// Every run writes a report to reports/; applied runs are also recorded as a SyncRun row.
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag("--dry-run");
const checkOnly = flag("--check");
const sourceFile = option("--source");

// Config must be loaded before anything opens a connection: the source env file's
// MSSQL_* override .env's (which point at the local restore), and TEABOX_DATABASE_URL
// is read when the Prisma client is constructed (load/prisma.ts), hence the requires.
dotenv.config();
if (sourceFile) {
  if (!fs.existsSync(sourceFile)) throw new Error(`--source ${sourceFile}: file not found`);
  dotenv.config({ path: sourceFile, override: true });
}
/* eslint-disable @typescript-eslint/no-var-requires */
const { getPool, closePool } = require("../extract/db") as typeof import("../extract/db");
const L = require("../extract/liberty") as typeof import("../extract/liberty");
const { transformClientToAccount } = require("../transform/account") as typeof import("../transform/account");
const { transformItem } = require("../transform/item") as typeof import("../transform/item");
const { transformSaleDetail } = require("../transform/sale") as typeof import("../transform/sale");
const { transformPayout, transformPayoutLine } = require("../transform/payout") as typeof import("../transform/payout");
const { buildAccountLookups, buildItemLookups } =
  require("../transform/lookups") as typeof import("../transform/lookups");
const { prisma } = require("../load/prisma");
const { assignLibertyNumbers } = require("../load/numbers") as typeof import("../load/numbers");
/* eslint-enable @typescript-eslint/no-var-requires */

const BALANCE_BEARING = new Set(["CONSIGNOR", "VENDOR", "BOOTH_OWNER"]);
const CHUNK = 500;
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const cents = (v: number) => Math.round(v * 100) / 100;
const ms = (d: Date | number | bigint | null | undefined) =>
  d == null ? null : d instanceof Date ? d.getTime() : Number(d);
const chunks = <T>(rows: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

interface Conflict {
  kind: string;
  key: string;
  detail: string;
}

function teaboxExeRunning(): boolean {
  if (process.platform !== "win32") return false;
  try {
    return execSync('tasklist /FI "IMAGENAME eq teabox.exe" /NH', { encoding: "utf-8" })
      .toLowerCase()
      .includes("teabox.exe");
  } catch {
    return false;
  }
}

async function sourceInfo() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT @@SERVERNAME AS server, DB_NAME() AS db, SUSER_SNAME() AS login,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'SELECT') AS canRead,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS canWrite,
           (SELECT MAX(SALE_TS) FROM SALE_HDR) AS lastSale,
           (SELECT MAX(RECEIVE_TS) FROM ITEM) AS lastIntake,
           (SELECT MAX(PAYOUT_TS) FROM PAYOUT) AS lastPayout,
           (SELECT MAX(MODIFIED_TS) FROM ITEM) AS lastItemChange,
           (SELECT MAX(LAST_UPDATE_TS) FROM CLIENT) AS lastClientChange;`);
  const row = r.recordset[0];
  const asOf = [row.lastSale, row.lastIntake, row.lastPayout, row.lastItemChange, row.lastClientChange]
    .filter(Boolean)
    .reduce((a: Date, b: Date) => (b > a ? b : a));
  return { ...row, asOf: asOf as Date };
}

async function main() {
  const target = process.env.TEABOX_DATABASE_URL;
  if (!target) throw new Error("TEABOX_DATABASE_URL is not set (in .env or the --source file).");
  const src = await sourceInfo();
  console.log(
    `Source: ${src.server} / ${src.db} as ${src.login}${src.canWrite ? "  (this login CAN write — the sync never does, but prefer the read-only `report` login)" : " (read-only)"}`
  );
  console.log(`Target: ${target}${dryRun ? "  (dry run)" : ""}`);
  console.log(
    `Liberty latest — sale ${src.lastSale?.toISOString() ?? "—"}, intake ${src.lastIntake?.toISOString() ?? "—"}, ` +
      `payout ${src.lastPayout?.toISOString() ?? "—"}`
  );
  const tbLatest = (
    await prisma.$queryRawUnsafe(`SELECT MAX(s."saleDate") AS sale FROM "Sale" s WHERE s."transactionId" LIKE 'lib-%'`)
  )[0];
  console.log(`Teabox's latest Liberty sale: ${tbLatest.sale ? new Date(Number(tbLatest.sale)).toISOString() : "—"}`);
  if (!src.canRead) throw new Error(`Login ${src.login} can't read ${src.db}.`);
  if (checkOnly) return;
  if (!dryRun && teaboxExeRunning() && !flag("--force")) {
    throw new Error("teabox.exe is running — stop it before applying a sync (or --dry-run / --force).");
  }

  const run = dryRun
    ? { id: "dry-run" }
    : await prisma.syncRun.create({
        data: {
          source: "liberty",
          sourceServer: src.server,
          sourceDatabase: src.db,
          sourceAsOf: src.asOf,
          dryRun,
          status: "RUNNING",
        },
      });

  try {
    const result = await reconcile(dryRun);
    const report = writeReport(run.id, src, target, result);
    if (!dryRun)
      await prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: "OK",
          finishedAt: new Date(),
          counts: JSON.stringify(result.counts),
          conflicts: JSON.stringify(result.conflicts.slice(0, 2000)),
        },
      });
    console.log(`\n${JSON.stringify(result.counts, null, 2)}`);
    console.log(`${result.conflicts.length} conflict(s). Report: ${report}`);
  } catch (err) {
    if (!dryRun)
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), error: String((err as Error)?.stack ?? err) },
      });
    throw err;
  }
}

async function reconcile(dry: boolean) {
  const t0 = Date.now();
  console.log("Reading Liberty...");
  const [
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
    libItems,
    itemStatuses,
    saleDetails,
    salePaymentTypes,
    libPayouts,
    payoutLines,
    ledgerClients,
  ] = await Promise.all([
    L.fetchOrdinaryClients(),
    L.fetchPrimaryAddresses(),
    L.fetchPrimaryPhones(),
    L.fetchPrimaryEmails(),
    L.fetchPriceCodeStorePct(),
    L.fetchPaymentActs(),
    L.fetchClientBalances(),
    L.fetchClientItemLinks(),
    L.fetchCategoryList(),
    L.fetchCategories(),
    L.fetchBrandSizeAttrs(),
    L.fetchItems(),
    L.fetchItemStatuses(),
    L.fetchInventorySaleDetails(),
    L.fetchPrimarySalePaymentTypes(),
    L.fetchPayouts(),
    L.fetchPayoutLines(),
    L.fetchLedgerClientOfStoreItems(),
  ]);
  const accountLookups = buildAccountLookups({ addresses, phones, emails, priceCodes, paymentActs, balances });
  const itemLookups = buildItemLookups({ itemStatuses, categoryList, categories, brandSizeAttrs, clientItemLinks });
  console.log(
    `  ${clients.length} clients, ${libItems.length} items, ${saleDetails.length} sale lines, ${libPayouts.length} payouts (${((Date.now() - t0) / 1000).toFixed(0)}s)`
  );

  console.log("Reading Teabox...");
  const store = await prisma.store.findFirstOrThrow();
  const storeAccount = await prisma.account.findFirstOrThrow({ where: { storeId: store.id, accountType: "STORE" } });
  const tbAccounts: {
    id: string;
    legacyId: string | null;
    accountType: string;
    isStoreAccount: boolean;
    name: string;
    phone: string | null;
    email: string | null;
    mailingAddress: string | null;
    currentBalance: number;
    createdAt: Date;
  }[] = await prisma.account.findMany({
    where: { storeId: store.id },
    select: {
      id: true,
      legacyId: true,
      accountType: true,
      isStoreAccount: true,
      name: true,
      phone: true,
      email: true,
      mailingAddress: true,
      currentBalance: true,
      createdAt: true,
    },
  });
  const accountByClient = new Map<number, (typeof tbAccounts)[number]>();
  for (const a of tbAccounts)
    if (a.legacyId?.startsWith("liberty:")) accountByClient.set(Number(a.legacyId.slice(8)), a);

  const tbItems: any[] = await prisma.$queryRawUnsafe(
    `
    SELECT "id", "itemNumber", "accountId", "description", "category", "subcategory", "brand", "size", "price", "cost",
           "status", "consignorPercent", "donateIfUnsold", "tagPrintedAt", "auditAppliedAt"
    FROM "Item" WHERE "storeId" = ? AND "sku" LIKE 'LIB-%'`,
    store.id
  );
  const itemByNumber = new Map<number, any>(tbItems.map((i) => [Number(i.itemNumber), i]));
  // Items Teabox itself has changed: a user-made history entry, an applied audit
  // decision, or a sale rung up in Teabox.
  const nativelySold = new Set<string>(
    (
      await prisma.$queryRawUnsafe(
        `SELECT DISTINCT s."itemId" AS id FROM "Sale" s WHERE s."transactionId" IS NULL OR s."transactionId" NOT LIKE 'lib-%'`
      )
    ).map((r: { id: string }) => r.id)
  );
  const touched = new Set<string>([
    ...nativelySold,
    ...(
      await prisma.$queryRawUnsafe(`
        SELECT DISTINCT h."itemId" AS id FROM "ItemHistory" h WHERE h."changedById" IS NOT NULL
        UNION SELECT "id" FROM "Item" WHERE "auditAppliedAt" IS NOT NULL
        -- automatic donations (no changedById) and flips are Teabox's too: Liberty still
        -- says Available, but sync must not put them back on the floor / owner
        UNION SELECT "id" FROM "Item" WHERE "donatedAt" IS NOT NULL OR "flippedAt" IS NOT NULL OR "claimedAt" IS NOT NULL`)
    ).map((r: { id: string }) => r.id),
  ]);
  const tbSales: { id: string; itemNumber: number; saleDate: bigint | number; transactionId: string | null }[] =
    await prisma.$queryRawUnsafe(`
    SELECT s."id", i."itemNumber", s."saleDate", s."transactionId" FROM "Sale" s JOIN "Item" i ON i."id" = s."itemId"
    WHERE i."sku" LIKE 'LIB-%' AND s."transactionId" LIKE 'lib-%'`);
  const saleKeys = new Map(tbSales.map((s) => [`${s.itemNumber}|${Number(s.saleDate)}`, s]));
  const tbPayouts: {
    id: string;
    payoutNumber: number;
    legacyId: string | null;
    accountId: string;
    amount: number;
    status: string;
    method: string | null;
    checkNumber: string | null;
    paidAt: bigint | number | null;
  }[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "payoutNumber", "legacyId", "accountId", "amount", "status", "method", "checkNumber", "paidAt" FROM "Payout"`
  );

  const conflicts: Conflict[] = [];
  const samples: Record<string, string[]> = {};
  const note = (k: string, s: string) => ((samples[k] ??= []).length < 25 ? samples[k].push(s) : undefined);

  // ---- 1. Accounts ----
  const newAccounts: any[] = [];
  const accountUpdates: { id: string; data: Record<string, unknown> }[] = [];
  const accountIdByClient = new Map<number, string>([...accountByClient].map(([c, a]) => [c, a.id]));
  // Migrated accounts that were never linked to their client (repair-ledger links via
  // items/payouts, so a client with neither stays unlinked): adopt them by name +
  // created date — both copied verbatim from Liberty by the migration — rather than
  // creating a duplicate. Only an unambiguous match is adopted.
  const unlinkedByKey = new Map<string, (typeof tbAccounts)[number][]>();
  for (const a of tbAccounts) {
    if (a.legacyId || a.accountType === "STORE") continue;
    const key = `${a.name}|${a.createdAt.getTime()}`;
    unlinkedByKey.set(key, [...(unlinkedByKey.get(key) ?? []), a]);
  }
  const accountLinks: { id: string; legacyId: string }[] = [];
  for (const client of clients) {
    const t = transformClientToAccount(client, accountLookups);
    let existing = accountByClient.get(client.CLIENT_ID);
    if (!existing && t.createdAt) {
      const candidates = unlinkedByKey.get(`${t.name}|${t.createdAt.getTime()}`);
      if (candidates?.length === 1) {
        existing = candidates[0];
        unlinkedByKey.delete(`${t.name}|${t.createdAt.getTime()}`);
        accountLinks.push({ id: existing.id, legacyId: `liberty:${client.CLIENT_ID}` });
        accountIdByClient.set(client.CLIENT_ID, existing.id);
      }
    }
    if (!existing) {
      const id = newId("acct");
      accountIdByClient.set(client.CLIENT_ID, id);
      newAccounts.push({
        id,
        storeId: store.id,
        accountType: t.accountType,
        isStoreAccount: t.isStoreAccount,
        isActive: t.isActive,
        name: t.name,
        phone: t.phone,
        email: t.email,
        mailingAddress: t.mailingAddress,
        paymentMethod: t.paymentMethod,
        splitPercent: t.splitPercent,
        currentBalance: 0,
        legacyId: `liberty:${client.CLIENT_ID}`,
        ...(t.createdAt ? { createdAt: t.createdAt } : {}),
      });
      note("accounts created", `${t.name} (client ${client.CLIENT_ID})`);
      continue;
    }
    // Teabox has no route that edits contact details, so Liberty's are authoritative.
    const data: Record<string, unknown> = {};
    for (const f of ["name", "phone", "email", "mailingAddress"] as const) {
      if ((existing[f] ?? null) !== (t[f] ?? null)) data[f] = t[f];
    }
    // The one type change sync makes: a client the owner confirmed as a holding
    // account (transform/account.ts HOLDING_CLIENT_IDS) becomes HOLDING. Its balance
    // goes to 0 in the balance pass below (holding accounts aren't balance-bearing).
    if (t.accountType === "HOLDING" && existing.accountType !== "HOLDING") {
      data.accountType = "HOLDING";
      existing.accountType = "HOLDING"; // so the balance pass below already treats it as one
    }
    if (Object.keys(data).length) {
      accountUpdates.push({ id: existing.id, data });
      note("accounts updated", `${existing.name}: ${Object.keys(data).join(", ")}`);
    }
  }

  // ---- 2. Items ----
  const newItems: any[] = [];
  const itemUpdates: { id: string; data: Record<string, unknown> }[] = [];
  const itemIdByNumber = new Map<number, string>(tbItems.map((i) => [Number(i.itemNumber), i.id]));
  let skippedExcludedOwner = 0;
  for (const li of libItems) {
    const t = transformItem(li, itemLookups);
    const ownerAccountId = t.ownerClientId == null ? storeAccount.id : accountIdByClient.get(t.ownerClientId);
    if (!ownerAccountId) {
      skippedExcludedOwner++; // CLIENT_ID 101508 (excluded) — same as migrate
      continue;
    }
    const existing = itemByNumber.get(li.ITEM_ID);
    if (!existing) {
      if (li.ITEM_ID >= store.itemStartNumber) {
        throw new Error(
          `Liberty ITEM_ID ${li.ITEM_ID} reached Teabox's own numbering (from ${store.itemStartNumber}) — raise Store.itemStartNumber first.`
        );
      }
      const id = newId("item");
      itemIdByNumber.set(li.ITEM_ID, id);
      newItems.push({
        id,
        sku: t.sku,
        itemNumber: li.ITEM_ID,
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
        consignorPercent: t.consignorPercent,
        donateIfUnsold: t.donateIfUnsold,
        tagPrintedAt: t.tagPrintedAt,
        accountId: ownerAccountId,
        storeId: store.id,
      });
      note("items created", `${t.sku} ${t.description} $${t.price}`);
      continue;
    }
    const data: Record<string, unknown> = {};
    const same = (a: unknown, b: unknown) =>
      typeof a === "number" || typeof b === "number"
        ? Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005 && (a == null) === (b == null)
        : (a ?? null) === (b ?? null);
    for (const f of [
      "description",
      "category",
      "subcategory",
      "brand",
      "size",
      "price",
      "cost",
      "consignorPercent",
    ] as const) {
      if (!same(existing[f], t[f])) data[f] = t[f];
    }
    const tbDonate = existing.donateIfUnsold == null ? null : Number(existing.donateIfUnsold) === 1;
    if (tbDonate !== t.donateIfUnsold) data.donateIfUnsold = t.donateIfUnsold;
    if (existing.accountId !== ownerAccountId) data.accountId = ownerAccountId;
    // SOLD comes from the sales pass; here only off-floor transitions (Void, Needs Info).
    if (existing.status !== t.status && existing.status !== "SOLD" && t.status !== "SOLD") data.status = t.status;
    const libTag = ms(t.tagPrintedAt);
    if (libTag != null && libTag > (ms(existing.tagPrintedAt) ?? 0)) data.tagPrintedAt = t.tagPrintedAt;
    if (!Object.keys(data).length) continue;
    if (touched.has(existing.id)) {
      conflicts.push({
        kind: "item changed in both",
        key: t.sku,
        detail: `Liberty changed ${Object.keys(data).join(", ")}; Teabox has its own edits — kept Teabox's`,
      });
      continue;
    }
    itemUpdates.push({ id: existing.id, data });
    note(
      "items updated",
      `${t.sku}: ${Object.entries(data)
        .map(([k, v]) => `${k} ${existing[k] ?? "—"} → ${v instanceof Date ? v.toISOString() : v}`)
        .join("; ")}`
    );
  }

  // ---- 3. Sales ----
  const paymentTypeIdBySaleId = new Map(salePaymentTypes.map((p) => [p.SALE_ID, p.PAYMENT_TYPE_ID]));
  const newSales: any[] = [];
  const libSaleKeys = new Set<string>();
  const salesByItemNumber = new Map<number, { id: string; saleDate: Date }[]>();
  for (const s of tbSales) {
    const list = salesByItemNumber.get(s.itemNumber) ?? [];
    list.push({ id: s.id, saleDate: new Date(Number(s.saleDate)) });
    salesByItemNumber.set(s.itemNumber, list);
  }
  for (const d of saleDetails) {
    const key = `${d.ITEM_ID}|${d.SALE_TS.getTime()}`;
    libSaleKeys.add(key);
    if (saleKeys.has(key)) continue;
    const itemId = itemIdByNumber.get(d.ITEM_ID);
    if (!itemId) continue; // excluded owner
    // A Liberty sale is money taken at the register — record it even if Teabox edited
    // the item. Only an item Teabox *also* sold is a real clash.
    if (nativelySold.has(itemId)) {
      conflicts.push({
        kind: "sold in both",
        key: `LIB-${d.ITEM_ID}`,
        detail: `Liberty sale ${d.SALE_TS.toISOString()} $${d.PRICE_SOLD} on an item Teabox also sold — not recorded`,
      });
      continue;
    }
    const t = transformSaleDetail(d, paymentTypeIdBySaleId);
    const id = newId("sale");
    newSales.push({
      id,
      itemId,
      salePrice: t.salePrice,
      saleDate: t.saleDate,
      paymentType: t.paymentType,
      transactionId: t.transactionId,
      storeId: store.id,
    });
    const list = salesByItemNumber.get(d.ITEM_ID) ?? [];
    list.push({ id, saleDate: t.saleDate });
    salesByItemNumber.set(d.ITEM_ID, list);
    note("sales created", `LIB-${d.ITEM_ID} $${t.salePrice} ${t.saleDate.toISOString()}`);
  }
  let salesMissingInLiberty = 0;
  for (const [key, s] of saleKeys) {
    if (!libSaleKeys.has(key)) {
      salesMissingInLiberty++;
      if (salesMissingInLiberty <= 200)
        conflicts.push({
          kind: "sale gone from Liberty",
          key: `LIB-${s.itemNumber}`,
          detail: `Teabox has a Liberty sale at ${new Date(Number(s.saleDate)).toISOString()} that Liberty no longer has (voided/returned?) — left as is`,
        });
    }
  }

  // ---- 4. Payouts ----
  const libPayoutIds = new Set(libPayouts.map((p) => p.PAYOUT_ID));
  const payoutByLegacy = new Map(tbPayouts.filter((p) => p.legacyId).map((p) => [p.legacyId!, p]));
  // First run against a database migrated before Payout.legacyId existed: claim the
  // migrated rows by number, but only when account and amount match too.
  const libPayoutById = new Map(libPayouts.map((p) => [p.PAYOUT_ID, p]));
  const markLegacy: { id: string; legacyId: string }[] = [];
  for (const p of tbPayouts) {
    if (p.legacyId || !libPayoutIds.has(p.payoutNumber)) continue;
    const lib = libPayoutById.get(p.payoutNumber)!;
    // Same number, same account *and* same amount — a Teabox payout that merely shares a
    // number (and maybe a consignor) with a Liberty one must not be adopted as Liberty's.
    if (accountIdByClient.get(lib.CLIENT_ID) === p.accountId && Math.abs(p.amount - transformPayout(lib).amount) < 0.005) {
      markLegacy.push({ id: p.id, legacyId: `liberty:${p.payoutNumber}` });
      payoutByLegacy.set(`liberty:${p.payoutNumber}`, { ...p, legacyId: `liberty:${p.payoutNumber}` });
    }
  }
  const markedIds = new Set(markLegacy.map((m) => m.id));
  const isLegacy = (p: { id: string; legacyId: string | null }) => !!p.legacyId || markedIds.has(p.id);
  const nativeByNumber = new Map(tbPayouts.filter((p) => !isLegacy(p)).map((p) => [p.payoutNumber, p]));
  let nextNumber =
    [...tbPayouts.map((p) => p.payoutNumber), ...libPayouts.map((p) => p.PAYOUT_ID)].reduce(
      (m, n) => Math.max(m, n),
      0
    ) + 1;
  const renumber: { id: string; from: number; to: number }[] = [];
  const newPayouts: any[] = [];
  const payoutUpdates: { id: string; data: Record<string, unknown> }[] = [];
  const newPayoutIdByLibId = new Map<number, string>();
  for (const lp of libPayouts) {
    const t = transformPayout(lp);
    const accountId = accountIdByClient.get(lp.CLIENT_ID);
    if (!accountId) continue;
    const existing = payoutByLegacy.get(`liberty:${lp.PAYOUT_ID}`);
    if (!existing) {
      const clash = nativeByNumber.get(lp.PAYOUT_ID);
      if (clash) {
        renumber.push({ id: clash.id, from: clash.payoutNumber, to: nextNumber });
        conflicts.push({
          kind: "payout number taken",
          key: `#${lp.PAYOUT_ID}`,
          detail: `Teabox payout #${clash.payoutNumber} renumbered #${nextNumber} — Liberty's payout keeps its number`,
        });
        nextNumber++;
      }
      const id = newId("payout");
      newPayoutIdByLibId.set(lp.PAYOUT_ID, id);
      newPayouts.push({
        id,
        payoutNumber: lp.PAYOUT_ID,
        accountId,
        amount: t.amount,
        status: t.status,
        createdAt: t.createdAt,
        paidAt: t.paidAt,
        method: t.method,
        checkNumber: t.checkNumber,
        legacyId: `liberty:${lp.PAYOUT_ID}`,
      });
      note("payouts created", `#${lp.PAYOUT_ID} $${t.amount} ${t.method ?? ""} ${t.status}`);
      continue;
    }
    const data: Record<string, unknown> = {};
    if (existing.status !== t.status) {
      data.status = t.status;
      data.paidAt = t.paidAt;
    }
    if (Math.abs(existing.amount - t.amount) >= 0.005) data.amount = t.amount;
    if ((existing.method ?? null) !== t.method) data.method = t.method;
    if ((existing.checkNumber ?? null) !== t.checkNumber) data.checkNumber = t.checkNumber;
    if (Object.keys(data).length) {
      payoutUpdates.push({ id: existing.id, data });
      note("payouts updated", `#${lp.PAYOUT_ID}: ${Object.keys(data).join(", ")}`);
    }
  }
  const nearestSaleId = (itemNumber: number, transTs: Date | null) => {
    const list = salesByItemNumber.get(itemNumber);
    if (!list?.length) return null;
    if (list.length === 1 || !transTs) return list[0].id;
    return list.reduce((b, s) =>
      Math.abs(s.saleDate.getTime() - transTs.getTime()) < Math.abs(b.saleDate.getTime() - transTs.getTime()) ? s : b
    ).id;
  };
  const newLines: any[] = [];
  for (const line of payoutLines) {
    const payoutId = newPayoutIdByLibId.get(line.PAYOUT_ID);
    if (!payoutId) continue;
    const t = transformPayoutLine(line);
    newLines.push({
      id: newId("pline"),
      payoutId,
      lineType: t.lineType,
      itemId: t.libertyItemId != null ? (itemIdByNumber.get(t.libertyItemId) ?? null) : null,
      saleId: t.lineType === "SALE" && t.libertyItemId != null ? nearestSaleId(t.libertyItemId, t.transTs) : null,
      description: t.description,
      amount: t.amount,
    });
  }

  // ---- 5. Balances: Liberty unpaid + Teabox-native credits − Teabox-native payouts ----
  const nativeCredits = new Map<string, number>(
    (
      await prisma.$queryRawUnsafe(`
        SELECT i."accountId" AS id, SUM(s."salePrice" * COALESCE(i."consignorPercent", a."splitPercent", 100) / 100.0) AS amt
        FROM "Sale" s JOIN "Item" i ON i."id" = s."itemId" JOIN "Account" a ON a."id" = i."accountId"
        WHERE s."transactionId" IS NULL OR s."transactionId" NOT LIKE 'lib-%' GROUP BY 1`)
    ).map((r: any) => [r.id, Number(r.amt)])
  );
  const nativePaid = new Map<string, number>();
  for (const p of tbPayouts) {
    if (!isLegacy(p) && p.status === "PAID") nativePaid.set(p.accountId, (nativePaid.get(p.accountId) ?? 0) + p.amount);
  }
  const unpaidByClient = new Map(balances.map((b) => [b.CLIENT_ID, b.balance]));
  const balanceUpdates: { id: string; balance: number }[] = [];
  let before = 0;
  let after = 0;
  const acctById = new Map<string, any>([...tbAccounts, ...newAccounts].map((a) => [a.id, a]));
  for (const client of clients) {
    const id = accountIdByClient.get(client.CLIENT_ID)!;
    const acct = acctById.get(id);
    const bearing = BALANCE_BEARING.has(acct.accountType) && !acct.isStoreAccount;
    const target = bearing
      ? cents((unpaidByClient.get(client.CLIENT_ID) ?? 0) + (nativeCredits.get(id) ?? 0) - (nativePaid.get(id) ?? 0))
      : 0;
    before += acct.currentBalance;
    after += target;
    if (Math.abs(acct.currentBalance - target) >= 0.005) {
      balanceUpdates.push({ id, balance: target });
      note("balances changed", `${acct.name}: $${cents(acct.currentBalance)} → $${target}`);
    }
  }

  const counts = {
    accounts: { created: newAccounts.length, updated: accountUpdates.length, linked: accountLinks.length },
    items: { created: newItems.length, updated: itemUpdates.length, skippedExcludedOwner },
    sales: { created: newSales.length, goneFromLiberty: salesMissingInLiberty },
    payouts: {
      created: newPayouts.length,
      lines: newLines.length,
      updated: payoutUpdates.length,
      markedLegacy: markLegacy.length,
      renumberedTeabox: renumber.length,
    },
    balances: { changed: balanceUpdates.length, linkedTotalBefore: cents(before), linkedTotalAfter: cents(after) },
    numbers: null as null | Omit<import("../load/numbers").NumberingResult, "nativeAccountsMoved">,
    seconds: 0,
  };
  console.log(`Plan: ${JSON.stringify(counts)}`);

  if (!dry) {
    console.log("Applying...");
    await prisma.$transaction(
      async (tx: any) => {
        for (const l of accountLinks) await tx.account.update({ where: { id: l.id }, data: { legacyId: l.legacyId } });
        for (const c of chunks(newAccounts)) await tx.account.createMany({ data: c });
        for (const u of accountUpdates) await tx.account.update({ where: { id: u.id }, data: u.data });
        for (const c of chunks(newItems)) await tx.item.createMany({ data: c });
        for (const u of itemUpdates) await tx.item.update({ where: { id: u.id }, data: u.data });
        for (const c of chunks(newSales)) await tx.sale.createMany({ data: c });
        // Sold items: status + the denormalized soldAt; owners' lastSaleAt.
        const soldItemIds = [...new Set(newSales.map((s) => s.itemId))];
        for (const c of chunks(soldItemIds)) {
          const marks = c.map(() => "?").join(",");
          await tx.$executeRawUnsafe(
            `UPDATE "Item" SET "status" = 'SOLD', "soldAt" = (SELECT MAX(s."saleDate") FROM "Sale" s WHERE s."itemId" = "Item"."id") WHERE "id" IN (${marks})`,
            ...c
          );
          await tx.$executeRawUnsafe(
            `
            UPDATE "Account" SET "lastSaleAt" = (SELECT MAX(s."saleDate") FROM "Item" i JOIN "Sale" s ON s."itemId" = i."id" WHERE i."accountId" = "Account"."id")
            WHERE "id" IN (SELECT DISTINCT "accountId" FROM "Item" WHERE "id" IN (${marks}))`,
            ...c
          );
        }
        for (const m of markLegacy) await tx.payout.update({ where: { id: m.id }, data: { legacyId: m.legacyId } });
        for (const r of renumber) await tx.payout.update({ where: { id: r.id }, data: { payoutNumber: r.to } });
        for (const c of chunks(newPayouts)) await tx.payout.createMany({ data: c });
        for (const c of chunks(newLines)) await tx.payoutLine.createMany({ data: c });
        for (const u of payoutUpdates) await tx.payout.update({ where: { id: u.id }, data: u.data });
        // paidOutAt for items on new or changed payouts (non-rejected) — same rule as the schema backfill.
        const paidItemIds = [...new Set(newLines.map((l) => l.itemId).filter(Boolean))];
        for (const c of chunks(paidItemIds)) {
          await tx.$executeRawUnsafe(
            `
            UPDATE "Item" SET "paidOutAt" = (
              SELECT MAX(COALESCE(p."paidAt", p."createdAt")) FROM "PayoutLine" l JOIN "Payout" p ON p."id" = l."payoutId"
              WHERE l."itemId" = "Item"."id" AND p."status" <> 'REJECTED')
            WHERE "id" IN (${c.map(() => "?").join(",")})`,
            ...c
          );
        }
        for (const b of balanceUpdates)
          await tx.account.update({ where: { id: b.id }, data: { currentBalance: b.balance } });
      },
      { timeout: 60 * 60 * 1000, maxWait: 60 * 1000 }
    );
    // Account numbers + item tag numbers for everything just created (and anything
    // still missing one) — after the apply, since it reads the rows back. Liberty wins
    // a clash with a Teabox-native account's number; those moves are reported.
    console.log("Numbering accounts and tags...");
    const { nativeAccountsMoved, ...numbers } = await assignLibertyNumbers(prisma, {
      storeId: store.id,
      clients,
      libItems,
      ownerClientIdByItemId: itemLookups.ownerClientIdByItemId,
      ledgerClientIdByItemId: new Map(ledgerClients.map((l) => [l.ITEM_ID, l.CLIENT_ID])),
      dryRun: false,
    });
    counts.numbers = numbers;
    for (const m of nativeAccountsMoved)
      conflicts.push({ kind: "account number taken by Liberty", key: m, detail: "Teabox account moved to a new number" });
  }
  counts.seconds = Math.round((Date.now() - t0) / 1000);
  return { counts, conflicts, samples };
}

function writeReport(
  runId: string,
  src: any,
  target: string,
  r: { counts: any; conflicts: Conflict[]; samples: Record<string, string[]> }
) {
  const dir = path.join(__dirname, "..", "reports");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `sync-${stamp}${dryRun ? "-dry" : ""}.md`);
  const lines = [
    `# Liberty → Teabox sync ${dryRun ? "(dry run)" : ""}`,
    "",
    `- Run: \`${runId}\` at ${new Date().toISOString()}`,
    `- Source: ${src.server} / ${src.db} as ${src.login} — Liberty data as of ${src.asOf?.toISOString()}`,
    `- Target: ${target}`,
    "",
    "## Counts",
    "",
    "```json",
    JSON.stringify(r.counts, null, 2),
    "```",
    "",
    `## Conflicts (${r.conflicts.length})`,
    "",
    ...(r.conflicts.length
      ? r.conflicts.slice(0, 500).map((c) => `- **${c.kind}** ${c.key} — ${c.detail}`)
      : ["None."]),
    "",
    "## Samples (first 25 of each)",
    "",
    ...Object.entries(r.samples).flatMap(([k, v]) => [`### ${k}`, "", ...v.map((s) => `- ${s}`), ""]),
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  return file;
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

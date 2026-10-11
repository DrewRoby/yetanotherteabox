import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// The account detail page's Items table: one account's items with two derived columns
// — soldAt (latest Sale) and the latest Payout that included the item — filtered,
// sorted and paged server-side. Server-side because an account can own hundreds of
// thousands of items (a migrated STORE account: ~340k; the largest consignors: ~6k).
// Raw SQL because Prisma can't sort or filter on per-row relation aggregates.

export const ITEM_SORTS = ["created", "sold", "payout", "price", "sku", "description", "status"] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

// Whitelist: the only strings ever interpolated (not bound) into the SQL.
const ORDER_BY: Record<ItemSort, string> = {
  created: `"intakeDate"`,
  sold: `"soldAt"`,
  payout: `"payoutNumber"`,
  price: `"price"`,
  sku: `"itemNumber"`, // SKUs are zero-padded/prefixed strings; itemNumber sorts them numerically
  description: `"description" COLLATE NOCASE`,
  status: `"status"`,
};

// Correlated on the outer query's `i` (an Item row).
const SOLD_AT = Prisma.sql`SELECT MAX(s."saleDate") FROM "Sale" s WHERE s."itemId" = i."id"`;
// The most recent payout (highest number) with a line for this item — an item that was
// sold, returned and resold can appear on several.
const LATEST_PAYOUT = Prisma.sql`
  SELECT p."id", p."payoutNumber" FROM "PayoutLine" l JOIN "Payout" p ON p."id" = l."payoutId"
  WHERE l."itemId" = i."id" ORDER BY p."payoutNumber" DESC LIMIT 1`;

export interface AccountItemsQuery {
  q?: string; // substring of SKU or description
  status?: string;
  sold?: "yes" | "no";
  paid?: "yes" | "no";
  payoutNumber?: number; // items on this payout (any line, not just their latest)
  createdFrom?: Date; // inclusive
  createdTo?: Date; // exclusive
  soldFrom?: Date;
  soldTo?: Date;
  sort: ItemSort;
  desc: boolean;
  limit: number;
  offset: number;
}

export interface AccountItemRow {
  id: string;
  sku: string;
  description: string;
  status: string;
  price: number;
  intakeDate: string;
  soldAt: string | null;
  payoutId: string | null;
  payoutNumber: number | null;
}

export async function listAccountItems(accountId: string, query: AccountItemsQuery) {
  // Filters on the item's own columns go inside the CTE so SQLite can use the
  // accountId index before computing the derived columns.
  const base: Prisma.Sql[] = [Prisma.sql`i."accountId" = ${accountId}`];
  if (query.q) {
    const q = query.q.toLowerCase();
    base.push(Prisma.sql`(instr(lower(i."sku"), ${q}) > 0 OR instr(lower(i."description"), ${q}) > 0)`);
  }
  if (query.status) base.push(Prisma.sql`i."status" = ${query.status}`);
  if (query.createdFrom) base.push(Prisma.sql`i."intakeDate" >= ${query.createdFrom.getTime()}`);
  if (query.createdTo) base.push(Prisma.sql`i."intakeDate" < ${query.createdTo.getTime()}`);
  if (query.payoutNumber != null) {
    base.push(Prisma.sql`EXISTS (SELECT 1 FROM "PayoutLine" l JOIN "Payout" p ON p."id" = l."payoutId"
      WHERE l."itemId" = i."id" AND p."payoutNumber" = ${query.payoutNumber})`);
  }
  if (query.paid === "yes") base.push(Prisma.sql`EXISTS (SELECT 1 FROM "PayoutLine" l WHERE l."itemId" = i."id")`);
  if (query.paid === "no") base.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "PayoutLine" l WHERE l."itemId" = i."id")`);
  if (query.sold === "yes") base.push(Prisma.sql`EXISTS (SELECT 1 FROM "Sale" s WHERE s."itemId" = i."id")`);
  if (query.sold === "no") base.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "Sale" s WHERE s."itemId" = i."id")`);

  const derived: Prisma.Sql[] = [];
  if (query.soldFrom) derived.push(Prisma.sql`"soldAt" >= ${query.soldFrom.getTime()}`);
  if (query.soldTo) derived.push(Prisma.sql`"soldAt" < ${query.soldTo.getTime()}`);

  // Page first, decorate after: the derived columns cost two index lookups per item,
  // so they're computed for the whole account only when a sort or filter needs them
  // (on a ~340k-item STORE account that's seconds; for one page, milliseconds).
  const needsSold = derived.length > 0 || query.sort === "sold";
  const needsPayout = query.sort === "payout";
  const baseWhere = Prisma.join(base, " AND ");
  const inner = Prisma.sql`
    SELECT i."id", i."itemNumber", i."description", i."status", i."price", i."intakeDate"
      ${needsSold ? Prisma.sql`, (${SOLD_AT}) AS "soldAt"` : Prisma.empty}
      ${needsPayout ? Prisma.sql`, (SELECT p."payoutNumber" FROM (${LATEST_PAYOUT}) p) AS "payoutNumber"` : Prisma.empty}
    FROM "Item" i WHERE ${baseWhere}`;
  const derivedWhere = derived.length ? Prisma.sql`WHERE ${Prisma.join(derived, " AND ")}` : Prisma.empty;
  const orderBy = Prisma.raw(`${ORDER_BY[query.sort]} ${query.desc ? "DESC" : "ASC"} NULLS LAST, "itemNumber" ASC`);

  const [pageIds, countRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM (${inner}) ${derivedWhere} ORDER BY ${orderBy} LIMIT ${query.limit} OFFSET ${query.offset}`,
    derived.length
      ? prisma.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM (${inner}) ${derivedWhere}`
      : prisma.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM "Item" i WHERE ${baseWhere}`,
  ]);

  const ids = pageIds.map((r) => r.id);
  const decorated = ids.length
    ? await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT i."id", i."sku", i."description", i."status", i."price", i."intakeDate",
          (${SOLD_AT}) AS "soldAt", lp."id" AS "payoutId", lp."payoutNumber" AS "payoutNumber"
        FROM "Item" i
        LEFT JOIN "Payout" lp ON lp."id" = (SELECT p."id" FROM (${LATEST_PAYOUT}) p)
        WHERE i."id" IN (${Prisma.join(ids)})`
    : [];
  const byId = new Map(decorated.map((r) => [r.id as string, r]));
  const rows = ids.map((id) => byId.get(id)!);

  return {
    total: Number(countRows[0].n),
    items: rows.map(
      (r): AccountItemRow => ({
        id: r.id as string,
        sku: r.sku as string,
        description: r.description as string,
        status: r.status as string,
        price: Number(r.price),
        intakeDate: toIso(r.intakeDate)!,
        soldAt: toIso(r.soldAt),
        payoutId: (r.payoutId as string | null) ?? null,
        payoutNumber: r.payoutNumber == null ? null : Number(r.payoutNumber),
      })
    ),
  };
}

// Prisma stores SQLite DateTimes as epoch-ms integers; raw queries hand back a Date
// for a real DATETIME column but a bare number/bigint for an aggregate like MAX().
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return new Date(Number(v)).toISOString();
}

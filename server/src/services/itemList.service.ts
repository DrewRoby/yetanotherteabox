import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ITEM_STATUSES } from "../lib/enums";

// Filtered / sorted / paged item listing shared by the Inventory page (whole store,
// GET /items/browse) and an account's Items table (GET /accounts/:id/items). Always
// server-side: a migrated store holds ~900k items. Sale and payout dates sort and
// filter through the denormalized Item.soldAt / Item.paidOutAt columns (indexed per
// store — computing them live took ~7s store-wide); only the payout *number* shown per
// row is looked up, and only for the returned page.

export const ITEM_SORTS = ["created", "sold", "paidOut", "price", "sku", "description", "status", "category", "account"] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

export interface ItemListQuery {
  q?: string; // substring of SKU, description or brand
  status?: string;
  category?: string;
  sold?: "yes" | "no";
  paid?: "yes" | "no"; // on a non-rejected payout
  payoutNumber?: number; // items itemized on this payout
  createdFrom?: Date; // inclusive; "created" = intake date
  createdTo?: Date; // exclusive
  soldFrom?: Date;
  soldTo?: Date;
  paidFrom?: Date;
  paidTo?: Date;
  sort: ItemSort;
  desc: boolean;
  limit: number;
  offset: number;
}

export interface ItemListRow {
  id: string;
  sku: string;
  description: string;
  category: string;
  status: string;
  price: number;
  intakeDate: Date;
  soldAt: Date | null;
  paidOutAt: Date | null;
  payoutId: string | null; // latest payout itemizing this item
  payoutNumber: number | null;
  account: { id: string; name: string; accountType: string; isStoreAccount: boolean };
}

const ROW_SELECT = {
  id: true,
  sku: true,
  description: true,
  category: true,
  status: true,
  price: true,
  intakeDate: true,
  soldAt: true,
  paidOutAt: true,
  account: { select: { id: true, name: true, accountType: true, isStoreAccount: true } },
} satisfies Prisma.ItemSelect;

function range(from?: Date, to?: Date) {
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;
}

export async function listItems(scope: { storeId: string; accountId?: string }, query: ItemListQuery) {
  const where: Prisma.ItemWhereInput = {
    storeId: scope.storeId,
    ...(scope.accountId ? { accountId: scope.accountId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    // Prisma's `contains` is SQLite LIKE: case-insensitive for ASCII.
    ...(query.q
      ? { OR: [{ sku: { contains: query.q } }, { description: { contains: query.q } }, { brand: { contains: query.q } }] }
      : {}),
    ...(query.sold === "yes" ? { soldAt: { not: null } } : query.sold === "no" ? { soldAt: null } : {}),
    ...(query.paid === "yes" ? { paidOutAt: { not: null } } : query.paid === "no" ? { paidOutAt: null } : {}),
    ...(query.payoutNumber != null ? { payoutLines: { some: { payout: { payoutNumber: query.payoutNumber } } } } : {}),
  };
  const intake = range(query.createdFrom, query.createdTo);
  const sold = range(query.soldFrom, query.soldTo);
  const paid = range(query.paidFrom, query.paidTo);
  if (intake) where.intakeDate = intake;
  if (sold) where.soldAt = sold; // a date range implies "sold", overriding sold=no
  if (paid) where.paidOutAt = paid;

  const dir: Prisma.SortOrder = query.desc ? "desc" : "asc";
  const ORDER: Record<ItemSort, Prisma.ItemOrderByWithRelationInput> = {
    created: { intakeDate: dir },
    sold: { soldAt: dir },
    paidOut: { paidOutAt: dir },
    price: { price: dir },
    sku: { itemNumber: dir }, // SKUs are prefixed/padded strings; itemNumber is their number
    description: { description: dir },
    status: { status: dir },
    category: { category: dir },
    account: { account: { name: dir } },
  };
  const page = (w: Prisma.ItemWhereInput, orderBy: Prisma.ItemOrderByWithRelationInput[], skip: number, take: number) =>
    take > 0 ? prisma.item.findMany({ where: w, orderBy, skip, take, select: ROW_SELECT }) : Promise.resolve([]);
  const total = await prisma.item.count({ where });

  let items: Awaited<ReturnType<typeof page>>;
  if (query.sort === "sold" || query.sort === "paidOut") {
    // Unsold / never-paid items sort last in both directions. Paged as two segments —
    // dated rows in date order, then undated ones — rather than ORDER BY ... NULLS LAST,
    // which stops SQLite using the (storeId, soldAt/paidOutAt) index (~1s vs ~2ms).
    const field = query.sort === "sold" ? "soldAt" : "paidOutAt";
    const dated: Prisma.ItemWhereInput = { AND: [where, { [field]: { not: null } }] };
    const undated: Prisma.ItemWhereInput = { AND: [where, { [field]: null }] };
    // total − undated: the IS NULL count is an index seek; counting the dated side
    // directly re-scans most of the store when other filters are active.
    const datedCount = total - (await prisma.item.count({ where: undated }));
    const fromDated = await page(dated, [ORDER[query.sort], { itemNumber: "desc" }], query.offset, Math.min(query.limit, Math.max(0, datedCount - query.offset)));
    const fromUndated = await page(undated, [{ itemNumber: "desc" }], Math.max(0, query.offset - datedCount), query.limit - fromDated.length);
    items = [...fromDated, ...fromUndated];
  } else {
    items = await page(where, [ORDER[query.sort], { itemNumber: "desc" }], query.offset, query.limit);
  }

  // Latest payout per item on this page (an item sold, returned and resold can be on several).
  const lines = items.length
    ? await prisma.payoutLine.findMany({
        where: { itemId: { in: items.map((i) => i.id) } },
        select: { itemId: true, payout: { select: { id: true, payoutNumber: true } } },
      })
    : [];
  const latestPayout = new Map<string, { id: string; payoutNumber: number }>();
  for (const l of lines) {
    const current = latestPayout.get(l.itemId!);
    if (!current || l.payout.payoutNumber > current.payoutNumber) latestPayout.set(l.itemId!, l.payout);
  }

  return {
    total,
    items: items.map(
      (i): ItemListRow => ({
        ...i,
        payoutId: latestPayout.get(i.id)?.id ?? null,
        payoutNumber: latestPayout.get(i.id)?.payoutNumber ?? null,
      })
    ),
  };
}

export async function listCategories(storeId: string): Promise<string[]> {
  const rows = await prisma.item.groupBy({ by: ["category"], where: { storeId }, orderBy: { category: "asc" } });
  return rows.map((r) => r.category);
}

// Query-string parser shared by GET /items/browse and GET /accounts/:id/items, so both
// tables accept exactly the same filters. Dates are epoch ms (the client resolves the
// shop's local-day bounds); `*To` bounds are exclusive.
const dateParam = z.coerce.number().int().transform((ms) => new Date(ms));
export const itemListQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    status: z.enum(ITEM_STATUSES).optional(),
    category: z.string().trim().min(1).optional(),
    sold: z.enum(["yes", "no"]).optional(),
    paid: z.enum(["yes", "no"]).optional(),
    payout: z.coerce.number().int().positive().optional(),
    createdFrom: dateParam.optional(),
    createdTo: dateParam.optional(),
    soldFrom: dateParam.optional(),
    soldTo: dateParam.optional(),
    paidFrom: dateParam.optional(),
    paidTo: dateParam.optional(),
    // "payout" = the pre-2026-10-12 account-items key, kept so old links/history entries still work.
    sort: z
      .enum([...ITEM_SORTS, "payout"])
      .default("created")
      .transform((v): ItemSort => (v === "payout" ? "paidOut" : v)),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .transform(({ payout, dir, page, pageSize, ...rest }) => ({
    query: { ...rest, payoutNumber: payout, desc: dir === "desc", limit: pageSize, offset: (page - 1) * pageSize },
    page,
    pageSize,
  }));

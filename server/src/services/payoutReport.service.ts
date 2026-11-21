import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { parseTagNumber } from "../lib/barcode";
import { consignorShareOf, isBalanceBearing, unpaidSalesOf } from "./accounts.service";
import { addDays, parseLocalDate } from "./salesReport.service";

// Payout reports (Reports > Payouts, the account page's statement button): the point is
// proving to a consignor exactly which items each payout covered. Two views:
// - listPayouts: every payout in a date range, store-wide or for one account, searchable
//   by item # ("4545-12" → the payout(s) that paid that item), payout #, check #.
// - payoutStatement: one account's payouts in a range, fully itemized (item #, sale
//   date, sale price, amount credited), plus what's sold but not yet paid out — the same
//   rule a new payout would use (unpaidSalesOf), so the statement reconciles to it.
// Dates are local calendar days "YYYY-MM-DD" (parseLocalDate — see root CLAUDE.md's
// local-vs-UTC gotcha) on the payout's date (createdAt; = paidAt for every PAID payout
// Teabox makes, and Liberty's PAYOUT_TS for migrated ones).

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const payoutListQuery = z.object({
  accountId: z.string().min(1).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(), // inclusive
  q: z.string().trim().min(1).optional(),
  status: z.enum(["PAID", "ALL"]).default("PAID"), // ALL adds voided (REJECTED) and requested ones
  page: z.coerce.number().int().min(1).default(1),
  // Up to 100,000 so the PDF export can take a whole store's history (~55k) in one call.
  pageSize: z.coerce.number().int().min(1).max(100000).default(50),
});
export type PayoutListQuery = z.infer<typeof payoutListQuery>;

function dateRange(from?: string, to?: string) {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  return f || t ? { ...(f ? { gte: f } : {}), ...(t ? { lt: addDays(t, 1) } : {}) } : undefined;
}

// Payout ids whose lines cover an item with this tag number — via the Item tag index
// and PayoutLine(itemId), never a scan of every line in the store.
async function payoutIdsForTag(storeId: string, tag: { tagAccountNumber: number; accountItemNumber: number }) {
  const items = await prisma.item.findMany({ where: { storeId, ...tag }, select: { id: true } });
  if (!items.length) return [];
  const lines = await prisma.payoutLine.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    select: { payoutId: true },
  });
  return [...new Set(lines.map((l) => l.payoutId))];
}

export async function listPayouts(storeId: string, query: PayoutListQuery) {
  const { accountId, q, status, page, pageSize } = query;
  // Store scoping by account id rather than `account: { storeId }` (Payout has no
  // storeId; the relation filter cost ~230ms per query over 55k migrated payouts).
  const storeAccountIds = accountId
    ? (await prisma.account.findMany({ where: { id: accountId, storeId }, select: { id: true } })).map((a) => a.id)
    : (await prisma.account.findMany({ where: { storeId }, select: { id: true } })).map((a) => a.id);
  const where: Prisma.PayoutWhereInput = {
    accountId: { in: storeAccountIds },
    ...(status === "PAID" ? { status: "PAID" } : {}),
  };
  const created = dateRange(query.from, query.to);
  if (created) where.createdAt = created;
  if (q) {
    const tag = parseTagNumber(q);
    if (tag) {
      where.id = { in: await payoutIdsForTag(storeId, tag) };
    } else if (/^\d+$/.test(q)) {
      where.OR = [{ payoutNumber: Number(q) }, { checkNumber: q }];
    } else if (accountId) {
      // Item description, scoped to this account's payouts first (see accounts.routes'
      // payout search for why not `lines: { some: ... }`).
      const rows = await prisma.$queryRaw<{ payoutId: string }[]>`
        SELECT DISTINCT l."payoutId" FROM "Payout" p
        JOIN "PayoutLine" l ON l."payoutId" = p."id"
        JOIN "Item" i ON i."id" = l."itemId"
        WHERE p."accountId" = ${accountId} AND instr(lower(i."description"), ${q.toLowerCase()}) > 0`;
      where.id = { in: rows.map((r) => r.payoutId) };
    } else {
      where.OR = [{ account: { name: { contains: q } } }, { checkNumber: q }];
    }
  }
  const [rows, agg] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { payoutNumber: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        payoutNumber: true,
        createdAt: true,
        paidAt: true,
        status: true,
        method: true,
        checkNumber: true,
        amount: true,
        account: { select: { id: true, accountNumber: true, name: true } },
      },
    }),
    prisma.payout.aggregate({ where, _count: true, _sum: { amount: true } }),
  ]);
  // Items per payout, for this page only (a filtered relation _count took ~900ms).
  const counts = rows.length
    ? await prisma.payoutLine.groupBy({
        by: ["payoutId"],
        where: { payoutId: { in: rows.map((r) => r.id) }, itemId: { not: null } },
        _count: true,
      })
    : [];
  const itemCount = new Map(counts.map((c) => [c.payoutId, c._count]));
  return {
    rows: rows.map((r) => ({ ...r, itemCount: itemCount.get(r.id) ?? 0 })),
    total: agg._count,
    totalAmount: agg._sum.amount ?? 0,
    page,
    pageSize,
  };
}

export const statementQuery = z.object({
  accountId: z.string().min(1),
  from: dayKey.optional(),
  to: dayKey.optional(),
});

const roundCents = (n: number) => Math.round(n * 100) / 100;

export async function payoutStatement(storeId: string, query: z.infer<typeof statementQuery>) {
  const account = await prisma.account.findFirst({ where: { id: query.accountId, storeId } });
  if (!account) return null;
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true, location: true } });
  const created = dateRange(query.from, query.to);
  const payouts = await prisma.payout.findMany({
    // Voided (REJECTED) payouts paid nothing, so they don't belong on a statement.
    where: { accountId: account.id, status: { not: "REJECTED" }, ...(created ? { createdAt: created } : {}) },
    // Newest first (owner feedback, 2026-11-08): the latest payouts lead the statement —
    // on screen and in the Statement PDF alike. Lines within a payout stay chronological.
    orderBy: [{ createdAt: "desc" }, { payoutNumber: "desc" }],
    select: {
      id: true,
      payoutNumber: true,
      createdAt: true,
      paidAt: true,
      status: true,
      method: true,
      checkNumber: true,
      amount: true,
      lines: {
        select: {
          id: true,
          lineType: true,
          description: true,
          amount: true,
          item: {
            select: { id: true, sku: true, tagAccountNumber: true, accountItemNumber: true, description: true, category: true },
          },
          sale: { select: { saleDate: true, salePrice: true } },
        },
      },
    },
  });
  for (const p of payouts) {
    // Chronological by sale; unattached lines (adjustments, deductions) last — as PayoutDetail.
    p.lines.sort(
      (a, b) =>
        (a.sale?.saleDate.getTime() ?? Infinity) - (b.sale?.saleDate.getTime() ?? Infinity) ||
        a.lineType.localeCompare(b.lineType)
    );
  }
  const paidLines = payouts.flatMap((p) => p.lines);

  // Sold, not yet paid out — current as of now, whatever the date range.
  const bearing = isBalanceBearing(account);
  const unpaid = bearing
    ? (await unpaidSalesOf(account.id)).map((s) => ({
        saleId: s.id,
        saleDate: s.saleDate,
        salePrice: s.salePrice,
        item: s.item,
        credit: roundCents(consignorShareOf(s.salePrice, s.item.consignorPercent ?? account.splitPercent)),
      }))
    : null;

  return {
    generatedAt: new Date(),
    store,
    range: { from: query.from ?? null, to: query.to ?? null },
    account: {
      id: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      accountType: account.accountType,
      splitPercent: account.splitPercent,
      ...(bearing ? { currentBalance: account.currentBalance } : {}),
    },
    payouts,
    totals: {
      payouts: payouts.length,
      amount: roundCents(payouts.reduce((s, p) => s + p.amount, 0)),
      itemsPaid: paidLines.filter((l) => l.item).length,
      salesTotal: roundCents(paidLines.reduce((s, l) => s + (l.sale?.salePrice ?? 0), 0)),
    },
    unpaid: unpaid && {
      lines: unpaid,
      total: roundCents(unpaid.reduce((s, u) => s + u.credit, 0)),
      // The part of the current balance no unpaid sale explains (e.g. a balance carried
      // over from Liberty) — what a payout today would add as its ADJUSTMENT line. Shown
      // so the statement always reconciles to the balance.
      otherBalance: roundCents(account.currentBalance - unpaid.reduce((s, u) => s + u.credit, 0)),
    },
  };
}

import { prisma } from "../lib/prisma";

// Reports > Daily Sales Summary and Day Detail. Every day boundary here is the SERVER's
// local calendar day (root CLAUDE.md's local-vs-UTC gotcha): ranges are built with
// setDate/setHours on local Dates, and rows are bucketed with localDateKey() — never
// toISOString(). Dates are stored by Prisma as integer epoch ms, so raw queries bind
// getTime() values.

export interface Metrics {
  transactions: number; // distinct tickets (Sale.transactionId; a sale without one is its own ticket)
  itemsSold: number;
  grossSales: number;
  inventoryAdded: number; // tag value (Item.price) of items taken in
  itemsAdded: number;
  payouts: number; // amount of PAID payouts, by paidAt
  payoutCount: number;
}

export interface Range {
  from: Date; // inclusive
  to: Date; // exclusive
}

export function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// "YYYY-MM-DD" → local midnight, or null if malformed.
export function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDateKey(d) === value ? d : null;
}

export function startOfLocalDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Same weekday 52 weeks earlier — retail YoY, so a Saturday compares to a Saturday.
const YOY_DAYS = 364;

export function dayRange(day: Date): Range {
  return { from: day, to: addDays(day, 1) };
}

// Week to date: Sunday through `day`.
export function weekToDateRange(day: Date): Range {
  return { from: addDays(day, -day.getDay()), to: addDays(day, 1) };
}

export function yearToDateRange(day: Date): Range {
  return { from: new Date(day.getFullYear(), 0, 1), to: addDays(day, 1) };
}

export function lastYearOf(range: Range): Range {
  return { from: addDays(range.from, -YOY_DAYS), to: addDays(range.to, -YOY_DAYS) };
}

// YTD compares against the same calendar span last year (Jan 1 → same month/day), not a
// 364-day shift. Feb 29 maps to Feb 28.
export function lastYearToDate(day: Date): Range {
  const y = day.getFullYear() - 1;
  const lastDayOfMonth = new Date(y, day.getMonth() + 1, 0).getDate();
  const sameDay = new Date(y, day.getMonth(), Math.min(day.getDate(), lastDayOfMonth));
  return { from: new Date(y, 0, 1), to: addDays(sameDay, 1) };
}

const n = (v: unknown) => Number(v ?? 0);

export async function metricsBetween(storeId: string, { from, to }: Range): Promise<Metrics> {
  const f = from.getTime();
  const t = to.getTime();
  const [[sales], [items], [payouts]] = await Promise.all([
    prisma.$queryRaw<{ itemsSold: bigint; transactions: bigint; grossSales: number | null }[]>`
      SELECT COUNT(*) AS "itemsSold", COUNT(DISTINCT COALESCE("transactionId", "id")) AS "transactions",
             SUM("salePrice") AS "grossSales"
      FROM "Sale" WHERE "storeId" = ${storeId} AND "saleDate" >= ${f} AND "saleDate" < ${t}`,
    prisma.$queryRaw<{ itemsAdded: bigint; inventoryAdded: number | null }[]>`
      SELECT COUNT(*) AS "itemsAdded", SUM("price") AS "inventoryAdded"
      FROM "Item" WHERE "storeId" = ${storeId} AND "intakeDate" >= ${f} AND "intakeDate" < ${t}`,
    prisma.$queryRaw<{ payoutCount: bigint; payouts: number | null }[]>`
      SELECT COUNT(*) AS "payoutCount", SUM(p."amount") AS "payouts"
      FROM "Payout" p JOIN "Account" a ON a."id" = p."accountId"
      WHERE a."storeId" = ${storeId} AND p."status" = 'PAID' AND p."paidAt" >= ${f} AND p."paidAt" < ${t}`,
  ]);
  return {
    transactions: n(sales.transactions),
    itemsSold: n(sales.itemsSold),
    grossSales: n(sales.grossSales),
    inventoryAdded: n(items.inventoryAdded),
    itemsAdded: n(items.itemsAdded),
    payouts: n(payouts.payouts),
    payoutCount: n(payouts.payoutCount),
  };
}

function emptyMetrics(): Metrics {
  return { transactions: 0, itemsSold: 0, grossSales: 0, inventoryAdded: 0, itemsAdded: 0, payouts: 0, payoutCount: 0 };
}

// Per-day metrics for every local day in `range`, keyed by localDateKey. Fetches the
// rows and buckets them here (a 90-day range is ~10k sales) so the day boundaries are
// exactly the ones JS computes.
export async function dailyMetrics(storeId: string, range: Range): Promise<Map<string, Metrics>> {
  const buckets = new Map<string, Metrics>();
  for (let d = range.from; d < range.to; d = addDays(d, 1)) buckets.set(localDateKey(d), emptyMetrics());
  const f = range.from.getTime();
  const t = range.to.getTime();
  const [sales, items, payouts] = await Promise.all([
    prisma.$queryRaw<{ at: bigint | number; ticket: string; price: number }[]>`
      SELECT "saleDate" AS "at", COALESCE("transactionId", "id") AS "ticket", "salePrice" AS "price"
      FROM "Sale" WHERE "storeId" = ${storeId} AND "saleDate" >= ${f} AND "saleDate" < ${t}`,
    prisma.$queryRaw<{ at: bigint | number; price: number }[]>`
      SELECT "intakeDate" AS "at", "price" FROM "Item"
      WHERE "storeId" = ${storeId} AND "intakeDate" >= ${f} AND "intakeDate" < ${t}`,
    prisma.$queryRaw<{ at: bigint | number; amount: number }[]>`
      SELECT p."paidAt" AS "at", p."amount" FROM "Payout" p JOIN "Account" a ON a."id" = p."accountId"
      WHERE a."storeId" = ${storeId} AND p."status" = 'PAID' AND p."paidAt" >= ${f} AND p."paidAt" < ${t}`,
  ]);
  const bucketOf = (at: bigint | number) => buckets.get(localDateKey(new Date(Number(at))));
  const tickets = new Map<string, Set<string>>();
  for (const s of sales) {
    const key = localDateKey(new Date(Number(s.at)));
    const b = buckets.get(key);
    if (!b) continue;
    b.itemsSold += 1;
    b.grossSales += s.price;
    const set = tickets.get(key) ?? new Set<string>();
    set.add(s.ticket);
    tickets.set(key, set);
  }
  for (const [key, set] of tickets) buckets.get(key)!.transactions = set.size;
  for (const i of items) {
    const b = bucketOf(i.at);
    if (!b) continue;
    b.itemsAdded += 1;
    b.inventoryAdded += i.price;
  }
  for (const p of payouts) {
    const b = bucketOf(p.at);
    if (!b) continue;
    b.payoutCount += 1;
    b.payouts += p.amount;
  }
  return buckets;
}

export interface LedgerRow {
  date: string;
  current: Metrics;
  lastYear: Metrics; // same weekday 52 weeks earlier
  lastYearDate: string;
}

// `days` local days ending with `asOf`, newest first, each with its YoY comparable.
export async function salesLedger(storeId: string, asOf: Date, days: number): Promise<LedgerRow[]> {
  const range: Range = { from: addDays(asOf, -(days - 1)), to: addDays(asOf, 1) };
  const [current, lastYear] = await Promise.all([
    dailyMetrics(storeId, range),
    dailyMetrics(storeId, lastYearOf(range)),
  ]);
  const rows: LedgerRow[] = [];
  for (let d = asOf; d >= range.from; d = addDays(d, -1)) {
    const ly = addDays(d, -YOY_DAYS);
    rows.push({
      date: localDateKey(d),
      current: current.get(localDateKey(d)) ?? emptyMetrics(),
      lastYear: lastYear.get(localDateKey(ly)) ?? emptyMetrics(),
      lastYearDate: localDateKey(ly),
    });
  }
  return rows;
}

const rangeOut = (r: Range) => ({ from: localDateKey(r.from), to: localDateKey(addDays(r.to, -1)) });

// The comparables block: the day, week to date and year to date ending `asOf`, each
// against last year.
export async function salesPeriods(storeId: string, asOf: Date) {
  const periods = {
    day: { current: dayRange(asOf), lastYear: lastYearOf(dayRange(asOf)) },
    week: { current: weekToDateRange(asOf), lastYear: lastYearOf(weekToDateRange(asOf)) },
    year: { current: yearToDateRange(asOf), lastYear: lastYearToDate(asOf) },
  };
  const entries = await Promise.all(
    Object.entries(periods).map(async ([key, p]) => {
      const [current, lastYear] = await Promise.all([
        metricsBetween(storeId, p.current),
        metricsBetween(storeId, p.lastYear),
      ]);
      return [key, { range: rangeOut(p.current), lastYearRange: rangeOut(p.lastYear), current, lastYear }] as const;
    })
  );
  return Object.fromEntries(entries) as Record<keyof typeof periods, {
    range: { from: string; to: string };
    lastYearRange: { from: string; to: string };
    current: Metrics;
    lastYear: Metrics;
  }>;
}

// Each Day Detail list is capped — a migrated bulk-intake day can have thousands of
// rows. The response says when a list was cut (`total` > rows returned).
const DETAIL_LIMIT = 1000;

export async function dayDetail(storeId: string, day: Date) {
  const { from, to } = dayRange(day);
  const inDay = { gte: from, lt: to };
  const itemSelect = {
    id: true,
    sku: true,
    description: true,
    category: true,
    account: { select: { id: true, name: true } },
  } as const;

  const [metrics, sales, salesTotal, added, addedTotal, priced, pricedTotal, printJobs, payouts] = await Promise.all([
    metricsBetween(storeId, { from, to }),
    prisma.sale.findMany({
      where: { storeId, saleDate: inDay },
      orderBy: { saleDate: "asc" },
      take: DETAIL_LIMIT,
      select: {
        id: true,
        saleDate: true,
        salePrice: true,
        paymentType: true,
        transactionId: true,
        processedBy: { select: { name: true } },
        item: { select: itemSelect },
      },
    }),
    prisma.sale.count({ where: { storeId, saleDate: inDay } }),
    prisma.item.findMany({
      where: { storeId, intakeDate: inDay },
      orderBy: { intakeDate: "asc" },
      take: DETAIL_LIMIT,
      select: { ...itemSelect, intakeDate: true, price: true, status: true },
    }),
    prisma.item.count({ where: { storeId, intakeDate: inDay } }),
    prisma.itemHistory.findMany({
      where: { changeType: "PRICE_CHANGE", timestamp: inDay, item: { storeId } },
      orderBy: { timestamp: "asc" },
      take: DETAIL_LIMIT,
      select: {
        id: true,
        timestamp: true,
        oldValue: true,
        newValue: true,
        changedBy: { select: { name: true } },
        item: { select: itemSelect },
      },
    }),
    prisma.itemHistory.count({ where: { changeType: "PRICE_CHANGE", timestamp: inDay, item: { storeId } } }),
    prisma.printJob.findMany({
      where: { storeId, createdAt: inDay },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        source: true,
        itemCount: true,
        createdBy: { select: { name: true } },
        items: {
          orderBy: { position: "asc" },
          select: { id: true, itemId: true, sku: true, description: true, price: true },
        },
      },
    }),
    prisma.payout.findMany({
      where: { status: "PAID", paidAt: inDay, account: { storeId } },
      orderBy: { paidAt: "asc" },
      select: {
        id: true,
        payoutNumber: true,
        amount: true,
        paidAt: true,
        account: { select: { id: true, name: true, accountType: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return {
    date: localDateKey(day),
    metrics,
    sold: { rows: sales, total: salesTotal },
    added: { rows: added, total: addedTotal },
    priced: { rows: priced, total: pricedTotal },
    printJobs,
    payouts,
  };
}

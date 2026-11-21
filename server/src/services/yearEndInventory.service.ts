import { z } from "zod";
import { prisma } from "../lib/prisma";
import { addDays, localDateKey, parseLocalDate } from "./salesReport.service";

// Year-End Inventory (Reports, Manager+). Hidden Treasures reports its store inventory
// to the IRS each year as the last three years' worth of unsold store-owned items,
// assuming anything older has left the store (owner, 2026-11-08). This reconstructs
// that list as of any day — normally Dec 31:
//
// - store-owned: on the built-in STORE account or a flagged store account (the 800xx
//   year buckets). Lost & Found and consignments are someone else's.
// - acquired in the window: the `years` years ending on the as-of day, by the store's
//   acquisition date — Item.flippedAt for an expired consignment kept by the store,
//   else intakeDate.
// - still on hand at the end of that day: AVAILABLE/PENDING now, or sold / donated
//   after it (Item.soldAt / donatedAt). DISPOSED/RETURNED items carry no date, so they
//   can't be placed and are only counted in `undated`.
//
// Values are each item's *current* tag price (repricing history isn't kept per day) and
// recorded cost where there is one; how to value it for tax is the owner's / her
// accountant's call, so both are shown. A few thousand rows, so it's one query and
// in-memory grouping.

export const yearEndQuery = z.object({
  date: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const d = v ? parseLocalDate(v) : lastYearEnd();
      if (!d) ctx.addIssue({ code: "custom", message: "date must be YYYY-MM-DD" });
      return d ?? new Date(0);
    }),
  years: z.coerce.number().int().min(1).max(10).default(3),
});
export type YearEndQuery = z.infer<typeof yearEndQuery>;

function lastYearEnd(): Date {
  return new Date(new Date().getFullYear() - 1, 11, 31);
}

export interface YearEndRow {
  id: string;
  sku: string;
  tagAccountNumber: number | null;
  accountItemNumber: number | null;
  description: string;
  category: string;
  accountName: string;
  accountNumber: number | null;
  acquisition: string; // ACQUISITION key below
  acquiredAt: Date;
  status: string; // today's status
  leftAt: Date | null; // sold / donated date, if it has left since
  price: number;
  cost: number | null;
}

// Item.consignmentType → report bucket.
const ACQUISITION: Record<string, string> = {
  "Buy-Outright": "purchased",
  Trade: "trade",
  "Walk-in Donation": "walk-in",
  "Expired Consignment": "flipped",
};
export const ACQUISITION_ORDER = ["purchased", "trade", "walk-in", "flipped", "unrecorded"];

const num = (v: unknown) => (v == null ? null : Number(v));
const roundCents = (n: number) => Math.round(n * 100) / 100;

export async function yearEndRows(storeId: string, query: YearEndQuery) {
  const end = addDays(query.date, 1); // exclusive: the next local midnight
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - query.years);
  const s = start.getTime();
  const e = end.getTime();
  // Two branches instead of COALESCE(flippedAt, intakeDate), so the intake branch can
  // use the (storeId, intakeDate) index.
  const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT i."id", i."sku", i."tagAccountNumber", i."accountItemNumber", i."description", i."category",
            a."name" AS "accountName", a."accountNumber", i."consignmentType", i."status", i."price", i."cost",
            COALESCE(i."flippedAt", i."intakeDate") AS "acquiredAt",
            CASE i."status" WHEN 'SOLD' THEN i."soldAt" WHEN 'DONATED' THEN i."donatedAt" END AS "leftAt"
     FROM "Item" i JOIN "Account" a ON a."id" = i."accountId"
     WHERE i."storeId" = ?1 AND (a."accountType" = 'STORE' OR a."isStoreAccount" = 1)
       AND (   (i."flippedAt" IS NULL AND i."intakeDate" >= ?2 AND i."intakeDate" < ?3)
            OR (i."flippedAt" IS NOT NULL AND i."flippedAt" >= ?2 AND i."flippedAt" < ?3))
       AND (   i."status" IN ('AVAILABLE','PENDING')
            OR (i."status" = 'SOLD' AND i."soldAt" >= ?3)
            OR (i."status" = 'DONATED' AND i."donatedAt" >= ?3)
            OR i."status" IN ('DISPOSED','RETURNED'))`,
    storeId,
    s,
    e
  );
  const rows: YearEndRow[] = [];
  let undated = 0;
  for (const r of raw) {
    if (r.status === "DISPOSED" || r.status === "RETURNED") {
      undated++;
      continue;
    }
    rows.push({
      id: String(r.id),
      sku: String(r.sku),
      tagAccountNumber: num(r.tagAccountNumber),
      accountItemNumber: num(r.accountItemNumber),
      description: String(r.description),
      category: String(r.category),
      accountName: String(r.accountName),
      accountNumber: num(r.accountNumber),
      acquisition: ACQUISITION[String(r.consignmentType)] ?? "unrecorded",
      acquiredAt: new Date(Number(r.acquiredAt)),
      status: String(r.status),
      leftAt: r.leftAt == null ? null : new Date(Number(r.leftAt)),
      price: Number(r.price),
      cost: num(r.cost),
    });
  }
  rows.sort((a, b) => b.acquiredAt.getTime() - a.acquiredAt.getTime() || a.sku.localeCompare(b.sku));
  return { asOf: localDateKey(query.date), from: localDateKey(start), years: query.years, rows, undated };
}

interface Bucket {
  key: string;
  count: number;
  retail: number;
  cost: number; // sum of recorded costs
  costed: number; // items with a cost above $0 — Liberty stored 0 when nobody entered one
}

function bucket(key: string): Bucket {
  return { key, count: 0, retail: 0, cost: 0, costed: 0 };
}
function add(b: Bucket, r: YearEndRow) {
  b.count++;
  b.retail += r.price;
  if (r.cost != null && r.cost > 0) {
    b.cost += r.cost;
    b.costed++;
  }
}
const finish = (b: Bucket) => ({ ...b, retail: roundCents(b.retail), cost: roundCents(b.cost) });

export async function yearEndSummary(storeId: string, query: YearEndQuery) {
  const { rows, ...meta } = await yearEndRows(storeId, query);
  const totals = bucket("total");
  const byYear = new Map<string, Bucket>();
  const byAcquisition = new Map(ACQUISITION_ORDER.map((k) => [k, bucket(k)]));
  let soldSince = 0;
  for (const r of rows) {
    add(totals, r);
    const y = String(r.acquiredAt.getFullYear());
    if (!byYear.has(y)) byYear.set(y, bucket(y));
    add(byYear.get(y)!, r);
    add(byAcquisition.get(r.acquisition)!, r);
    if (r.leftAt) soldSince++;
  }
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true, location: true } });
  return {
    ...meta,
    store,
    generatedAt: new Date(),
    totals: finish(totals),
    leftSince: soldSince, // counted as on hand then, gone (sold/donated) by now
    byYear: [...byYear.values()].sort((a, b) => b.key.localeCompare(a.key)).map(finish),
    byAcquisition: [...byAcquisition.values()].filter((b) => b.count > 0).map(finish),
  };
}

const CSV_ACQUISITION: Record<string, string> = {
  purchased: "Purchased",
  trade: "Trade",
  "walk-in": "Walk-in donation",
  flipped: "Expired consignment kept",
  unrecorded: "Not recorded",
};

export function yearEndCsv(rows: YearEndRow[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["item_number", "sku", "description", "category", "account", "acquired", "acquired_date", "status_now", "left_date", "price", "cost"];
  const lines = rows.map((r) =>
    [
      r.tagAccountNumber != null && r.accountItemNumber != null ? `${r.tagAccountNumber}-${r.accountItemNumber}` : "",
      r.sku,
      r.description,
      r.category,
      r.accountNumber != null ? `${r.accountNumber} ${r.accountName}` : r.accountName,
      CSV_ACQUISITION[r.acquisition],
      localDateKey(r.acquiredAt),
      r.status,
      r.leftAt ? localDateKey(r.leftAt) : "",
      r.price.toFixed(2),
      // $0 is a real cost only for a walk-in donation; elsewhere it's Liberty's "not entered".
      r.cost != null && (r.cost > 0 || r.acquisition === "walk-in") ? r.cost.toFixed(2) : "",
    ]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

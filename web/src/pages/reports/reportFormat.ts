// Shared shapes + formatting for Reports > Daily Sales Summary / Day Detail. Mirrors
// server/src/services/salesReport.service.ts's Metrics.

export interface Metrics {
  transactions: number;
  itemsSold: number;
  grossSales: number;
  inventoryAdded: number;
  itemsAdded: number;
  payouts: number;
  payoutCount: number;
}

export const money = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const count = (v: number) => v.toLocaleString();
export const avgTicket = (m: Metrics) => (m.transactions ? m.grossSales / m.transactions : 0);

// "YYYY-MM-DD" in the browser's local calendar (the server buckets by its own local day;
// both run in the shop, same zone).
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDateKey(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

export const todayKey = () => localDateKey(new Date());

// "Mon, Oct 12, 2026"
export function longDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "Oct 12" / "Oct 12, 2025" when the year differs from `relativeTo`'s.
export function shortDate(key: string, relativeTo?: string): string {
  const d = parseDateKey(key);
  const showYear = !relativeTo || relativeTo.slice(0, 4) !== key.slice(0, 4);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(showYear ? { year: "numeric" } : {}) });
}

export function weekday(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: "short" });
}

// Percent change vs last year, or null when there's nothing to compare against.
export function change(current: number, lastYear: number): number | null {
  if (!lastYear) return null;
  return (current - lastYear) / lastYear;
}

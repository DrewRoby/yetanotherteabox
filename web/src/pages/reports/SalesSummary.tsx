import { useEffect, useState } from "react";
import { api, getToken } from "../../api/client";
import { Button, Card } from "../../components/Card";
import { DateStepper, Delta } from "./DateStepper";
import { avgTicket, change, count, longDate, money, shortDate, weekday, type Metrics } from "./reportFormat";

interface Period {
  range: { from: string; to: string };
  lastYearRange: { from: string; to: string };
  current: Metrics;
  lastYear: Metrics;
}
interface LedgerRow {
  date: string;
  current: Metrics;
  lastYear: Metrics;
  lastYearDate: string;
}
interface Summary {
  asOf: string;
  days: number;
  periods: { day: Period; week: Period; year: Period };
  ledger: LedgerRow[];
}

const LEDGER_DAYS = [7, 14, 30, 60, 90];

// The rows of the comparables table, in display order.
const MEASURES: {
  label: string;
  value: (m: Metrics) => number;
  fmt: (v: number) => string;
  sub?: (m: Metrics) => string;
}[] = [
  { label: "Transactions", value: (m) => m.transactions, fmt: count },
  { label: "Items Sold", value: (m) => m.itemsSold, fmt: count },
  { label: "Gross Sales", value: (m) => m.grossSales, fmt: money },
  { label: "Avg Transaction", value: avgTicket, fmt: money },
  { label: "Inventory Added", value: (m) => m.inventoryAdded, fmt: money, sub: (m) => `${count(m.itemsAdded)} items` },
  { label: "Payouts", value: (m) => m.payouts, fmt: money, sub: (m) => `${count(m.payoutCount)} paid` },
];

// Reports > Daily Sales Summary: day / week-to-date / year-to-date, each against last
// year, then a per-day ledger. Clicking any row opens that day's Day Detail.
export function SalesSummary({
  date,
  days,
  onDate,
  onDays,
  onOpenDay,
}: {
  date: string;
  days: number;
  onDate: (date: string) => void;
  onDays: (days: number) => void;
  onOpenDay: (date: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<Summary>(`/reports/sales-summary?date=${date}&days=${days}`)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [date, days]);

  const stale = data && (data.asOf !== date || data.days !== days);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateStepper label="As of" value={date} onChange={onDate} />
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold uppercase tracking-wide">
            Ledger{" "}
            <select
              value={days}
              onChange={(e) => onDays(Number(e.target.value))}
              className="border border-ink px-2 py-1 ml-1 text-sm"
            >
              {LEDGER_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={() => downloadCsv(date, days)}>
            Export CSV
          </Button>
        </div>
      </div>

      {error && <p className="text-crimson text-sm">{error}</p>}
      {!data && !error && <p className="text-gray-500">Loading…</p>}
      {data && (
        <div className={stale ? "opacity-60 transition-opacity" : ""}>
          <Comparables data={data} onOpenDay={onOpenDay} />
          <Ledger data={data} onOpenDay={onOpenDay} />
        </div>
      )}
    </div>
  );
}

function Comparables({ data, onOpenDay }: { data: Summary; onOpenDay: (date: string) => void }) {
  const { day, week, year } = data.periods;
  const cols: { title: string; period: Period }[] = [
    { title: longDate(data.asOf), period: day },
    { title: "Week to Date", period: week },
    { title: "Year to Date", period: year },
  ];
  const range = (r: { from: string; to: string }) =>
    r.from === r.to ? shortDate(r.from) : `${shortDate(r.from, r.to)} – ${shortDate(r.to)}`;
  const th = "p-2 text-xs uppercase font-bold text-right";

  return (
    <Card className="mb-6">
      <h3 className="font-bold uppercase tracking-wide mb-1">Comparables</h3>
      <p className="text-xs text-gray-500 mb-4">
        Last year = the same weekday 52 weeks earlier (day, week); year to date runs Jan 1 through the same date last
        year. Week starts Sunday. Click a row for the day's detail.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.title} colSpan={3} className="p-2 text-center border-b-2 border-gold">
                  <div className="text-xs uppercase font-bold">{c.title}</div>
                  <div className="text-[10px] font-normal text-gray-500">
                    {range(c.period.range)} vs {range(c.period.lastYearRange)}
                  </div>
                </th>
              ))}
            </tr>
            <tr className="border-b border-gray-200">
              <th className="p-2 text-left text-xs uppercase font-bold">Measure</th>
              {cols.map((c) => (
                <PeriodHeads key={c.title} className={th} />
              ))}
            </tr>
          </thead>
          <tbody>
            {MEASURES.map((m) => (
              <tr
                key={m.label}
                onClick={() => onOpenDay(data.asOf)}
                className="border-b border-gray-100 cursor-pointer hover:bg-bone"
                title={`Open ${longDate(data.asOf)} detail`}
              >
                <td className="p-2 font-bold whitespace-nowrap">{m.label}</td>
                {cols.map(({ title, period }) => (
                  <PeriodCells key={title} measure={m} period={period} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PeriodHeads({ className }: { className: string }) {
  return (
    <>
      <th className={`${className} border-l border-gray-200`}>This Year</th>
      <th className={`${className} text-gray-500`}>Last Year</th>
      <th className={className}>Change</th>
    </>
  );
}

function PeriodCells({ measure, period }: { measure: (typeof MEASURES)[number]; period: Period }) {
  const cur = measure.value(period.current);
  const ly = measure.value(period.lastYear);
  return (
    <>
      <td className="p-2 text-right font-bold border-l border-gray-200 whitespace-nowrap">
        {measure.fmt(cur)}
        {measure.sub && <div className="text-[10px] font-normal text-gray-500">{measure.sub(period.current)}</div>}
      </td>
      <td className="p-2 text-right text-gray-500 whitespace-nowrap">
        {measure.fmt(ly)}
        {measure.sub && <div className="text-[10px]">{measure.sub(period.lastYear)}</div>}
      </td>
      <td className="p-2 text-right text-xs whitespace-nowrap">
        <Delta value={change(cur, ly)} />
      </td>
    </>
  );
}

const LEDGER_COLS: { label: string; value: (m: Metrics) => number; fmt: (v: number) => string; bold?: boolean }[] = [
  { label: "Transactions", value: (m) => m.transactions, fmt: count },
  { label: "Items Sold", value: (m) => m.itemsSold, fmt: count },
  { label: "Gross Sales", value: (m) => m.grossSales, fmt: money, bold: true },
  { label: "Inventory Added", value: (m) => m.inventoryAdded, fmt: money },
  { label: "Payouts", value: (m) => m.payouts, fmt: money },
];

function sumMetrics(rows: Metrics[]): Metrics {
  return rows.reduce(
    (t, m) => ({
      transactions: t.transactions + m.transactions,
      itemsSold: t.itemsSold + m.itemsSold,
      grossSales: t.grossSales + m.grossSales,
      inventoryAdded: t.inventoryAdded + m.inventoryAdded,
      itemsAdded: t.itemsAdded + m.itemsAdded,
      payouts: t.payouts + m.payouts,
      payoutCount: t.payoutCount + m.payoutCount,
    }),
    { transactions: 0, itemsSold: 0, grossSales: 0, inventoryAdded: 0, itemsAdded: 0, payouts: 0, payoutCount: 0 }
  );
}

function Ledger({ data, onOpenDay }: { data: Summary; onOpenDay: (date: string) => void }) {
  const rows = data.ledger;
  const chronological = rows.slice().reverse();
  const maxSales = Math.max(1, ...rows.flatMap((r) => [r.current.grossSales, r.lastYear.grossSales]));
  const total = sumMetrics(rows.map((r) => r.current));
  const totalLy = sumMetrics(rows.map((r) => r.lastYear));
  const th = "p-2 border-b-2 border-gold text-xs uppercase text-right";

  return (
    <Card>
      <h3 className="text-center font-bold uppercase tracking-wide mb-4">Sales Performance Ledger</h3>
      <div className="h-44 bg-bone border-l-2 border-b-2 border-ink flex items-end gap-1 p-4 pb-0">
        {chronological.map((r) => (
          <button
            key={r.date}
            onClick={() => onOpenDay(r.date)}
            className="flex-1 h-full flex items-end gap-px group"
            title={`${longDate(r.date)}: ${money(r.current.grossSales)} (last year ${money(r.lastYear.grossSales)})`}
          >
            <div
              className="flex-1 bg-crimson group-hover:bg-ink"
              style={{ height: `${Math.max(1, (r.current.grossSales / maxSales) * 100)}%` }}
            />
            <div
              className="w-1/3 bg-gold/60"
              style={{ height: `${Math.max(1, (r.lastYear.grossSales / maxSales) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1 mb-2">
        <span>{shortDate(chronological[0].date)}</span>
        <span className="flex gap-3">
          <span>
            <span className="inline-block w-2 h-2 bg-crimson mr-1" />
            Gross sales
          </span>
          <span>
            <span className="inline-block w-2 h-2 bg-gold/60 mr-1" />
            Same day last year
          </span>
        </span>
        <span>{shortDate(data.asOf)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr>
              <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Date</th>
              {LEDGER_COLS.map((c) => (
                <th key={c.label} className={th}>
                  {c.label}
                </th>
              ))}
              <th className={th}>Sales vs LY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.date}
                onClick={() => onOpenDay(r.date)}
                className="border-b border-gray-100 cursor-pointer hover:bg-bone"
                title={`Open ${longDate(r.date)} detail`}
              >
                <td className="p-2 whitespace-nowrap">
                  <span className="inline-block w-9 text-gray-500 text-xs uppercase">{weekday(r.date)}</span>
                  {shortDate(r.date, data.asOf)}
                </td>
                {LEDGER_COLS.map((c) => (
                  <td key={c.label} className="p-2 text-right whitespace-nowrap">
                    <span className={c.bold ? "font-bold" : ""}>{c.fmt(c.value(r.current))}</span>
                    <div className="text-[10px] text-gray-400">LY {c.fmt(c.value(r.lastYear))}</div>
                  </td>
                ))}
                <td className="p-2 text-right text-xs whitespace-nowrap">
                  <Delta value={change(r.current.grossSales, r.lastYear.grossSales)} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink font-bold">
              <td className="p-2">{data.days}-day total</td>
              {LEDGER_COLS.map((c) => (
                <td key={c.label} className="p-2 text-right whitespace-nowrap">
                  {c.fmt(c.value(total))}
                  <div className="text-[10px] font-normal text-gray-400">LY {c.fmt(c.value(totalLy))}</div>
                </td>
              ))}
              <td className="p-2 text-right text-xs">
                <Delta value={change(total.grossSales, totalLy.grossSales)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[10px] text-gray-500 mt-3">
        Sales before the switch to Teabox were posted to Liberty in nightly batches, so their transaction counts are
        posting batches rather than individual checkouts — compare transactions across that line with care.
      </p>
    </Card>
  );
}

async function downloadCsv(date: string, days: number) {
  const token = getToken();
  const res = await fetch(`/api/reports/sales-summary/export.csv?date=${date}&days=${days}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-sales-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, getToken } from "../../api/client";
import { Badge, Button, Card } from "../../components/Card";
import { Pager, rangeLabel } from "../../components/Pager";
import { exportPdf, pdfMoney } from "../../lib/pdf";
import { itemNo } from "../../lib/itemNumber";
import { formatDate, money } from "../accounts/format";

// Reports > Year-End Inventory: store-owned items acquired in the last N years (default
// 3) and still on hand at the end of the chosen day (default last Dec 31) — Hidden
// Treasures reports that to the IRS as its store inventory, assuming anything older has
// left. Server: services/yearEndInventory.service.ts. Shows current tag value and
// recorded cost side by side; how to value it is the owner's / accountant's call.
// URL keys "ye"-prefixed.

const PAGE_SIZE = 50;

interface Bucket {
  key: string;
  count: number;
  retail: number;
  cost: number;
  costed: number;
}

interface Summary {
  asOf: string;
  from: string;
  years: number;
  undated: number;
  leftSince: number;
  store: { name: string; location: string | null };
  totals: Bucket;
  byYear: Bucket[];
  byAcquisition: Bucket[];
}

interface Row {
  id: string;
  sku: string;
  tagAccountNumber: number | null;
  accountItemNumber: number | null;
  description: string;
  category: string;
  accountName: string;
  accountNumber: number | null;
  acquisition: string;
  acquiredAt: string;
  status: string;
  leftAt: string | null;
  price: number;
  cost: number | null;
}

const ACQUISITION_LABELS: Record<string, string> = {
  purchased: "Purchased",
  trade: "Trade",
  "walk-in": "Walk-in donation",
  flipped: "Expired consignment, kept",
  unrecorded: "Not recorded",
};

function lastYearEnd(): string {
  return `${new Date().getFullYear() - 1}-12-31`;
}

const longDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

export function YearEndInventory() {
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("yedate") ?? "") ? params.get("yedate")! : lastYearEnd();
  const years = Math.min(10, Math.max(1, Number(params.get("yeyears")) || 3));
  const page = Number(params.get("yepage")) || 1;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<{ total: number; rows: Row[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(changes: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v == null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true }
    );
  }

  const qs = `date=${date}&years=${years}`;
  useEffect(() => {
    let live = true;
    setSummary(null);
    api
      .get<Summary>(`/reports/year-end-inventory?${qs}`)
      .then((s) => live && setSummary(s))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Couldn't load the report"));
    return () => {
      live = false;
    };
  }, [qs]);
  useEffect(() => {
    let live = true;
    api
      .get<{ total: number; rows: Row[] }>(`/reports/year-end-inventory/items?${qs}&page=${page}&pageSize=${PAGE_SIZE}`)
      .then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [qs, page]);

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  const downloadCsv = () =>
    run("csv", async () => {
      const token = getToken();
      const res = await fetch(`/api/reports/year-end-inventory/export.csv?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `year-end-inventory-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const downloadPdf = () =>
    run("pdf", async () => {
      if (summary) await summaryPdf(summary);
    });

  const s = summary;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Inventory as of</label>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && update({ yedate: e.target.value === lastYearEnd() ? null : e.target.value, yepage: null })}
            className="border border-ink p-2"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Count items acquired in the last</label>
          <select
            value={years}
            onChange={(e) => update({ yeyears: e.target.value === "3" ? null : e.target.value, yepage: null })}
            className="border border-ink p-2 bg-white"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} year{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" disabled={!s || busy != null} onClick={downloadPdf}>
            {busy === "pdf" ? "Building…" : "Summary PDF"}
          </Button>
          <Button variant="secondary" disabled={!s || busy != null} onClick={downloadCsv}>
            {busy === "csv" ? "Exporting…" : "Item List CSV"}
          </Button>
        </div>
        {error && <p className="text-crimson text-xs w-full">{error}</p>}
      </Card>

      {!s ? (
        <Card className="text-gray-500">Loading…</Card>
      ) : (
        <>
          <Card>
            <p className="text-sm mb-3">
              Store-owned items acquired <strong>{longDate(s.from)}</strong> – <strong>{longDate(s.asOf)}</strong> and still in
              the store at the end of {longDate(s.asOf)}.
            </p>
            <div className="flex flex-wrap gap-10">
              <Stat label="Items" value={s.totals.count.toLocaleString()} />
              <Stat label="Tag value" value={money(s.totals.retail)} />
              <Stat
                label="Recorded cost"
                value={money(s.totals.cost)}
                sub={`${s.totals.costed.toLocaleString()} of ${s.totals.count.toLocaleString()} items have a cost`}
              />
            </div>
            <ul className="text-xs text-gray-500 mt-4 space-y-1 list-disc pl-4">
              <li>Tag value is each item's current price — Teabox doesn't keep what it was priced at on a past day.</li>
              {s.leftSince > 0 && (
                <li>
                  {s.leftSince.toLocaleString()} of these have sold or been donated since {longDate(s.asOf)}; they were still here
                  then, so they count.
                </li>
              )}
              {s.undated > 0 && (
                <li>
                  {s.undated.toLocaleString()} store items from the window are marked disposed or returned with no date, so they
                  aren't counted.
                </li>
              )}
              <li>Expired consignments the store kept count from the day they were flipped, not the day they came in.</li>
            </ul>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BucketTable title="By year acquired" rows={s.byYear} label={(k) => k} />
            <BucketTable title="By how the store got it" rows={s.byAcquisition} label={(k) => ACQUISITION_LABELS[k] ?? k} />
          </div>

          <Card>
            <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
              <h3 className="text-xs uppercase font-bold">Items</h3>
              {rows && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">{rangeLabel(page, PAGE_SIZE, rows.total)}</span>
                  <Pager
                    page={page}
                    pages={Math.max(1, Math.ceil(rows.total / PAGE_SIZE))}
                    onPage={(p) => update({ yepage: p > 1 ? String(p) : null })}
                  />
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-gray-500 border-b border-ink">
                    <th className="p-2">Item #</th>
                    <th className="p-2">Description</th>
                    <th className="p-2">Account</th>
                    <th className="p-2">How</th>
                    <th className="p-2">Acquired</th>
                    <th className="p-2">Now</th>
                    <th className="p-2 text-right">Tag Price</th>
                    <th className="p-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-200 hover:bg-bone">
                      <td className="p-2 whitespace-nowrap" title={r.sku}>
                        <Link to={`/inventory/${r.id}`} className="text-crimson font-bold hover:underline">
                          {itemNo(r)}
                        </Link>
                      </td>
                      <td className="p-2">
                        {r.description}
                        <span className="text-gray-500 text-xs"> · {r.category}</span>
                      </td>
                      <td className="p-2 text-xs">{r.accountNumber != null ? `${r.accountName} - ${r.accountNumber}` : r.accountName}</td>
                      <td className="p-2 text-xs">{ACQUISITION_LABELS[r.acquisition]}</td>
                      <td className="p-2 whitespace-nowrap">{formatDate(r.acquiredAt)}</td>
                      <td className="p-2 whitespace-nowrap">
                        {r.leftAt ? (
                          <span className="text-xs text-gray-600">
                            {r.status === "SOLD" ? "Sold" : "Donated"} {formatDate(r.leftAt)}
                          </span>
                        ) : (
                          <Badge>On floor</Badge>
                        )}
                      </td>
                      <td className="p-2 text-right">{money(r.price)}</td>
                      <td className="p-2 text-right">{r.cost != null && (r.cost > 0 || r.acquisition === "walk-in") ? money(r.cost) : "—"}</td>
                    </tr>
                  ))}
                  {rows && rows.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-gray-500">
                        No store-owned items in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}

function BucketTable({ title, rows, label }: { title: string; rows: Bucket[]; label: (key: string) => string }) {
  return (
    <Card>
      <h3 className="text-xs uppercase font-bold mb-3">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase text-gray-500 border-b border-ink">
            <th className="p-2"></th>
            <th className="p-2 text-right">Items</th>
            <th className="p-2 text-right">Tag Value</th>
            <th className="p-2 text-right">Recorded Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.key} className="border-b border-gray-200">
              <td className="p-2 font-bold">{label(b.key)}</td>
              <td className="p-2 text-right">{b.count.toLocaleString()}</td>
              <td className="p-2 text-right">{money(b.retail)}</td>
              <td className="p-2 text-right">
                {money(b.cost)}
                <span className="text-[10px] text-gray-500"> ({b.costed.toLocaleString()})</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="p-4 text-center text-gray-500">
                —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

async function summaryPdf(s: Summary) {
  const table = (rows: Bucket[], label: (k: string) => string) => ({
    head: ["", "Items", "Tag value", "Recorded cost", "Items with cost"],
    body: rows.map((b) => [label(b.key), b.count.toLocaleString(), pdfMoney(b.retail), pdfMoney(b.cost), b.costed.toLocaleString()]),
    foot: ["Total", s.totals.count.toLocaleString(), pdfMoney(s.totals.retail), pdfMoney(s.totals.cost), s.totals.costed.toLocaleString()],
    rightAlign: [1, 2, 3, 4],
  });
  await exportPdf({
    filename: `Year-End-Inventory-${s.asOf}`,
    storeName: s.store.name,
    title: "Year-End Store Inventory",
    subtitle: [
      `As of the end of ${longDate(s.asOf)}`,
      `Store-owned items acquired ${longDate(s.from)} - ${longDate(s.asOf)} and still in the store then`,
    ],
    summary: [
      ["Items", s.totals.count.toLocaleString()],
      ["Tag value (current prices)", pdfMoney(s.totals.retail)],
      ["Recorded cost", `${pdfMoney(s.totals.cost)} (${s.totals.costed.toLocaleString()} items with a cost)`],
      ...(s.leftSince ? ([["Sold or donated since", s.leftSince.toLocaleString()]] as [string, string][]) : []),
      ...(s.undated ? ([["Not counted (disposed/returned, no date)", s.undated.toLocaleString()]] as [string, string][]) : []),
    ],
    sections: [
      { heading: "By year acquired", ...table(s.byYear, (k) => k) },
      { heading: "By how the store got it", ...table(s.byAcquisition, (k) => ACQUISITION_LABELS[k] ?? k) },
    ],
    emptyText: "No store-owned items in this window.",
  });
}

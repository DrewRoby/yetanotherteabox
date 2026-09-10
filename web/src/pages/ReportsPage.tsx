import { useEffect, useState } from "react";
import { api, getToken } from "../api/client";
import { Button, Card } from "../components/Card";

interface DailySalesRow {
  date: string;
  transactions: number;
  grossSales: number;
}
interface AgingData {
  buckets: Record<string, number>;
  aged90Plus: { id: string; sku: string; description: string; price: number }[];
}
interface PayoutAccount {
  id: string;
  name: string;
  accountType: string;
  currentBalance: number;
}

const TABS = ["Daily Sales Summary", "Unsold Inventory Aging", "Consignor Payout Statements"] as const;

export function ReportsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold uppercase">Reports &amp; Analytics</h1>
        <Button variant="outline" onClick={() => downloadCsv()}>
          Export CSV
        </Button>
      </div>

      <div className="flex gap-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-bold uppercase border border-ink ${tab === t ? "bg-crimson text-white" : "bg-white"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Daily Sales Summary" && <DailySales />}
      {tab === "Unsold Inventory Aging" && <InventoryAging />}
      {tab === "Consignor Payout Statements" && <PayoutStatements />}
    </div>
  );
}

async function downloadCsv() {
  const token = getToken();
  const res = await fetch("/api/reports/daily-sales/export.csv?days=14", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "daily-sales.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function DailySales() {
  const [rows, setRows] = useState<DailySalesRow[]>([]);
  useEffect(() => {
    api.get<DailySalesRow[]>("/reports/daily-sales?days=7").then(setRows);
  }, []);
  const maxSales = Math.max(1, ...rows.map((r) => r.grossSales));

  return (
    <Card>
      <h3 className="text-center font-bold uppercase tracking-wide mb-6">Sales Performance Ledger</h3>
      <div className="h-44 bg-bone border-l-2 border-b-2 border-ink flex items-end gap-3 p-4 mb-6">
        {rows.map((r) => (
          <div
            key={r.date}
            className="flex-1 bg-crimson"
            style={{ height: `${Math.max(4, (r.grossSales / maxSales) * 100)}%` }}
            title={`${r.date}: $${r.grossSales.toFixed(2)}`}
          />
        ))}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Date</th>
            <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Transactions</th>
            <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Gross Sales</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .reverse()
            .map((r) => (
              <tr key={r.date} className="border-b border-gray-100">
                <td className="p-2">{r.date}</td>
                <td className="p-2">{r.transactions}</td>
                <td className="p-2 font-bold">${r.grossSales.toFixed(2)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </Card>
  );
}

function InventoryAging() {
  const [data, setData] = useState<AgingData | null>(null);
  useEffect(() => {
    api.get<AgingData>("/reports/inventory-aging").then(setData);
  }, []);
  if (!data) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {Object.entries(data.buckets).map(([bucket, count]) => (
          <Card key={bucket}>
            <div className="text-[10px] uppercase text-gray-500">{bucket} days</div>
            <div className="text-2xl font-bold text-crimson">{count}</div>
          </Card>
        ))}
      </div>
      <Card>
        <h3 className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">
          Aged 90+ Days (review for markdown/return)
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {data.aged90Plus.map((i) => (
              <tr key={i.id} className="border-b border-gray-100">
                <td className="p-2 font-mono text-xs">{i.sku}</td>
                <td className="p-2">{i.description}</td>
                <td className="p-2 text-right font-bold">${i.price.toFixed(2)}</td>
              </tr>
            ))}
            {data.aged90Plus.length === 0 && (
              <tr>
                <td className="p-4 text-center text-gray-400" colSpan={3}>
                  Nothing aged past 90 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PayoutStatements() {
  const [accounts, setAccounts] = useState<PayoutAccount[]>([]);
  useEffect(() => {
    api.get<PayoutAccount[]>("/reports/payouts").then(setAccounts);
  }, []);

  return (
    <Card>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Account</th>
            <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Type</th>
            <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Outstanding Balance</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b border-gray-100">
              <td className="p-2 font-bold">{a.name}</td>
              <td className="p-2">{a.accountType}</td>
              <td className="p-2 font-bold text-crimson">${a.currentBalance.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

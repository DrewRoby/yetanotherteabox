import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Card } from "../../components/Card";
import { money, money0, valueLabel } from "./auditVocab";

interface Data {
  owed: number;
  activeOwed: number;
  owedAccounts: number;
  negative: number;
  negativeAccounts: number;
  aging: { key: string; accounts: number; owed: number; activeOwed: number }[];
  top: { id: string; name: string; isActive: boolean; balance: number; lastActivity: string | null }[];
  negatives: { id: string; name: string; isActive: boolean; balance: number }[];
  inventory: { key: string; count: number; retail: number; consignorShare: number; storeShare: number }[];
}

const AGING_LABEL: Record<string, string> = {
  "<1y": "Active within a year",
  "1-3y": "1 – 3 years ago",
  "3-10y": "3 – 10 years ago",
  "10y+": "Over 10 years ago",
  never: "No recorded activity",
};
const th = "p-2 border-b-2 border-gold text-xs uppercase";

// What the store owes (consignor balances, aged by each account's last activity) and
// what the floor is worth, split by who it belongs to.
export function Obligations() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<Data>("/audit/obligations")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="text-crimson text-sm">{error}</p>;
  if (!data) return <p className="text-gray-500">Loading…</p>;

  const inv = data.inventory.reduce(
    (t, r) => ({ retail: t.retail + r.retail, consignor: t.consignor + r.consignorShare, count: t.count + r.count }),
    { retail: 0, consignor: 0, count: 0 }
  );

  return (
    <div className="space-y-6">
      <p className="text-xs bg-bone border border-gold p-3">
        <b>Pending owner validation.</b> Migrated balances were recomputed on 2026-10-12 from Liberty's unpaid ledger
        rows (the first migration had counted lifetime earnings). Spot-check a few against Liberty before relying on
        them.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Owed to Consignors"
          value={money0(data.owed)}
          sub={`${data.owedAccounts.toLocaleString()} accounts`}
        />
        <Stat label="…on Active Accounts" value={money0(data.activeOwed)} sub="excludes dormant accounts" />
        <Stat
          label="Negative Balances"
          value={money0(data.negative)}
          sub={`${data.negativeAccounts.toLocaleString()} accounts owe the store`}
        />
        <Stat
          label="Floor Value"
          value={money0(inv.retail)}
          sub={`${inv.count.toLocaleString()} items · ${money0(inv.consignor)} would go to consignors`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-bold uppercase tracking-wide mb-1">Balances by Last Activity</h3>
          <p className="text-[10px] text-gray-500 mb-3">Last intake, sale or payout on the account.</p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Last Activity</th>
                <th className={`${th} text-right`}>Accounts</th>
                <th className={`${th} text-right`}>Owed</th>
                <th className={`${th} text-right`}>On Active</th>
              </tr>
            </thead>
            <tbody>
              {data.aging.map((a) => (
                <tr key={a.key} className="border-b border-gray-100">
                  <td className="p-2">{AGING_LABEL[a.key] ?? a.key}</td>
                  <td className="p-2 text-right">{a.accounts.toLocaleString()}</td>
                  <td className="p-2 text-right font-bold">{money0(a.owed)}</td>
                  <td className="p-2 text-right text-gray-600">{money0(a.activeOwed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <h3 className="font-bold uppercase tracking-wide mb-1">Floor Value by Owner</h3>
          <p className="text-[10px] text-gray-500 mb-3">
            Available + pending items at tag price; consignor share uses each item's own split.{" "}
            <Link to="/audit" className="underline hover:text-crimson">
              Explore →
            </Link>
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Owner</th>
                <th className={`${th} text-right`}>Items</th>
                <th className={`${th} text-right`}>Retail</th>
                <th className={`${th} text-right`}>Consignor</th>
              </tr>
            </thead>
            <tbody>
              {data.inventory.map((r) => (
                <tr key={r.key} className="border-b border-gray-100">
                  <td className="p-2">
                    <Link to={`/audit?owner=${r.key}&groupBy=age`} className="hover:text-crimson hover:underline">
                      {valueLabel("owner", r.key)}
                    </Link>
                  </td>
                  <td className="p-2 text-right">{r.count.toLocaleString()}</td>
                  <td className="p-2 text-right font-bold">{money0(r.retail)}</td>
                  <td className="p-2 text-right text-gray-600">{money0(r.consignorShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card>
        <h3 className="font-bold uppercase tracking-wide mb-3">Largest Balances (top 50)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Account</th>
                <th className={`${th} text-left`}>Last Activity</th>
                <th className={`${th} text-right`}>Owed</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((a) => (
                <tr key={a.id} className="border-b border-gray-100">
                  <td className="p-2">
                    <Link to={`/accounts/${a.id}`} className="font-bold hover:text-crimson hover:underline">
                      {a.name}
                    </Link>
                    {!a.isActive && <span className="ml-2 text-[10px] uppercase text-gray-500">inactive</span>}
                  </td>
                  <td className="p-2 text-gray-600">
                    {a.lastActivity ? new Date(a.lastActivity).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-2 text-right font-bold">{money(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.negatives.length > 0 && (
        <Card>
          <h3 className="font-bold uppercase tracking-wide mb-1">Negative Balances</h3>
          <p className="text-[10px] text-gray-500 mb-3">
            Deductions or advances larger than what the account has earned — the consignor owes the store.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {data.negatives.map((a) => (
              <Link key={a.id} to={`/accounts/${a.id}`} className="hover:text-crimson hover:underline">
                {a.name} <span className="text-crimson">{money(a.balance)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="text-2xl font-black text-crimson mt-1">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </Card>
  );
}

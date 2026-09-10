import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Button, Card } from "../components/Card";

interface AccountRow {
  id: string;
  accountType: string;
  name: string;
  email: string | null;
  currentBalance?: number;
}

const TABS = [
  { type: "CONSIGNOR", label: "Consignors" },
  { type: "VENDOR", label: "Vendors" },
  { type: "DONOR", label: "Donors" },
  { type: "BOOTH_OWNER", label: "Booth Owners" },
  { type: "STORE", label: "Store" },
];

export function AccountsPage() {
  const { id } = useParams();
  if (id) return <AccountDetail id={id} />;

  const [tab, setTab] = useState("CONSIGNOR");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  useEffect(() => {
    api.get<AccountRow[]>(`/accounts?accountType=${tab}`).then(setAccounts);
  }, [tab]);

  return (
    <div className="p-8">
      <div className="flex gap-2 mb-6 border-b border-ink">
        {TABS.map((t) => (
          <button
            key={t.type}
            onClick={() => setTab(t.type)}
            className={`px-4 py-2 text-sm font-bold uppercase border-t border-l border-r border-ink -mb-px ${
              tab === t.type ? "bg-white" : "bg-bone2 text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "DONOR" && (
        <p className="text-xs text-gray-500 mb-4">
          Donor accounts have no balance or payouts — they are not owed money for donated items.
        </p>
      )}

      <div className="corner-ticks bg-white border border-ink overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Name</th>
              <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Email</th>
              {tab !== "DONOR" && tab !== "STORE" && (
                <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Balance</th>
              )}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-bone/50">
                <td className="p-3 font-bold">
                  <Link to={`/accounts/${a.id}`} className="hover:text-crimson">
                    {a.name}
                  </Link>
                </td>
                <td className="p-3">{a.email || "—"}</td>
                {tab !== "DONOR" && tab !== "STORE" && <td className="p-3 font-bold">${(a.currentBalance ?? 0).toFixed(2)}</td>}
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-gray-400">
                  No accounts of this type yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AccountDetailData extends AccountRow {
  splitPercent: number | null;
  items: { id: string; sku: string; description: string; status: string; price: number }[];
  payouts: { id: string; amount: number; status: string; createdAt: string }[];
}

function AccountDetail({ id }: { id: string }) {
  const [account, setAccount] = useState<AccountDetailData | null>(null);

  function reload() {
    api.get<AccountDetailData>(`/accounts/${id}`).then(setAccount);
  }
  useEffect(reload, [id]);

  if (!account) return <div className="p-8 text-gray-500">Loading…</div>;
  const showsBalance = account.currentBalance !== undefined;

  return (
    <div className="p-8 max-w-4xl">
      <Link to="/accounts" className="text-xs uppercase text-gray-500 hover:text-crimson">
        ← Back to Accounts
      </Link>
      <div className="flex justify-between items-start mt-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">{account.name}</h2>
          <Badge>{account.accountType}</Badge>
        </div>
        {showsBalance && account.currentBalance! > 0 && (
          <Button
            onClick={async () => {
              await api.post(`/accounts/${id}/payouts`, {});
              reload();
            }}
          >
            Generate Payout
          </Button>
        )}
      </div>

      {showsBalance && (
        <Card className="mb-6 flex gap-10">
          <div>
            <div className="text-[10px] uppercase text-gray-500">Balance</div>
            <div className="text-2xl font-bold text-crimson">${account.currentBalance!.toFixed(2)}</div>
          </div>
          {account.splitPercent != null && (
            <div>
              <div className="text-[10px] uppercase text-gray-500">Split</div>
              <div className="text-2xl font-bold">{account.splitPercent}%</div>
            </div>
          )}
        </Card>
      )}

      <h3 className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">Items</h3>
      <table className="w-full text-sm mb-8">
        <tbody>
          {account.items.map((i) => (
            <tr key={i.id} className="border-b border-gray-100">
              <td className="p-2 font-mono text-xs">{i.sku}</td>
              <td className="p-2">{i.description}</td>
              <td className="p-2">
                <Badge>{i.status}</Badge>
              </td>
              <td className="p-2 text-right font-bold">${i.price.toFixed(2)}</td>
            </tr>
          ))}
          {account.items.length === 0 && (
            <tr>
              <td className="p-4 text-gray-400 text-center" colSpan={4}>
                No items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showsBalance && (
        <>
          <h3 className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">Payout History</h3>
          <table className="w-full text-sm">
            <tbody>
              {account.payouts.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="p-2">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="p-2">
                    <Badge>{p.status}</Badge>
                  </td>
                  <td className="p-2 text-right font-bold">${p.amount.toFixed(2)}</td>
                </tr>
              ))}
              {account.payouts.length === 0 && (
                <tr>
                  <td className="p-4 text-gray-400 text-center" colSpan={3}>
                    No payouts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

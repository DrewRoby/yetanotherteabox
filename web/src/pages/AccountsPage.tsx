import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
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

const CAN_CREATE_ROLES = ["SYSTEM_ADMIN", "OWNER", "MANAGER"];

export function AccountsPage() {
  const { id } = useParams();
  if (id) return <AccountDetail id={id} />;

  const { user } = useAuth();
  const [tab, setTab] = useState("CONSIGNOR");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  function reload() {
    api.get<AccountRow[]>(`/accounts?accountType=${tab}`).then(setAccounts);
  }
  useEffect(reload, [tab]);

  const canCreate = user ? CAN_CREATE_ROLES.includes(user.activeRole) : false;

  return (
    <div className="p-8">
      <div className="flex justify-between items-end mb-6 border-b border-ink">
        <div className="flex gap-2">
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
        {canCreate && tab !== "STORE" && (
          <Button className="mb-2" onClick={() => setAddOpen(true)}>
            + Add Account
          </Button>
        )}
      </div>

      {addOpen && (
        <AddAccountModal
          accountType={tab}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            reload();
          }}
        />
      )}

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

function AddAccountModal({
  accountType,
  onClose,
  onCreated,
}: {
  accountType: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [splitPercent, setSplitPercent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tabLabel = TABS.find((t) => t.type === accountType)?.label.replace(/s$/, "") ?? accountType;
  const showsSplit = accountType !== "DONOR";

  async function handleCreate() {
    setError(null);
    setSaving(true);
    try {
      await api.post("/accounts", {
        accountType,
        name,
        email: email || undefined,
        phone: phone || undefined,
        splitPercent: showsSplit && splitPercent ? Number(splitPercent) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <Card className="w-[420px]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold uppercase text-sm">Add {tabLabel}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-crimson">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-ink p-2"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-ink p-2" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-ink p-2" />
          </div>
          {showsSplit && (
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Split % (their share)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={splitPercent}
                onChange={(e) => setSplitPercent(e.target.value)}
                placeholder="e.g. 60"
                className="w-full border border-ink p-2"
              />
            </div>
          )}
        </div>
        {error && <p className="text-crimson text-sm mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name || saving}>
            {saving ? "Saving…" : "Create Account"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

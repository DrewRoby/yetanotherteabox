import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card } from "../components/Card";

interface AccountRow {
  id: string;
  accountType: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastSaleAt: string | null;
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

type SortKey = "name" | "createdAt" | "lastSaleAt" | "balance";
// Dates and balances read most usefully newest/largest first; names A→Z.
const DEFAULT_DESC: Record<SortKey, boolean> = { name: false, createdAt: true, lastSaleAt: true, balance: true };

function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// One route component for the whole Accounts area: list, account detail, payout detail.
export function AccountsPage() {
  const { id, payoutId } = useParams();
  if (id && payoutId) return <PayoutDetail accountId={id} payoutId={payoutId} />;
  if (id) return <AccountDetail id={id} />;
  return <AccountList />;
}

function AccountList() {
  const { user } = useAuth();
  // Tab and search live in the URL so "← Back to Accounts" from a detail page returns
  // to the same filtered list instead of resetting to Consignors.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "CONSIGNOR";
  const query = params.get("q") ?? "";
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDesc, setSortDesc] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  }

  function reload() {
    api.get<AccountRow[]>(`/accounts?accountType=${tab}`).then(setAccounts);
  }
  useEffect(reload, [tab]);

  // Filtering is client-side over the already-loaded tab (a few thousand rows at most),
  // so results update on every keystroke with no request; useDeferredValue keeps the
  // input itself responsive while a large table re-renders.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const filtered = q
      ? accounts.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.email ?? "").toLowerCase().includes(q) ||
            (digits.length >= 3 && (a.phone ?? "").replace(/\D/g, "").includes(digits))
        )
      : accounts;
    const value = (a: AccountRow): string | number => {
      switch (sortKey) {
        case "name":
          return a.name.toLowerCase();
        case "createdAt":
          return a.createdAt;
        case "lastSaleAt":
          return a.lastSaleAt ?? "";
        case "balance":
          return a.currentBalance ?? 0;
      }
    };
    return [...filtered].sort((a, b) => {
      // Accounts with no sale yet always sort last, whichever direction.
      if (sortKey === "lastSaleAt" && !a.lastSaleAt !== !b.lastSaleAt) return a.lastSaleAt ? -1 : 1;
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "number" ? va - (vb as number) : va.localeCompare(vb as string);
      return sortDesc ? -cmp : cmp;
    });
  }, [accounts, deferredQuery, sortKey, sortDesc]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDesc(!sortDesc);
    else {
      setSortKey(key);
      setSortDesc(DEFAULT_DESC[key]);
    }
  }

  const canCreate = user ? CAN_CREATE_ROLES.includes(user.activeRole) : false;
  const showsBalance = tab !== "DONOR" && tab !== "STORE";
  const columnCount = showsBalance ? 4 : 3;

  function sortHeader(k: SortKey, label: string, align: "left" | "right" = "left") {
    const active = sortKey === k;
    return (
      <th key={k} className={`p-3 border-b-2 border-gold text-xs uppercase ${align === "right" ? "text-right" : "text-left"}`}>
        <button onClick={() => sortBy(k)} className={`uppercase ${active ? "text-crimson" : "hover:text-crimson"}`}>
          {label}
          <span className="ml-1 inline-block w-2">{active ? (sortDesc ? "▼" : "▲") : ""}</span>
        </button>
      </th>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-end mb-6 border-b border-ink">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.type}
              onClick={() => setParam("tab", t.type === "CONSIGNOR" ? "" : t.type)}
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

      <div className="flex items-center gap-4 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setParam("q", e.target.value)}
          placeholder="Search by name, email, or phone…"
          aria-label="Search accounts"
          className="w-full max-w-md border border-ink p-2 bg-white"
        />
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {query ? `${visible.length} of ${accounts.length}` : accounts.length} account{accounts.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="corner-ticks bg-white border border-ink">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {sortHeader("name", "Name")}
                {sortHeader("createdAt", "Created")}
                {sortHeader("lastSaleAt", "Latest Sale")}
                {showsBalance && sortHeader("balance", "Balance", "right")}
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-bone/50">
                  <td className="p-3 font-bold">
                    <Link to={`/accounts/${a.id}`} className="hover:text-crimson hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="p-3">{formatDate(a.createdAt)}</td>
                  <td className="p-3">{formatDate(a.lastSaleAt)}</td>
                  {showsBalance && <td className="p-3 font-bold text-right">{money(a.currentBalance ?? 0)}</td>}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="p-6 text-center text-gray-400">
                    {query ? `No accounts match "${query}".` : "No accounts of this type yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface PayoutSummary {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  itemCount: number;
}

interface AccountDetailData extends AccountRow {
  splitPercent: number | null;
  items: { id: string; sku: string; description: string; status: string; price: number }[];
  itemCount: number; // total; `items` is only the newest slice
  payouts: PayoutSummary[];
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
      <BackToAccounts />
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

      <Card className="mb-6 flex flex-wrap gap-10">
        {showsBalance && (
          <div>
            <div className="text-[10px] uppercase text-gray-500">Balance</div>
            <div className="text-2xl font-bold text-crimson">{money(account.currentBalance!)}</div>
          </div>
        )}
        {showsBalance && account.splitPercent != null && (
          <div>
            <div className="text-[10px] uppercase text-gray-500">Split</div>
            <div className="text-2xl font-bold">{account.splitPercent}%</div>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase text-gray-500">Created</div>
          <div className="text-2xl font-bold">{formatDate(account.createdAt)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500">Latest Sale</div>
          <div className="text-2xl font-bold">{formatDate(account.lastSaleAt)}</div>
        </div>
      </Card>

      {showsBalance && (
        <>
          <h3 className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">
            Payout History ({account.payouts.length})
          </h3>
          <table className="w-full text-sm mb-8">
            <thead>
              <tr className="text-[10px] uppercase text-gray-500">
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Items</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {account.payouts.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-bone/50">
                  <td className="p-2">
                    <Link to={`/accounts/${id}/payouts/${p.id}`} className="font-bold hover:text-crimson hover:underline">
                      {formatDate(p.paidAt ?? p.createdAt)}
                    </Link>
                  </td>
                  <td className="p-2">
                    <Badge>{p.status}</Badge>
                  </td>
                  <td className="p-2 text-right">{p.itemCount || "—"}</td>
                  <td className="p-2 text-right font-bold">{money(p.amount)}</td>
                </tr>
              ))}
              {account.payouts.length === 0 && (
                <tr>
                  <td className="p-4 text-gray-400 text-center" colSpan={4}>
                    No payouts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <h3 className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">
        Items ({account.itemCount})
      </h3>
      {account.itemCount > account.items.length && (
        <p className="text-xs text-gray-500 mb-2">
          Showing the {account.items.length} most recently received — search Inventory for the rest.
        </p>
      )}
      <table className="w-full text-sm">
        <tbody>
          {account.items.map((i) => (
            <tr key={i.id} className="border-b border-gray-100">
              <td className="p-2 font-mono text-xs">
                <Link to={`/inventory/${i.id}`} className="hover:text-crimson hover:underline">
                  {i.sku}
                </Link>
              </td>
              <td className="p-2">{i.description}</td>
              <td className="p-2">
                <Badge>{i.status}</Badge>
              </td>
              <td className="p-2 text-right font-bold">{money(i.price)}</td>
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
    </div>
  );
}

// Plain history-back when we came from inside the app (keeps the list's tab/search,
// which live in the URL); a direct link/bookmark falls back to the list root.
function BackToAccounts() {
  const canGoBack = typeof window !== "undefined" && window.history.state?.idx > 0;
  return canGoBack ? (
    <button onClick={() => window.history.back()} className="text-xs uppercase text-gray-500 hover:text-crimson">
      ← Back
    </button>
  ) : (
    <Link to="/accounts" className="text-xs uppercase text-gray-500 hover:text-crimson">
      ← Back to Accounts
    </Link>
  );
}

interface PayoutDetailData {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  account: { id: string; name: string; accountType: string };
  lines: {
    id: string;
    lineType: string;
    description: string | null;
    amount: number;
    item: { id: string; sku: string; description: string; category: string; size: string | null; price: number } | null;
    sale: { id: string; saleDate: string; salePrice: number } | null;
  }[];
}

const LINE_TYPE_LABELS: Record<string, string> = {
  SALE: "Sale",
  PURCHASE: "Purchase",
  RETURN: "Return",
  DEDUCTION: "Deduction",
  FEE: "Fee",
  ADVANCE: "Advance",
  ADJUSTMENT: "Adjustment",
};

function PayoutDetail({ accountId, payoutId }: { accountId: string; payoutId: string }) {
  const [payout, setPayout] = useState<PayoutDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PayoutDetailData>(`/accounts/${accountId}/payouts/${payoutId}`)
      .then(setPayout)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load payout."));
  }, [accountId, payoutId]);

  if (error) return <div className="p-8 text-crimson">{error}</div>;
  if (!payout) return <div className="p-8 text-gray-500">Loading…</div>;

  const itemCount = payout.lines.filter((l) => l.item).length;
  const lineTotal = payout.lines.reduce((sum, l) => sum + l.amount, 0);

  return (
    <div className="p-8 max-w-5xl">
      <BackToAccounts />
      <div className="mt-4 mb-6">
        <div className="text-xs uppercase text-gray-500">
          Payout to{" "}
          <Link to={`/accounts/${payout.account.id}`} className="font-bold text-ink hover:text-crimson hover:underline">
            {payout.account.name}
          </Link>
        </div>
        <h2 className="text-2xl font-bold">{formatDate(payout.paidAt ?? payout.createdAt)}</h2>
      </div>

      <Card className="mb-6 flex flex-wrap gap-10">
        <div>
          <div className="text-[10px] uppercase text-gray-500">Amount</div>
          <div className="text-2xl font-bold text-crimson">{money(payout.amount)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500">Status</div>
          <div className="mt-1">
            <Badge>{payout.status}</Badge>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500">Items</div>
          <div className="text-2xl font-bold">{itemCount}</div>
        </div>
      </Card>

      {payout.lines.length === 0 ? (
        <p className="text-sm text-gray-500">
          This payout has no itemized lines — it was {payout.status === "PAID" ? "recorded" : "requested"} as a lump sum.
        </p>
      ) : (
        <div className="corner-ticks bg-white border border-ink">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Item</th>
                  <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Description</th>
                  <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Type</th>
                  <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Sold</th>
                  <th className="text-right p-3 border-b-2 border-gold text-xs uppercase">Sale Price</th>
                  <th className="text-right p-3 border-b-2 border-gold text-xs uppercase">Credited</th>
                </tr>
              </thead>
              <tbody>
                {payout.lines.map((l) => (
                  <tr key={l.id} className="border-b border-gray-100 hover:bg-bone/50">
                    <td className="p-3 font-mono text-xs">
                      {l.item ? (
                        <Link to={`/inventory/${l.item.id}`} className="hover:text-crimson hover:underline">
                          {l.item.sku}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3">
                      {l.item ? l.item.description : l.description ?? "—"}
                      {l.item && l.description && l.lineType !== "SALE" && (
                        <div className="text-xs text-gray-500">{l.description}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge tone={l.amount < 0 ? "warning" : "default"}>{LINE_TYPE_LABELS[l.lineType] ?? l.lineType}</Badge>
                    </td>
                    <td className="p-3">{formatDate(l.sale?.saleDate)}</td>
                    <td className="p-3 text-right">{l.sale ? money(l.sale.salePrice) : "—"}</td>
                    <td className={`p-3 text-right font-bold ${l.amount < 0 ? "text-crimson" : ""}`}>{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="p-3 text-right text-xs uppercase font-bold border-t-2 border-gold">
                    Total
                  </td>
                  <td className="p-3 text-right font-bold border-t-2 border-gold">{money(lineTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
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

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card } from "../components/Card";
import { Barcode } from "../components/Barcode";
import { AccountPicker, type AccountOption } from "../components/AccountPicker";

interface ItemDetail {
  id: string;
  sku: string;
  description: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  style: string | null;
  pattern: string | null;
  size: string | null;
  serialNumber: string | null;
  condition: string | null;
  status: string;
  intakeDate: string;
  price: number;
  priceQuickSale: number | null;
  pricePremium: number | null;
  account: { id: string; name: string; accountType: string; splitPercent: number | null; currentBalance: number };
  history: { id: string; changeType: string; oldValue: string | null; newValue: string | null; timestamp: string }[];
  sales: { id: string; saleDate: string; salePrice: number }[];
  _count: { payoutLines: number };
}

// Mirrors server/src/routes/items.routes.ts PATCH/DELETE /items/:id — the server is the
// real gate; these only decide which controls to offer.
const STAFF = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"];
const MANAGER_UP = ["SYSTEM_ADMIN", "OWNER", "MANAGER"];
const EDITABLE_STATUSES = ["AVAILABLE", "PENDING", "DONATED", "DISPOSED", "RETURNED"];
const TEXT_FIELDS: { key: keyof ItemDetail & string; label: string; required?: boolean }[] = [
  { key: "description", label: "Item Name", required: true },
  { key: "category", label: "Category", required: true },
  { key: "subcategory", label: "Subcategory" },
  { key: "brand", label: "Brand" },
  { key: "style", label: "Style" },
  { key: "pattern", label: "Pattern" },
  { key: "size", label: "Size" },
  { key: "condition", label: "Condition" },
  { key: "serialNumber", label: "Serial #" },
];
const PRICE_FIELDS: { key: "price" | "priceQuickSale" | "pricePremium"; label: string; required?: boolean }[] = [
  { key: "price", label: "Price", required: true },
  { key: "priceQuickSale", label: "Quick-Sale Price" },
  { key: "pricePremium", label: "Premium Price" },
];

const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const date = (iso: string) => new Date(iso).toLocaleDateString();

export function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!id) return;
    api
      .get<ItemDetail>(`/items/${id}`)
      .then(setItem)
      .catch(() => setError("You are not authorized to view this item, or it does not exist."));
  }
  useEffect(load, [id]);

  if (error) return <div className="p-8 text-crimson font-semibold">{error}</div>;
  if (!item) return <div className="p-8 text-gray-500">Loading…</div>;

  const role = user?.activeRole ?? "";
  const isStaff = STAFF.includes(role);
  const isManagerUp = MANAGER_UP.includes(role);
  const hasFinancialRecords = item.sales.length > 0 || item._count.payoutLines > 0;

  async function run(action: () => Promise<void>) {
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const reprint = () =>
    run(async () => {
      await api.post("/items/print-batch", { itemIds: [item.id] });
      setNotice(`Tag for ${item.sku} sent to the printer.`);
    });

  const remove = () => {
    if (!window.confirm(`Delete "${item.description}" (${item.sku})? This can't be undone.`)) return;
    run(async () => {
      await api.del(`/items/${item.id}`);
      navigate("/inventory", { replace: true });
    });
  };

  return (
    <div className="p-8">
      <BackLink />

      <div className="flex flex-wrap items-center gap-3 mt-4">
        {isStaff && !editing && (
          <Button onClick={() => setEditing(true)} disabled={busy}>
            Edit Item
          </Button>
        )}
        <Button variant="outline" onClick={reprint} disabled={busy || editing}>
          Reprint Tag
        </Button>
        {isManagerUp && !editing && (
          <span title={hasFinancialRecords ? "Items with sale or payout records can't be deleted" : undefined}>
            <Button variant="secondary" onClick={remove} disabled={busy || hasFinancialRecords}>
              Delete Item
            </Button>
          </span>
        )}
        {hasFinancialRecords && isManagerUp && !editing && (
          <span className="text-xs text-gray-500">Has sale/payout records — set it to Disposed instead of deleting.</span>
        )}
      </div>
      {notice && <p className="text-sm text-crimson font-semibold mt-3">{notice}</p>}
      {actionError && <p className="text-sm text-crimson mt-3">{actionError}</p>}

      <div className="flex flex-wrap gap-6 mt-4">
        <Card className="flex-[1.8] min-w-[320px] border-t-4 border-t-crimson2">
          {editing ? (
            <EditItemForm
              item={item}
              canChangePriceAndAccount={isManagerUp}
              onCancel={() => setEditing(false)}
              onSaved={(updated) => {
                setEditing(false);
                setNotice(updated ? "Changes saved." : "No changes to save.");
                load();
              }}
            />
          ) : (
            <ItemView item={item} />
          )}

          <section className="mt-8">
            <h3 className="text-xs uppercase tracking-wide text-crimson border-b border-gold inline-block pb-1 mb-3">
              Inventory History
            </h3>
            <table className="w-full text-sm">
              <thead className="bg-bone border-y border-ink">
                <tr>
                  <th className="text-left p-2 uppercase text-xs">Date</th>
                  <th className="text-left p-2 uppercase text-xs">Action</th>
                  <th className="text-right p-2 uppercase text-xs">Details</th>
                </tr>
              </thead>
              <tbody>
                {item.history.map((h) => (
                  <tr key={h.id} className="border-b border-gray-100">
                    <td className="p-2 whitespace-nowrap">{date(h.timestamp)}</td>
                    <td className="p-2">{h.changeType.replace("_", " ")}</td>
                    <td className="p-2 text-right">{h.oldValue ? `${h.oldValue} → ${h.newValue}` : h.newValue}</td>
                  </tr>
                ))}
                {item.history.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-center text-gray-400">
                      No history recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </Card>

        <Card className="flex-1 min-w-[260px] bg-bone">
          <h3 className="text-xs uppercase tracking-wide border-b border-gold inline-block pb-1 mb-4">Account</h3>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-ink text-bone flex items-center justify-center font-bold">
              {item.account.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="font-bold">{item.account.name}</div>
              <div className="text-[11px] text-crimson font-bold">{item.account.accountType}</div>
            </div>
          </div>
          {item.account.splitPercent != null && (
            <div className="text-sm border-l-2 border-gold pl-3 space-y-1">
              <div className="flex justify-between">
                <strong>Split:</strong>
                <span>
                  {item.account.splitPercent}% / {100 - item.account.splitPercent}%
                </span>
              </div>
              <div className="flex justify-between">
                <strong>Balance:</strong>
                <span>${item.account.currentBalance.toFixed(2)}</span>
              </div>
            </div>
          )}
          <div className="mt-6">
            <Link to={`/accounts/${item.account.id}`}>
              <Button variant="outline" className="w-full">
                View Account
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

// History-back when we came from inside the app (e.g. an account's item list keeps its
// filters); a direct link falls back to Inventory.
function BackLink() {
  const canGoBack = typeof window !== "undefined" && window.history.state?.idx > 0;
  const cls = "text-xs uppercase tracking-wide text-gray-500 hover:text-crimson";
  return canGoBack ? (
    <button onClick={() => window.history.back()} className={cls}>
      ← Back
    </button>
  ) : (
    <Link to="/inventory" className={cls}>
      ← Back to Inventory
    </Link>
  );
}

function ItemView({ item }: { item: ItemDetail }) {
  const lastSale = item.sales[0];
  return (
    <>
      <div className="flex justify-between items-start mb-6 gap-4">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-gray-500">Item Name</label>
          <h2 className="text-2xl font-bold">{item.description}</h2>
          <div className="text-xs text-crimson font-bold mt-1">SKU: {item.sku}</div>
          <Barcode value={item.sku} className="mt-2 h-12" />
        </div>
        <div className="bg-crimson2 text-white border border-ink px-4 py-2 text-center">
          <div className="text-[9px] uppercase opacity-80 border-b border-white/30 mb-1">Status</div>
          <div className="text-sm font-bold">{item.status}</div>
        </div>
      </div>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-crimson border-b border-gold inline-block pb-1 mb-3">
          Core Attributes
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          {TEXT_FIELDS.filter((f) => f.key !== "description").map((f) => (
            <Field key={f.key} label={f.label} value={(item[f.key] as string | null) || "—"} />
          ))}
          <Field label="Received" value={date(item.intakeDate)} />
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-crimson border-b border-gold inline-block pb-1 mb-3">
          Pricing
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          <div>
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Price</label>
            <div className="text-xl font-bold">{money(item.price)}</div>
          </div>
          <Field label="Quick-Sale Price" value={money(item.priceQuickSale)} />
          <Field label="Premium Price" value={money(item.pricePremium)} />
          {lastSale && (
            <Field label="Sold" value={`${date(lastSale.saleDate)} for ${money(lastSale.salePrice)}`} />
          )}
        </div>
      </section>
    </>
  );
}

function EditItemForm({
  item,
  canChangePriceAndAccount,
  onCancel,
  onSaved,
}: {
  item: ItemDetail;
  canChangePriceAndAccount: boolean;
  onCancel: () => void;
  onSaved: (changed: boolean) => void;
}) {
  const sold = item.status === "SOLD";
  const pricesLocked = sold || !canChangePriceAndAccount;
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, (item[f.key] as string | null) ?? ""]))
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(PRICE_FIELDS.map((f) => [f.key, item[f.key] == null ? "" : String(item[f.key])]))
  );
  const [status, setStatus] = useState(item.status);
  const [account, setAccount] = useState<AccountOption>({
    id: item.account.id,
    name: item.account.name,
    accountType: item.account.accountType,
    isStoreAccount: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceErrors = PRICE_FIELDS.filter((f) => {
    const v = prices[f.key].trim();
    if (!v) return !!f.required;
    return !(Number(v) > 0);
  });
  const textErrors = TEXT_FIELDS.filter((f) => f.required && !text[f.key].trim());
  const valid = priceErrors.length === 0 && textErrors.length === 0;

  async function save() {
    // Only send what changed; the server records each change in the item's history.
    const body: Record<string, unknown> = {};
    for (const f of TEXT_FIELDS) {
      const next = text[f.key].trim();
      if (next !== ((item[f.key] as string | null) ?? "")) body[f.key] = next || null;
    }
    if (!pricesLocked) {
      for (const f of PRICE_FIELDS) {
        const raw = prices[f.key].trim();
        const next = raw ? Number(raw) : null;
        if (next !== item[f.key]) body[f.key] = next;
      }
    }
    if (!sold && status !== item.status) body.status = status;
    if (!sold && canChangePriceAndAccount && account.id !== item.account.id) body.accountId = account.id;
    if (Object.keys(body).length === 0) return onSaved(false);

    setError(null);
    setSaving(true);
    try {
      await api.patch(`/items/${item.id}`, body);
      onSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  const label = "block text-[10px] uppercase text-gray-500 mb-1";
  const input = "w-full border border-ink p-2 bg-white disabled:bg-gray-100 disabled:text-gray-500";

  return (
    <div>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-bold uppercase">Edit Item</h2>
          <div className="text-xs text-crimson font-bold">SKU: {item.sku}</div>
        </div>
      </div>
      {sold && (
        <p className="text-xs bg-bone border border-gold p-2 mb-4">
          This item has been sold, so its price, status and account are fixed by the sale. You can still correct its
          description details.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className={f.key === "description" ? "sm:col-span-2" : ""}>
            <label className={label}>
              {f.label}
              {f.required && " *"}
            </label>
            <input
              value={text[f.key]}
              onChange={(e) => setText({ ...text, [f.key]: e.target.value })}
              className={input}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
        {PRICE_FIELDS.map((f) => (
          <div key={f.key}>
            <label className={label}>
              {f.label}
              {f.required && " *"}
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={prices[f.key]}
              disabled={pricesLocked}
              onChange={(e) => setPrices({ ...prices, [f.key]: e.target.value })}
              className={input}
            />
          </div>
        ))}
      </div>
      {!sold && !canChangePriceAndAccount && (
        <p className="text-xs text-gray-500 mb-2">Only a Manager, Owner or Admin can change prices or the account.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 mb-5">
        <div>
          <label className={label}>Status</label>
          <select value={status} disabled={sold} onChange={(e) => setStatus(e.target.value)} className={input}>
            {(sold ? ["SOLD"] : EDITABLE_STATUSES).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Account</label>
          {sold || !canChangePriceAndAccount ? (
            <input value={item.account.name} disabled className={input} />
          ) : (
            <AccountPicker value={account} onChange={setAccount} placeholder="Type to search accounts…" />
          )}
        </div>
      </div>

      {(priceErrors.length > 0 || textErrors.length > 0) && (
        <p className="text-crimson text-xs mb-2">
          {textErrors.length > 0 && `${textErrors.map((f) => f.label).join(", ")} can't be blank. `}
          {priceErrors.length > 0 && `${priceErrors.map((f) => f.label).join(", ")}: enter an amount above $0.`}
        </p>
      )}
      {error && <p className="text-crimson text-sm mb-2">{error}</p>}
      <div className="flex gap-3">
        <Button onClick={save} disabled={!valid || saving}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-gray-500 mb-1">{label}</label>
      <div className="border-b border-gray-100 py-1">{value}</div>
    </div>
  );
}

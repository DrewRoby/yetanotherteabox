import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { Badge, Button } from "../components/Card";
import { Pager, rangeLabel } from "../components/Pager";
import { formatDate, localDayStartMs, money } from "./accounts/format";

// The whole store's inventory (~900k items for a migrated shop), filtered, sorted and
// paged server-side by GET /items/browse (server/src/services/itemList.service.ts —
// the same query behind an account's Items table). Every control lives in the URL so
// opening an item and coming back keeps the view.

interface ItemRow {
  id: string;
  sku: string;
  description: string;
  category: string;
  status: string;
  price: number;
  intakeDate: string;
  soldAt: string | null;
  paidOutAt: string | null;
  payoutId: string | null;
  payoutNumber: number | null;
  account: { id: string; name: string; accountType: string; isStoreAccount: boolean };
}

interface BrowseResponse {
  items: ItemRow[];
  total: number;
}

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "sold"> = {
  AVAILABLE: "success",
  PENDING: "warning",
  SOLD: "sold",
  DONATED: "warning",
  DISPOSED: "default",
  RETURNED: "default",
};
const STATUSES = ["AVAILABLE", "PENDING", "SOLD", "DONATED", "DISPOSED", "RETURNED"];

type SortKey = "sku" | "description" | "category" | "account" | "status" | "price" | "created" | "sold" | "paidOut";
const SORT_KEYS: SortKey[] = ["sku", "description", "category", "account", "status", "price", "created", "sold", "paidOut"];
// Dates and prices read best newest/largest first; text A→Z.
const DEFAULT_DESC: Record<SortKey, boolean> = {
  sku: true,
  description: false,
  category: false,
  account: false,
  status: false,
  price: true,
  created: true,
  sold: true,
  paidOut: true,
};
const FILTER_KEYS = ["q", "category", "status", "createdFrom", "createdTo", "soldFrom", "soldTo", "paidFrom", "paidTo"];
const DATE_RANGES = [
  { label: "Received", from: "createdFrom", to: "createdTo" },
  { label: "Sold", from: "soldFrom", to: "soldTo" },
  { label: "Paid out", from: "paidFrom", to: "paidTo" },
];
const PAGE_SIZE = 50;

export function InventoryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const sortParam = params.get("sort") as SortKey | null;
  const sort: SortKey = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : "created";
  const desc = (params.get("dir") ?? (DEFAULT_DESC[sort] ? "desc" : "asc")) === "desc";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const [categories, setCategories] = useState<string[]>([]);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    api.get<string[]>("/items/categories").then(setCategories);
  }, []);

  // Any change but paging resets to page 1.
  function update(changes: Record<string, string>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true }
    );
  }

  const apiQuery = (() => {
    const s = new URLSearchParams({ sort, dir: desc ? "desc" : "asc", page: String(page), pageSize: String(PAGE_SIZE) });
    for (const k of ["q", "category", "status"]) if (get(k).trim()) s.set(k, get(k).trim());
    for (const r of DATE_RANGES) {
      if (get(r.from)) s.set(r.from, String(localDayStartMs(get(r.from))));
      if (get(r.to)) s.set(r.to, String(localDayStartMs(get(r.to), 1))); // "to" day is inclusive
    }
    return s.toString();
  })();

  // Debounced so typing in Search doesn't fire per keystroke; stale responses dropped.
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get<BrowseResponse>(`/items/browse?${apiQuery}`)
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setData(res);
          setError(null);
        })
        .catch((err) => {
          if (seq !== requestSeq.current) return;
          setError(err instanceof ApiError ? err.message : "Could not load inventory.");
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [apiQuery]);

  function sortBy(key: SortKey) {
    const nextDesc = key === sort ? !desc : DEFAULT_DESC[key];
    update({ sort: key === "created" ? "" : key, dir: nextDesc === DEFAULT_DESC[key] ? "" : nextDesc ? "desc" : "asc" });
  }

  function header(key: SortKey, label: string, align: "left" | "right" = "left") {
    const active = sort === key;
    return (
      <th className={`p-3 border-b-2 border-gold text-xs uppercase ${align === "right" ? "text-right" : "text-left"}`}>
        <button onClick={() => sortBy(key)} className={`uppercase ${active ? "text-crimson" : "hover:text-crimson"}`}>
          {label}
          <span className="ml-1 inline-block w-2">{active ? (desc ? "▼" : "▲") : ""}</span>
        </button>
      </th>
    );
  }

  const filtersActive = FILTER_KEYS.some((k) => get(k));
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const goToPage = (p: number) => update({ page: p === 1 ? "" : String(p) });
  const label = "block text-[10px] uppercase tracking-wide font-bold mb-1";
  const field = "border border-ink px-3 py-2 bg-white text-sm";

  return (
    <div className="p-8">
      <div className="flex flex-wrap justify-between items-end gap-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={label}>Search Inventory</label>
            <input
              type="search"
              value={get("q")}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search by SKU, description, brand..."
              aria-label="Search inventory"
              className={`${field} w-72`}
            />
          </div>
          <div>
            <label className={label}>Category</label>
            <select value={get("category")} onChange={(e) => update({ category: e.target.value })} className={field}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Status</label>
            <select value={get("status")} onChange={(e) => update({ status: e.target.value })} className={field}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button onClick={() => navigate("/intake")}>+ New Item</Button>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mb-4">
        {DATE_RANGES.map((r) => (
          <div key={r.from}>
            <label className={label}>{r.label}</label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={get(r.from)}
                onChange={(e) => update({ [r.from]: e.target.value })}
                aria-label={`${r.label} from`}
                className={`${field} py-1.5`}
              />
              <span className="text-xs text-gray-500">to</span>
              <input
                type="date"
                value={get(r.to)}
                onChange={(e) => update({ [r.to]: e.target.value })}
                aria-label={`${r.label} to`}
                className={`${field} py-1.5`}
              />
            </div>
          </div>
        ))}
        {filtersActive && (
          <Button variant="secondary" onClick={() => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex justify-between items-center text-xs text-gray-500 mb-2">
        <span>
          {data ? rangeLabel(page, PAGE_SIZE, total, filtersActive) : ""}
          {loading && <span className="ml-2 italic">Loading…</span>}
        </span>
        <Pager page={page} pages={pages} onPage={goToPage} />
      </div>
      {error && <p className="text-crimson text-sm mb-2">{error}</p>}

      <div className="corner-ticks bg-white border border-ink">
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${loading ? "opacity-60" : ""}`}>
            <thead>
              <tr>
                {header("sku", "SKU")}
                {header("description", "Description")}
                {header("category", "Category")}
                {header("account", "Account")}
                {header("status", "Status")}
                {header("price", "Price", "right")}
                {header("created", "Received")}
                {header("sold", "Sold")}
                {header("paidOut", "Paid Out")}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-bone/50">
                  <td className="p-3 font-mono text-xs whitespace-nowrap">
                    <Link to={`/inventory/${item.id}`} className="text-crimson font-bold hover:underline">
                      {item.sku}
                    </Link>
                  </td>
                  <td className="p-3 font-bold">
                    <Link to={`/inventory/${item.id}`} className="hover:underline">
                      {item.description}
                    </Link>
                  </td>
                  <td className="p-3">{item.category}</td>
                  <td className="p-3">
                    <Link to={`/accounts/${item.account.id}`} className="hover:text-crimson hover:underline">
                      {item.account.name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS_TONE[item.status] || "default"}>{item.status}</Badge>
                  </td>
                  <td className="p-3 font-bold text-right">{money(item.price)}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(item.intakeDate)}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(item.soldAt)}</td>
                  <td className="p-3 whitespace-nowrap">
                    {item.paidOutAt && item.payoutId ? (
                      <Link
                        to={`/accounts/${item.account.id}/payouts/${item.payoutId}`}
                        title={`Payout #${item.payoutNumber}`}
                        className="hover:text-crimson hover:underline"
                      >
                        {formatDate(item.paidOutAt)}
                      </Link>
                    ) : (
                      formatDate(item.paidOutAt)
                    )}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-gray-400">
                    {filtersActive ? "No items match these filters." : "No items yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex justify-end mt-2">
          <Pager page={page} pages={pages} onPage={goToPage} />
        </div>
      )}
    </div>
  );
}

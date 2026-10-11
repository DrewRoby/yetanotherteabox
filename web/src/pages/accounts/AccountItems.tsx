import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { Badge, Button } from "../../components/Card";
import { formatDate, localDayStartMs, money } from "./format";
import { Pager, rangeLabel } from "./Pager";

// The account detail page's Items table. Filtering, sorting and paging all happen
// server-side (GET /accounts/:id/items) — an account can own ~340k items. Every
// control lives in the URL so following an item/payout link and coming back keeps it.

const ITEM_STATUSES = ["PENDING", "AVAILABLE", "SOLD", "DONATED", "DISPOSED", "RETURNED"];
type SortKey = "sku" | "description" | "status" | "price" | "created" | "sold" | "payout";
const DEFAULT_DESC: Record<SortKey, boolean> = {
  sku: false,
  description: false,
  status: false,
  price: true,
  created: true,
  sold: true,
  payout: true,
};
const FILTER_KEYS = ["q", "status", "sold", "paid", "payout", "createdFrom", "createdTo", "soldFrom", "soldTo"];
const PAGE_SIZE = 50;

interface ItemRow {
  id: string;
  sku: string;
  description: string;
  status: string;
  price: number;
  intakeDate: string;
  soldAt: string | null;
  payoutId: string | null;
  payoutNumber: number | null;
}

interface ItemsResponse {
  items: ItemRow[];
  total: number;
}

export function AccountItems({
  accountId,
  itemCount,
  version = 0,
}: {
  accountId: string;
  itemCount: number;
  version?: number; // bumped by the parent after it creates a payout, to refetch (Payout # column)
}) {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const sort = (params.get("sort") as SortKey | null) ?? "created";
  const desc = (params.get("dir") ?? (DEFAULT_DESC[sort] ? "desc" : "asc")) === "desc";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const [data, setData] = useState<ItemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  function update(changes: Record<string, string>, resetPage = true) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (resetPage) next.delete("page");
        return next;
      },
      { replace: true }
    );
  }

  const apiQuery = (() => {
    const q = new URLSearchParams({ sort, dir: desc ? "desc" : "asc", page: String(page), pageSize: String(PAGE_SIZE) });
    for (const k of ["q", "status", "sold", "paid", "payout"]) if (get(k)) q.set(k, get(k));
    if (get("createdFrom")) q.set("createdFrom", String(localDayStartMs(get("createdFrom"))));
    if (get("createdTo")) q.set("createdTo", String(localDayStartMs(get("createdTo"), 1)));
    if (get("soldFrom")) q.set("soldFrom", String(localDayStartMs(get("soldFrom"))));
    if (get("soldTo")) q.set("soldTo", String(localDayStartMs(get("soldTo"), 1)));
    return q.toString();
  })();

  // Short debounce so typing in Search / Payout # doesn't fire a request per keystroke;
  // the sequence number drops responses that arrive after a newer request was sent.
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get<ItemsResponse>(`/accounts/${accountId}/items?${apiQuery}`)
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setData(res);
          setError(null);
        })
        .catch((err) => {
          if (seq !== requestSeq.current) return;
          setError(err instanceof ApiError ? err.message : "Could not load items.");
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [accountId, apiQuery, version]);

  function sortBy(key: SortKey) {
    const nextDesc = key === sort ? !desc : DEFAULT_DESC[key];
    update({ sort: key, dir: nextDesc ? "desc" : "asc" });
  }

  function header(key: SortKey, label: string, align: "left" | "right" = "left") {
    const active = sort === key;
    return (
      <th className={`p-2 border-b-2 border-gold text-xs uppercase ${align === "right" ? "text-right" : "text-left"}`}>
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

  const label = "block text-[10px] font-bold uppercase text-gray-500 mb-1";
  const field = "border border-ink p-1.5 bg-white text-sm";

  return (
    <section>
      <h3 className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">Items ({itemCount})</h3>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="grow min-w-[200px] max-w-sm">
          <label className={label}>Search</label>
          <input
            type="search"
            value={get("q")}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="SKU or description…"
            aria-label="Search items"
            className={`${field} w-full`}
          />
        </div>
        <div>
          <label className={label}>Status</label>
          <select value={get("status")} onChange={(e) => update({ status: e.target.value })} className={field}>
            <option value="">All</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Sold</label>
          <select value={get("sold")} onChange={(e) => update({ sold: e.target.value })} className={field}>
            <option value="">Any</option>
            <option value="yes">Sold</option>
            <option value="no">Not sold</option>
          </select>
        </div>
        <div>
          <label className={label}>Paid out</label>
          <select value={get("paid")} onChange={(e) => update({ paid: e.target.value })} className={field}>
            <option value="">Any</option>
            <option value="yes">Paid out</option>
            <option value="no">Not paid out</option>
          </select>
        </div>
        <div>
          <label className={label}>Payout #</label>
          <input
            type="number"
            min="1"
            value={get("payout")}
            onChange={(e) => update({ payout: e.target.value })}
            className={`${field} w-28`}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className={label}>Created from</label>
          <input type="date" value={get("createdFrom")} onChange={(e) => update({ createdFrom: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>Created to</label>
          <input type="date" value={get("createdTo")} onChange={(e) => update({ createdTo: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>Sold from</label>
          <input type="date" value={get("soldFrom")} onChange={(e) => update({ soldFrom: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>Sold to</label>
          <input type="date" value={get("soldTo")} onChange={(e) => update({ soldTo: e.target.value })} className={field} />
        </div>
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
        <Pager page={page} pages={pages} onPage={(p) => update({ page: p === 1 ? "" : String(p) }, false)} />
      </div>

      {error && <p className="text-crimson text-sm mb-2">{error}</p>}

      <div className="corner-ticks bg-white border border-ink">
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${loading ? "opacity-60" : ""}`}>
            <thead>
              <tr>
                {header("sku", "SKU")}
                {header("description", "Description")}
                {header("status", "Status")}
                {header("price", "Price", "right")}
                {header("created", "Created")}
                {header("sold", "Sold")}
                {header("payout", "Payout #")}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((i) => (
                <tr key={i.id} className="border-b border-gray-100 hover:bg-bone/50">
                  <td className="p-2 font-mono text-xs whitespace-nowrap">
                    <Link to={`/inventory/${i.id}`} className="hover:text-crimson hover:underline">
                      {i.sku}
                    </Link>
                  </td>
                  <td className="p-2">{i.description}</td>
                  <td className="p-2">
                    <Badge>{i.status}</Badge>
                  </td>
                  <td className="p-2 text-right font-bold">{money(i.price)}</td>
                  <td className="p-2 whitespace-nowrap">{formatDate(i.intakeDate)}</td>
                  <td className="p-2 whitespace-nowrap">{formatDate(i.soldAt)}</td>
                  <td className="p-2">
                    {i.payoutId ? (
                      <Link
                        to={`/accounts/${accountId}/payouts/${i.payoutId}`}
                        className="font-bold hover:text-crimson hover:underline"
                      >
                        {i.payoutNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td className="p-6 text-gray-400 text-center" colSpan={7}>
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
          <Pager page={page} pages={pages} onPage={(p) => update({ page: p === 1 ? "" : String(p) }, false)} />
        </div>
      )}
    </section>
  );
}

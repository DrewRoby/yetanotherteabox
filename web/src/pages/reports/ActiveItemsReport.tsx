import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { AccountPicker } from "../../components/AccountPicker";
import { Badge, Button, Card } from "../../components/Card";
import { Pager, rangeLabel } from "../../components/Pager";
import { itemNo } from "../../lib/itemNumber";
import { formatDate, money } from "../accounts/format";
import { useAccountOption } from "./PayoutsReport";
import {
  daysOut,
  downloadActiveItems,
  fetchActiveItems,
  type ActiveItemsFilters,
  type ActiveItemsResponse,
} from "./reportPdfs";

// Reports > Active Items: everything still out on the floor (Available + Pending) — for
// one consignor ("what of mine is still in the store?") or the whole store — with what
// each would pay the consignor if sold (same split rule as checkout / Inventory Audit).
// Pairs with the Payouts report: between them a consignor's items are either paid for,
// sold-awaiting-payout (on the statement) or still here. URL keys "ai"-prefixed.

const PAGE_SIZE = 50;
const K = {
  account: "aia",
  q: "aiq",
  category: "aic",
  status: "ais",
  sort: "aisort",
  dir: "aidir",
  page: "aipage",
};
type Sort = "sku" | "intake" | "price" | "category" | "account";

export function ActiveItemsReport() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get(K.account) ?? "";
  const category = params.get(K.category) ?? "";
  const status =
    params.get(K.status) === "AVAILABLE" || params.get(K.status) === "PENDING"
      ? (params.get(K.status) as "AVAILABLE" | "PENDING")
      : undefined;
  const sort = (
    ["sku", "intake", "price", "category", "account"].includes(
      params.get(K.sort) ?? "",
    )
      ? params.get(K.sort)
      : "sku"
  ) as Sort;
  const dir = params.get(K.dir) === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get(K.page)) || 1);
  const [qInput, setQInput] = useState(params.get(K.q) ?? "");
  const account = useAccountOption(accountId);
  const [categories, setCategories] = useState<string[]>([]);
  const [data, setData] = useState<ActiveItemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  function update(changes: Record<string, string>, resetPage = true) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (resetPage && !(K.page in changes)) next.delete(K.page);
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    api.get<string[]>("/items/categories").then(setCategories);
  }, []);

  // Search → URL, debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get(K.q) ?? "") !== qInput.trim())
        update({ [K.q]: qInput.trim() });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const q = params.get(K.q) ?? "";
  const filters: ActiveItemsFilters = {
    accountId: accountId || undefined,
    q: q || undefined,
    category: category || undefined,
    status,
    sort,
    dir,
  };

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    fetchActiveItems(filters, page, PAGE_SIZE)
      .then((r) => mine === seq.current && setData(r))
      .catch(
        (e) =>
          mine === seq.current &&
          setError(e instanceof ApiError ? e.message : "Failed to load items"),
      )
      .finally(() => mine === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, q, category, status, sort, dir, page]);

  async function exportPdf() {
    setExporting(true);
    setError(null);
    try {
      await downloadActiveItems(filters);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't build the PDF");
    } finally {
      setExporting(false);
    }
  }

  function header(k: Sort, label: string, right = false) {
    const active = sort === k;
    return (
      <th className={`p-2 ${right ? "text-right" : ""}`}>
        <button
          className={`uppercase ${active ? "text-crimson" : "hover:text-crimson"}`}
          onClick={() =>
            update({
              [K.sort]: k === "sku" ? "" : k,
              [K.dir]: active && dir === "asc" ? "desc" : "",
            })
          }
        >
          {label}
          <span className="ml-1 inline-block w-2">
            {active ? (dir === "desc" ? "▼" : "▲") : ""}
          </span>
        </button>
      </th>
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const big = !accountId && (data?.total ?? 0) > 3000;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-80">
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Consignor / Account
            </label>
            <div className="flex gap-1">
              <AccountPicker
                value={account}
                onChange={(a) => update({ [K.account]: a.id })}
                placeholder="All accounts — type an account #, name…"
                className="flex-1"
              />
              {accountId && (
                <button
                  className="px-2 border border-ink bg-white text-xs"
                  onClick={() => update({ [K.account]: "" })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-56">
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Search
            </label>
            <input
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Item # (4545-12), SKU, description, account"
              className="w-full border border-ink p-2 bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => update({ [K.category]: e.target.value })}
              className="border border-ink p-2 bg-white max-w-48"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Status
            </label>
            <select
              value={status ?? ""}
              onChange={(e) => update({ [K.status]: e.target.value })}
              className="border border-ink p-2 bg-white"
            >
              <option value="">Available + Pending</option>
              <option value="AVAILABLE">Available</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <Button
            variant="secondary"
            disabled={exporting || !data || data.total === 0}
            onClick={exportPdf}
          >
            {exporting ? "Building…" : "Download PDF"}
          </Button>
        </div>
        {big && (
          <p className="text-[11px] text-gray-500 mt-2">
            Whole-store PDF: {data!.total.toLocaleString()} items, about{" "}
            {Math.ceil(data!.total / 30).toLocaleString()} pages — pick an
            account or filter to narrow it.
          </p>
        )}
      </Card>

      {error && (
        <Card className="border-crimson">
          <span className="text-crimson font-semibold">{error}</span>
        </Card>
      )}

      {data && (
        <Card>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            {(
              [
                ["Items", data.totals.count.toLocaleString()],
                ["Retail value", money(data.totals.retail)],
                ["Consignor share if sold", money(data.totals.consignorShare)],
                ["Store share if sold", money(data.totals.storeShare)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="text-[10px] uppercase text-gray-500">
                  {label}
                </div>
                <div className="text-xl font-bold">{value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <div className="flex justify-between items-center mb-3 text-sm">
          <div>
            {data && data.total > 0 && (
              <span className="text-gray-500">
                {rangeLabel(page, PAGE_SIZE, data.total)}
              </span>
            )}
            {loading && <span className="text-gray-400 ml-2">Loading…</span>}
          </div>
          <Pager
            page={page}
            pages={pages}
            onPage={(p) => update({ [K.page]: p > 1 ? String(p) : "" }, false)}
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase border-b-2 border-gold">
              {header("sku", "Item #")}
              <th className="p-2">Description</th>
              {header("category", "Category")}
              <th className="p-2">Size</th>
              {!accountId && header("account", "Account")}
              <th className="p-2">Status</th>
              {header("intake", "Received")}
              <th className="p-2 text-right">Days</th>
              {header("price", "Price", true)}
              <th className="p-2 text-right">Split</th>
              <th className="p-2 text-right">Consignor Share</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-gray-100 hover:bg-bone/50"
              >
                <td className="p-2 whitespace-nowrap">
                  <Link
                    to={`/inventory/${r.id}`}
                    className="text-crimson font-bold hover:underline"
                    title={`SKU ${r.sku}`}
                  >
                    {itemNo(r)}
                  </Link>
                </td>
                <td className="p-2">{r.description}</td>
                <td className="p-2">{r.category}</td>
                <td className="p-2">{r.size ?? "—"}</td>
                {!accountId && (
                  <td className="p-2">
                    <Link
                      to={`/accounts/${r.accountId}`}
                      className="hover:text-crimson hover:underline"
                    >
                      {r.accountNumber != null ? `${r.accountNumber} · ` : ""}
                      {r.accountName}
                    </Link>
                  </td>
                )}
                <td className="p-2">
                  <Badge>{r.status}</Badge>
                </td>
                <td className="p-2 whitespace-nowrap">
                  {formatDate(r.intakeDate)}
                </td>
                <td className="p-2 text-right">{daysOut(r.intakeDate)}</td>
                <td className="p-2 text-right font-bold">{money(r.price)}</td>
                <td className="p-2 text-right">{r.consignorPercent}%</td>
                <td className="p-2 text-right">
                  {money((r.price * r.consignorPercent) / 100)}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-gray-400">
                  No active items match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

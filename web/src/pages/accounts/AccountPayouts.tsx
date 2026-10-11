import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { Badge, Button } from "../../components/Card";
import { formatDate, localDayStartMs, money } from "./format";
import { Pager, rangeLabel } from "../../components/Pager";

// The account detail page's Payout History: newest first, PAGE_SIZE at a time, with a
// date range and a search over the descriptions of the items each payout covered.
// Server-side (GET /accounts/:id/payouts) — the busiest migrated consignor has ~1,000
// payouts. Controls live in the URL under "p"-prefixed keys so they don't collide with
// the Items table's (q, page, ...) on the same page.

const PAGE_SIZE = 5;
const KEYS = { q: "pq", from: "pfrom", to: "pto", page: "ppage" };

interface PayoutRow {
  id: string;
  payoutNumber: number;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  itemCount: number;
  matchCount: number | null; // items matching the search, when searching
}

interface PayoutsResponse {
  payouts: PayoutRow[];
  total: number;
}

export function AccountPayouts({
  accountId,
  payoutCount,
  version,
}: {
  accountId: string;
  payoutCount: number;
  version: number; // bumped by the parent after it creates a payout, to refetch
}) {
  const [params, setParams] = useSearchParams();
  const q = params.get(KEYS.q) ?? "";
  const from = params.get(KEYS.from) ?? "";
  const to = params.get(KEYS.to) ?? "";
  const page = Math.max(1, Number(params.get(KEYS.page) ?? 1) || 1);

  const [data, setData] = useState<PayoutsResponse | null>(null);
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
        if (resetPage) next.delete(KEYS.page);
        return next;
      },
      { replace: true } // typing in the search box shouldn't stack history entries
    );
  }

  const apiQuery = (() => {
    const s = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q.trim()) s.set("q", q.trim());
    if (from) s.set("from", String(localDayStartMs(from)));
    if (to) s.set("to", String(localDayStartMs(to, 1)));
    return s.toString();
  })();

  // Debounced so the search box doesn't fire per keystroke; stale responses dropped.
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get<PayoutsResponse>(`/accounts/${accountId}/payouts?${apiQuery}`)
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setData(res);
          setError(null);
        })
        .catch((err) => {
          if (seq !== requestSeq.current) return;
          setError(err instanceof ApiError ? err.message : "Could not load payouts.");
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [accountId, apiQuery, version]);

  const filtersActive = !!(q || from || to);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const label = "block text-[10px] font-bold uppercase text-gray-500 mb-1";
  const field = "border border-ink p-1.5 bg-white text-sm";
  const goTo = (p: number) => update({ [KEYS.page]: p === 1 ? "" : String(p) }, false);

  return (
    <section className="mb-8">
      <h3 id="payouts" className="text-xs uppercase font-bold border-b border-gold inline-block pb-1 mb-3">
        Payout History ({payoutCount.toLocaleString()})
      </h3>

      {payoutCount > 0 && (
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="grow min-w-[200px] max-w-sm">
            <label className={label}>Search items in payouts</label>
            <input
              type="search"
              value={q}
              onChange={(e) => update({ [KEYS.q]: e.target.value })}
              placeholder="Item description…"
              aria-label="Search payouts by item description"
              className={`${field} w-full`}
            />
          </div>
          <div>
            <label className={label}>From</label>
            <input type="date" value={from} onChange={(e) => update({ [KEYS.from]: e.target.value })} className={field} />
          </div>
          <div>
            <label className={label}>To</label>
            <input type="date" value={to} onChange={(e) => update({ [KEYS.to]: e.target.value })} className={field} />
          </div>
          {filtersActive && (
            <Button variant="secondary" onClick={() => update({ [KEYS.q]: "", [KEYS.from]: "", [KEYS.to]: "" })}>
              Clear
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-crimson text-sm mb-2">{error}</p>}

      <table className={`w-full text-sm ${loading ? "opacity-60" : ""}`}>
        <thead>
          <tr className="text-[10px] uppercase text-gray-500">
            <th className="p-2 text-left">Payout #</th>
            <th className="p-2 text-left">Date</th>
            <th className="p-2 text-left">Status</th>
            <th className="p-2 text-right">{q.trim() ? "Matching items" : "Items"}</th>
            <th className="p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data?.payouts.map((p) => (
            <tr key={p.id} className="border-b border-gray-100 hover:bg-bone/50">
              <td className="p-2">
                <Link to={`/accounts/${accountId}/payouts/${p.id}`} className="font-bold hover:text-crimson hover:underline">
                  {p.payoutNumber}
                </Link>
              </td>
              <td className="p-2">{formatDate(p.paidAt ?? p.createdAt)}</td>
              <td className="p-2">
                <Badge>{p.status}</Badge>
              </td>
              <td className="p-2 text-right">
                {p.matchCount != null ? `${p.matchCount} of ${p.itemCount}` : p.itemCount || "—"}
              </td>
              <td className="p-2 text-right font-bold">{money(p.amount)}</td>
            </tr>
          ))}
          {data && data.payouts.length === 0 && (
            <tr>
              <td className="p-4 text-gray-400 text-center" colSpan={5}>
                {filtersActive ? "No payouts match." : "No payouts yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {total > 0 && (
        <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
          <span>{rangeLabel(page, PAGE_SIZE, total, filtersActive)}</span>
          <Pager
            page={page}
            pages={pages}
            onPage={goTo}
            labels={{ first: "Newest payouts", prev: "Newer payouts", next: "Older payouts", last: "Oldest payouts" }}
          />
        </div>
      )}
    </section>
  );
}

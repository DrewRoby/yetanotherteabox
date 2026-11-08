import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import {
  AccountPicker,
  type AccountOption,
} from "../../components/AccountPicker";
import { Badge, Button, Card } from "../../components/Card";
import { Pager, rangeLabel } from "../../components/Pager";
import { accountLabel, itemNo } from "../../lib/itemNumber";
import { formatDate, money } from "../accounts/format";
import { localDateKey, todayKey } from "./reportFormat";
import {
  LINE_TYPE_LABELS,
  downloadPayoutList,
  downloadPayoutStatement,
  downloadSinglePayout,
  fetchStatement,
  payoutDate,
  payoutHow,
  queryString,
  type PayoutListResponse,
  type PayoutStatement,
  type StatementPayout,
} from "./reportPdfs";

// Reports > Payouts: every payout, store-wide or for one account, over a date range —
// built to answer "what was I paid for?" quickly. Search takes an item # ("4545-12" →
// the payout that paid it), a payout # or check #, or a name (an item description once
// an account is picked). Rows expand into their itemized lines. With an account picked,
// "Statement" shows every payout in the range fully itemized plus what's sold but not
// yet paid — the same content as the Statement PDF. All controls live in the URL under
// "po"-prefixed keys (Print Queues already uses "p…").

const PAGE_SIZE = 50;
const K = {
  account: "poa",
  from: "pofrom",
  to: "poto",
  q: "poq",
  status: "pos",
  page: "popage",
  view: "pov",
};

export function useAccountOption(id: string): AccountOption | null {
  const [account, setAccount] = useState<AccountOption | null>(null);
  useEffect(() => {
    if (!id) return setAccount(null);
    let live = true;
    api
      .get<AccountOption>(`/accounts/${id}`)
      .then((a) => live && setAccount(a))
      .catch(() => live && setAccount(null));
    return () => {
      live = false;
    };
  }, [id]);
  return account;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Quick ranges as local calendar days.
function quickRanges(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    {
      label: "This month",
      from: localDateKey(new Date(y, m, 1)),
      to: todayKey(),
    },
    {
      label: "Last month",
      from: localDateKey(new Date(y, m - 1, 1)),
      to: localDateKey(new Date(y, m, 0)),
    },
    {
      label: "This year",
      from: localDateKey(new Date(y, 0, 1)),
      to: todayKey(),
    },
    {
      label: "Last year",
      from: localDateKey(new Date(y - 1, 0, 1)),
      to: localDateKey(new Date(y - 1, 11, 31)),
    },
    { label: "All dates", from: "", to: "" },
  ];
}

export function PayoutsReport() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const accountId = params.get(K.account) ?? "";
  const from = params.get(K.from) ?? "";
  const to = params.get(K.to) ?? "";
  const status: "PAID" | "ALL" =
    params.get(K.status) === "ALL" ? "ALL" : "PAID";
  const page = Math.max(1, Number(params.get(K.page)) || 1);
  const view =
    accountId && params.get(K.view) === "statement" ? "statement" : "list";
  const [qInput, setQInput] = useState(params.get(K.q) ?? "");
  const q = useDebounced(qInput.trim());
  const account = useAccountOption(accountId);

  const [data, setData] = useState<PayoutListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
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

  // Search box → URL (debounced), so Back/links keep it.
  useEffect(() => {
    if ((params.get(K.q) ?? "") !== q) update({ [K.q]: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filters = {
    accountId: accountId || undefined,
    from: from || undefined,
    to: to || undefined,
    q: q || undefined,
    status,
  };

  useEffect(() => {
    if (view !== "list") return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    api
      .get<PayoutListResponse>(
        `/reports/payouts?${queryString({ ...filters, page, pageSize: PAGE_SIZE })}`,
      )
      .then((r) => mine === seq.current && setData(r))
      .catch(
        (e) =>
          mine === seq.current &&
          setError(
            e instanceof ApiError ? e.message : "Failed to load payouts",
          ),
      )
      .finally(() => mine === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, from, to, q, status, page, view]);

  async function run(label: string, f: () => Promise<void>) {
    setExporting(label);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't build the PDF");
    } finally {
      setExporting(null);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-80">
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Account
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
                  onClick={() => update({ [K.account]: "", [K.view]: "" })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              From
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => update({ [K.from]: e.target.value })}
              className="border border-ink p-2 bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              To
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => update({ [K.to]: e.target.value })}
              className="border border-ink p-2 bg-white"
            />
          </div>
          <div className="flex-1 min-w-56">
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Search
            </label>
            <input
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={
                accountId
                  ? "Item # (4545-12), payout #, check #, item description"
                  : "Item # (4545-12), payout #, check #, name"
              }
              className="w-full border border-ink p-2 bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              Show
            </label>
            <select
              value={status}
              onChange={(e) =>
                update({ [K.status]: e.target.value === "ALL" ? "ALL" : "" })
              }
              className="border border-ink p-2 bg-white"
            >
              <option value="PAID">Paid payouts</option>
              <option value="ALL">All (incl. voided)</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
          {quickRanges().map((r) => (
            <button
              key={r.label}
              onClick={() => update({ [K.from]: r.from, [K.to]: r.to })}
              className={`px-2 py-1 border border-ink ${from === r.from && to === r.to ? "bg-crimson text-white" : "bg-white hover:bg-bone"}`}
            >
              {r.label}
            </button>
          ))}
          <span className="flex-1" />
          {accountId && (
            <div className="flex border border-ink">
              {(["list", "statement"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() =>
                    update({ [K.view]: v === "list" ? "" : v }, false)
                  }
                  className={`px-3 py-1 uppercase font-bold ${view === v ? "bg-ink text-white" : "bg-white"}`}
                >
                  {v === "list" ? "List" : "Statement"}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            disabled={!accountId || exporting != null}
            onClick={() =>
              run("statement", () =>
                downloadPayoutStatement(
                  accountId,
                  from || undefined,
                  to || undefined,
                ),
              )
            }
          >
            {exporting === "statement"
              ? "Building…"
              : accountId
                ? "Statement PDF"
                : "Statement PDF (pick an account)"}
          </Button>
          <Button
            variant="secondary"
            disabled={exporting != null}
            onClick={() =>
              run("list", () =>
                downloadPayoutList(
                  user?.storeName ?? "Teabox",
                  filters,
                  account ? accountLabel(account) : undefined,
                ),
              )
            }
          >
            {exporting === "list" ? "Building…" : "List PDF"}
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="border-crimson">
          <span className="text-crimson font-semibold">{error}</span>
        </Card>
      )}

      {view === "statement" ? (
        <StatementView
          accountId={accountId}
          from={from}
          to={to}
          highlight={q}
        />
      ) : (
        <Card className="overflow-x-auto">
          <div className="flex justify-between items-center mb-3 text-sm">
            <div>
              {data && (
                <>
                  <span className="font-bold">
                    {data.total.toLocaleString()}
                  </span>{" "}
                  payout{data.total === 1 ? "" : "s"} ·{" "}
                  <span className="font-bold">{money(data.totalAmount)}</span>
                  {data.total > 0 && (
                    <span className="text-gray-500 ml-2">
                      ({rangeLabel(page, PAGE_SIZE, data.total)})
                    </span>
                  )}
                </>
              )}
              {loading && <span className="text-gray-400 ml-2">Loading…</span>}
            </div>
            <Pager
              page={page}
              pages={pages}
              onPage={(p) =>
                update({ [K.page]: p > 1 ? String(p) : "" }, false)
              }
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase border-b-2 border-gold">
                <th className="p-2 w-6" />
                <th className="p-2">Date</th>
                <th className="p-2">Payout #</th>
                {!accountId && <th className="p-2">Account #</th>}
                {!accountId && <th className="p-2">Account</th>}
                <th className="p-2">How Paid</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Items</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((p) => (
                <PayoutRow
                  key={p.id}
                  row={p}
                  showAccount={!accountId}
                  highlight={q}
                  autoOpen={data.rows.length === 1}
                />
              ))}
              {data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-gray-400">
                    No payouts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// One list row; expands into the payout's itemized lines (GET /accounts/:id/payouts/:pid).
function PayoutRow({
  row,
  showAccount,
  highlight,
  autoOpen,
}: {
  row: PayoutListResponse["rows"][number];
  showAccount: boolean;
  highlight: string;
  autoOpen: boolean;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(autoOpen);
  const [detail, setDetail] = useState<StatementPayout | null>(null);
  useEffect(() => {
    if (open && !detail)
      api
        .get<StatementPayout>(`/accounts/${row.account.id}/payouts/${row.id}`)
        .then(setDetail);
  }, [open, detail, row]);
  const cols = showAccount ? 9 : 7;
  return (
    <Fragment>
      <tr
        className={`border-b border-gray-100 cursor-pointer ${open ? "bg-bone" : "hover:bg-bone/50"}`}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="p-2 text-gray-500">{open ? "▾" : "▸"}</td>
        <td className="p-2 whitespace-nowrap">{formatDate(payoutDate(row))}</td>
        <td className="p-2 font-bold">
          <Link
            to={`/accounts/${row.account.id}/payouts/${row.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-crimson hover:underline"
          >
            {row.payoutNumber}
          </Link>
        </td>
        {showAccount && (
          <td className="p-2">{row.account.accountNumber ?? "—"}</td>
        )}
        {showAccount && (
          <td className="p-2">
            <Link
              to={`/accounts/${row.account.id}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-crimson hover:underline"
            >
              {row.account.name}
            </Link>
          </td>
        )}
        <td className="p-2">{payoutHow(row) || "—"}</td>
        <td className="p-2">
          {row.status === "PAID" ? (
            <Badge>Paid</Badge>
          ) : (
            <Badge tone="warning">{row.status}</Badge>
          )}
        </td>
        <td className="p-2 text-right">{row.itemCount}</td>
        <td className="p-2 text-right font-bold">{money(row.amount)}</td>
      </tr>
      {open && (
        <tr className="border-b border-gold bg-bone/40">
          <td colSpan={cols} className="p-3 pl-8">
            {!detail ? (
              <span className="text-gray-400 text-xs">Loading…</span>
            ) : (
              <>
                <LinesTable payout={detail} highlight={highlight} />
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      downloadSinglePayout(
                        user?.storeName ?? "Teabox",
                        row.account,
                        detail,
                      )
                    }
                  >
                    Payout PDF
                  </Button>
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// A payout's lines: item #, description, type, sold, sale price, paid. Lines whose item
// number matches the search are highlighted — the "yes, this item was paid here" proof.
export function LinesTable({
  payout,
  highlight,
}: {
  payout: StatementPayout;
  highlight?: string;
}) {
  const sales = payout.lines.reduce((s, l) => s + (l.sale?.salePrice ?? 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs bg-white border border-gray-200">
        <thead>
          <tr className="text-left uppercase text-gray-500 border-b border-gray-200">
            <th className="p-1.5">Item #</th>
            <th className="p-1.5">Description</th>
            <th className="p-1.5">Type</th>
            <th className="p-1.5">Sold</th>
            <th className="p-1.5 text-right">Sale Price</th>
            <th className="p-1.5 text-right">Paid</th>
          </tr>
        </thead>
        <tbody>
          {payout.lines.map((l) => {
            const hit =
              !!highlight &&
              !!l.item &&
              itemNo(l.item) === highlight.replace(/\s+/g, "");
            return (
              <tr
                key={l.id}
                className={`border-b border-gray-100 ${hit ? "bg-gold/30 font-bold" : ""}`}
              >
                <td className="p-1.5 whitespace-nowrap">
                  {l.item ? (
                    <Link
                      to={`/inventory/${l.item.id}`}
                      className="hover:text-crimson hover:underline"
                      title={`SKU ${l.item.sku}`}
                    >
                      {itemNo(l.item)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-1.5">
                  {l.item ? l.item.description : (l.description ?? "—")}
                </td>
                <td className="p-1.5">
                  {LINE_TYPE_LABELS[l.lineType] ?? l.lineType}
                </td>
                <td className="p-1.5 whitespace-nowrap">
                  {l.sale ? formatDate(l.sale.saleDate) : "—"}
                </td>
                <td className="p-1.5 text-right">
                  {l.sale ? money(l.sale.salePrice) : "—"}
                </td>
                <td className="p-1.5 text-right">{money(l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="p-1.5" colSpan={4}>
              {payout.lines.filter((l) => l.item).length} item(s)
            </td>
            <td className="p-1.5 text-right">{money(sales)}</td>
            <td className="p-1.5 text-right">{money(payout.amount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// The whole statement on screen: summary, every payout itemized, sold-not-yet-paid.
function StatementView({
  accountId,
  from,
  to,
  highlight,
}: {
  accountId: string;
  from: string;
  to: string;
  highlight: string;
}) {
  const [s, setS] = useState<PayoutStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setS(null);
    setError(null);
    fetchStatement(accountId, from || undefined, to || undefined)
      .then(setS)
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : "Failed to load statement",
        ),
      );
  }, [accountId, from, to]);
  if (error)
    return <Card className="border-crimson text-crimson">{error}</Card>;
  if (!s) return <Card className="text-gray-400">Loading statement…</Card>;
  const stats: [string, string][] = [
    ["Payouts", s.totals.payouts.toLocaleString()],
    ["Total paid", money(s.totals.amount)],
    ["Items paid for", s.totals.itemsPaid.toLocaleString()],
    ["Those items sold for", money(s.totals.salesTotal)],
    ...(s.unpaid
      ? ([
          [
            "Sold, not yet paid",
            `${s.unpaid.lines.length} · ${money(s.unpaid.total)}`,
          ],
        ] as [string, string][])
      : []),
    ...(s.unpaid && s.unpaid.otherBalance !== 0
      ? ([["Other balance (not itemized)", money(s.unpaid.otherBalance)]] as [
          string,
          string,
        ][])
      : []),
    ...(s.account.currentBalance !== undefined
      ? ([["Current balance", money(s.account.currentBalance)]] as [
          string,
          string,
        ][])
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h3 className="text-lg font-bold">{accountLabel(s.account)}</h3>
        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-3">
          {stats.map(([label, value]) => (
            <div key={label}>
              <div className="text-[10px] uppercase text-gray-500">{label}</div>
              <div className="text-lg font-bold">{value}</div>
            </div>
          ))}
        </div>
      </Card>
      {s.payouts.length === 0 && (
        <Card className="text-gray-400">No payouts in this period.</Card>
      )}
      {s.payouts
        .slice()
        .reverse()
        .map((p) => (
          <Card key={p.id}>
            <div className="flex justify-between items-baseline mb-2">
              <div className="font-bold">
                <Link
                  to={`/accounts/${s.account.id}/payouts/${p.id}`}
                  className="hover:text-crimson hover:underline"
                >
                  Payout #{p.payoutNumber}
                </Link>
                <span className="font-normal text-gray-600 ml-3">
                  {formatDate(payoutDate(p))}
                  {payoutHow(p) && ` · ${payoutHow(p)}`}
                  {p.status !== "PAID" && ` · ${p.status}`}
                </span>
              </div>
              <div className="font-bold">{money(p.amount)}</div>
            </div>
            <LinesTable payout={p} highlight={highlight} />
          </Card>
        ))}
      {s.unpaid && (
        <Card>
          <h3 className="font-bold mb-2">
            Sold, not yet paid out (as of today)
          </h3>
          {s.unpaid.otherBalance !== 0 && (
            <p className="text-xs text-gray-600 mb-2">
              Plus {money(s.unpaid.otherBalance)} of the balance not tied to any
              item (e.g. carried over from Liberty) — a payout today would
              include it as an adjustment line.
            </p>
          )}
          {s.unpaid.lines.length === 0 ? (
            <p className="text-gray-400 text-sm">No sales awaiting payout.</p>
          ) : (
            <table className="w-full text-xs bg-white border border-gray-200">
              <thead>
                <tr className="text-left uppercase text-gray-500 border-b border-gray-200">
                  <th className="p-1.5">Item #</th>
                  <th className="p-1.5">Description</th>
                  <th className="p-1.5">Sold</th>
                  <th className="p-1.5 text-right">Sale Price</th>
                  <th className="p-1.5 text-right">Consignor Share</th>
                </tr>
              </thead>
              <tbody>
                {s.unpaid.lines.map((u) => (
                  <tr key={u.saleId} className="border-b border-gray-100">
                    <td className="p-1.5">
                      <Link
                        to={`/inventory/${u.item.id}`}
                        className="hover:text-crimson hover:underline"
                      >
                        {itemNo(u.item)}
                      </Link>
                    </td>
                    <td className="p-1.5">{u.item.description}</td>
                    <td className="p-1.5">{formatDate(u.saleDate)}</td>
                    <td className="p-1.5 text-right">{money(u.salePrice)}</td>
                    <td className="p-1.5 text-right">{money(u.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td className="p-1.5" colSpan={4}>
                    Total
                  </td>
                  <td className="p-1.5 text-right">{money(s.unpaid.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

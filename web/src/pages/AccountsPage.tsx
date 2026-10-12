import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card } from "../components/Card";
import { AccountItems } from "./accounts/AccountItems";
import { AccountPayouts } from "./accounts/AccountPayouts";
import { formatDate, localDayStartMs, money } from "./accounts/format";
import { Pager, rangeLabel } from "../components/Pager";

interface AccountRow {
  id: string;
  accountType: string;
  isStoreAccount: boolean; // store-owned like the STORE type: no balance, no payouts
  isActive: boolean; // false = dormant: hidden by default, not counted as owed, no new intake
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastSaleAt: string | null;
  lastPayoutAt?: string | null; // list endpoint only
  lastActivityAt?: string | null; // list endpoint only: latest intake, sale or payout
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

type SortKey = "name" | "createdAt" | "lastSaleAt" | "lastPayoutAt" | "lastActivityAt" | "balance";
const SORT_KEYS: SortKey[] = ["name", "createdAt", "lastSaleAt", "lastPayoutAt", "lastActivityAt", "balance"];
const DATE_SORTS: SortKey[] = ["lastSaleAt", "lastPayoutAt", "lastActivityAt"];
const PAGE_SIZE = 50;
// Dates and balances read most usefully newest/largest first; names A→Z.
const DEFAULT_DESC: Record<SortKey, boolean> = {
  name: false,
  createdAt: true,
  lastSaleAt: true,
  lastPayoutAt: true,
  lastActivityAt: true,
  balance: true,
};

// One route component for the whole Accounts area: list, account detail, payout detail.
export function AccountsPage() {
  const { id, payoutId } = useParams();
  if (id && payoutId) return <PayoutDetail accountId={id} payoutId={payoutId} />;
  if (id) return <AccountDetail id={id} />;
  return <AccountList />;
}

function AccountList() {
  const { user } = useAuth();
  // Tab, search, filters, sort and page all live in the URL so "← Back" from a detail
  // page returns to exactly the same slice of the list.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "CONSIGNOR";
  const query = params.get("q") ?? "";
  // Active accounts only unless asked: dormant ones are noise in day-to-day work.
  const show = params.get("show") === "inactive" || params.get("show") === "all" ? params.get("show")! : "active";
  // "No activity since" (YYYY-MM-DD): accounts whose latest intake, sale and payout are
  // all before that day (or that have none) — how dormant accounts are found for bulk
  // deactivation.
  const idleSince = params.get("idle") ?? "";
  const sortParam = params.get("sort") as SortKey | null;
  const sortKey: SortKey = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : "name";
  const sortDesc = (params.get("dir") ?? (DEFAULT_DESC[sortKey] ? "desc" : "asc")) === "desc";
  const requestedPage = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  // Select mode (bulk activate/deactivate). Selection is by id and deliberately
  // survives searching/paging, so a set can be built up across several searches; the
  // action bar says how many selected accounts the current filters hide.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  // Any change but paging itself resets to page 1.
  function setParam(changes: Record<string, string>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true }
    );
  }

  function reload() {
    api.get<AccountRow[]>(`/accounts?accountType=${tab}&status=${show}`).then(setAccounts);
  }
  useEffect(reload, [tab, show]);
  // A different tab or Show filter is a different list — start the selection over.
  useEffect(() => {
    setSelected(new Set());
    setLastClicked(null);
  }, [tab, show]);

  // Filtering is client-side over the already-loaded tab (a few thousand rows at most),
  // so results update on every keystroke with no request; useDeferredValue keeps the
  // input itself responsive while a large table re-renders.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const idleCutoff = idleSince ? localDayStartMs(idleSince) : null;
    const filtered = accounts.filter(
      (a) =>
        (!q ||
          a.name.toLowerCase().includes(q) ||
          (a.email ?? "").toLowerCase().includes(q) ||
          (digits.length >= 3 && (a.phone ?? "").replace(/\D/g, "").includes(digits))) &&
        (idleCutoff == null || !a.lastActivityAt || new Date(a.lastActivityAt).getTime() < idleCutoff)
    );
    const value = (a: AccountRow): string | number => {
      switch (sortKey) {
        case "name":
          return a.name.toLowerCase();
        case "createdAt":
          return a.createdAt;
        case "lastSaleAt":
          return a.lastSaleAt ?? "";
        case "lastPayoutAt":
          return a.lastPayoutAt ?? "";
        case "lastActivityAt":
          return a.lastActivityAt ?? "";
        case "balance":
          return a.currentBalance ?? 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      // Accounts with no sale/payout/activity yet always sort last, whichever direction.
      if (DATE_SORTS.includes(sortKey) && !va !== !vb) return va ? -1 : 1;
      const cmp = typeof va === "number" ? va - (vb as number) : va.localeCompare(vb as string);
      return sortDesc ? -cmp : cmp;
    });
  }, [accounts, deferredQuery, idleSince, sortKey, sortDesc]);

  function sortBy(key: SortKey) {
    const desc = key === sortKey ? !sortDesc : DEFAULT_DESC[key];
    setParam({ sort: key === "name" ? "" : key, dir: desc === DEFAULT_DESC[key] ? "" : desc ? "desc" : "asc" });
  }

  // Paging is client-side too: the whole tab is already loaded for instant search, so
  // this just limits how many rows render. Clamped in case the list shrank (e.g. a
  // stale ?page= after the search narrowed it).
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = visible.slice(pageStart, pageStart + PAGE_SIZE);
  const goToPage = (p: number) => setParam({ page: p === 1 ? "" : String(p) });

  const canCreate = user ? CAN_CREATE_ROLES.includes(user.activeRole) : false;
  const canBulkEdit = canCreate; // same roles as the account page's Inactive checkbox
  const showsBalance = tab !== "DONOR" && tab !== "STORE";
  const columnCount = (showsBalance ? 6 : 4) + (selecting ? 1 : 0);

  // ---- selection ----
  const selectable = (a: AccountRow) => a.accountType !== "STORE"; // built-in store account is always active
  const pageSelectable = pageRows.filter(selectable);
  const visibleSelectable = useMemo(() => visible.filter(selectable), [visible]);
  const pageAllSelected = pageSelectable.length > 0 && pageSelectable.every((a) => selected.has(a.id));
  const pageSomeSelected = pageSelectable.some((a) => selected.has(a.id));
  const allMatchingSelected = visibleSelectable.length > 0 && visibleSelectable.every((a) => selected.has(a.id));
  const visibleIds = useMemo(() => new Set(visible.map((a) => a.id)), [visible]);
  const hiddenSelected = [...selected].filter((id) => !visibleIds.has(id)).length;
  const selectedRows = useMemo(() => accounts.filter((a) => selected.has(a.id)), [accounts, selected]);
  const selectedBalance = selectedRows.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
  const willDeactivate = selectedRows.filter((a) => a.isActive);
  const willReactivate = selectedRows.filter((a) => !a.isActive);

  function setMany(rows: AccountRow[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of rows) if (selectable(a)) on ? next.add(a.id) : next.delete(a.id);
      return next;
    });
  }

  // Shift-click selects (or clears) the run of rows from the last-clicked one, in the
  // current sort order across pages — the usual list-UI behavior.
  function toggleRow(a: AccountRow, indexInVisible: number, shiftKey: boolean) {
    const on = !selected.has(a.id);
    if (shiftKey && lastClicked != null) {
      const [from, to] = [Math.min(lastClicked, indexInVisible), Math.max(lastClicked, indexInVisible)];
      setMany(visible.slice(from, to + 1), on);
    } else {
      setMany([a], on);
    }
    setLastClicked(indexInVisible);
  }

  function exitSelectMode() {
    setSelecting(false);
    setSelected(new Set());
    setLastClicked(null);
  }

  async function bulkSetActive(isActive: boolean) {
    const targets = isActive ? willReactivate : willDeactivate;
    if (targets.length === 0) return;
    const balance = targets.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
    const n = targets.length.toLocaleString();
    const msg = isActive
      ? `Reactivate ${n} account${targets.length === 1 ? "" : "s"}? They return to the lists and pickers` +
        (showsBalance ? `, and their ${money(balance)} in balances counts toward payout totals again.` : ".")
      : `Mark ${n} account${targets.length === 1 ? "" : "s"} inactive? They'll be hidden from the lists and pickers and can't take new intake` +
        (showsBalance ? `, and their ${money(balance)} in balances stops counting toward payout totals (balances are kept).` : ".") +
        (hiddenSelected ? `\n\n${hiddenSelected.toLocaleString()} of the selected accounts aren't shown by the current filters.` : "");
    if (!window.confirm(msg)) return;
    setBulkBusy(true);
    setBulkMessage(null);
    try {
      const res = await api.post<{ updated: number }>("/accounts/bulk-status", {
        accountIds: targets.map((a) => a.id),
        isActive,
      });
      setBulkMessage(
        `${res.updated.toLocaleString()} account${res.updated === 1 ? "" : "s"} marked ${isActive ? "active" : "inactive"}.`
      );
      setSelected(new Set());
      setLastClicked(null);
      reload();
    } catch (err) {
      setBulkMessage(err instanceof ApiError ? err.message : "Could not update the accounts.");
    } finally {
      setBulkBusy(false);
    }
  }

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

  const filtered = !!query || !!idleSince;

  return (
    <div className="p-8">
      <div className="flex justify-between items-end mb-6 border-b border-ink">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.type}
              onClick={() => setParam({ tab: t.type === "CONSIGNOR" ? "" : t.type })}
              className={`px-4 py-2 text-sm font-bold uppercase border-t border-l border-r border-ink -mb-px ${
                tab === t.type ? "bg-white" : "bg-bone2 text-gray-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-2">
          {canBulkEdit &&
            (selecting ? (
              <Button variant="secondary" onClick={exitSelectMode}>
                Done Selecting
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setSelecting(true)}>
                Select Accounts
              </Button>
            ))}
          {canCreate && tab !== "STORE" && <Button onClick={() => setAddOpen(true)}>+ Add Account</Button>}
        </div>
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

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setParam({ q: e.target.value })}
          placeholder="Search by name, email, or phone…"
          aria-label="Search accounts"
          className="w-full max-w-md border border-ink p-2 bg-white"
        />
        <label className="flex items-center gap-2 text-xs uppercase font-bold">
          Show
          <select
            value={show}
            onChange={(e) => setParam({ show: e.target.value === "active" ? "" : e.target.value })}
            className="border border-ink p-2 bg-white text-sm normal-case font-normal"
          >
            <option value="active">Active accounts</option>
            <option value="inactive">Inactive accounts</option>
            <option value="all">All accounts</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs uppercase font-bold" title="Latest intake, sale and payout all before this day">
          No activity since
          <input
            type="date"
            value={idleSince}
            onChange={(e) => setParam({ idle: e.target.value })}
            aria-label="No activity since"
            className="border border-ink p-2 bg-white text-sm normal-case font-normal"
          />
        </label>
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {filtered ? `${visible.length.toLocaleString()} of ${accounts.length.toLocaleString()}` : accounts.length.toLocaleString()}{" "}
          account{accounts.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto">
          <Pager page={page} pages={pages} onPage={goToPage} />
        </div>
      </div>

      {bulkMessage && <p className="text-sm text-crimson font-semibold mb-3">{bulkMessage}</p>}

      {selecting && (
        <div className="sticky top-0 z-10 bg-ink text-bone px-4 py-2 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-bold">{selected.size.toLocaleString()} selected</span>
          {showsBalance && selected.size > 0 && <span>{money(selectedBalance)} in balances</span>}
          {hiddenSelected > 0 && (
            <span className="text-gold">{hiddenSelected.toLocaleString()} not shown by the current filters</span>
          )}
          <div className="ml-auto flex gap-2">
            <Button onClick={() => bulkSetActive(false)} disabled={bulkBusy || willDeactivate.length === 0}>
              Mark Inactive{willDeactivate.length ? ` (${willDeactivate.length.toLocaleString()})` : ""}
            </Button>
            <Button variant="outline" onClick={() => bulkSetActive(true)} disabled={bulkBusy || willReactivate.length === 0} className="bg-bone text-ink">
              Mark Active{willReactivate.length ? ` (${willReactivate.length.toLocaleString()})` : ""}
            </Button>
            <Button variant="secondary" onClick={() => setSelected(new Set())} disabled={bulkBusy || selected.size === 0}>
              Clear
            </Button>
          </div>
        </div>
      )}
      {/* Gmail-style: selecting the page offers the whole filtered list. */}
      {selecting && pageAllSelected && visibleSelectable.length > pageSelectable.length && (
        <div className="bg-bone border border-gold px-4 py-2 mb-2 text-sm text-center">
          {allMatchingSelected ? (
            <>
              All {visibleSelectable.length.toLocaleString()} matching accounts are selected.{" "}
              <button className="font-bold text-crimson hover:underline" onClick={() => setMany(visibleSelectable, false)}>
                Clear selection
              </button>
            </>
          ) : (
            <>
              All {pageSelectable.length} on this page are selected.{" "}
              <button className="font-bold text-crimson hover:underline" onClick={() => setMany(visibleSelectable, true)}>
                Select all {visibleSelectable.length.toLocaleString()} matching accounts
              </button>
            </>
          )}
        </div>
      )}

      <div className="corner-ticks bg-white border border-ink">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {selecting && (
                  <th className="p-3 border-b-2 border-gold w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={pageAllSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !pageAllSelected && pageSomeSelected;
                      }}
                      onChange={() => setMany(pageRows, !pageAllSelected)}
                    />
                  </th>
                )}
                {sortHeader("name", "Name")}
                {sortHeader("createdAt", "Created")}
                {sortHeader("lastSaleAt", "Latest Sale")}
                {showsBalance && sortHeader("lastPayoutAt", "Latest Payout")}
                {sortHeader("lastActivityAt", "Last Activity")}
                {showsBalance && sortHeader("balance", "Balance", "right")}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((a, i) => (
                <tr
                  key={a.id}
                  className={`border-b border-gray-100 ${selected.has(a.id) ? "bg-bone" : "hover:bg-bone/50"}`}
                >
                  {selecting && (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.name}`}
                        checked={selected.has(a.id)}
                        disabled={!selectable(a)}
                        title={selectable(a) ? undefined : "The built-in store account is always active"}
                        onChange={() => undefined}
                        onClick={(e) => toggleRow(a, pageStart + i, e.shiftKey)}
                      />
                    </td>
                  )}
                  <td className="p-3 font-bold">
                    <Link to={`/accounts/${a.id}`} className="hover:text-crimson hover:underline">
                      {a.name}
                    </Link>
                    {a.accountType === "STORE" && (
                      <span className="ml-2 align-middle">
                        <Badge>Built-in</Badge>
                      </span>
                    )}
                    {!a.isActive && (
                      <span className="ml-2 align-middle">
                        <Badge>Inactive</Badge>
                      </span>
                    )}
                  </td>
                  <td className="p-3">{formatDate(a.createdAt)}</td>
                  <td className="p-3">{formatDate(a.lastSaleAt)}</td>
                  {showsBalance && (
                    <td className="p-3">
                      {a.lastPayoutAt ? (
                        <Link to={`/accounts/${a.id}#payouts`} className="hover:text-crimson hover:underline">
                          {formatDate(a.lastPayoutAt)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td className="p-3">{formatDate(a.lastActivityAt)}</td>
                  {showsBalance && <td className="p-3 font-bold text-right">{money(a.currentBalance ?? 0)}</td>}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="p-6 text-center text-gray-400">
                    {filtered
                      ? "No accounts match these filters."
                      : show === "inactive"
                        ? "No inactive accounts of this type."
                        : "No accounts of this type yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {visible.length > 0 && (
        <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
          <span>{rangeLabel(page, PAGE_SIZE, visible.length, filtered)}</span>
          <Pager page={page} pages={pages} onPage={goToPage} />
        </div>
      )}
    </div>
  );
}

interface AccountDetailData extends AccountRow {
  splitPercent: number | null;
  itemCount: number; // the items themselves load via <AccountItems> (GET /accounts/:id/items)
  payoutCount: number; // the payouts themselves load via <AccountPayouts> (GET /accounts/:id/payouts)
}

// Only these types can be flagged isStoreAccount (server: PATCH /accounts/:id) — the
// built-in STORE account and DONOR accounts are never owed money to begin with.
const FLAGGABLE_TYPES = ["CONSIGNOR", "VENDOR", "BOOTH_OWNER"];

function AccountDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const [account, setAccount] = useState<AccountDetailData | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagSaving, setFlagSaving] = useState(false);
  // Bumped after this page creates a payout so the payout and item tables refetch too.
  const [version, setVersion] = useState(0);

  function reload() {
    api.get<AccountDetailData>(`/accounts/${id}`).then(setAccount);
    setVersion((v) => v + 1);
  }
  useEffect(reload, [id]);

  const FLAG_PROMPTS = {
    isStoreAccount: {
      on: "Mark this as a store account? Its sales will no longer credit a balance and it can't receive payouts.",
      off: "Unmark this as a store account? Future sales of its items will credit a balance it can be paid out from.",
    },
    // isActive is stored the other way round from the checkbox ("Inactive").
    isActive: {
      on: "Reactivate this account? It returns to the account lists and pickers, and its balance counts toward payout totals again.",
      off: "Mark this account inactive? It's hidden from the account lists and pickers, its balance stops counting toward payout totals (but is kept), and it can't take new intake until reactivated.",
    },
  };

  async function setFlag(flag: "isStoreAccount" | "isActive", value: boolean) {
    if (!window.confirm(FLAG_PROMPTS[flag][value ? "on" : "off"])) return;
    setFlagError(null);
    setFlagSaving(true);
    try {
      await api.patch(`/accounts/${id}`, { [flag]: value });
      reload();
    } catch (err) {
      setFlagError(err instanceof ApiError ? err.message : "Could not update the account.");
    } finally {
      setFlagSaving(false);
    }
  }

  // The list's "Latest Payout" link lands here as #payouts; React Router doesn't
  // scroll to hash targets, and the section only exists once the account has loaded.
  const { hash } = useLocation();
  useEffect(() => {
    if (account && hash === "#payouts") document.getElementById("payouts")?.scrollIntoView({ block: "start" });
  }, [account, hash]);

  if (!account) return <div className="p-8 text-gray-500">Loading…</div>;
  const showsBalance = account.currentBalance !== undefined;
  const canEditFlags = !!user && CAN_CREATE_ROLES.includes(user.activeRole);
  const canFlag = canEditFlags && FLAGGABLE_TYPES.includes(account.accountType);
  const canDeactivate = canEditFlags && account.accountType !== "STORE"; // the built-in store account is always active

  return (
    <div className="p-8 max-w-6xl">
      <BackToAccounts />
      <div className="flex justify-between items-start mt-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">{account.name}</h2>
          <div className="flex gap-2 items-center">
            <Badge>{account.accountType}</Badge>
            {account.isStoreAccount && <Badge tone="warning">Store account</Badge>}
            {!account.isActive && <Badge>Inactive</Badge>}
          </div>
          {(canFlag || canDeactivate) && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
              {canFlag && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={account.isStoreAccount}
                    disabled={flagSaving}
                    onChange={(e) => setFlag("isStoreAccount", e.target.checked)}
                  />
                  Store account (store-owned — no balance or payouts)
                </label>
              )}
              {canDeactivate && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!account.isActive}
                    disabled={flagSaving}
                    onChange={(e) => setFlag("isActive", !e.target.checked)}
                  />
                  Inactive (hidden from lists; not counted as owed; no new intake)
                </label>
              )}
            </div>
          )}
          {flagError && <p className="text-crimson text-xs mt-1">{flagError}</p>}
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
            {!account.isActive && account.currentBalance! !== 0 && (
              <div className="text-[10px] text-gray-500">Not counted in payout totals while inactive</div>
            )}
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

      {(showsBalance || account.payoutCount > 0) && (
        <AccountPayouts accountId={id} payoutCount={account.payoutCount} version={version} />
      )}

      <AccountItems accountId={id} itemCount={account.itemCount} version={version} />
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
  payoutNumber: number;
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
        <h2 className="text-2xl font-bold">
          Payout #{payout.payoutNumber}
          <span className="ml-3 text-base font-normal text-gray-500">{formatDate(payout.paidAt ?? payout.createdAt)}</span>
        </h2>
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
  const [isStoreAccount, setIsStoreAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tabLabel = TABS.find((t) => t.type === accountType)?.label.replace(/s$/, "") ?? accountType;
  const canBeStoreAccount = FLAGGABLE_TYPES.includes(accountType);
  const showsSplit = accountType !== "DONOR" && !isStoreAccount;

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
        isStoreAccount: canBeStoreAccount ? isStoreAccount : undefined,
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
          {canBeStoreAccount && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={isStoreAccount} onChange={(e) => setIsStoreAccount(e.target.checked)} />
              Store account (the shop's own — no balance or payouts; lists under the Store tab)
            </label>
          )}
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

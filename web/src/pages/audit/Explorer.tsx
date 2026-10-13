import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { Badge, Button, Card } from "../../components/Card";
import { Pager, rangeLabel } from "../../components/Pager";
import {
  AUDIT_LABELS,
  DIMENSIONS,
  dimensionLabel,
  labelOf,
  money,
  money0,
  valueLabel,
  type AuditLabelKey,
  type Dimension,
} from "./auditVocab";

interface Measures {
  count: number;
  retail: number;
  consignorShare: number;
  storeShare: number;
}
interface Summary {
  groupBy: Dimension;
  totals: Measures;
  groups: (Measures & { key: string })[];
  labels: (Measures & { key: string })[];
}
interface AuditItem {
  id: string;
  sku: string;
  description: string;
  category: string;
  price: number;
  status: string;
  intakeDate: string;
  tagPrintedAt: string | null;
  donateIfUnsold: boolean | null;
  auditLabel: string | null;
  auditAppliedAt: string | null;
  consignorPercent: number;
  accountId: string;
  accountName: string;
  accountActive: boolean;
  owner: string;
}
interface ItemPage {
  rows: AuditItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type Filters = Partial<Record<Dimension, string[]>>;
export interface ExplorerState {
  filters: Filters;
  q: string;
  groupBy: Dimension;
  sort: string;
  dir: "asc" | "desc";
  page: number;
}

// One-click starting points for the questions this page exists to answer.
const PRESETS: { label: string; filters: Filters; groupBy: Dimension }[] = [
  { label: "Expired consignments", filters: { expired: ["expired"] }, groupBy: "age" },
  { label: "Never tagged", filters: { tagged: ["never"] }, groupBy: "owner" },
  { label: "Inactive owners", filters: { accountStatus: ["inactive"] }, groupBy: "age" },
  {
    label: "Old store stock",
    filters: { owner: ["store", "store-account"], age: ["1-3y", "3y+"] },
    groupBy: "category",
  },
  { label: "Unlabeled", filters: { label: ["unlabeled"] }, groupBy: "expired" },
];

const PAGE_SIZE = 50;

// The query string shared by /audit/summary, /audit/items and a filter-based /audit/label.
export function filterQuery(filters: Filters, q: string): URLSearchParams {
  const qs = new URLSearchParams();
  for (const d of DIMENSIONS) {
    const v = filters[d.key];
    if (v?.length) qs.set(d.key, v.join(","));
  }
  if (q) qs.set("q", q);
  return qs;
}

export function Explorer({
  state,
  onChange,
  canApply,
}: {
  state: ExplorerState;
  onChange: (next: Partial<ExplorerState>) => void;
  canApply: boolean;
}) {
  const { filters, q, groupBy, sort, dir, page } = state;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<ItemPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const fq = useMemo(() => filterQuery(filters, q).toString(), [filters, q]);

  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => onChange({ q: search, page: 1 }), 300);
    return () => clearTimeout(t);
  }, [search, q, onChange]);

  // A new filter set is a new selection scope.
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, [fq]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Summary>(`/audit/summary?${fq}${fq ? "&" : ""}groupBy=${groupBy}`)
      .then((s) => !cancelled && setSummary(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [fq, groupBy, reload]);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams(fq);
    qs.set("sort", sort);
    qs.set("dir", dir);
    qs.set("page", String(page));
    qs.set("pageSize", String(PAGE_SIZE));
    api
      .get<ItemPage>(`/audit/items?${qs}`)
      .then((r) => !cancelled && setItems(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [fq, sort, dir, page, reload]);

  const toggleValue = (dim: Dimension, value: string) => {
    const current = filters[dim] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ filters: { ...filters, [dim]: next.length ? next : undefined }, page: 1 });
  };
  const activeFilters = DIMENSIONS.filter((d) => filters[d.key]?.length);
  const selectedCount = allMatching ? (summary?.totals.count ?? 0) : selected.size;

  const label = async (labelKey: AuditLabelKey | null) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const body = allMatching
        ? { label: labelKey, filters: Object.fromEntries(new URLSearchParams(fq)) }
        : { label: labelKey, itemIds: Array.from(selected) };
      const res = await api.post<{ changed: number; skipped: number }>("/audit/label", body);
      setNotice(
        `${res.changed.toLocaleString()} item${res.changed === 1 ? "" : "s"} ${labelKey ? `labeled ${labelOf(labelKey)}` : "unlabeled"}` +
          (res.skipped ? ` (${res.skipped.toLocaleString()} already applied — unchanged)` : "") +
          "."
      );
      setSelected(new Set());
      setAllMatching(false);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Labeling failed.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (labelKey: AuditLabelKey, count: number) => {
    const def = AUDIT_LABELS.find((l) => l.key === labelKey)!;
    if (
      !window.confirm(
        `Apply "${def.label}" to ${count.toLocaleString()} item(s)?\n\n${def.effect}\n\nEach item's history records the change.`
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.post<{ applied: number }>("/audit/apply", { label: labelKey });
      setNotice(`Applied "${def.label}" to ${res.applied.toLocaleString()} item(s).`);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Apply failed.");
    } finally {
      setBusy(false);
    }
  };

  const pageIds = items?.rows.map((r) => r.id) ?? [];
  const pageAllSelected = allMatching || (pageIds.length > 0 && pageIds.every((id) => selected.has(id)));
  const togglePage = () => {
    setAllMatching(false);
    setSelected((s) => {
      const next = new Set(s);
      if (pageAllSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleRow = (id: string) => {
    setAllMatching(false);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const sortBy = (key: string) => onChange({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc", page: 1 });

  const maxGroup = Math.max(1, ...(summary?.groups.map((g) => g.count) ?? [1]));
  const selectedValues = filters[groupBy] ?? [];
  const pages = items ? Math.max(1, Math.ceil(items.total / items.pageSize)) : 1;

  return (
    <div className="space-y-6">
      {/* Presets + search + active filters */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wide mr-1">Start from</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => onChange({ filters: p.filters, groupBy: p.groupBy, page: 1 })}
              className="px-3 py-1 border border-ink bg-white hover:bg-bone text-xs font-bold uppercase"
            >
              {p.label}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, description, account…"
            className="ml-auto border border-ink px-2 py-1 text-sm w-64"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold uppercase tracking-wide mr-1">Filters</span>
          {activeFilters.length === 0 && !q && <span className="text-gray-500">None — the whole active floor.</span>}
          {activeFilters.flatMap((d) =>
            (filters[d.key] ?? []).map((v) => (
              <button
                key={`${d.key}:${v}`}
                onClick={() => toggleValue(d.key, v)}
                className="px-2 py-1 border border-crimson bg-crimson/10 hover:bg-crimson/20"
                title="Remove filter"
              >
                <span className="text-gray-600">{d.label}:</span> <b>{valueLabel(d.key, v)}</b> ✕
              </button>
            ))
          )}
          {(activeFilters.length > 0 || q) && (
            <button
              onClick={() => {
                setSearch("");
                onChange({ filters: {}, q: "", page: 1 });
              }}
              className="px-2 py-1 border border-ink bg-white hover:bg-bone uppercase font-bold"
            >
              Clear all
            </button>
          )}
        </div>
      </Card>

      {error && <p className="text-crimson text-sm">{error}</p>}
      {notice && <p className="text-green-700 text-sm">{notice}</p>}

      {/* Totals */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Total label="Items" value={summary.totals.count.toLocaleString()} />
          <Total label="Retail Value" value={money0(summary.totals.retail)} sub="at tag price" />
          <Total
            label="Consignor Share"
            value={money0(summary.totals.consignorShare)}
            sub="owed to consignors if it all sells"
          />
          <Total label="Store Share" value={money0(summary.totals.storeShare)} sub="the store's if it all sells" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Pivot */}
        <Card>
          <div className="flex flex-wrap gap-1 mb-4">
            <span className="text-xs font-bold uppercase tracking-wide mr-2 self-center">Break down by</span>
            {DIMENSIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => onChange({ groupBy: d.key })}
                className={`px-2 py-1 text-[11px] font-bold uppercase border border-ink ${
                  groupBy === d.key ? "bg-crimson text-white" : "bg-white hover:bg-bone"
                } ${filters[d.key]?.length ? "underline decoration-gold decoration-2" : ""}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr>
                  <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">{dimensionLabel(groupBy)}</th>
                  <th className="text-right p-2 border-b-2 border-gold text-xs uppercase">Items</th>
                  <th className="p-2 border-b-2 border-gold w-1/5" />
                  <th className="text-right p-2 border-b-2 border-gold text-xs uppercase">Retail</th>
                  <th className="text-right p-2 border-b-2 border-gold text-xs uppercase">Consignor</th>
                  <th className="text-right p-2 border-b-2 border-gold text-xs uppercase">Store</th>
                </tr>
              </thead>
              <tbody>
                {summary && summary.groupBy !== groupBy && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-gray-400">
                      Loading…
                    </td>
                  </tr>
                )}
                {summary?.groupBy === groupBy &&
                  summary.groups.map((g) => {
                    const on = selectedValues.includes(g.key);
                    return (
                      <tr
                        key={g.key}
                        onClick={() => toggleValue(groupBy, g.key)}
                        className={`border-b border-gray-100 cursor-pointer ${on ? "bg-crimson/10" : "hover:bg-bone"}`}
                        title={on ? "Remove this filter" : "Filter to this"}
                      >
                        <td className="p-2 font-bold">
                          <span className={`inline-block w-4 ${on ? "text-crimson" : "text-gray-300"}`}>
                            {on ? "✓" : "○"}
                          </span>
                          {valueLabel(groupBy, g.key)}
                        </td>
                        <td className="p-2 text-right">{g.count.toLocaleString()}</td>
                        <td className="p-2">
                          <div className="h-2 bg-crimson" style={{ width: `${(g.count / maxGroup) * 100}%` }} />
                        </td>
                        <td className="p-2 text-right">{money0(g.retail)}</td>
                        <td className="p-2 text-right">{money0(g.consignorShare)}</td>
                        <td className="p-2 text-right text-gray-600">{money0(g.storeShare)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Click rows to filter (several in one breakdown = any of them). The breakdown ignores its own filter so every
            value stays listed.
          </p>
        </Card>

        {/* Labels */}
        <Card>
          <h3 className="font-bold uppercase tracking-wide mb-1">Audit Labels</h3>
          <p className="text-[10px] text-gray-500 mb-3">
            Labels are notes until applied. Progress covers the whole active floor.
          </p>
          <LabelProgress summary={summary} canApply={canApply} busy={busy} onApply={apply} />
        </Card>
      </div>

      {/* Items */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-bold uppercase tracking-wide">Items</h3>
          {items && (
            <span className="text-xs text-gray-600">
              {rangeLabel(items.page, items.pageSize, items.total, activeFilters.length > 0 || !!q)}
            </span>
          )}
        </div>

        {selectedCount > 0 && (
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-ink text-white p-2 mb-3 text-xs">
            <span className="font-bold mr-2">{selectedCount.toLocaleString()} selected — label as:</span>
            {AUDIT_LABELS.map((l) => (
              <button
                key={l.key}
                disabled={busy}
                onClick={() => label(l.key)}
                className="px-2 py-1 border border-white hover:bg-white hover:text-ink uppercase font-bold disabled:opacity-40"
                title={l.effect}
              >
                {l.label}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => label(null)}
              className="px-2 py-1 border border-gray-400 text-gray-300 hover:bg-white hover:text-ink uppercase font-bold disabled:opacity-40"
            >
              Clear label
            </button>
            <button
              onClick={() => {
                setSelected(new Set());
                setAllMatching(false);
              }}
              className="ml-auto underline"
            >
              Deselect
            </button>
          </div>
        )}
        {pageAllSelected && !allMatching && items && items.total > pageIds.length && (
          <p className="text-xs bg-bone p-2 mb-3">
            All {pageIds.length} on this page are selected.{" "}
            <button className="underline font-bold" onClick={() => setAllMatching(true)}>
              Select all {items.total.toLocaleString()} matching items
            </button>
          </p>
        )}
        {allMatching && (
          <p className="text-xs bg-bone p-2 mb-3">
            All {summary?.totals.count.toLocaleString()} matching items are selected.{" "}
            <button className="underline" onClick={() => setAllMatching(false)}>
              Clear
            </button>
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr>
                <th className="p-2 border-b-2 border-gold w-8">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={togglePage}
                    aria-label="Select this page"
                  />
                </th>
                <SortTh label="SKU" k="sku" sort={sort} dir={dir} onSort={sortBy} />
                <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Description</th>
                <SortTh label="Category" k="category" sort={sort} dir={dir} onSort={sortBy} />
                <SortTh label="Account" k="account" sort={sort} dir={dir} onSort={sortBy} />
                <SortTh label="Received" k="intake" sort={sort} dir={dir} onSort={sortBy} />
                <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Tagged</th>
                <th className="text-right p-2 border-b-2 border-gold text-xs uppercase">Split</th>
                <SortTh label="Price" k="price" sort={sort} dir={dir} onSort={sortBy} right />
                <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Label</th>
              </tr>
            </thead>
            <tbody>
              {items?.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-gray-400">
                    Nothing matches.
                  </td>
                </tr>
              )}
              {items?.rows.map((r) => {
                const on = allMatching || selected.has(r.id);
                return (
                  <tr key={r.id} className={`border-b border-gray-100 ${on ? "bg-crimson/5" : ""}`}>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleRow(r.id)}
                        aria-label={`Select ${r.sku}`}
                      />
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <Link to={`/inventory/${r.id}`} className="font-mono text-xs hover:text-crimson hover:underline">
                        {r.sku}
                      </Link>
                    </td>
                    <td className="p-2">{r.description}</td>
                    <td className="p-2 text-gray-600">{r.category}</td>
                    <td className="p-2">
                      <Link to={`/accounts/${r.accountId}`} className="hover:text-crimson hover:underline">
                        {r.accountName}
                      </Link>
                      {!r.accountActive && <span className="ml-1 text-[10px] uppercase text-gray-500">inactive</span>}
                    </td>
                    <td className="p-2 whitespace-nowrap text-gray-600">
                      {new Date(r.intakeDate).toLocaleDateString()}
                    </td>
                    <td className="p-2 whitespace-nowrap text-gray-600">
                      {r.tagPrintedAt ? (
                        new Date(r.tagPrintedAt).toLocaleDateString()
                      ) : (
                        <span className="text-crimson">never</span>
                      )}
                    </td>
                    <td className="p-2 text-right text-gray-600">{r.consignorPercent}%</td>
                    <td className="p-2 text-right font-bold">{money(r.price)}</td>
                    <td className="p-2">
                      {r.auditLabel && (
                        <Badge tone={r.auditAppliedAt ? "sold" : "warning"}>
                          {labelOf(r.auditLabel)}
                          {r.auditAppliedAt ? " ✓" : ""}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end mt-3">
          <Pager page={page} pages={pages} onPage={(p) => onChange({ page: p })} />
        </div>
      </Card>
    </div>
  );
}

function Total({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="text-2xl font-black text-crimson mt-1">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </Card>
  );
}

function SortTh({
  label,
  k,
  sort,
  dir,
  onSort,
  right = false,
}: {
  label: string;
  k: string;
  sort: string;
  dir: string;
  onSort: (k: string) => void;
  right?: boolean;
}) {
  return (
    <th className={`p-2 border-b-2 border-gold text-xs uppercase ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => onSort(k)} className="uppercase font-bold hover:text-crimson">
        {label}
        {sort === k ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

// Per label: how many items carry it, how many still await "Apply" (Owner/Admin).
function LabelProgress({
  summary,
  canApply,
  busy,
  onApply,
}: {
  summary: Summary | null;
  canApply: boolean;
  busy: boolean;
  onApply: (label: AuditLabelKey, count: number) => void;
}) {
  if (!summary) return <p className="text-gray-500 text-sm">Loading…</p>;
  const byKey = new Map(summary.labels.map((l) => [l.key, l]));
  const total = summary.labels.reduce((n, l) => n + l.count, 0);
  const unlabeled = byKey.get("unlabeled")?.count ?? 0;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span>Reviewed</span>
          <span className="font-bold">
            {(total - unlabeled).toLocaleString()} / {total.toLocaleString()}
          </span>
        </div>
        <div className="h-2 bg-bone border border-ink">
          <div className="h-full bg-gold" style={{ width: `${total ? ((total - unlabeled) / total) * 100 : 0}%` }} />
        </div>
      </div>
      {AUDIT_LABELS.map((l) => {
        const pending = byKey.get(l.key);
        const applied = byKey.get(`${l.key}:applied`);
        return (
          <div key={l.key} className="border-t border-gray-100 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-bold">{l.label}</span>
              <span className="text-xs text-gray-600">
                {(pending?.count ?? 0).toLocaleString()} pending
                {applied ? ` · ${applied.count.toLocaleString()} applied` : ""}
              </span>
            </div>
            {pending && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-500">
                  {money0(pending.retail)} retail · {money0(pending.consignorShare)} consignor share
                </span>
                {l.key !== "KEEP" && (
                  <Button
                    variant="secondary"
                    className="!px-2 !py-1 !text-[10px]"
                    disabled={!canApply || busy}
                    onClick={() => onApply(l.key, pending.count)}
                  >
                    Apply
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!canApply && <p className="text-[10px] text-gray-500">Applying labels needs an Owner or Admin session.</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { Badge, Button, Card } from "../../components/Card";
import { Pager, rangeLabel } from "../../components/Pager";
import { TagLabel } from "../../components/TagLabel";
import { PRINT_SOURCE_LABEL } from "./DayDetail";
import { localDateKey, money } from "./reportFormat";

interface JobRow {
  id: string;
  createdAt: string;
  source: string;
  itemCount: number;
  activeRole: string | null;
  reprintOfId: string | null;
  createdBy: { name: string } | null;
  items: { sku: string; description: string }[];
}
interface JobList {
  rows: JobRow[];
  total: number;
  page: number;
  pageSize: number;
}
interface JobDetail {
  id: string;
  createdAt: string;
  source: string;
  itemCount: number;
  activeRole: string | null;
  createdBy: { name: string } | null;
  reprintOf: { id: string; createdAt: string } | null;
  reprints: { id: string; createdAt: string; itemCount: number }[];
  items: {
    id: string;
    itemId: string | null;
    sku: string;
    description: string;
    price: number;
    category: string | null;
    size: string | null;
    item: {
      id: string;
      sku: string;
      description: string;
      price: number;
      status: string;
      category: string;
      size: string | null;
    } | null;
  }[];
}

export interface PrintQueueFilters {
  q: string;
  from: string;
  to: string;
  page: number;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Reports > Print Queues: every tag print run, newest first, searchable by SKU or
// description; open one to see its tags and print them (or some of them) again.
export function PrintQueues({
  jobId,
  filters,
  onFilters,
  onOpenJob,
}: {
  jobId: string | null;
  filters: PrintQueueFilters;
  onFilters: (f: Partial<PrintQueueFilters>) => void;
  onOpenJob: (id: string | null) => void;
}) {
  return jobId ? (
    <JobView id={jobId} onOpenJob={onOpenJob} />
  ) : (
    <JobListView filters={filters} onFilters={onFilters} onOpenJob={onOpenJob} />
  );
}

function JobListView({
  filters,
  onFilters,
  onOpenJob,
}: {
  filters: PrintQueueFilters;
  onFilters: (f: Partial<PrintQueueFilters>) => void;
  onOpenJob: (id: string) => void;
}) {
  const [data, setData] = useState<JobList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(filters.q);

  // Debounce typing into the URL-backed filter.
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => onFilters({ q: search, page: 1 }), 300);
    return () => clearTimeout(t);
  }, [search, filters.q, onFilters]);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(filters.page), pageSize: "25" });
    if (filters.q) qs.set("q", filters.q);
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    setError(null);
    api
      .get<JobList>(`/reports/print-jobs?${qs}`)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [filters.page, filters.q, filters.from, filters.to]);

  const filtered = Boolean(filters.q || filters.from || filters.to);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const th = "text-left p-2 border-b-2 border-gold text-xs uppercase";

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h3 className="font-bold uppercase tracking-wide">Print Queues</h3>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="font-bold uppercase">
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SKU or description"
              className="block border border-ink px-2 py-1 text-sm font-normal normal-case w-52"
            />
          </label>
          <label className="font-bold uppercase">
            From
            <input
              type="date"
              value={filters.from}
              max={filters.to || localDateKey(new Date())}
              onChange={(e) => onFilters({ from: e.target.value, page: 1 })}
              className="block border border-ink px-2 py-1 text-sm font-normal"
            />
          </label>
          <label className="font-bold uppercase">
            To
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              max={localDateKey(new Date())}
              onChange={(e) => onFilters({ to: e.target.value, page: 1 })}
              className="block border border-ink px-2 py-1 text-sm font-normal"
            />
          </label>
          {filtered && (
            <button
              onClick={() => {
                setSearch("");
                onFilters({ q: "", from: "", to: "", page: 1 });
              }}
              className="px-2 py-1 border border-ink bg-white hover:bg-bone uppercase font-bold"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-crimson text-sm mb-2">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr>
              <th className={th}>Printed</th>
              <th className={th}>By</th>
              <th className={th}>Source</th>
              <th className={`${th} text-right`}>Tags</th>
              <th className={th}>Items</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-400">
                  {filtered ? "No print runs match." : "No tags have been printed yet."}
                </td>
              </tr>
            )}
            {data?.rows.map((j) => (
              <tr
                key={j.id}
                onClick={() => onOpenJob(j.id)}
                className="border-b border-gray-100 cursor-pointer hover:bg-bone"
              >
                <td className="p-2 whitespace-nowrap">{when(j.createdAt)}</td>
                <td className="p-2 text-gray-600">
                  {j.createdBy?.name ?? "—"}
                  {j.activeRole && (
                    <div className="text-[10px] uppercase">{j.activeRole.replace("_", " ").toLowerCase()}</div>
                  )}
                </td>
                <td className="p-2">
                  <Badge tone={j.source === "REPRINT" ? "warning" : "default"}>
                    {PRINT_SOURCE_LABEL[j.source] ?? j.source}
                  </Badge>
                </td>
                <td className="p-2 text-right font-bold">{j.itemCount}</td>
                <td className="p-2 text-xs text-gray-600">
                  {j.items.map((i) => `${i.sku} ${i.description.slice(0, 24)}`).join(", ")}
                  {j.itemCount > j.items.length && ` +${j.itemCount - j.items.length} more`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-600">
          <span>{rangeLabel(data.page, data.pageSize, data.total, filtered)}</span>
          <Pager page={data.page} pages={pages} onPage={(page) => onFilters({ page })} />
        </div>
      )}
    </Card>
  );
}

function JobView({ id, onOpenJob }: { id: string; onOpenJob: (id: string | null) => void }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setJob(null);
    setError(null);
    setNotice(null);
    setSelected(new Set());
    api
      .get<JobDetail>(`/reports/print-jobs/${id}`)
      .then((d) => !cancelled && setJob(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <button onClick={() => onOpenJob(null)} className="text-xs font-bold uppercase hover:text-crimson">
      ← All print queues
    </button>
  );
  if (error)
    return (
      <div className="space-y-3">
        {back}
        <p className="text-crimson text-sm">{error}</p>
      </div>
    );
  if (!job) return <p className="text-gray-500">Loading…</p>;

  const printable = job.items.filter((l) => l.item);
  const toggle = (lineId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

  const reprint = async (lineIds?: string[]) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.post<{ printJobId: string; printed: number; skipped: number }>(
        `/reports/print-jobs/${job.id}/reprint`,
        lineIds ? { printJobItemIds: lineIds } : {}
      );
      setSelected(new Set());
      setNotice(
        `${res.printed} tag${res.printed === 1 ? "" : "s"} sent to the printer` +
          (res.skipped ? ` (${res.skipped} skipped — item deleted)` : "") +
          "."
      );
      // Show the new run in the "Reprinted as" list.
      setJob(await api.get<JobDetail>(`/reports/print-jobs/${job.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reprint failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {back}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-bold uppercase tracking-wide">
              {job.itemCount} tag{job.itemCount === 1 ? "" : "s"} · {when(job.createdAt)}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {PRINT_SOURCE_LABEL[job.source] ?? job.source}
              {job.createdBy ? ` by ${job.createdBy.name}` : ""}
              {job.activeRole ? ` (${job.activeRole.replace("_", " ").toLowerCase()})` : ""}
              {" · "}
              <Link
                to={`/reports?tab=day&date=${localDateKey(new Date(job.createdAt))}`}
                className="hover:text-crimson hover:underline"
              >
                Day detail
              </Link>
            </p>
            {job.reprintOf && (
              <p className="text-xs mt-1">
                Reprint of{" "}
                <button onClick={() => onOpenJob(job.reprintOf!.id)} className="underline hover:text-crimson">
                  the run from {when(job.reprintOf.createdAt)}
                </button>
              </p>
            )}
            {job.reprints.length > 0 && (
              <p className="text-xs mt-1">
                Reprinted as:{" "}
                {job.reprints.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ", "}
                    <button onClick={() => onOpenJob(r.id)} className="underline hover:text-crimson">
                      {when(r.createdAt)} ({r.itemCount})
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy || selected.size === 0}
              onClick={() => reprint(Array.from(selected))}
            >
              Reprint Selected ({selected.size})
            </Button>
            <Button disabled={busy || printable.length === 0} onClick={() => reprint()}>
              Reprint All ({printable.length})
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-gray-500 mt-3">
          Tags below show what was printed. A reprint uses each item's current details.
        </p>
        {notice && <p className="text-sm text-green-700 mt-2">{notice}</p>}
      </Card>

      <div className="flex flex-wrap gap-4">
        {job.items.map((line) => {
          const now = line.item;
          const changes = now
            ? [
                now.price !== line.price ? `now ${money(now.price)}` : null,
                now.description !== line.description ? "description changed" : null,
              ].filter(Boolean)
            : [];
          return (
            <TagLabel
              key={line.id}
              tag={line}
              dim={!now}
              corner={
                now ? (
                  <input
                    type="checkbox"
                    checked={selected.has(line.id)}
                    onChange={() => toggle(line.id)}
                    aria-label={`Select ${line.sku} for reprint`}
                  />
                ) : undefined
              }
            >
              <div className="flex items-center justify-between text-[10px] mt-1">
                {now ? (
                  <Link to={`/inventory/${now.id}`} className="font-mono hover:text-crimson hover:underline">
                    {line.sku}
                  </Link>
                ) : (
                  <span className="font-mono">{line.sku}</span>
                )}
                {now ? (
                  now.status === "SOLD" && <Badge tone="sold">Sold</Badge>
                ) : (
                  <span className="text-crimson uppercase">Deleted</span>
                )}
              </div>
              {changes.length > 0 && (
                <div className="text-[10px] text-crimson font-bold">Since printed: {changes.join(", ")}</div>
              )}
            </TagLabel>
          );
        })}
      </div>
    </div>
  );
}

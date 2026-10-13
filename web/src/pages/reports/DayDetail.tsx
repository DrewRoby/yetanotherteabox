import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, Card } from "../../components/Card";
import { DateStepper } from "./DateStepper";
import { avgTicket, count, longDate, money, type Metrics } from "./reportFormat";

interface ItemRef {
  id: string;
  sku: string;
  description: string;
  category: string;
  account: { id: string; name: string };
}
interface Detail {
  date: string;
  metrics: Metrics;
  sold: {
    total: number;
    rows: {
      id: string;
      saleDate: string;
      salePrice: number;
      paymentType: string;
      transactionId: string | null;
      processedBy: { name: string } | null;
      item: ItemRef;
    }[];
  };
  added: { total: number; rows: (ItemRef & { intakeDate: string; price: number; status: string })[] };
  priced: {
    total: number;
    rows: {
      id: string;
      timestamp: string;
      oldValue: string | null;
      newValue: string | null;
      changedBy: { name: string } | null;
      item: ItemRef;
    }[];
  };
  printJobs: {
    id: string;
    createdAt: string;
    source: string;
    itemCount: number;
    createdBy: { name: string } | null;
    items: { id: string; itemId: string | null; sku: string; description: string; price: number }[];
  }[];
  payouts: {
    id: string;
    payoutNumber: number;
    amount: number;
    paidAt: string;
    account: { id: string; name: string; accountType: string };
    _count: { lines: number };
  }[];
}

export const PRINT_SOURCE_LABEL: Record<string, string> = { INTAKE: "Intake", ITEM: "Item page", REPRINT: "Reprint" };
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const th = "text-left p-2 border-b-2 border-gold text-xs uppercase";

// Reports > Day Detail: everything that happened on one day — sales (grouped by
// transaction), intake, repricing, tag print runs and payouts, each linking onward.
export function DayDetail({ date, onDate }: { date: string; onDate: (date: string) => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<Detail>(`/reports/day-detail?date=${date}`)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const tagsPrinted = data?.printJobs.reduce((n, j) => n + j.itemCount, 0) ?? 0;
  const sections = data
    ? [
        { id: "sold", label: "Sold", n: data.sold.total },
        { id: "added", label: "Added", n: data.added.total },
        { id: "priced", label: "Priced", n: data.priced.total },
        { id: "printed", label: "Tags Printed", n: tagsPrinted },
        { id: "payouts", label: "Payouts", n: data.payouts.length },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateStepper label="Day" value={date} onChange={onDate} />
        <h2 className="text-lg font-bold">{longDate(date)}</h2>
      </div>
      {error && <p className="text-crimson text-sm">{error}</p>}
      {!data && !error && <p className="text-gray-500">Loading…</p>}
      {data && (
        <div className={`space-y-6 ${data.date !== date ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat
              label="Transactions"
              value={count(data.metrics.transactions)}
              sub={`avg ${money(avgTicket(data.metrics))}`}
            />
            <Stat label="Items Sold" value={count(data.metrics.itemsSold)} />
            <Stat label="Gross Sales" value={money(data.metrics.grossSales)} />
            <Stat
              label="Inventory Added"
              value={money(data.metrics.inventoryAdded)}
              sub={`${count(data.metrics.itemsAdded)} items`}
            />
            <Stat label="Payouts" value={money(data.metrics.payouts)} sub={`${count(data.metrics.payoutCount)} paid`} />
            <Stat label="Tags Printed" value={count(tagsPrinted)} sub={`${data.printJobs.length} print runs`} />
          </div>

          <nav className="flex flex-wrap gap-2 text-xs">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => document.getElementById(`day-${s.id}`)?.scrollIntoView({ behavior: "smooth" })}
                className="px-3 py-1 border border-ink bg-white hover:bg-bone font-bold uppercase"
              >
                {s.label} ({count(s.n)})
              </button>
            ))}
          </nav>

          <Sold data={data} />
          <Added data={data} />
          <Priced data={data} />
          <Printed data={data} />
          <Payouts data={data} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="text-xl font-black text-crimson mt-1">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </Card>
  );
}

function Section({
  id,
  title,
  children,
  truncated,
}: {
  id: string;
  title: string;
  children: ReactNode;
  truncated?: { shown: number; total: number };
}) {
  return (
    <Card>
      <h3 id={`day-${id}`} className="font-bold uppercase tracking-wide mb-3 scroll-mt-4">
        {title}
      </h3>
      {truncated && truncated.total > truncated.shown && (
        <p className="text-xs text-crimson mb-2">
          Showing the first {count(truncated.shown)} of {count(truncated.total)}.
        </p>
      )}
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

function Empty({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="p-4 text-center text-gray-400">
        {children}
      </td>
    </tr>
  );
}

function SkuLink({ item }: { item: { id: string | null; sku: string } }) {
  return item.id ? (
    <Link to={`/inventory/${item.id}`} className="font-mono text-xs hover:text-crimson hover:underline">
      {item.sku}
    </Link>
  ) : (
    <span className="font-mono text-xs text-gray-400" title="Item deleted">
      {item.sku}
    </span>
  );
}

function AccountLink({ account }: { account: { id: string; name: string } }) {
  return (
    <Link to={`/accounts/${account.id}`} className="hover:text-crimson hover:underline">
      {account.name}
    </Link>
  );
}

// Sales grouped by transaction, numbered in the order they were rung up.
function Sold({ data }: { data: Detail }) {
  const tickets = useMemo(() => {
    const groups = new Map<string, Detail["sold"]["rows"]>();
    for (const s of data.sold.rows) {
      const key = s.transactionId ?? s.id;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return Array.from(groups.values());
  }, [data]);

  return (
    <Section id="sold" title="Items Sold" truncated={{ shown: data.sold.rows.length, total: data.sold.total }}>
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr>
            <th className={th}>SKU</th>
            <th className={th}>Description</th>
            <th className={th}>Category</th>
            <th className={th}>Account</th>
            <th className={`${th} text-right`}>Price</th>
          </tr>
        </thead>
        <tbody>
          {tickets.length === 0 && <Empty cols={5}>Nothing sold.</Empty>}
          {tickets.map((lines, i) => {
            const first = lines[0];
            const total = lines.reduce((t, l) => t + l.salePrice, 0);
            return [
              <tr key={`t-${first.id}`} className="bg-bone border-y border-gray-200">
                <td colSpan={4} className="p-2 text-xs">
                  <span className="font-bold uppercase">Transaction {i + 1}</span>
                  <span className="text-gray-500">
                    {" · "}
                    {first.paymentType.replace("_", " ").toLowerCase()} · {count(lines.length)} item
                    {lines.length === 1 ? "" : "s"}
                    {first.processedBy ? ` · ${first.processedBy.name}` : ""}
                  </span>
                </td>
                <td className="p-2 text-right font-bold">{money(total)}</td>
              </tr>,
              ...lines.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="p-2 pl-4">
                    <SkuLink item={s.item} />
                  </td>
                  <td className="p-2">{s.item.description}</td>
                  <td className="p-2 text-gray-600">{s.item.category}</td>
                  <td className="p-2">
                    <AccountLink account={s.item.account} />
                  </td>
                  <td className="p-2 text-right">{money(s.salePrice)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </Section>
  );
}

function Added({ data }: { data: Detail }) {
  return (
    <Section id="added" title="Items Added" truncated={{ shown: data.added.rows.length, total: data.added.total }}>
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr>
            <th className={th}>SKU</th>
            <th className={th}>Description</th>
            <th className={th}>Category</th>
            <th className={th}>Account</th>
            <th className={th}>Status</th>
            <th className={`${th} text-right`}>Price</th>
          </tr>
        </thead>
        <tbody>
          {data.added.rows.length === 0 && <Empty cols={6}>No intake.</Empty>}
          {data.added.rows.map((i) => (
            <tr key={i.id} className="border-b border-gray-100">
              <td className="p-2">
                <SkuLink item={i} />
              </td>
              <td className="p-2">{i.description}</td>
              <td className="p-2 text-gray-600">{i.category}</td>
              <td className="p-2">
                <AccountLink account={i.account} />
              </td>
              <td className="p-2">
                <Badge tone={i.status === "SOLD" ? "sold" : "default"}>{i.status}</Badge>
              </td>
              <td className="p-2 text-right">{money(i.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Priced({ data }: { data: Detail }) {
  return (
    <Section id="priced" title="Items Priced" truncated={{ shown: data.priced.rows.length, total: data.priced.total }}>
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr>
            <th className={th}>Time</th>
            <th className={th}>SKU</th>
            <th className={th}>Description</th>
            <th className={th}>Account</th>
            <th className={th}>By</th>
            <th className={`${th} text-right`}>Price Change</th>
          </tr>
        </thead>
        <tbody>
          {data.priced.rows.length === 0 && (
            <Empty cols={6}>No price changes. (Liberty's price history wasn't migrated.)</Empty>
          )}
          {data.priced.rows.map((h) => (
            <tr key={h.id} className="border-b border-gray-100">
              <td className="p-2 text-gray-600 whitespace-nowrap">{time(h.timestamp)}</td>
              <td className="p-2">
                <SkuLink item={h.item} />
              </td>
              <td className="p-2">{h.item.description}</td>
              <td className="p-2">
                <AccountLink account={h.item.account} />
              </td>
              <td className="p-2 text-gray-600">{h.changedBy?.name ?? "—"}</td>
              <td className="p-2 text-right whitespace-nowrap">
                <span className="text-gray-400 line-through mr-2">{h.oldValue ?? "—"}</span>
                <span className="font-bold">{h.newValue ?? "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Printed({ data }: { data: Detail }) {
  return (
    <Section id="printed" title="Tags Printed">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr>
            <th className={th}>Time</th>
            <th className={th}>Print Run</th>
            <th className={th}>By</th>
            <th className={th}>Tags</th>
          </tr>
        </thead>
        <tbody>
          {data.printJobs.length === 0 && <Empty cols={4}>No tags printed.</Empty>}
          {data.printJobs.map((j) => (
            <tr key={j.id} className="border-b border-gray-100 align-top">
              <td className="p-2 text-gray-600 whitespace-nowrap">{time(j.createdAt)}</td>
              <td className="p-2 whitespace-nowrap">
                <Link to={`/reports?tab=print&job=${j.id}`} className="font-bold hover:text-crimson hover:underline">
                  {count(j.itemCount)} tag{j.itemCount === 1 ? "" : "s"} →
                </Link>
                <div className="text-[10px] uppercase text-gray-500">{PRINT_SOURCE_LABEL[j.source] ?? j.source}</div>
              </td>
              <td className="p-2 text-gray-600">{j.createdBy?.name ?? "—"}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {j.items.map((t) => (
                    <span key={t.id} className="whitespace-nowrap">
                      <SkuLink item={{ id: t.itemId, sku: t.sku }} />{" "}
                      <span className="text-xs text-gray-600">
                        {t.description.slice(0, 32)} · {money(t.price)}
                      </span>
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Payouts({ data }: { data: Detail }) {
  const total = data.payouts.reduce((t, p) => t + p.amount, 0);
  return (
    <Section id="payouts" title="Payouts">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr>
            <th className={th}>Payout #</th>
            <th className={th}>Account</th>
            <th className={th}>Lines</th>
            <th className={`${th} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.payouts.length === 0 && <Empty cols={4}>No payouts.</Empty>}
          {data.payouts.map((p) => (
            <tr key={p.id} className="border-b border-gray-100">
              <td className="p-2">
                <Link
                  to={`/accounts/${p.account.id}/payouts/${p.id}`}
                  className="font-bold hover:text-crimson hover:underline"
                >
                  #{p.payoutNumber}
                </Link>
              </td>
              <td className="p-2">
                <AccountLink account={p.account} />
              </td>
              <td className="p-2 text-gray-600">{count(p._count.lines)}</td>
              <td className="p-2 text-right font-bold">{money(p.amount)}</td>
            </tr>
          ))}
        </tbody>
        {data.payouts.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-ink font-bold">
              <td className="p-2" colSpan={3}>
                Total
              </td>
              <td className="p-2 text-right">{money(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </Section>
  );
}

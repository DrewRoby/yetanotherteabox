import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { SignInSheet } from "./reports/SignInSheet";
import { BarcodeGenerator } from "./reports/BarcodeGenerator";
import { SalesSummary } from "./reports/SalesSummary";
import { DayDetail } from "./reports/DayDetail";
import { PrintQueues, type PrintQueueFilters } from "./reports/PrintQueues";
import { todayKey } from "./reports/reportFormat";

const TABS = [
  { key: "sales", label: "Daily Sales Summary" },
  { key: "day", label: "Day Detail" },
  { key: "sign-in", label: "Employee Sign-In Sheet" },
  { key: "barcode", label: "Barcode Generator" },
  { key: "print", label: "Print Queues" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// All report state lives in the URL (?tab=&date=&days=, Print Queues' ?job=/pq/pfrom/
// pto/ppage) so Back returns to the same view and a day or print run can be linked to
// — Day Detail rows link out to items/accounts/payouts and back again. `date` is shared:
// the summary's "as of" day is the day Day Detail opens on.
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.some((t) => t.key === params.get("tab")) ? (params.get("tab") as TabKey) : "sales";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : todayKey();
  const days = Number(params.get("days")) || 14;

  const update = useCallback(
    (changes: Record<string, string | null>, push = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: !push }
      ),
    [setParams]
  );

  const printFilters: PrintQueueFilters = {
    q: params.get("pq") ?? "",
    from: params.get("pfrom") ?? "",
    to: params.get("pto") ?? "",
    page: Number(params.get("ppage")) || 1,
  };
  const onPrintFilters = useCallback(
    (f: Partial<PrintQueueFilters>) =>
      update({
        ...(f.q !== undefined ? { pq: f.q } : {}),
        ...(f.from !== undefined ? { pfrom: f.from } : {}),
        ...(f.to !== undefined ? { pto: f.to } : {}),
        ...(f.page !== undefined ? { ppage: f.page > 1 ? String(f.page) : null } : {}),
      }),
    [update]
  );

  return (
    <div className="p-8">
      <div className="no-print mb-6">
        <h1 className="text-xl font-bold uppercase">Reports &amp; Analytics</h1>
      </div>

      <div className="no-print flex flex-wrap gap-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => update({ tab: t.key === "sales" ? null : t.key, job: null }, true)}
            className={`px-4 py-2 text-xs font-bold uppercase border border-ink ${tab === t.key ? "bg-crimson text-white" : "bg-white"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sales" && (
        <SalesSummary
          date={date}
          days={days}
          onDate={(d) => update({ date: d === todayKey() ? null : d })}
          onDays={(n) => update({ days: n === 14 ? null : String(n) })}
          onOpenDay={(d) => update({ tab: "day", date: d }, true)}
        />
      )}
      {tab === "day" && <DayDetail date={date} onDate={(d) => update({ date: d === todayKey() ? null : d })} />}
      {tab === "sign-in" && <SignInSheet />}
      {tab === "barcode" && <BarcodeGenerator />}
      {tab === "print" && (
        <PrintQueues
          jobId={params.get("job")}
          filters={printFilters}
          onFilters={onPrintFilters}
          onOpenJob={(id) => update({ job: id }, true)}
        />
      )}
    </div>
  );
}

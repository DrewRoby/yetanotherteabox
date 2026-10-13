import { shiftDateKey, todayKey } from "./reportFormat";

// ‹ [date] › Today — the day picker shared by the Daily Sales Summary (its "as of" day)
// and Day Detail. Never steps past today.
export function DateStepper({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (date: string) => void;
  label: string;
}) {
  const today = todayKey();
  const btn =
    "px-2 py-1 border border-ink bg-white hover:bg-bone disabled:opacity-40 disabled:cursor-not-allowed text-sm";
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-bold uppercase tracking-wide mr-1">{label}</span>
      <button className={btn} onClick={() => onChange(shiftDateKey(value, -1))} aria-label="Previous day">
        ‹
      </button>
      <input
        type="date"
        value={value}
        max={today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="border border-ink px-2 py-1 text-sm"
      />
      <button
        className={btn}
        disabled={value >= today}
        onClick={() => onChange(shiftDateKey(value, 1))}
        aria-label="Next day"
      >
        ›
      </button>
      <button
        className={`${btn} text-xs font-bold uppercase ml-1`}
        disabled={value === today}
        onClick={() => onChange(today)}
      >
        Today
      </button>
    </div>
  );
}

// ▲ 12.3% / ▼ 4.0% vs last year; "—" when last year had nothing.
export function Delta({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null) return <span className={`text-gray-400 ${className}`}>—</span>;
  const up = value >= 0;
  return (
    <span className={`${up ? "text-green-700" : "text-crimson"} ${className}`}>
      {up ? "▲" : "▼"} {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

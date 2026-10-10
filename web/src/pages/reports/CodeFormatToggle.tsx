import { CODE_FORMAT_LABELS, type CodeFormat } from "../../lib/codeImage";

export function CodeFormatToggle({ value, onChange }: { value: CodeFormat; onChange: (f: CodeFormat) => void }) {
  return (
    <div className="flex" role="radiogroup" aria-label="Code format">
      {(Object.keys(CODE_FORMAT_LABELS) as CodeFormat[]).map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          onClick={() => onChange(f)}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase border border-ink -ml-px first:ml-0 ${
            value === f ? "bg-ink text-white" : "bg-white hover:bg-bone"
          }`}
        >
          {CODE_FORMAT_LABELS[f]}
        </button>
      ))}
    </div>
  );
}

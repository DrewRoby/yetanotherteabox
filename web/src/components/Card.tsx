import type { ReactNode } from "react";

export function Card({ children, className = "", accent = false }: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={`corner-ticks bg-white border border-ink p-5 shadow-[4px_4px_0px_rgba(0,0,0,0.05)] ${
        accent ? "border-t-4 border-t-gold" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card>
      <div className="text-xs font-bold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="text-3xl font-black text-crimson mt-2">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </Card>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "sold" }) {
  const tones: Record<string, string> = {
    default: "bg-white border-ink text-ink",
    success: "bg-crimson2 border-ink text-white",
    warning: "bg-gold border-ink text-ink",
    sold: "bg-ink border-ink text-white",
  };
  return (
    <span className={`inline-block px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border rounded-full ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "outline";
  disabled?: boolean;
  className?: string;
}) {
  const variants: Record<string, string> = {
    primary: "bg-crimson text-white border-ink shadow-[3px_3px_0_theme(colors.gold)] hover:bg-ink",
    secondary: "bg-bone text-ink border-ink hover:border-gold",
    outline: "bg-transparent text-ink border-ink hover:bg-bone",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2 border font-bold uppercase text-xs tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

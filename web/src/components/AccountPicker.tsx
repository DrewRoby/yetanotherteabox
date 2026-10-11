import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

// Type-to-search over every account in the store (a few thousand; loaded once per
// picker). Matches name, email or phone (3+ digits) like the Accounts list search, and
// shows each account's type so duplicate names — e.g. several "Hidden Treasures" store
// accounts — can be told apart. Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
// Used by Item Intake ("Intake For") and the item editor's Account field.

export interface AccountOption {
  id: string;
  name: string;
  accountType: string;
  isStoreAccount?: boolean;
  email?: string | null;
  phone?: string | null;
}

const MAX_MATCHES = 10;
const typeLabel = (a: AccountOption) => (a.isStoreAccount ? "STORE ACCOUNT" : a.accountType);

export function AccountPicker({
  value,
  onChange,
  placeholder = "Type a name, email or phone…",
  autoFocus,
  className = "",
}: {
  value: AccountOption | null;
  onChange: (account: AccountOption) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    api.get<AccountOption[]>("/accounts").then(setAccounts);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!accounts || !q) return [];
    const digits = q.replace(/\D/g, "");
    return accounts
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.email ?? "").toLowerCase().includes(q) ||
          (digits.length >= 3 && (a.phone ?? "").replace(/\D/g, "").includes(digits))
      )
      .slice(0, MAX_MATCHES);
  }, [accounts, query]);

  useEffect(() => setHighlight(0), [query]);

  function pick(a: AccountOption) {
    onChange(a);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && matches[highlight]) {
      e.preventDefault();
      pick(matches[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const display = value ? `${value.name} (${typeLabel(value)})` : "";

  return (
    <div className={`relative ${className}`}>
      <input
        type="search"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-label="Search accounts"
        autoFocus={autoFocus}
        value={open ? query : display}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={accounts ? (value ? display : placeholder) : "Loading accounts…"}
        className="w-full border border-ink p-2 bg-white"
      />
      {open && matches.length > 0 && (
        <ul role="listbox" className="absolute z-20 left-0 right-0 bg-white border border-ink border-t-0 max-h-72 overflow-y-auto">
          {matches.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(a)}
                className={`w-full text-left px-2 py-1.5 text-sm flex justify-between gap-2 ${i === highlight ? "bg-bone" : ""}`}
              >
                <span>
                  {a.name}
                  {(a.phone || a.email) && <span className="ml-2 text-xs text-gray-500">{a.phone || a.email}</span>}
                </span>
                <span className="text-[10px] text-gray-500 uppercase whitespace-nowrap">{typeLabel(a)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && accounts && matches.length === 0 && (
        <div className="absolute z-20 left-0 right-0 bg-white border border-ink border-t-0 px-2 py-1.5 text-sm text-gray-500">
          No matching accounts.
        </div>
      )}
    </div>
  );
}

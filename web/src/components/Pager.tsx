// First / previous / "Page N of M" / next / last — shared by the Inventory page, the Accounts list, an
// account's Payout History and its Items table. Renders nothing for a single page.
// `labels` overrides the buttons' accessible names where "page" order has a meaning
// of its own (e.g. payouts: newest → oldest).

const BUTTON = "px-2 py-1 border border-ink bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bone";
const DEFAULT_LABELS = { first: "First page", prev: "Previous page", next: "Next page", last: "Last page" };

export function Pager({
  page,
  pages,
  onPage,
  labels = DEFAULT_LABELS,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  labels?: typeof DEFAULT_LABELS;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-1 text-xs">
      <button className={BUTTON} disabled={page <= 1} onClick={() => onPage(1)} aria-label={labels.first}>
        «
      </button>
      <button className={BUTTON} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={labels.prev}>
        ‹
      </button>
      <span className="px-2">
        Page {page.toLocaleString()} of {pages.toLocaleString()}
      </span>
      <button className={BUTTON} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={labels.next}>
        ›
      </button>
      <button className={BUTTON} disabled={page >= pages} onClick={() => onPage(pages)} aria-label={labels.last}>
        »
      </button>
    </div>
  );
}

// "1–50 of 3,607" (+ " matching" when a filter is narrowing the set).
export function rangeLabel(page: number, pageSize: number, total: number, filtered = false): string {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}${filtered ? " matching" : ""}`;
}

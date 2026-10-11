// Display helpers shared by the Accounts pages.

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Date inputs give a local calendar day ("2024-03-05"); the server compares epoch ms,
// so resolve the day's bounds here in the shop's local time (see root CLAUDE.md's
// local-vs-UTC gotcha). A "to" date is inclusive in the UI: pass plusDays = 1 to send
// the next local midnight as the exclusive bound.
export function localDayStartMs(day: string, plusDays = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays).getTime();
}

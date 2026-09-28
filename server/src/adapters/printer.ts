import fs from "fs";
import path from "path";

// STUB: real deployments print physical tags to a label printer — exact model is
// still TBD (candidates on hand: a Zebra label printer speaking ZPL, or an Epson
// receipt printer speaking ESC/POS; tech_stack_document.md assumed the latter, an
// Epson TM-T88V, but that predates having real hardware to test against). No
// physical printer is reachable in this environment, so this adapter renders the
// same tag content a real driver would send and writes it to var/print-jobs/ instead
// of opening a socket. Swap printTag/printTagBatch's bodies for a real ZPL or ESC/POS
// client without touching any caller — the TagTicket shape and per-item job semantics
// stay the same either way.
// The packaged binary redirects this to a real per-user data directory (see
// bootstrap.ts) since it can't write next to itself; dev/plain-node keeps the
// project-relative var/print-jobs/ path.
const PRINT_JOBS_DIR = process.env.TEABOX_PRINT_JOBS_DIR || path.join(__dirname, "..", "..", "var", "print-jobs");

export interface TagTicket {
  sku: string;
  description: string;
  price: number;
  category?: string;
  size?: string;
}

export interface PrintResult {
  printed: boolean;
  jobFile: string;
  sku: string;
}

export async function printTag(ticket: TagTicket): Promise<PrintResult> {
  fs.mkdirSync(PRINT_JOBS_DIR, { recursive: true });
  const jobFile = path.join(PRINT_JOBS_DIR, `${ticket.sku}.txt`);
  const pertinent = [ticket.category, ticket.size ? `Size ${ticket.size}` : null].filter(Boolean).join(" · ");
  const rendered = [
    "================================",
    "           TEABOX ERP",
    "================================",
    ticket.description.slice(0, 32),
    ...(pertinent ? [pertinent.slice(0, 32)] : []),
    `PRICE: $${ticket.price.toFixed(2)}`,
    `SKU:   ${ticket.sku}`,
    "|||||  ||  |  |||  ||  |||||", // stand-in barcode glyph
    "================================",
  ].join("\n");
  fs.writeFileSync(jobFile, rendered, "utf-8");
  console.log(`[printer stub] tag printed for ${ticket.sku} -> ${jobFile}`);
  return { printed: true, jobFile, sku: ticket.sku };
}

// Item entry queues tags into a batch (see IntakePage's "Tag Batch" preview) instead
// of printing one at a time, so a clerk entering several items only walks to the
// printer once. A real label printer takes one continuous job for a batch like this;
// this stub approximates that by writing one job file per ticket (keeps per-item
// reprint/debugging simple) while still returning one combined result set.
export async function printTagBatch(tickets: TagTicket[]): Promise<PrintResult[]> {
  const results: PrintResult[] = [];
  for (const ticket of tickets) {
    results.push(await printTag(ticket));
  }
  console.log(`[printer stub] batch of ${tickets.length} tag(s) sent to printer`);
  return results;
}

export async function testPrinterConnection(): Promise<{ online: boolean; device: string }> {
  return { online: true, device: "Label printer (simulated, model TBD)" };
}

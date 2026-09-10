import fs from "fs";
import path from "path";

// STUB: real deployments talk ESC/POS to an Epson TM-T88V over Ethernet
// (tech_stack_document.md). No physical printer is reachable in this environment, so
// this adapter renders the same ticket content a real driver would send and writes it
// to var/print-jobs/ instead of opening a socket. Swap this file's body for a real
// ESC/POS client without touching any caller.
// The packaged binary redirects this to a real per-user data directory (see
// bootstrap.ts) since it can't write next to itself; dev/plain-node keeps the
// project-relative var/print-jobs/ path.
const PRINT_JOBS_DIR = process.env.TEABOX_PRINT_JOBS_DIR || path.join(__dirname, "..", "..", "var", "print-jobs");

export interface TagTicket {
  sku: string;
  description: string;
  price: number;
}

export async function printTag(ticket: TagTicket): Promise<{ printed: boolean; jobFile: string }> {
  fs.mkdirSync(PRINT_JOBS_DIR, { recursive: true });
  const jobFile = path.join(PRINT_JOBS_DIR, `${ticket.sku}.txt`);
  const rendered = [
    "================================",
    "           TEABOX ERP",
    "================================",
    ticket.description.slice(0, 32),
    `SKU:   ${ticket.sku}`,
    `PRICE: $${ticket.price.toFixed(2)}`,
    "|||||  ||  |  |||  ||  |||||", // stand-in barcode glyph
    "================================",
  ].join("\n");
  fs.writeFileSync(jobFile, rendered, "utf-8");
  console.log(`[printer stub] tag printed for ${ticket.sku} -> ${jobFile}`);
  return { printed: true, jobFile };
}

export async function testPrinterConnection(): Promise<{ online: boolean; device: string }> {
  return { online: true, device: "Epson TM-T88V (simulated)" };
}

// The printable (PDF) versions of the payout and active-items reports, shared by
// Reports > Payouts / Active Items, the account page and a single payout's page. Each
// fetches its data from the same endpoints the screens use and hands it to lib/pdf.ts.
import { api } from "../../api/client";
import { itemNo, type ItemNumbered } from "../../lib/itemNumber";
import { exportPdf, pdfDate, pdfMoney, type PdfSection } from "../../lib/pdf";

// ---- Shapes (mirror server/src/services/payoutReport.service.ts) ----

interface StatementItem extends ItemNumbered {
  id: string;
  description: string;
  category: string;
}
export interface StatementLine {
  id: string;
  lineType: string;
  description: string | null;
  amount: number;
  item: StatementItem | null;
  sale: { saleDate: string; salePrice: number } | null;
}
export interface StatementPayout {
  id: string;
  payoutNumber: number;
  createdAt: string;
  paidAt: string | null;
  status: string;
  method: string | null;
  checkNumber: string | null;
  amount: number;
  lines: StatementLine[];
}
export interface PayoutStatement {
  generatedAt: string;
  store: { name: string; location: string | null };
  range: { from: string | null; to: string | null };
  account: {
    id: string;
    accountNumber: number | null;
    name: string;
    accountType: string;
    splitPercent: number | null;
    currentBalance?: number;
  };
  payouts: StatementPayout[];
  totals: {
    payouts: number;
    amount: number;
    itemsPaid: number;
    salesTotal: number;
  };
  unpaid: {
    lines: {
      saleId: string;
      saleDate: string;
      salePrice: number;
      credit: number;
      item: StatementItem;
    }[];
    total: number;
    otherBalance: number; // balance not explained by unpaid sales (carried over / adjustments)
  } | null;
}

export interface PayoutListRow {
  id: string;
  payoutNumber: number;
  createdAt: string;
  paidAt: string | null;
  status: string;
  method: string | null;
  checkNumber: string | null;
  amount: number;
  itemCount: number;
  account: { id: string; accountNumber: number | null; name: string };
}
export interface PayoutListResponse {
  rows: PayoutListRow[];
  total: number;
  totalAmount: number;
  page: number;
  pageSize: number;
}

export interface PayoutListFilters {
  accountId?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: "PAID" | "ALL";
}

export interface ActiveItemRow extends ItemNumbered {
  id: string;
  description: string;
  category: string;
  size: string | null;
  price: number;
  status: string;
  intakeDate: string;
  consignorPercent: number;
  accountId: string;
  accountName: string;
  accountNumber: number | null;
}
export interface ActiveItemsResponse {
  rows: ActiveItemRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    count: number;
    retail: number;
    consignorShare: number;
    storeShare: number;
  };
  store: { name: string; location: string | null };
  account: {
    id: string;
    accountNumber: number | null;
    name: string;
    accountType: string;
    isStoreAccount: boolean;
  } | null;
  generatedAt: string;
}
export interface ActiveItemsFilters {
  accountId?: string;
  q?: string;
  category?: string;
  status?: "AVAILABLE" | "PENDING";
  sort?: string;
  dir?: "asc" | "desc";
}

// ---- Shared bits ----

export function queryString(
  params: Record<string, string | number | undefined | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v != null && v !== "") sp.set(k, String(v));
  return sp.toString();
}

const accountTitle = (a: { name: string; accountNumber: number | null }) =>
  a.accountNumber != null ? `${a.name} - ${a.accountNumber}` : a.name;

function periodText(from?: string | null, to?: string | null): string {
  const d = (k: string) =>
    pdfDate(
      new Date(
        Number(k.slice(0, 4)),
        Number(k.slice(5, 7)) - 1,
        Number(k.slice(8, 10)),
      ),
    );
  if (from && to) return `Period: ${d(from)} to ${d(to)}`;
  if (from) return `Period: since ${d(from)}`;
  if (to) return `Period: through ${d(to)}`;
  return "Period: all dates";
}

export const LINE_TYPE_LABELS: Record<string, string> = {
  SALE: "Sale",
  PURCHASE: "Purchase",
  RETURN: "Return",
  DEDUCTION: "Deduction",
  FEE: "Fee",
  ADVANCE: "Advance",
  ADJUSTMENT: "Adjustment",
};

export const payoutDate = (p: { paidAt: string | null; createdAt: string }) =>
  p.paidAt ?? p.createdAt;

export function payoutHow(p: {
  method: string | null;
  checkNumber: string | null;
}): string {
  if (p.method === "CHECK")
    return p.checkNumber ? `Check #${p.checkNumber}` : "Check";
  if (p.method === "CASH") return "Cash";
  return p.checkNumber ? `Check #${p.checkNumber}` : "";
}

function payoutSection(p: StatementPayout): PdfSection {
  const sales = p.lines.reduce((s, l) => s + (l.sale?.salePrice ?? 0), 0);
  const how = payoutHow(p);
  return {
    heading: `Payout #${p.payoutNumber}  -  ${pdfDate(payoutDate(p))}${how ? `  -  ${how}` : ""}  -  ${pdfMoney(p.amount)}`,
    subheading: p.status !== "PAID" ? `Status: ${p.status}` : undefined,
    head: [
      "Item #",
      "Description",
      "Type",
      "Sold",
      "Sale Price",
      "Paid to You",
    ],
    body: p.lines.map((l) => [
      l.item ? itemNo(l.item) : "",
      l.item ? l.item.description : (l.description ?? ""),
      LINE_TYPE_LABELS[l.lineType] ?? l.lineType,
      pdfDate(l.sale?.saleDate),
      l.sale ? pdfMoney(l.sale.salePrice) : "",
      pdfMoney(l.amount),
    ]),
    foot: [
      `${p.lines.filter((l) => l.item).length} item(s)`,
      "",
      "",
      "",
      pdfMoney(sales),
      pdfMoney(p.amount),
    ],
    rightAlign: [4, 5],
    columnWidths: { 0: 62, 2: 58, 3: 58, 4: 62, 5: 66 },
  };
}

// ---- Payout statement: one account, itemized ----

export async function fetchStatement(
  accountId: string,
  from?: string,
  to?: string,
) {
  return api.get<PayoutStatement>(
    `/reports/payouts/statement?${queryString({ accountId, from, to })}`,
  );
}

export async function downloadPayoutStatement(
  accountId: string,
  from?: string,
  to?: string,
) {
  const s = await fetchStatement(accountId, from, to);
  const summary: [string, string][] = [
    ["Payouts", s.totals.payouts.toLocaleString()],
    ["Total paid", pdfMoney(s.totals.amount)],
    ["Items paid for", s.totals.itemsPaid.toLocaleString()],
    ["Those items sold for", pdfMoney(s.totals.salesTotal)],
  ];
  if (s.unpaid) {
    summary.push([
      "Sold, not yet paid (items)",
      s.unpaid.lines.length.toLocaleString(),
    ]);
    summary.push(["Sold, not yet paid (owed)", pdfMoney(s.unpaid.total)]);
    if (s.unpaid.otherBalance !== 0)
      summary.push([
        "Other balance (not itemized)",
        pdfMoney(s.unpaid.otherBalance),
      ]);
  }
  if (s.account.currentBalance !== undefined)
    summary.push(["Current balance", pdfMoney(s.account.currentBalance)]);
  const sections: PdfSection[] = s.payouts.map(payoutSection);
  if (s.unpaid) {
    sections.push({
      heading: "Sold, not yet paid out (as of today)",
      subheading: "These sales will be on your next payout.",
      head: ["Item #", "Description", "Sold", "Sale Price", "Your Share"],
      body: [
        ...s.unpaid.lines.map((u) => [
          itemNo(u.item),
          u.item.description,
          pdfDate(u.saleDate),
          pdfMoney(u.salePrice),
          pdfMoney(u.credit),
        ]),
        ...(s.unpaid.otherBalance !== 0
          ? [
              [
                "",
                "Other balance not tied to an item (e.g. carried over from the previous system)",
                "",
                "",
                pdfMoney(s.unpaid.otherBalance),
              ],
            ]
          : []),
      ],
      foot: [
        `${s.unpaid.lines.length} item(s)`,
        "",
        "",
        "Balance",
        pdfMoney(s.unpaid.total + s.unpaid.otherBalance),
      ],
      rightAlign: [3, 4],
      columnWidths: { 0: 62, 2: 58, 3: 62, 4: 66 },
    });
  }
  await exportPdf({
    filename: `Payout-Statement-${s.account.accountNumber ?? ""}-${s.account.name}`,
    storeName: s.store.name,
    title: "Payout Statement",
    subtitle: [
      accountTitle(s.account),
      periodText(s.range.from, s.range.to),
      ...(s.account.splitPercent != null
        ? [
            `Consignor split: ${s.account.splitPercent}% (items may carry their own split)`,
          ]
        : []),
    ],
    summary,
    sections,
    emptyText: "No payouts in this period.",
  });
}

// ---- One payout (its own page) ----

export async function downloadSinglePayout(
  storeName: string,
  account: { name: string; accountNumber: number | null },
  payout: StatementPayout,
) {
  await exportPdf({
    filename: `Payout-${payout.payoutNumber}-${account.accountNumber ?? ""}-${account.name}`,
    storeName,
    title: `Payout #${payout.payoutNumber}`,
    subtitle: [
      accountTitle(account),
      `${pdfDate(payoutDate(payout))}${payoutHow(payout) ? ` - ${payoutHow(payout)}` : ""} - ${payout.status}`,
    ],
    summary: [
      ["Amount", pdfMoney(payout.amount)],
      ["Items", payout.lines.filter((l) => l.item).length.toLocaleString()],
    ],
    sections: [
      { ...payoutSection(payout), heading: undefined, subheading: undefined },
    ],
  });
}

// ---- Payout list (store-wide or one account, any filters) ----

export async function downloadPayoutList(
  storeName: string,
  filters: PayoutListFilters,
  accountLabel?: string,
) {
  const data = await api.get<PayoutListResponse>(
    `/reports/payouts?${queryString({ ...filters, pageSize: 100000 })}`,
  );
  const subtitle = [
    accountLabel ?? "All accounts",
    periodText(filters.from, filters.to),
    filters.status === "ALL"
      ? "All statuses (including voided)"
      : "Paid payouts",
    ...(filters.q ? [`Search: ${filters.q}`] : []),
  ];
  await exportPdf({
    filename: `Payouts-${filters.from ?? "all"}-${filters.to ?? ""}`,
    storeName,
    title: "Payouts",
    subtitle,
    summary: [
      ["Payouts", data.total.toLocaleString()],
      ["Total amount", pdfMoney(data.totalAmount)],
    ],
    sections: [
      {
        head: [
          "Date",
          "Payout #",
          "Account #",
          "Account",
          "How Paid",
          "Status",
          "Items",
          "Amount",
        ],
        body: data.rows.map((p) => [
          pdfDate(payoutDate(p)),
          p.payoutNumber,
          p.account.accountNumber ?? "",
          p.account.name,
          payoutHow(p),
          p.status,
          p.itemCount,
          pdfMoney(p.amount),
        ]),
        foot: ["Total", "", "", "", "", "", "", pdfMoney(data.totalAmount)],
        rightAlign: [1, 2, 6, 7],
      },
    ],
    landscape: true,
    emptyText: "No payouts match.",
  });
}

// ---- Active items ----

export async function fetchActiveItems(
  filters: ActiveItemsFilters,
  page: number,
  pageSize: number,
) {
  return api.get<ActiveItemsResponse>(
    `/reports/active-items?${queryString({ ...filters, page, pageSize })}`,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysOut = (intakeDate: string) =>
  Math.max(
    0,
    Math.floor((Date.now() - new Date(intakeDate).getTime()) / DAY_MS),
  );

export async function downloadActiveItems(filters: ActiveItemsFilters) {
  const data = await fetchActiveItems(filters, 1, 50000);
  const oneAccount = data.account != null;
  const head = [
    "Item #",
    "Description",
    "Category",
    "Size",
    ...(oneAccount ? [] : ["Account"]),
    "Status",
    "Received",
    "Days",
    "Price",
    "Split",
    "Consignor Share",
  ];
  const body = data.rows.map((r) => [
    itemNo(r),
    r.description,
    r.category,
    r.size ?? "",
    ...(oneAccount
      ? []
      : [
          r.accountNumber != null
            ? `${r.accountNumber} ${r.accountName}`
            : r.accountName,
        ]),
    r.status === "AVAILABLE" ? "Available" : "Pending",
    pdfDate(r.intakeDate),
    daysOut(r.intakeDate),
    pdfMoney(r.price),
    `${r.consignorPercent}%`,
    pdfMoney((r.price * r.consignorPercent) / 100),
  ]);
  const n = head.length;
  await exportPdf({
    filename: `Active-Items-${data.account ? `${data.account.accountNumber ?? ""}-${data.account.name}` : "All"}`,
    storeName: data.store.name,
    title: "Active Items",
    subtitle: [
      data.account ? accountTitle(data.account) : "All accounts",
      `Items on the floor (Available${filters.status === "AVAILABLE" ? "" : " and Pending"}) as of ${new Date().toLocaleDateString()}`,
      ...[
        filters.category ? `Category: ${filters.category}` : null,
        filters.q ? `Search: ${filters.q}` : null,
      ].filter((x): x is string => x != null),
    ],
    summary: [
      ["Items", data.totals.count.toLocaleString()],
      ["Retail value", pdfMoney(data.totals.retail)],
      ["Consignor share if sold", pdfMoney(data.totals.consignorShare)],
      ["Store share if sold", pdfMoney(data.totals.storeShare)],
    ],
    sections: [
      {
        head,
        body,
        foot: [
          `${data.totals.count} item(s)`,
          ...Array(n - 4).fill(""),
          pdfMoney(data.totals.retail),
          "",
          pdfMoney(data.totals.consignorShare),
        ],
        rightAlign: [n - 4, n - 3, n - 2, n - 1],
      },
    ],
    landscape: true,
    emptyText: "No active items.",
  });
}

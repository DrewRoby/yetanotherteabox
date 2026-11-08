// Client-side PDF export for printable reports (Reports > Payouts / Active Items, the
// account page's statement buttons). Built in the browser with jsPDF + jspdf-autotable —
// no server round trip and no network, so it works in the offline packaged app. The
// libraries are loaded on first use (dynamic import) to keep them out of the main bundle.
//
// A report is: a title block (store, title, subtitle lines), an optional summary of
// label/value pairs, then sections — each an optional heading plus a table. Every page
// repeats the store + title at the top and "Page X of Y · generated …" at the bottom.
// Helvetica throughout (plain sans-serif digits, which is what the owner asked for on
// screen too). Stick to Latin-1 text: jsPDF's built-in fonts can't draw e.g. arrows.

export interface PdfSection {
  heading?: string;
  subheading?: string;
  head: string[];
  body: (string | number)[][];
  foot?: (string | number)[];
  // Columns to right-align (money, counts) by index.
  rightAlign?: number[];
  // Relative column widths by index ("wrap" = as narrow as the content allows).
  columnWidths?: Record<number, number | "wrap">;
}

export interface PdfReport {
  filename: string; // without .pdf
  storeName: string;
  title: string;
  subtitle?: string[];
  summary?: [string, string][];
  sections: PdfSection[];
  landscape?: boolean;
  emptyText?: string; // shown when there are no sections with rows
}

const CRIMSON: [number, number, number] = [185, 28, 28];
const INK: [number, number, number] = [26, 26, 26];
const BONE: [number, number, number] = [248, 243, 231];
const MARGIN = 40;

export async function exportPdf(report: PdfReport): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({
    orientation: report.landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "letter",
    compress: true,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generated = new Date().toLocaleString();

  // Running header, drawn on every page by autoTable's didDrawPage (and once up front).
  const runningHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...CRIMSON);
    doc.text(report.storeName.toUpperCase(), MARGIN, 24);
    doc.setTextColor(...INK);
    doc.text(report.title, pageWidth - MARGIN, 24, { align: "right" });
    doc.setDrawColor(212, 175, 55); // gold rule
    doc.setLineWidth(1);
    doc.line(MARGIN, 30, pageWidth - MARGIN, 30);
  };
  runningHeader();

  // Title block.
  let y = 58;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(report.title, MARGIN, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of report.subtitle ?? []) {
    doc.text(line, MARGIN, y);
    y += 13;
  }

  // Summary: label/value pairs in a light box, two columns of pairs.
  if (report.summary?.length) {
    y += 4;
    const rows: string[][] = [];
    for (let i = 0; i < report.summary.length; i += 2) {
      const [a, b] = [report.summary[i], report.summary[i + 1]];
      rows.push([a[0], a[1], b?.[0] ?? "", b?.[1] ?? ""]);
    }
    autoTable(doc, {
      startY: y,
      body: rows,
      theme: "plain",
      margin: { left: MARGIN, right: MARGIN, top: 40 },
      styles: {
        font: "helvetica",
        fontSize: 10,
        cellPadding: 3,
        fillColor: BONE,
        textColor: INK,
      },
      columnStyles: {
        0: { fontStyle: "bold", textColor: [90, 90, 90] },
        1: { fontStyle: "bold", halign: "right" },
        2: { fontStyle: "bold", textColor: [90, 90, 90] },
        3: { fontStyle: "bold", halign: "right" },
      },
    });
    y = lastY(doc) + 14;
  }

  const sections = report.sections.filter(
    (s) => s.body.length > 0 || s.heading,
  );
  if (!sections.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.text(report.emptyText ?? "Nothing to report.", MARGIN, y + 10);
  }

  for (const section of sections) {
    // Keep a heading with at least the start of its table.
    if (y > pageHeight - 120) {
      doc.addPage();
      runningHeader();
      y = 50;
    }
    if (section.heading) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(section.heading, MARGIN, y);
      y += 4;
      if (section.subheading) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        doc.text(section.subheading, MARGIN, y + 10);
        y += 12;
      }
      y += 6;
    }
    const columnStyles: Record<
      number,
      { halign?: "right"; cellWidth?: number | "wrap" }
    > = {};
    for (const i of section.rightAlign ?? [])
      columnStyles[i] = { ...columnStyles[i], halign: "right" };
    for (const [i, w] of Object.entries(section.columnWidths ?? {}))
      columnStyles[Number(i)] = { ...columnStyles[Number(i)], cellWidth: w };
    autoTable(doc, {
      startY: y,
      head: [section.head],
      body: section.body.length
        ? section.body.map((r) => r.map(String))
        : [[{ content: "None.", colSpan: section.head.length }]],
      foot: section.foot ? [section.foot.map(String)] : undefined,
      showFoot: "lastPage",
      theme: "grid",
      margin: { left: MARGIN, right: MARGIN, top: 40, bottom: 40 },
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 3,
        textColor: INK,
        lineColor: [210, 210, 210],
        lineWidth: 0.5,
        overflow: "linebreak",
      },
      headStyles: { fillColor: CRIMSON, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: BONE, textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [252, 250, 245] },
      columnStyles,
      didParseCell: (data) => {
        // Right-align the matching head/foot cells too.
        if (
          (data.section === "head" || data.section === "foot") &&
          section.rightAlign?.includes(data.column.index)
        ) {
          data.cell.styles.halign = "right";
        }
      },
      didDrawPage: () => runningHeader(),
    });
    y = lastY(doc) + 18;
  }

  // Footer with page numbers, once the page count is known.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated ${generated}`, MARGIN, pageHeight - 18);
    doc.text(`Page ${i} of ${pages}`, pageWidth - MARGIN, pageHeight - 18, {
      align: "right",
    });
  }

  doc.save(`${safeFilename(report.filename)}.pdf`);
}

function lastY(doc: unknown): number {
  return (
    (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60
  );
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9 _.-]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "report"
  );
}

// Shared formatters for PDF cells (plain strings; no locale symbols jsPDF can't draw).
export const pdfMoney = (n: number | null | undefined) =>
  n == null
    ? ""
    : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pdfDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "";

import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

// Raster (PNG) rendering of an arbitrary value as a Code128 barcode or a QR code.
// Used by the Reports page's Employee Sign-In Sheet and Barcode Generator tabs. The
// on-screen item barcode (components/Barcode.tsx) stays SVG; this exists because both
// of these features need a real downloadable PNG, and a canvas gets us one directly.
export type CodeFormat = "BARCODE" | "QR";

export const CODE_FORMAT_LABELS: Record<CodeFormat, string> = {
  BARCODE: "Barcode (Code128)",
  QR: "QR Code",
};

export interface RenderOptions {
  // Print the value as text under a barcode. Ignored for QR codes.
  showText?: boolean;
}

// Code128 only covers ASCII 0–127; anything else (accents, emoji, CJK) needs a QR code,
// which encodes UTF-8. Checked up front so the error is readable rather than
// jsbarcode's generic "invalid" throw.
export function barcodeUnsupportedReason(value: string): string | null {
  if (!value) return "Enter some text first.";
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(value)) return "Barcodes (Code128) only support plain ASCII text — use a QR code for accents, symbols, or emoji.";
  if (value.length > 80) return "That's too long to scan reliably as a barcode — use a QR code for text over 80 characters.";
  return null;
}

export async function renderCodeToDataUrl(value: string, format: CodeFormat, opts: RenderOptions = {}): Promise<string> {
  if (format === "QR") {
    // "M" error correction: survives a smudged/creased printout without inflating size
    // much; margin 2 modules is enough quiet zone for phone and HID imagers alike.
    return QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 2, scale: 8, color: { dark: "#1a1a1a", light: "#ffffff" } });
  }
  const reason = barcodeUnsupportedReason(value);
  if (reason) throw new Error(reason);
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: opts.showText ?? true,
    height: 80,
    width: 2,
    fontSize: 16,
    margin: 12,
    lineColor: "#1a1a1a",
    background: "#ffffff",
  });
  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// Turns arbitrary input into a safe, recognizable file name ("Hello World!" ->
// "hello-world-barcode.png").
export function codeFilename(value: string, format: CodeFormat) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "code"}-${format === "QR" ? "qr" : "barcode"}.png`;
}

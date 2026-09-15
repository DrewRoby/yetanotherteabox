// Barcode value format shared by intake (assigns it as an Item's sku), the printer
// adapter (renders it onto the tag), and POS (looks items up by it). Encodable as
// Code128 by the web client's Barcode component (web/src/components/Barcode.tsx).
export function formatBarcode(storeId: string, itemNumber: number): string {
  return `${storeId}-${itemNumber.toString().padStart(6, "0")}`;
}

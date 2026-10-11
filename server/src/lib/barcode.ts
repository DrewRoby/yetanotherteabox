// Barcode value format shared by intake (assigns it as an Item's sku), the printer
// adapter (renders it onto the tag), and POS (looks items up by it). Encodable as
// Code128 by the web client's Barcode component (web/src/components/Barcode.tsx).
//
// "<prefix>-<itemNumber, zero-padded to 6>", e.g. "HT-2000000", "TBX-000042". The
// prefix is the store's configurable Store.itemPrefix; the number is the item's own
// Item.itemNumber, so a SKU always encodes its item's number — which is what keeps
// new SKUs from ever colliding with existing ones (see items.service.ts).
export function formatBarcode(prefix: string, itemNumber: number): string {
  return `${prefix}-${itemNumber.toString().padStart(6, "0")}`;
}

// Uppercase letters/digits only: Code128-safe, unambiguous on a printed tag, and a
// HID barcode scanner typing with Caps Lock on can't mangle it.
export const ITEM_PREFIX_PATTERN = /^[A-Z0-9]{1,8}$/;

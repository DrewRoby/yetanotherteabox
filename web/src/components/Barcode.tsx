import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

// Renders `value` (an Item.sku — see server/src/lib/barcode.ts's formatBarcode) as a
// real scannable Code128 barcode, for the printed tag preview and the Item Detail
// screen. BarcodeScanner (in this same directory) is the read side.
export function Barcode({ value, className }: { value: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    JsBarcode(ref.current, value, {
      format: "CODE128",
      displayValue: true,
      height: 50,
      fontSize: 14,
      margin: 8,
    });
  }, [value]);

  return <svg ref={ref} className={className} role="img" aria-label={`Barcode ${value}`} />;
}

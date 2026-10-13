import type { ReactNode } from "react";
import { Barcode } from "./Barcode";

export interface TagContent {
  sku: string;
  description: string;
  category?: string | null;
  size?: string | null;
  price: number;
}

// A small mock of a printed item tag: description, "Category · Size", price and the
// SKU's real Code128 barcode — what the physical tag carries. Used by IntakePage's Tag
// Batch and Reports > Print Queues. `corner` renders top-right (e.g. a remove ✕ or a
// checkbox); `children` render under the barcode (e.g. "changed since printed").
export function TagLabel({
  tag,
  corner,
  children,
  dim = false,
}: {
  tag: TagContent;
  corner?: ReactNode;
  children?: ReactNode;
  dim?: boolean;
}) {
  const pertinent = [tag.category, tag.size ? `Size ${tag.size}` : null].filter(Boolean).join(" · ");
  return (
    <div className={`relative w-48 border-2 border-ink bg-white p-3 flex flex-col gap-1 ${dim ? "opacity-50" : ""}`}>
      {corner && <div className="absolute top-1 right-1">{corner}</div>}
      <div className="text-[11px] font-bold uppercase leading-tight pr-4 line-clamp-2">{tag.description}</div>
      {pertinent && <div className="text-[10px] text-gray-500 uppercase">{pertinent}</div>}
      <div className="text-lg font-black text-crimson">${tag.price.toFixed(2)}</div>
      <Barcode value={tag.sku} className="w-full" />
      {children}
    </div>
  );
}

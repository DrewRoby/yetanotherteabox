import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Button } from "../components/Card";

interface ItemRow {
  id: string;
  sku: string;
  description: string;
  category: string;
  status: string;
  price: number;
  account: { name: string; accountType: string };
}

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "sold"> = {
  AVAILABLE: "success",
  PENDING: "warning",
  SOLD: "sold",
  DONATED: "warning",
  DISPOSED: "default",
  RETURNED: "default",
};

export function InventoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      api
        .get<ItemRow[]>(`/items?${params.toString()}`)
        .then(setItems)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <div className="p-8">
      <div className="flex justify-between items-end mb-6">
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-bold mb-1">Search Inventory</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by SKU, description, brand..."
            className="border border-ink px-3 py-2 w-72 bg-white"
          />
        </div>
        <Button onClick={() => navigate("/intake")}>+ New Item</Button>
      </div>

      <div className="corner-ticks bg-white border border-ink overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-3 border-b-2 border-gold uppercase text-xs">SKU</th>
              <th className="p-3 border-b-2 border-gold uppercase text-xs">Description</th>
              <th className="p-3 border-b-2 border-gold uppercase text-xs">Category</th>
              <th className="p-3 border-b-2 border-gold uppercase text-xs">Account</th>
              <th className="p-3 border-b-2 border-gold uppercase text-xs">Status</th>
              <th className="p-3 border-b-2 border-gold uppercase text-xs">Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100 hover:bg-bone/50">
                <td className="p-3 font-mono text-xs">
                  <Link to={`/inventory/${item.id}`} className="text-crimson font-bold hover:underline">
                    #{item.sku}
                  </Link>
                </td>
                <td className="p-3 font-bold">
                  <Link to={`/inventory/${item.id}`}>{item.description}</Link>
                </td>
                <td className="p-3">{item.category}</td>
                <td className="p-3">{item.account.name}</td>
                <td className="p-3">
                  <Badge tone={STATUS_TONE[item.status] || "default"}>{item.status}</Badge>
                </td>
                <td className="p-3 font-bold">${item.price.toFixed(2)}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  No items match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

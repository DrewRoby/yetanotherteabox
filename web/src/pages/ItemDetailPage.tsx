import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Button, Card } from "../components/Card";

interface ItemDetail {
  id: string;
  sku: string;
  description: string;
  brand: string | null;
  style: string | null;
  status: string;
  price: number;
  account: { id: string; name: string; accountType: string; splitPercent: number | null; currentBalance: number };
  history: { id: string; changeType: string; oldValue: string | null; newValue: string | null; timestamp: string }[];
}

export function ItemDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<ItemDetail>(`/items/${id}`)
      .then(setItem)
      .catch(() => setError("You are not authorized to view this item, or it does not exist."));
  }, [id]);

  if (error) return <div className="p-8 text-crimson font-semibold">{error}</div>;
  if (!item) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="p-8">
      <Link to="/inventory" className="text-xs uppercase tracking-wide text-gray-500 hover:text-crimson">
        ← Back to Inventory
      </Link>

      <div className="flex gap-6 mt-4">
        <Card className="flex-[1.8] border-t-4 border-t-crimson2">
          <div className="flex justify-between items-start mb-6">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-gray-500">Item Name</label>
              <h2 className="text-2xl font-bold">{item.description}</h2>
              <div className="text-xs text-crimson font-bold mt-1">SKU: {item.sku}</div>
            </div>
            <div className="bg-crimson2 text-white border border-ink px-4 py-2 text-center">
              <div className="text-[9px] uppercase opacity-80 border-b border-white/30 mb-1">Status</div>
              <div className="text-sm font-bold">{item.status}</div>
            </div>
          </div>

          <section className="mb-8">
            <h3 className="text-xs uppercase tracking-wide text-crimson border-b border-gold inline-block pb-1 mb-3">
              Core Attributes
            </h3>
            <div className="grid grid-cols-3 gap-5">
              <Field label="Brand" value={item.brand || "—"} />
              <Field label="Style" value={item.style || "—"} />
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Price</label>
                <div className="text-xl font-bold">${item.price.toFixed(2)}</div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-wide text-crimson border-b border-gold inline-block pb-1 mb-3">
              Inventory History
            </h3>
            <table className="w-full text-sm">
              <thead className="bg-bone border-y border-ink">
                <tr>
                  <th className="text-left p-2 uppercase text-xs">Date</th>
                  <th className="text-left p-2 uppercase text-xs">Action</th>
                  <th className="text-right p-2 uppercase text-xs">Details</th>
                </tr>
              </thead>
              <tbody>
                {item.history.map((h) => (
                  <tr key={h.id} className="border-b border-gray-100">
                    <td className="p-2">{new Date(h.timestamp).toLocaleDateString()}</td>
                    <td className="p-2">{h.changeType}</td>
                    <td className="p-2 text-right">{h.newValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </Card>

        <Card className="flex-1 bg-bone">
          <h3 className="text-xs uppercase tracking-wide border-b border-gold inline-block pb-1 mb-4">Account</h3>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-ink text-bone flex items-center justify-center font-bold">
              {item.account.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="font-bold">{item.account.name}</div>
              <div className="text-[11px] text-crimson font-bold">{item.account.accountType}</div>
            </div>
          </div>
          {item.account.splitPercent != null && (
            <div className="text-sm border-l-2 border-gold pl-3 space-y-1">
              <div className="flex justify-between">
                <strong>Split:</strong>
                <span>{item.account.splitPercent}% / {100 - item.account.splitPercent}%</span>
              </div>
              <div className="flex justify-between">
                <strong>Balance:</strong>
                <span>${item.account.currentBalance.toFixed(2)}</span>
              </div>
            </div>
          )}
          <div className="mt-6">
            <Link to={`/accounts/${item.account.id}`}>
              <Button variant="outline" className="w-full">
                View Account
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-gray-500 mb-1">{label}</label>
      <div className="border-b border-gray-100 py-1">{value}</div>
    </div>
  );
}

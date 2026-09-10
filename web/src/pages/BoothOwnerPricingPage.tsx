import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card } from "../components/Card";

interface PricedItem {
  id: string;
  sku: string;
  description: string;
  price: number;
}

interface AccountOption {
  id: string;
  name: string;
}

interface LogEntry {
  id: string;
  message: string;
  at: string;
}

export function BoothOwnerPricingPage() {
  const { user } = useAuth();
  const isBoothOwner = user?.activeRole === "BOOTH_OWNER";

  const [boothOptions, setBoothOptions] = useState<AccountOption[]>([]);
  const [selectedBoothId, setSelectedBoothId] = useState<string>("");
  const [items, setItems] = useState<PricedItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bulkPercent, setBulkPercent] = useState("10");
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (isBoothOwner) {
      loadOwnItems();
    } else {
      api.get<AccountOption[]>("/accounts?accountType=BOOTH_OWNER").then(setBoothOptions);
    }
  }, [isBoothOwner]);

  useEffect(() => {
    if (!isBoothOwner && selectedBoothId) {
      api.get<PricedItem[]>(`/items?accountId=${selectedBoothId}`).then((rows) => setItems(rows));
    }
  }, [isBoothOwner, selectedBoothId]);

  async function loadOwnItems() {
    const profile = await api.get<{ items: PricedItem[] }>("/accounts/me/profile");
    setItems(profile.items.filter((i) => (i as unknown as { status: string }).status === "AVAILABLE"));
  }

  function addLog(message: string) {
    setLog((l) => [{ id: crypto.randomUUID(), message, at: new Date().toLocaleTimeString() }, ...l].slice(0, 8));
  }

  async function saveDraft(item: PricedItem) {
    const draft = drafts[item.id];
    if (draft === undefined) return;
    const newPrice = Number(draft);
    if (!Number.isFinite(newPrice) || newPrice <= 0) return;
    await api.put(`/items/${item.id}/price`, { price: newPrice });
    addLog(`SKU ${item.sku} adjusted to $${newPrice.toFixed(2)}`);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, price: newPrice } : i)));
  }

  async function applyBulkAdjustment() {
    const pct = Number(bulkPercent);
    if (!Number.isFinite(pct) || pct === 0) return;
    for (const item of items) {
      const newPrice = Math.max(0.01, Math.round(item.price * (1 - pct / 100) * 100) / 100);
      await api.put(`/items/${item.id}/price`, { price: newPrice });
    }
    addLog(`Bulk adjustment: ${pct}% applied to ${items.length} item(s)`);
    if (isBoothOwner) loadOwnItems();
    else api.get<PricedItem[]>(`/items?accountId=${selectedBoothId}`).then(setItems);
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-xl font-bold uppercase">Booth Owner Pricing</h1>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={bulkPercent}
            onChange={(e) => setBulkPercent(e.target.value)}
            className="w-16 border border-ink p-1 text-sm"
          />
          <span className="text-sm">%</span>
          <Button onClick={applyBulkAdjustment} disabled={items.length === 0}>
            Bulk Price Adjustment
          </Button>
        </div>
      </div>

      {!isBoothOwner && (
        <Card className="mb-5">
          <label className="block text-xs font-bold uppercase mb-2">Select Booth</label>
          <select
            value={selectedBoothId}
            onChange={(e) => setSelectedBoothId(e.target.value)}
            className="border border-ink p-2 w-72"
          >
            <option value="">— Choose a booth owner —</option>
            {boothOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Card>
      )}

      <div className="flex gap-5">
        <Card className="flex-[2] p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bone">
                <th className="p-3 text-left text-xs uppercase border-b-2 border-gold">SKU</th>
                <th className="p-3 text-left text-xs uppercase border-b-2 border-gold">Description</th>
                <th className="p-3 text-left text-xs uppercase border-b-2 border-gold">Current</th>
                <th className="p-3 text-left text-xs uppercase border-b-2 border-gold">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="p-3 font-mono text-xs">{item.sku}</td>
                  <td className="p-3">{item.description}</td>
                  <td className="p-3">
                    <input
                      value={drafts[item.id] ?? item.price.toFixed(2)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                      className="w-20 border border-crimson2 p-1"
                    />
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => saveDraft(item)}
                      className="border border-gold text-gold px-2 py-1 text-[10px] font-bold uppercase hover:bg-gold hover:text-white"
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-400">
                    No items to price.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="flex-1">
          <h3 className="text-sm font-bold border-b border-gold pb-1 mb-4">Price History Log</h3>
          <div className="flex flex-col gap-3 border-l border-ink pl-4">
            {log.map((entry) => (
              <div key={entry.id}>
                <div className="text-xs font-bold">{entry.at}</div>
                <div className="text-xs text-gray-500">{entry.message}</div>
              </div>
            ))}
            {log.length === 0 && <p className="text-xs text-gray-400">No changes yet this session.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

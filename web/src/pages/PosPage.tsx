import { lazy, Suspense, useState } from "react";
import { api, ApiError } from "../api/client";
import { Button, Card } from "../components/Card";

// Lazy: pulls in the @zxing/browser decoder, which is sizable and only needed once
// someone actually opens the camera scanner.
const BarcodeScanner = lazy(() => import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })));

interface CartItem {
  itemId: string;
  sku: string;
  description: string;
  accountName: string;
  price: number;
}

interface SearchResult {
  id: string;
  sku: string;
  description: string;
  price: number;
  account: { name: string };
}

export function PosPage() {
  const [scanCode, setScanCode] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saleComplete, setSaleComplete] = useState(false);

  const total = cart.reduce((sum, i) => sum + i.price, 0);

  async function lookupCode(code: string) {
    setScanError(null);
    try {
      const item = await api.get<{ id: string; sku: string; description: string; price: number; account: { name: string } }>(
        `/pos/lookup?code=${encodeURIComponent(code)}`
      );
      addToCart(item);
    } catch (err) {
      setScanError(err instanceof ApiError ? "No available item with that code." : "Lookup failed.");
    }
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    await lookupCode(scanCode);
    setScanCode("");
  }

  function addToCart(item: { id: string; sku: string; description: string; price: number; account: { name: string } }) {
    setCart((c) => [...c, { itemId: item.id, sku: item.sku, description: item.description, accountName: item.account.name, price: item.price }]);
  }

  function removeFromCart(itemId: string) {
    setCart((c) => c.filter((i) => i.itemId !== itemId));
  }

  async function checkout(paymentType: "CASH" | "CARD" | "STORE_CREDIT") {
    if (cart.length === 0) return;
    await api.post("/pos/checkout", {
      items: cart.map((i) => ({ itemId: i.itemId, salePrice: i.price })),
      paymentType,
      registerName: "Main Terminal",
    });
    setCart([]);
    setSaleComplete(true);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {saleComplete && (
        <Card className="mb-4 border-crimson">
          <div className="flex justify-between items-center">
            <span className="font-bold text-crimson">Sale complete.</span>
            <Button variant="outline" onClick={() => setSaleComplete(false)}>
              New Sale
            </Button>
          </div>
        </Card>
      )}

      <div className="flex gap-4">
        <Card className="flex-[2] p-0 overflow-hidden">
          <div className="p-4 border-b border-ink flex gap-3">
            <form onSubmit={handleScan} className="flex-1">
              <label className="block text-[11px] font-bold uppercase text-gray-500 mb-1">Scan Input</label>
              <input
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                autoFocus
                placeholder="Scan barcode or enter SKU..."
                className="w-full border border-ink p-3 focus:border-crimson"
              />
            </form>
            <div className="flex items-end gap-2">
              <Button variant="outline" onClick={() => setCameraOpen(true)}>
                Scan with Camera
              </Button>
              <Button variant="secondary" onClick={() => setModalOpen(true)}>
                Search Inventory
              </Button>
            </div>
          </div>
          {scanError && <div className="px-4 py-2 text-crimson text-sm">{scanError}</div>}
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-3 border-b-2 border-gold text-xs uppercase">Item Details</th>
                <th className="p-3 border-b-2 border-gold text-xs uppercase w-24">Price</th>
                <th className="p-3 border-b-2 border-gold w-10" />
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => (
                <tr key={item.itemId} className="border-b border-gray-100 even:bg-bone/40">
                  <td className="p-3">
                    <span className="font-bold block">{item.description}</span>
                    <span className="text-[10px] text-gray-500">
                      SKU: {item.sku} <span className="text-gold font-bold">|</span> {item.accountName}
                    </span>
                  </td>
                  <td className="p-3">${item.price.toFixed(2)}</td>
                  <td className="p-3 text-crimson cursor-pointer text-center" onClick={() => removeFromCart(item.itemId)}>
                    ✕
                  </td>
                </tr>
              ))}
              {cart.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-gray-400">
                    Cart is empty — scan an item or search inventory.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="flex-1 flex flex-col">
          <div className="text-xs font-bold uppercase mb-1">Total Amount</div>
          <div className="text-5xl font-black text-crimson text-right mb-8">${total.toFixed(2)}</div>
          <div className="flex-1" />
          <div className="flex flex-col gap-3">
            <Button onClick={() => checkout("CASH")} disabled={cart.length === 0} variant="secondary">
              Cash Payment
            </Button>
            <Button onClick={() => checkout("CARD")} disabled={cart.length === 0}>
              Card / Electronic
            </Button>
            <Button onClick={() => checkout("STORE_CREDIT")} disabled={cart.length === 0} variant="outline">
              Store Credit
            </Button>
          </div>
        </Card>
      </div>

      {modalOpen && (
        <SearchModal
          onClose={() => setModalOpen(false)}
          onSelect={(item) => {
            addToCart(item);
            setModalOpen(false);
          }}
        />
      )}

      {cameraOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner onClose={() => setCameraOpen(false)} onDetect={(code) => lookupCode(code)} />
        </Suspense>
      )}
    </div>
  );
}

function SearchModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (item: { id: string; sku: string; description: string; price: number; account: { name: string } }) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  async function runSearch(query: string) {
    setLoading(true);
    try {
      const res = await api.get<{ results: SearchResult[] }>(`/pos/inventory-search?q=${encodeURIComponent(query)}`);
      setResults(res.results);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <Card className="w-[600px] max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold uppercase text-sm">Search Inventory (tagless item)</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-crimson">
            ✕
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            runSearch(e.target.value);
          }}
          placeholder="Search by description, brand, category..."
          className="border border-ink p-3 mb-4"
        />
        <div className="overflow-y-auto flex-1">
          {loading && <p className="text-gray-400 text-sm">Searching…</p>}
          {!loading && results.length === 0 && q && <p className="text-gray-400 text-sm">No available items match.</p>}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="w-full text-left border-b border-gray-100 py-3 px-2 hover:bg-bone flex justify-between items-center"
            >
              <div>
                <div className="font-bold text-sm">{r.description}</div>
                <div className="text-[11px] text-gray-500">
                  SKU: {r.sku} · {r.account.name}
                </div>
              </div>
              <div className="font-bold">${r.price.toFixed(2)}</div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

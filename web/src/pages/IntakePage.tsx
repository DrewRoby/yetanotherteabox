import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card } from "../components/Card";
import { Barcode } from "../components/Barcode";

interface AccountOption {
  id: string;
  name: string;
  accountType: string;
}

interface CvSuggestion {
  brand?: string;
  category?: string;
  confidence: number;
}

interface QueuedTicket {
  itemId: string;
  sku: string;
  description: string;
  category: string;
  size: string;
  price: number;
}

const ACCOUNT_SCOPED_ROLES = ["CONSIGNOR", "BOOTH_OWNER"];

export function IntakePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAccountScoped = user ? ACCOUNT_SCOPED_ROLES.includes(user.activeRole) : false;

  const [ownAccount, setOwnAccount] = useState<{ name: string; accountType: string } | null>(null);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [suggestion, setSuggestion] = useState<CvSuggestion | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ sku: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState<QueuedTicket[]>([]);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printedCount, setPrintedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    if (isAccountScoped) {
      api.get<{ name: string; accountType: string }>("/accounts/me/profile").then(setOwnAccount);
    } else {
      api.get<AccountOption[]>("/accounts").then((accounts) => {
        setAccountOptions(accounts);
      });
    }
  }, [user, isAccountScoped]);

  const accountReady = isAccountScoped ? !!ownAccount : !!selectedAccountId;

  async function handleCapture() {
    setCapturing(true);
    try {
      const s = await api.post<CvSuggestion>("/items/suggest-metadata", { photoUrl: "local-capture-stub" });
      setSuggestion(s);
      if (s.brand) setBrand(s.brand);
      if (s.category) setCategory(s.category);
    } finally {
      setCapturing(false);
    }
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await api.post<{ item: { id: string; sku: string; description: string; category: string; size: string | null; price: number } }>(
        "/items",
        {
          description,
          category,
          brand: brand || undefined,
          size: size || undefined,
          price: Number(price),
          accountId: isAccountScoped ? undefined : selectedAccountId,
        }
      );
      setResult({ sku: res.item.sku });
      setBatch((b) => [
        ...b,
        {
          itemId: res.item.id,
          sku: res.item.sku,
          description: res.item.description,
          category: res.item.category,
          size: res.item.size || "",
          price: res.item.price,
        },
      ]);
      setPrintedCount(null);
      setDescription("");
      setCategory("");
      setBrand("");
      setSize("");
      setPrice("");
      setSuggestion(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save item.");
    } finally {
      setSaving(false);
    }
  }

  function removeFromBatch(itemId: string) {
    setBatch((b) => b.filter((t) => t.itemId !== itemId));
  }

  async function handlePrintBatch() {
    if (batch.length === 0) return;
    setPrintError(null);
    setPrinting(true);
    try {
      await api.post("/items/print-batch", { itemIds: batch.map((t) => t.itemId) });
      setPrintedCount(batch.length);
      setBatch([]);
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : "Could not send tags to the printer.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-xl font-bold uppercase tracking-wide">Item Intake</h1>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Discard
          </Button>
          <Button onClick={handleSave} disabled={!accountReady || !description || !category || !price || saving}>
            {saving ? "Saving…" : "Save Item"}
          </Button>
        </div>
      </div>

      {/* Intake For — locked for account-scoped roles, required selector for staff. */}
      <Card className="mb-5 bg-bone">
        <div className="text-xs uppercase font-bold tracking-wide mb-2">Intake For</div>
        {isAccountScoped ? (
          ownAccount ? (
            <div className="text-sm">
              <span className="font-bold">{ownAccount.name}</span>{" "}
              <span className="text-gray-500">({ownAccount.accountType})</span>
              <span className="ml-3 text-[10px] text-gray-400 uppercase">Locked to your own account</span>
            </div>
          ) : (
            <div className="text-sm text-gray-400">Loading your account…</div>
          )
        ) : (
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="border border-ink px-3 py-2 bg-white w-96"
          >
            <option value="">— Select target account (required) —</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.accountType})
              </option>
            ))}
          </select>
        )}
      </Card>

      {result && (
        <Card className="mb-5 bg-white border-crimson">
          <span className="font-bold text-crimson">Saved.</span> Item <span className="font-mono">{result.sku}</span> created and
          queued in the tag batch below.
        </Card>
      )}
      {printedCount != null && (
        <Card className="mb-5 bg-white border-crimson">
          <span className="font-bold text-crimson">Printed.</span> Sent {printedCount} tag{printedCount === 1 ? "" : "s"} to the
          printer.
        </Card>
      )}
      {error && (
        <Card className="mb-5 border-crimson">
          <span className="text-crimson font-semibold">{error}</span>
        </Card>
      )}

      <fieldset disabled={!accountReady} className="grid grid-cols-[400px_1fr] gap-6 disabled:opacity-50">
        <div className="flex flex-col gap-5">
          <Card>
            <h3 className="text-xs uppercase font-bold border-b border-gray-100 pb-2 mb-3">Intake Capture</h3>
            <div className="border border-ink h-56 flex items-center justify-center text-gray-400 relative">
              <span className="absolute top-0 right-0 bg-crimson text-white text-[10px] px-2 py-1 font-bold uppercase">
                Live View
              </span>
              <div className="text-center">
                <div className="text-4xl mb-2 text-gold">📷</div>
                <p className="text-xs uppercase">{capturing ? "Analyzing…" : "Awaiting Focus"}</p>
              </div>
            </div>
            <Button className="w-full mt-3" onClick={handleCapture} disabled={capturing}>
              Capture Image
            </Button>
            {suggestion && (
              <p className="text-[11px] text-gray-500 mt-2">
                CV suggestion applied (confidence {(suggestion.confidence * 100).toFixed(0)}%).
              </p>
            )}
          </Card>
          <Card>
            <label className="block text-xs font-bold uppercase mb-2">Barcode / SKU</label>
            {result ? (
              <Barcode value={result.sku} className="w-full" />
            ) : (
              <input
                disabled
                placeholder="Assigned automatically on save"
                className="w-full border-2 border-crimson px-3 py-2 font-mono text-gray-400 bg-gray-50"
              />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <h3 className="text-xs uppercase font-bold mb-3">Description Draft</h3>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-20 border border-ink p-2 bg-gray-50"
              placeholder="Vintage Levi's 501 Denim Jeans, Button Fly..."
            />
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500">Category / Dept.</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-ink p-2" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500">Brand</label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full border border-ink p-2" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500">Size</label>
                <input value={size} onChange={(e) => setSize(e.target.value)} className="w-full border border-ink p-2" placeholder="e.g. M, 32x30" />
              </div>
            </div>
          </Card>
          <Card>
            <h3 className="text-xs uppercase font-bold mb-3">Price</h3>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full border-2 border-ink p-3 text-lg font-bold"
              placeholder="0.00"
            />
          </Card>
        </div>
      </fieldset>

      <Card className="mt-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs uppercase font-bold tracking-wide">
            Tag Batch {batch.length > 0 && <span className="text-crimson">({batch.length} pending)</span>}
          </h3>
          <Button onClick={handlePrintBatch} disabled={batch.length === 0 || printing}>
            {printing ? "Sending…" : `Print Batch${batch.length > 0 ? ` (${batch.length})` : ""}`}
          </Button>
        </div>
        {printError && <p className="text-crimson text-sm mb-3">{printError}</p>}
        {batch.length === 0 ? (
          <p className="text-sm text-gray-400">
            Saved items are queued here for printing. Enter a batch of items, then print all their tags at once.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {batch.map((ticket) => (
              <TagPreview key={ticket.itemId} ticket={ticket} onRemove={() => removeFromBatch(ticket.itemId)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TagPreview({ ticket, onRemove }: { ticket: QueuedTicket; onRemove: () => void }) {
  const pertinent = [ticket.category, ticket.size ? `Size ${ticket.size}` : null].filter(Boolean).join(" · ");
  return (
    <div className="relative w-48 border-2 border-ink bg-white p-3 flex flex-col gap-1">
      <button
        onClick={onRemove}
        title="Remove from batch (won't delete the item)"
        className="absolute top-1 right-1 text-gray-400 hover:text-crimson text-xs leading-none"
      >
        ✕
      </button>
      <div className="text-[11px] font-bold uppercase leading-tight pr-3 line-clamp-2">{ticket.description}</div>
      {pertinent && <div className="text-[10px] text-gray-500 uppercase">{pertinent}</div>}
      <div className="text-lg font-black text-crimson">${ticket.price.toFixed(2)}</div>
      <Barcode value={ticket.sku} className="w-full" />
    </div>
  );
}

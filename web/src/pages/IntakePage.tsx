import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card } from "../components/Card";

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
  const [price, setPrice] = useState("");
  const [suggestion, setSuggestion] = useState<CvSuggestion | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ sku: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await api.post<{ item: { sku: string } }>("/items", {
        description,
        category,
        brand: brand || undefined,
        price: Number(price),
        accountId: isAccountScoped ? undefined : selectedAccountId,
      });
      setResult({ sku: res.item.sku });
      setDescription("");
      setCategory("");
      setBrand("");
      setPrice("");
      setSuggestion(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save item.");
    } finally {
      setSaving(false);
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
            {saving ? "Saving…" : "Save & Print"}
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
          tag sent to printer.
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
            <input
              disabled
              placeholder="Assigned automatically on save"
              className="w-full border-2 border-crimson px-3 py-2 font-mono text-gray-400 bg-gray-50"
            />
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
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500">Category</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-ink p-2" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-500">Brand</label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full border border-ink p-2" />
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
    </div>
  );
}

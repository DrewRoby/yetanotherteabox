import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, setToken } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type Step = "welcome" | "shop" | "owner";

export function SetupWizardPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [storeName, setStoreName] = useState("");
  const [storeLocation, setStoreLocation] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function handleCreateShop(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<{ token: string }>("/setup/complete", {
        storeName,
        storeLocation: storeLocation || undefined,
        ownerName,
        ownerEmail,
        password,
      });
      setToken(result.token);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? "Could not create your shop. It may already be set up — try signing in instead."
          : "Could not reach the server."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bone px-4">
      <div className="fixed top-0 w-full h-[60px] bg-white border-b-2 border-ink flex items-center px-6">
        <div className="w-[34px] h-[34px] bg-crimson text-white flex items-center justify-center font-bold rounded-sm mr-4">茶</div>
        <div className="font-bold uppercase tracking-wide">Teabox ERP — First-Time Setup</div>
      </div>

      <div className="corner-ticks bg-white border border-ink w-[480px] shadow-xl">
        <div className="bg-crimson text-white text-center py-3 -mt-6 mx-auto w-2/3 font-extrabold tracking-[3px] border border-ink shadow-[0_4px_0_#111]">
          {step === "welcome" && "WELCOME"}
          {step === "shop" && "YOUR SHOP"}
          {step === "owner" && "YOUR ACCOUNT"}
        </div>

        <div className="px-11 pb-11 pt-6">
          <StepDots step={step} />

          {step === "welcome" && (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-gray-700 leading-relaxed">
                Nobody has set up this Teabox instance yet — you're the first person here. In two short
                steps we'll create your shop and your Owner account, and sign you straight in.
              </p>
              <ul className="text-xs text-gray-500 list-disc pl-5 space-y-1">
                <li>Your data stays on this machine — nothing is uploaded anywhere.</li>
                <li>You'll be the Owner, with full access to invite staff and consignors later.</li>
                <li>This only needs to happen once.</li>
              </ul>
              <button
                onClick={() => setStep("shop")}
                className="w-full py-4 bg-crimson text-white border border-ink font-extrabold uppercase tracking-widest hover:bg-ink transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {step === "shop" && (
            <form
              className="flex flex-col gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                setStep("owner");
              }}
            >
              <p className="text-sm text-gray-600">What's your shop called?</p>
              <Field label="Shop Name" value={storeName} onChange={setStoreName} placeholder="Second Chance Threads" required autoFocus />
              <Field
                label="Location (optional)"
                value={storeLocation}
                onChange={setStoreLocation}
                placeholder="Boulder, CO"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("welcome")}
                  className="flex-1 py-3 border border-ink font-bold uppercase text-xs tracking-wide hover:bg-bone"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!storeName}
                  className="flex-1 py-3 bg-crimson text-white border border-ink font-bold uppercase text-xs tracking-wide hover:bg-ink disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </form>
          )}

          {step === "owner" && (
            <form onSubmit={handleCreateShop} className="flex flex-col gap-5">
              <p className="text-sm text-gray-600">
                Now create your own Owner login for <span className="font-bold">{storeName}</span>.
              </p>
              <Field label="Your Name" value={ownerName} onChange={setOwnerName} placeholder="Priya Kapoor" required autoFocus />
              <Field label="Email" value={ownerEmail} onChange={setOwnerEmail} type="email" placeholder="you@yourshop.com" required />
              <Field label="Password" value={password} onChange={setPassword} type="password" placeholder="At least 8 characters" required />
              <Field
                label="Confirm Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                type="password"
                placeholder="Re-enter password"
                required
              />
              {error && <p className="text-crimson text-sm font-semibold">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("shop")}
                  className="flex-1 py-3 border border-ink font-bold uppercase text-xs tracking-wide hover:bg-bone"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || !ownerName || !ownerEmail || !password || !confirmPassword}
                  className="flex-1 py-4 bg-crimson text-white border border-ink font-extrabold uppercase tracking-widest hover:bg-ink transition-colors disabled:opacity-50"
                >
                  {submitting ? "Creating your shop…" : "Create My Shop"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ["welcome", "shop", "owner"];
  const idx = steps.indexOf(step);
  return (
    <div className="flex justify-center gap-2 mb-6">
      {steps.map((s, i) => (
        <div key={s} className={`h-1.5 w-10 ${i <= idx ? "bg-crimson" : "bg-gray-200"}`} />
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-extrabold uppercase tracking-wide mb-2">{label}</label>
      <input
        type={type}
        required={required}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border-0 border-b border-ink bg-transparent py-2 focus:outline-none focus:border-b-2 focus:border-crimson"
      />
    </div>
  );
}

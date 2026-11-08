import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AccountPicker, type AccountOption } from "../../components/AccountPicker";
import { Badge, Button, Card } from "../../components/Card";
import { Pager, rangeLabel } from "../../components/Pager";
import { accountLabel, itemNo } from "../../lib/itemNumber";
import { formatDate, localDayStartMs, money } from "./format";

// "Waiting to be claimed" on a HOLDING (Lost & Found) account: goods an account
// holder dropped off unmarked. Staff pick the items, pick whose they were, and claim
// them — the owner is credited for any sale (server: POST /accounts/:id/claims, see
// services/holding.service.ts). Claiming for the store releases a sale nobody will
// claim; "Release older sales" does that in bulk by sale date.

const CLAIM_ROLES = ["SYSTEM_ADMIN", "OWNER", "MANAGER"]; // server: same as moving an item between accounts
const PAGE_SIZE = 25;

interface HeldRow {
  id: string;
  sku: string;
  tagAccountNumber: number | null;
  accountItemNumber: number | null;
  description: string;
  category: string;
  status: string;
  price: number;
  intakeDate: string;
  soldAt: string | null;
  salePrice: number | null;
  estShare: number | null;
}

interface HeldResponse {
  total: number;
  totals: { soldCount: number; soldGross: number; soldEstShare: number; floorCount: number; floorRetail: number };
  items: HeldRow[];
}

interface ClaimResult {
  claimed: number;
  sold: number;
  credited: number;
  target: { id: string; name: string; accountNumber: number | null };
}

export function HeldItems({ accountId, onChanged }: { accountId: string; onChanged: () => void }) {
  const { user } = useAuth();
  const canClaim = !!user && CLAIM_ROLES.includes(user.activeRole);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "sold" | "floor">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HeldResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claimFor, setClaimFor] = useState<AccountOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams({ show, page: String(page), pageSize: String(PAGE_SIZE) });
    if (q.trim()) params.set("q", q.trim());
    let live = true;
    api.get<HeldResponse>(`/accounts/${accountId}/unclaimed?${params}`).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [accountId, q, show, page, version]);

  function afterClaim(result: ClaimResult, what: string) {
    const who = accountLabel(result.target);
    setMessage({
      tone: "ok",
      text:
        `${what} ${result.claimed.toLocaleString()} item${result.claimed === 1 ? "" : "s"} for ${who}` +
        (result.credited ? ` — credited ${money(result.credited)}.` : result.sold ? " — the store keeps those sales." : "."),
    });
    setSelected(new Set());
    setVersion((v) => v + 1);
    onChanged();
  }

  async function claimSelected() {
    if (!claimFor || selected.size === 0) return;
    const rows = data?.items.filter((r) => selected.has(r.id)) ?? [];
    const soldCount = rows.filter((r) => r.status === "SOLD").length;
    const ok = window.confirm(
      `Claim ${selected.size} item${selected.size === 1 ? "" : "s"} for ${accountLabel(claimFor)}?\n\n` +
        (soldCount
          ? `${soldCount} sold — ${claimFor.isStoreAccount || claimFor.accountType === "STORE" || claimFor.accountType === "DONOR" ? "the store keeps those sales (nobody is credited)" : `${claimFor.name} is credited their share of those sales`}.\n`
          : "") +
        (selected.size - soldCount ? `${selected.size - soldCount} still on the floor move to their account.\n` : "") +
        "This can't be undone from here."
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      afterClaim(await api.post<ClaimResult>(`/accounts/${accountId}/claims`, { accountId: claimFor.id, itemIds: [...selected] }), "Claimed");
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError ? e.message : "Couldn't claim the items." });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Card className="mb-6 text-gray-500">Loading items waiting to be claimed…</Card>;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageIds = data.items.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap justify-between items-baseline gap-3 mb-3">
        <h3 className="text-lg font-bold">Waiting to be claimed</h3>
        <p className="text-xs text-gray-500 max-w-xl">
          Goods dropped off without being marked as someone's. When you know whose they were, select them and claim them for
          that person's account — they're credited for anything already sold. This account itself is never paid out.
        </p>
      </div>

      <div className="flex flex-wrap gap-10 mb-4">
        <div>
          <div className="text-[10px] uppercase text-gray-500">Sold, unclaimed</div>
          <div className="text-2xl font-bold text-crimson">{money(data.totals.soldGross)}</div>
          <div className="text-[10px] text-gray-500">
            {data.totals.soldCount.toLocaleString()} items · ≈{money(data.totals.soldEstShare)} owner share
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500">Still on the floor</div>
          <div className="text-2xl font-bold">{data.totals.floorCount.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">{money(data.totals.floorRetail)} retail</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-3">
        <input
          className="border border-ink px-3 py-1.5 text-sm w-64"
          placeholder="Search item #, description or SKU…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="border border-ink px-2 py-1.5 text-sm"
          value={show}
          onChange={(e) => {
            setShow(e.target.value as typeof show);
            setPage(1);
          }}
        >
          <option value="all">Sold and on the floor</option>
          <option value="sold">Sold only</option>
          <option value="floor">On the floor only</option>
        </select>
        <span className="text-xs text-gray-500">{rangeLabel(page, PAGE_SIZE, data.total, !!q.trim() || show !== "all")}</span>
        <span className="ml-auto">
          <Pager page={page} pages={pages} onPage={setPage} />
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase text-gray-500 border-b border-ink">
            {canClaim && (
              <th className="p-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select this page"
                  checked={allOnPage}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      for (const id of pageIds) {
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                      }
                      return next;
                    })
                  }
                />
              </th>
            )}
            <th className="p-2">Item #</th>
            <th className="p-2">Description</th>
            <th className="p-2">Status</th>
            <th className="p-2">Received</th>
            <th className="p-2">Sold</th>
            <th className="p-2 text-right">Sold For</th>
            <th className="p-2 text-right" title="Consignor share at the item's own split (or this account's); a claim uses the owner's split for items without one">
              ≈ Owner Share
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id} className="border-b border-gray-200 hover:bg-bone">
              {canClaim && (
                <td className="p-2">
                  <input type="checkbox" aria-label={`Select ${itemNo(r)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
              )}
              <td className="p-2 whitespace-nowrap" title={r.sku}>
                <Link to={`/inventory/${r.id}`} className="text-crimson font-bold hover:underline">
                  {itemNo(r)}
                </Link>
              </td>
              <td className="p-2">
                {r.description}
                <span className="text-gray-500 text-xs"> · {r.category}</span>
              </td>
              <td className="p-2">{r.status === "SOLD" ? <Badge tone="sold">Sold</Badge> : <Badge>On floor</Badge>}</td>
              <td className="p-2 whitespace-nowrap">{formatDate(r.intakeDate)}</td>
              <td className="p-2 whitespace-nowrap">{formatDate(r.soldAt)}</td>
              <td className="p-2 text-right">{r.salePrice != null ? money(r.salePrice) : <span className="text-gray-500">{money(r.price)} tag</span>}</td>
              <td className="p-2 text-right">{r.estShare != null ? money(r.estShare) : "—"}</td>
            </tr>
          ))}
          {data.items.length === 0 && (
            <tr>
              <td colSpan={canClaim ? 8 : 7} className="p-6 text-center text-gray-500">
                Nothing waiting to be claimed{q.trim() || show !== "all" ? " matches these filters" : ""}.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {message && <p className={`text-sm mt-3 ${message.tone === "error" ? "text-crimson" : "text-green-700"}`}>{message.text}</p>}

      {canClaim && (
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-gray-200">
          <span className="text-xs uppercase font-bold">Claim {selected.size ? `${selected.size} selected` : "selected"} for</span>
          <AccountPicker value={claimFor} onChange={setClaimFor} placeholder="Whose were they? Account #, name or phone…" className="w-80" />
          <Button disabled={busy || !claimFor || selected.size === 0} onClick={claimSelected}>
            {busy ? "Claiming…" : `Claim ${selected.size || ""} item${selected.size === 1 ? "" : "s"}`.replace("  ", " ")}
          </Button>
          {selected.size > 0 && (
            <button className="text-xs underline text-gray-600" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
        </div>
      )}

      {canClaim && data.totals.soldCount > 0 && <ReleaseOlder accountId={accountId} busy={busy} setBusy={setBusy} onDone={afterClaim} onError={(t) => setMessage({ tone: "error", text: t })} />}
    </Card>
  );
}

// Bulk "nobody's coming for these": every unclaimed sale sold before a date goes to the
// store's built-in account (nobody credited). Migrated Lost & Found history has years of
// sales Liberty settled by hand-written deductions that Teabox can't tie to items.
function ReleaseOlder({
  accountId,
  busy,
  setBusy,
  onDone,
  onError,
}: {
  accountId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: (r: ClaimResult, what: string) => void;
  onError: (text: string) => void;
}) {
  const [before, setBefore] = useState("");
  const [storeAccount, setStoreAccount] = useState<AccountOption | null>(null);
  useEffect(() => {
    api.get<AccountOption[]>("/accounts?accountType=STORE").then((rows) => setStoreAccount(rows.find((a) => a.accountType === "STORE") ?? null));
  }, []);

  async function release() {
    if (!before || !storeAccount) return;
    const soldBefore = localDayStartMs(before);
    const preview = await api.get<HeldResponse>(`/accounts/${accountId}/unclaimed?show=sold&soldBefore=${soldBefore}&pageSize=1`);
    if (preview.total === 0) return onError(`Nothing unclaimed was sold before ${new Date(soldBefore).toLocaleDateString()}.`);
    if (
      !window.confirm(
        `Release ${preview.total.toLocaleString()} unclaimed sale${preview.total === 1 ? "" : "s"} from before ${new Date(soldBefore).toLocaleDateString()} to ${accountLabel(storeAccount)}?\n\n` +
          "The store keeps those sales — nobody is credited, and they leave this list for good."
      )
    )
      return;
    setBusy(true);
    try {
      onDone(await api.post<ClaimResult>(`/accounts/${accountId}/claims`, { accountId: storeAccount.id, soldBefore }), "Released");
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Couldn't release the sales.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
      <span className="uppercase font-bold">Release older sales to the store</span>
      <span>sold before</span>
      <input type="date" className="border border-ink px-2 py-1" value={before} onChange={(e) => setBefore(e.target.value)} />
      <Button variant="secondary" disabled={busy || !before || !storeAccount} onClick={release}>
        Release…
      </Button>
      <span className="text-gray-500">For sales nobody will come back for.</span>
    </div>
  );
}

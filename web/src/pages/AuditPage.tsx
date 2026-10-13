import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Explorer, type ExplorerState, type Filters } from "./audit/Explorer";
import { Obligations } from "./audit/Obligations";
import { DIMENSION_KEYS, type Dimension } from "./audit/auditVocab";

// Inventory Audit: sort out the active floor (Explore) and what's owed (Obligations).
// All Explore state lives in the URL — one param per filtered dimension (same names the
// API takes), plus groupBy/q/sort/dir/page — so a slice can be bookmarked or linked to.
export function AuditPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "obligations" ? "obligations" : "explore";
  const canApply = user?.activeRole === "OWNER" || user?.activeRole === "SYSTEM_ADMIN";

  const state: ExplorerState = useMemo(() => {
    const filters: Filters = {};
    for (const key of DIMENSION_KEYS) {
      const v = params.get(key);
      if (v) filters[key] = v.split(",");
    }
    const groupBy = (DIMENSION_KEYS as string[]).includes(params.get("groupBy") ?? "")
      ? (params.get("groupBy") as Dimension)
      : "expired";
    return {
      filters,
      q: params.get("q") ?? "",
      groupBy,
      sort: params.get("sort") ?? "intake",
      dir: params.get("dir") === "desc" ? "desc" : "asc",
      page: Number(params.get("page")) || 1,
    };
  }, [params]);

  const onChange = useCallback(
    (next: Partial<ExplorerState>) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next.filters) {
            for (const key of DIMENSION_KEYS) {
              const v = next.filters[key];
              if (v?.length) p.set(key, v.join(","));
              else p.delete(key);
            }
          }
          const set = (k: string, v: string | undefined, dflt: string) => {
            if (v === undefined) return;
            if (v === dflt || v === "") p.delete(k);
            else p.set(k, v);
          };
          set("q", next.q, "");
          set("groupBy", next.groupBy, "expired");
          set("sort", next.sort, "intake");
          set("dir", next.dir, "asc");
          set("page", next.page === undefined ? undefined : String(next.page), "1");
          return p;
        },
        // Filter/grouping changes are history steps (Back undoes a drill-down); paging
        // and typing replace.
        { replace: !(next.filters || next.groupBy) }
      ),
    [setParams]
  );

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold uppercase">Inventory Audit</h1>
        <p className="text-sm text-gray-600 mt-1">
          Everything still on the books as Available or Pending — who it belongs to, what it's worth, and what to do
          with it. Consignments expire after 90 days.
        </p>
      </div>
      <div className="flex gap-1 mb-6">
        {(["explore", "obligations"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setParams(v === "explore" ? {} : { view: v })}
            className={`px-4 py-2 text-xs font-bold uppercase border border-ink ${view === v ? "bg-crimson text-white" : "bg-white"}`}
          >
            {v === "explore" ? "Explore Items" : "Payout Obligations"}
          </button>
        ))}
      </div>
      {view === "explore" ? <Explorer state={state} onChange={onChange} canApply={canApply} /> : <Obligations />}
    </div>
  );
}

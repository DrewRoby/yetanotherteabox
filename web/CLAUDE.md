# web/

React + TypeScript + Vite + Tailwind. Dev: `npm run dev` (:5173, proxies `/api` to
`:4000`). Ming Dynasty theme tokens in `tailwind.config.js`: `crimson #b91c1c`,
`crimson2 #a62c2b`, `gold #d4af37`, `ink #1a1a1a`, `bone #f8f3e7`. Shared visual
primitives (`Card`, `StatCard`, `Badge`, `Button`, the gold corner-tick decoration) in
`src/components/Card.tsx` / `.corner-ticks` in `src/index.css`.

## Auth state (`src/auth/AuthContext.tsx`)

Single context holds `user` (decoded `/auth/me`, or null), `loading`, and
`needsSetup` (from `/setup/status` — only meaningful when `user` is null; an existing
session always implies setup already happened). `login/selectRole/switchRole` all
call the matching server endpoint, store the JWT (`src/api/client.ts`'s
`setToken`/localStorage), then re-fetch `/auth/me`. `refresh()` is exposed for
`SetupWizardPage` to pull the newly-issued session in after `/setup/complete`.

## Routing gate (`src/App.tsx`)

Order matters: `loading` → blank; else if `!user && needsSetup` → force `/setup`
regardless of requested path (new deployment, no session yet); else render `Routes`.
`HomeRedirect` (root path) picks the landing page **by active role** — staff →
`/dashboard`, `BOOTH_OWNER` → `/booth-pricing`, else → `/portal`. Always navigate
through `"/"` (or call nothing and let this resolve) after login/role-select/switch —
never hardcode a destination route, since it depends on the role just chosen.
`RequireRole` (`src/auth/RequireRole.tsx`) wraps each route as a **UX-only** gate
(redirects to `/access-denied`); the server's `requireRole` middleware is the actual
security boundary.

## Role → screen matrix (`src/auth/roles.ts`)

`NAV_ENTRIES` is the single list driving both the sidebar (`AppShell.tsx`) and
`App.tsx`'s per-route `RequireRole` — one definition instead of two lists that could
drift. Mirrors `server/src/lib/enums.ts::ROLES` by hand (no shared package between
the two apps — update both if roles change).

## Pages (`src/pages/`)

| Path | Component | Roles | Notes |
|---|---|---|---|
| `/setup` | `SetupWizardPage` | none (pre-auth) | 3-step: Welcome → Shop → Owner. Blocked once `needsSetup` is false. |
| `/login` | `LoginPage` | none | Handles the multi-role picker step inline. |
| `/dashboard` | `DashboardPage` | staff | Role-specific widgets from `/reports/dashboard`. |
| `/inventory`, `/inventory/:id` | `InventoryPage`, `ItemDetailPage` | staff | |
| `/intake` | `IntakePage` | staff + Consignor/Booth Owner | Locked "Intake For" card vs. required account `<select>` — mirrors `resolveIntakeAccountId` server-side. |
| `/pos` | `PosPage` | staff + Register | Scan input + "Search Inventory" modal (tagless items) + checkout. |
| `/accounts`, `/accounts/:id` | `AccountsPage` | staff | Tabbed by `accountType`; Donor tab never renders a balance column. |
| `/portal` | `ConsignorPortalPage` | Consignor/Vendor/Donor | Self-service, own account only (`/accounts/me/profile`). |
| `/booth-pricing` | `BoothOwnerPricingPage` | Booth Owner (own items) + Manager/Owner (pick a booth) | Inline price edits + bulk % adjustment. |
| `/reports` | `ReportsPage` | Manager/Owner/Admin | Daily sales, aging, payouts; CSV export via raw `fetch` (blob download, not the JSON api client). |
| `/settings` | `SettingsPage` | Manager/Owner/Admin | Tabbed; Users & Permissions restricted further to Owner/Admin inside the page. |

## API client (`src/api/client.ts`)

Thin wrapper (`api.get/post/put/del`) auto-attaching the bearer token and throwing
`ApiError` with the parsed server error on non-2xx. CSV export bypasses it
deliberately (needs a `Blob`, not JSON).

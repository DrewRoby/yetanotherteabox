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
`/dashboard`, `BOOTH_OWNER` → `/booth-pricing`, `REGISTER` → `/pos`, else → `/portal`. Always navigate
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
| `/login` | `LoginPage` | none | Handles the multi-role picker step inline. Also badge sign-in: a scan into the autofocused Email field (value starting `TBXB-` + Enter) is routed to `/auth/badge-login`, as is the explicit "Or scan your badge" field / Camera button. |
| `/dashboard` | `DashboardPage` | staff | Role-specific widgets from `/reports/dashboard`. |
| `/inventory`, `/inventory/:id` | `InventoryPage`, `ItemDetailPage` | staff | |
| `/intake` | `IntakePage` | staff + Consignor/Booth Owner | Locked "Intake For" card vs. required account `<select>` — mirrors `resolveIntakeAccountId` server-side. Saving queues a tag into the "Tag Batch" panel instead of printing immediately — see "Ticket printing" below. |
| `/pos` | `PosPage` | staff + Register | Scan input + "Search Inventory" modal (tagless items) + camera scanner (`components/BarcodeScanner.tsx`, lazy-loaded) + checkout. |
| `/accounts`, `/accounts/:id` | `AccountsPage` | staff | Tabbed by `accountType`; Donor tab never renders a balance column. "+ Add Account" (Owner/Manager/Admin only, hidden on the Store tab) opens a modal posting to the pre-existing `POST /accounts` — see `server/CLAUDE.md`'s "Accounts" section. |
| `/portal` | `ConsignorPortalPage` | Consignor/Vendor/Donor | Self-service, own account only (`/accounts/me/profile`). |
| `/booth-pricing` | `BoothOwnerPricingPage` | Booth Owner (own items) + Manager/Owner (pick a booth) | Inline price edits + bulk % adjustment. |
| `/reports` | `ReportsPage` | Manager/Owner/Admin | Daily sales, aging, payouts; CSV export via raw `fetch` (blob download, not the JSON api client). Plus two tools in `pages/reports/`: **Employee Sign-In Sheet** (`SignInSheet.tsx` — issues/rotates/revokes scan-to-login badges and prints them; plaintext codes exist only in component state while the sheet is on screen) and **Barcode Generator** (`BarcodeGenerator.tsx` — any text → PNG, fully client-side). Both offer Code128 or QR via `lib/codeImage.ts`. |
| `/settings` | `SettingsPage` | Manager/Owner/Admin | Tabbed; Users & Permissions restricted further to Owner/Admin inside the page. |

## Barcode scanning (`PosPage`'s "Scan Input")

Physical USB barcode scanners (tested against the NetumScan NSA5, an omnidirectional
desktop scanner) are HID keyboard-emulation devices — no driver, no serial/COM mode.
Decoding a barcode just "types" the code into whatever element has focus, followed by
a terminator (Enter/CR by that device's default). That means the plain `<input>` in
`PosPage` *is* the entire scanner integration; there's no server-side "scanner
adapter" the way `printer.ts` stubs a real printer, because there's no protocol to
implement — the OS already presents it as a keyboard.

The only real failure mode is focus: if a clerk clicks elsewhere on the page first,
the next scan's keystrokes go nowhere. `PosPage` re-focuses the scan input after
every state change that could have stolen it (cart update, modal close, checkout) and
on any stray click that isn't on another field/button/modal — see the `focusScanInput`
calls and the document `click` listener in `PosPage.tsx`.

`components/BarcodeScanner.tsx` (camera-based, via `@zxing/browser`, lazy-loaded) is a
secondary input path for devices with a camera but no physical scanner attached — not
a replacement for the HID path above, which is what real registers use.

`components/Barcode.tsx` is the write/render side — renders any `Item.sku` (see
`server/src/lib/barcode.ts::formatBarcode`) as a real Code128 barcode via `jsbarcode`.
Used on `IntakePage` (in place of the old disabled "assigned automatically" input,
once `result.sku` comes back from the save) and on `ItemDetailPage` next to the SKU
line, so the same tag/barcode that's on the physical item can be reprinted or
re-scanned for verification.

`lib/codeImage.ts` is the raster counterpart: renders any value to a PNG data URL as
Code128 (`jsbarcode` on a canvas) or QR (`qrcode`), for the Reports page's sign-in
sheet and Barcode Generator. Code128 is ASCII-only — `barcodeUnsupportedReason()`
catches non-ASCII/over-long input up front and points the user at QR (UTF-8) instead.
Print-only regions use `.print-area` / `.no-print` from `index.css`.

## Ticket printing (`IntakePage`'s "Tag Batch" panel)

Saving an item no longer prints its tag right away — `handleSave` pushes the newly
created item (id/sku/description/category/size/price) into a `batch` array instead,
rendered as a "Tag Batch" `Card` below the intake form. Each queued entry is shown via
`TagPreview`, a small mock label: description, a "Category · Size" pertinent-info line
(the department + size fields a clothing tag needs), price, and a real `Barcode` for
the item's `sku` — meant to look like what the physical tag will actually contain, not
just a confirmation. A ✕ on each preview removes it from the batch only (the `Item`
stays saved either way); "Print Batch (N)" posts all queued item IDs to `POST
/items/print-batch` (see `server/CLAUDE.md`) and clears the batch on success.

This means a clerk can enter several items from one consignor drop-off in a row and
print all their tags in one trip to the printer, instead of the previous per-item
auto-print. The "Size" field on the intake form (next to Category/Brand) was added
specifically to feed this — `Item.size`/`category` already existed in the schema and
intake route, just weren't exposed in this form before.

## API client (`src/api/client.ts`)

Thin wrapper (`api.get/post/put/del`) auto-attaching the bearer token and throwing
`ApiError` with the parsed server error on non-2xx. CSV export bypasses it
deliberately (needs a `Blob`, not JSON).

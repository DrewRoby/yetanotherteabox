# server/

Express + TypeScript + Prisma (SQLite). Entry: `src/index.ts`. Dev: `npm run dev`
(tsx watch). Build: `npm run build` (→ `dist/`, uses `tsconfig.build.json`). See root
`CLAUDE.md` for the one-active-role rule this whole layer enforces.

## Request lifecycle

`src/bootstrap.ts` (imported first, always) → if running as the packaged binary
(`process.pkg` set), relocates the SQLite file before Prisma Client is constructed
anywhere, copying in the bundled `prisma/template.db` on first run. On Linux this
goes to `~/.local/share/teabox/` (XDG convention). On Windows (the test-deploy
target, see root CLAUDE.md) it's deliberately portable instead: `teabox.db` and an
optional `config.env` (loaded via `dotenv`, overriding nothing that isn't set) live
next to `process.execPath` — the exe/config/db travel together as one folder. Plain
dev/`npm start` skip all of this and use `server/.env`'s `DATABASE_URL`.

`authenticate` (`src/middleware/auth.ts`) decodes the bearer JWT into `req.session:
SessionClaims { sub, activeRole, storeId, accountId? }` — nothing else is ever read
for authorization. `requireRole(...roles)` (`src/middleware/requireRole.ts`) checks
only `req.session.activeRole`. `/api/setup/*` and `/api/auth/login` are mounted
*before* `authenticate` (no session yet); everything else requires one.

## Data model (`prisma/schema.prisma`)

SQLite has no native enum type — `Role`, `AccountType`, `ItemStatus`, `PayoutStatus`
are plain strings, validated against the TS unions in `src/lib/enums.ts` (the
source of truth for valid values; keep in sync with `web/src/auth/roles.ts` by hand,
no shared package).

- `User` — auth identity only (email/passwordHash/name). Never carries roles directly.
- `UserRole` — `(userId, role, storeId, accountId?)`. One row per role a person holds; a user with both `MANAGER` and `CONSIGNOR` rows still only acts as one per session. `accountId` set for account-scoped roles (Consignor/Vendor/Donor/Booth Owner) — links the grant to the `Account` it acts on.
- `Store` — one per shop.
- `Account` — polymorphic party items/payouts attach to: `accountType ∈ {CONSIGNOR, VENDOR, DONOR, BOOTH_OWNER, STORE}`. Every store has exactly one `STORE`-type account (store-owned inventory) so intake always has a target. `serializeAccount()` (`src/services/accounts.service.ts`) strips `currentBalance` from the API response entirely for non-balance-bearing types (Donor, Store) — not just hidden in the UI. `mailingAddress` (free text, like `Store.location`) and `paymentMethod` have **no current write path** — populated only by direct SQL (e.g. a migration), not reachable via any route or UI today.
- `Item` — `accountId` is **required** (no intake without an account). `status ∈ {PENDING, AVAILABLE, SOLD, DONATED, DISPOSED, RETURNED}`. `cost` (acquisition cost basis) has **no current write path**, same as `consignmentType`. `sku` is also the barcode value (see below) — POS scan lookup, the printed tag, and the web `Barcode` component all key off it. `itemNumber` is a sequential-per-store counter (`@@unique([storeId, itemNumber])`) that `sku` is derived from.
- `ItemHistory`, `Photo`, `Sale`, `Payout`, `Device`, `Heartbeat` — as named.
- `AuditLog` — records `activeRole` alongside `performedById`, not just the user (security-doc requirement: interpret actions strictly in the role that performed them).

## Auth flow (`src/routes/auth.routes.ts`, `src/services/auth.service.ts`)

`POST /login` → 1 role: issues token immediately. >1 role: returns the role list, no
token (drives the login page's role picker). `POST /select-role` (public, second
step) / `POST /switch-role` (authenticated) both re-validate the user actually holds
`(role, storeId)` via `UserRole` before signing a new JWT — a session can never talk
itself into an ungranted role. `GET /me` returns the decoded session + fresh role list.

`/login` and `/select-role` are both rate-limited (`express-rate-limit`, 20 requests /
15 min / IP — see `credentialLimiter` in `auth.routes.ts`) since they're the two
pre-auth, credential-adjacent endpoints. The JWT itself is signed with `JWT_SECRET`
if set, else (packaged installs only) a random secret `bootstrap.ts` generates on
first run and persists as a `jwt-secret` file next to the database — never the
hardcoded fallback string in `lib/jwt.ts`, which only a plain `npm run dev` actually
uses. See root `CLAUDE.md`'s "Roadmap toward a real commercial deployment" for the
rest of the hardening pass this came out of (host binding, helmet, CORS).

## Setup Wizard (`src/routes/setup.routes.ts`, `src/services/setup.service.ts`)

`GET /setup/status` → `{ needsSetup: prisma.store.count() === 0 }`, public. `POST
/setup/complete` creates the Store + its `STORE` account + a `User` with an `OWNER`
`UserRole`, then signs them in — the real first-time-owner bootstrap (see root
`CLAUDE.md`). Re-checks `needsSetup` itself and 409s if a store already exists, so a
stale client can't re-trigger it against a live shop. Creates **no** demo data.

`maybeAutoCompleteSetup()` (same file) is an opt-in alternative to the manual wizard:
if `SETUP_STORE_NAME`/`SETUP_OWNER_NAME`/`SETUP_OWNER_EMAIL`/`SETUP_OWNER_PASSWORD`
are all set in the environment (e.g. via `config.env` on the Windows build — see
`config.env.example`), `index.ts`'s `start()` calls it before `app.listen`, so a
fresh `teabox.db` gets a known owner login with no browser interaction. No-op once a
store exists; a partial set of the four vars logs a warning and falls back to the
wizard rather than guessing.

## Intake account resolution (`src/services/items.service.ts::resolveIntakeAccountId`)

The load-bearing function for the account-linked-intake requirement:
- `activeRole ∈ {CONSIGNOR, BOOTH_OWNER}` → always uses `session.accountId`; any
  client-supplied `accountId` is **ignored**, not merely validated.
- Staff roles (`EMPLOYEE/MANAGER/OWNER/SYSTEM_ADMIN`) → must supply a valid
  `accountId` belonging to the same store (the store's own `STORE` account is valid).
Every route that creates an `Item` goes through this — don't bypass it.

## Barcode values (`src/lib/barcode.ts`)

`formatBarcode(storeId, itemNumber)` → `` `${storeId}-${itemNumber padded to 6}` ``,
used as `Item.sku` (also the value rendered as a real Code128 barcode by the web
`Barcode` component, and what POS scan lookup matches against). `items.routes.ts`'s
intake handler assigns `itemNumber` and `sku` inside one `prisma.$transaction` (count
existing items for the store, +1) rather than as a separate step before `create` —
SQLite serializes writer transactions, so this is race-free without needing a DB
sequence. This replaced an earlier `generateSku(category)` (3-letter category prefix +
random suffix); migration `20260915011122_add_item_number` backfilled existing rows'
`itemNumber` via a per-store `ROW_NUMBER() OVER (PARTITION BY storeId ORDER BY
intakeDate)` window function when the column was added as non-nullable.

See `web/CLAUDE.md`'s "Barcode scanning" section for the read side — a physical USB
scanner needs no server-side integration at all (it's a keyboard, not a device with a
protocol), so there's no `adapters/scanner.ts` alongside `adapters/printer.ts`.

## Ticket printing (`src/adapters/printer.ts`, `POST /items/print-batch`)

Item intake (`POST /items`) no longer prints a tag itself — it only creates the `Item`
and logs the `INTAKE` history entry. Printing is a separate, explicit step: the web
`IntakePage` queues each saved item into a "Tag Batch" and calls `POST
/items/print-batch` once, so a clerk entering several items from one drop-off walks to
the printer a single time instead of once per item. Don't reintroduce a `printTag`
call inside the intake handler.

`print-batch` takes `{ itemIds: string[] }`, re-reads those items from the DB (never
trusts client-supplied ticket text — a tampered price/description can't reach the
printer that way), and applies the same staff-or-own-account authorization check as
`GET /:id` — a Consignor/Booth Owner may only print tags for their own items. It calls
`printTagBatch()`, which loops `printTag()` per item and returns one combined result
set; one `PRINT_TAG` audit entry is recorded per item.

`TagTicket` (the adapter's input shape) carries `category` and `size` alongside
`sku`/`description`/`price` so the printed tag can show department + size (the
"pertinent info" for clothing) under the item name. The exact printer model is still
unconfirmed — candidates on hand are a Zebra label printer (ZPL) or an Epson receipt
printer (ESC/POS); `prisma/seed.ts`'s demo `Device` row names a "Zebra ZD410" if that's
a hint. Since the stub only renders ticket text and writes it to
`var/print-jobs/<sku>.txt`, it doesn't commit to either protocol — swapping
`printTag`/`printTagBatch`'s bodies for a real driver shouldn't require touching any
caller either way.

## Accounts (`src/routes/accounts.routes.ts`)

`GET /` (staff-only) and `POST /` (Owner/Manager/Admin only — `EMPLOYEE` sessions can
view but not create) predate this feature but had no web entry point until the
Accounts page's "+ Add Account" modal was added (see `web/CLAUDE.md`'s Pages table).
`POST /` rejects `accountType: "STORE"` outright (`"STORE accounts are managed
automatically"`) since every store's `STORE` account is created once, at Setup Wizard
time — the web only shows the Add button on the other four tabs for that reason.

## POS (`src/routes/pos.routes.ts`)

`GET /lookup?code=` exact SKU match. `GET /inventory-search?q=&category=&size=&brand=`
fuzzy search over `AVAILABLE` items only (the "tagless item" modal). `POST /checkout`
creates one `Sale` per cart line, flips items to `SOLD`, credits the owning account's
balance by its `splitPercent` — skipped for `DONOR`/`STORE` accounts (no payouts owed).

## Reports (`src/routes/reports.routes.ts`)

Aggregates computed live from Prisma, not cached. `localDateKey()` buckets by the
server's **local** calendar day consistently for both range boundaries and bucket
keys — see root `CLAUDE.md`'s gotcha list for why this matters.

## Adapters (`src/adapters/`) — all stubs, all swappable

`printer.ts` (writes rendered tag tickets to a print-jobs dir instead of talking ZPL/
ESC/POS to a real label printer — see "Ticket printing" above), `cv.ts` (canned brand/
category suggestions), `email.ts` (logs instead of sending), `cloudSync.ts` (stamps
`Heartbeat.lastSyncedAt` locally instead of pushing to Azure/DO). Each keeps the
interface a real integration would use.

## Packaging (`scripts/build-linux.sh`, see root `CLAUDE.md` for the two gotchas)

Compiles server + web, copies web's `dist/` into `server/public/` (served by
`index.ts` when `public/index.html` exists — a no-op in normal dev), bakes a fresh
migrated-empty `prisma/template.db`, then runs `@yao-pkg/pkg` targeting
`node22-linux-x64`. Needs a Node ≥20 runtime just to *run* the packager
(auto-downloaded to `.build-tools/`, gitignored) — unrelated to the app's own Node
18 runtime target or the executable's bundled Node 22.

`scripts/build-windows.sh` is the same pipeline cross-targeting `node22-win-x64`
(pkg fetches the target Node build rather than compiling one, so this runs fine from
Linux). Requires `prisma/schema.prisma`'s `generator client` to include `"windows"`
in `binaryTargets` so the Windows query engine `.node` binary gets fetched into
`node_modules/.prisma/client/` and picked up by the same `pkg.assets` glob that
already grabs the native one. `index.ts` prints the resolved DB/config paths and
auto-opens the default browser only when `isPackaged && process.platform ===
"win32"` (exported from `bootstrap.ts`) — the Linux binary keeps letting `install.sh`
do that instead.

Because a double-clicked Windows console app's window closes the instant it exits, a
fast crash is otherwise invisible: `bootstrap.ts` registers `uncaughtException`/
`unhandledRejection` handlers (win32-packaged only, before any other import) that
append the error to `teabox-error.log` next to the exe (or `%TEMP%` if that folder
isn't writable) and then run the OS's own `pause` before exiting, so the window stays
up. `index.ts`'s `server.on("error", ...)` adds one specific, friendlier message on
top of that for `EADDRINUSE` — by far the most likely cause on a repeated test-deploy
attempt (a previous run still holding the port). Neither of these fires on the Linux
binary.

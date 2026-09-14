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
- `Item` — `accountId` is **required** (no intake without an account). `status ∈ {PENDING, AVAILABLE, SOLD, DONATED, DISPOSED, RETURNED}`. `cost` (acquisition cost basis) has **no current write path**, same as `consignmentType`.
- `ItemHistory`, `Photo`, `Sale`, `Payout`, `Device`, `Heartbeat` — as named.
- `AuditLog` — records `activeRole` alongside `performedById`, not just the user (security-doc requirement: interpret actions strictly in the role that performed them).

## Auth flow (`src/routes/auth.routes.ts`, `src/services/auth.service.ts`)

`POST /login` → 1 role: issues token immediately. >1 role: returns the role list, no
token (drives the login page's role picker). `POST /select-role` (public, second
step) / `POST /switch-role` (authenticated) both re-validate the user actually holds
`(role, storeId)` via `UserRole` before signing a new JWT — a session can never talk
itself into an ungranted role. `GET /me` returns the decoded session + fresh role list.

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

`printer.ts` (writes a rendered ESC/POS-style ticket to a print-jobs dir instead of a
real Epson socket), `cv.ts` (canned brand/category suggestions), `email.ts` (logs
instead of sending), `cloudSync.ts` (stamps `Heartbeat.lastSyncedAt` locally instead
of pushing to Azure/DO). Each keeps the interface a real integration would use.

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

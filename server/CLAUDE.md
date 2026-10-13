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

- `User` — auth identity only (email/passwordHash/name, plus `badgeCodeHash`/`badgeIssuedAt` for sign-in-sheet badges — see "Sign-in-sheet badges" below). Never carries roles directly.
- `UserRole` — `(userId, role, storeId, accountId?)`. One row per role a person holds; a user with both `MANAGER` and `CONSIGNOR` rows still only acts as one per session. `accountId` set for account-scoped roles (Consignor/Vendor/Donor/Booth Owner) — links the grant to the `Account` it acts on.
- `Store` — one per shop. `itemPrefix`/`itemStartNumber` drive new item tags (see "Barcode values").
- `Account` — polymorphic party items/payouts attach to: `accountType ∈ {CONSIGNOR, VENDOR, DONOR, BOOTH_OWNER, STORE}`. Every store has exactly one `STORE`-type account (store-owned inventory) so intake always has a target. `isStoreAccount` flags *additional* store-owned accounts (a shop's per-year "2019 Inventory" buckets, kept separate for their history) under an ordinary `CONSIGNOR`/`VENDOR`/`BOOTH_OWNER` type. **`isBalanceBearing()` (`src/services/accounts.service.ts`) is the one rule for "is this account owed money"** — balance-bearing type *and* not flagged; checkout credits, payouts, `serializeAccount()`'s balance stripping (Donor/Store/flagged — removed from the API response, not just hidden in the UI) and the dashboard's pending-payout total (`BALANCE_BEARING_WHERE`) all use it. Don't test `BALANCE_BEARING_ACCOUNT_TYPES` alone. `isActive` = dormant flag (see "Active flag" under Accounts). `lastSaleAt` is denormalized (see Accounts). `mailingAddress` (free text, like `Store.location`) and `paymentMethod` have **no current write path** — populated only by direct SQL (e.g. a migration), not reachable via any route or UI today.
- `Item` — `accountId` is **required** (no intake without an account). `status ∈ {PENDING, AVAILABLE, SOLD, DONATED, DISPOSED, RETURNED}`. `cost` (acquisition cost basis) has **no current write path**, same as `consignmentType`. `sku` is also the barcode value (see below) — POS scan lookup, the printed tag, and the web `Barcode` component all key off it. `itemNumber` (`@@unique([storeId, itemNumber])`) is the number encoded in `sku` — see "Barcode values" for the invariant. `soldAt`/`paidOutAt` are denormalized latest sale/payout dates for list sorting (see "Item lists").
- `ItemHistory`, `Photo`, `Sale`, `Device`, `Heartbeat` — as named.
- `Payout` — `payoutNumber` is the human-facing "Payout #" (migrated payouts keep the source system's number; new ones `nextPayoutNumber()`).
- `PayoutLine` — itemization of a `Payout`; a `Sale` with a line counts as paid out. See "Accounts" below.
- `Sale.transactionId` — the ticket (one checkout); see "POS" and "Reports".
- `PrintJob` / `PrintJobItem` — every tag print run plus a snapshot of each tag; see "Ticket printing".
- `Item.consignorPercent` (per-item split, overrides `Account.splitPercent`), `donateIfUnsold`, `tagPrintedAt` and the `audit*` columns; `Account.legacyId` (`"liberty:<CLIENT_ID>"`); `Payout.method`/`checkNumber` — see "Inventory Audit".
- `AuditLog` — records `activeRole` alongside `performedById`, not just the user (security-doc requirement: interpret actions strictly in the role that performed them).

## Auth flow (`src/routes/auth.routes.ts`, `src/services/auth.service.ts`)

`POST /login` → 1 role: issues token immediately. >1 role: returns the role list plus
a **role-selection ticket** — no session token, and deliberately no `userId` (drives
the login page's role picker). `POST /select-role { ticket, role, storeId }` (public,
second step) takes the user **only** from that ticket; `POST /switch-role`
(authenticated) takes it from the current session. Both then re-validate the user
actually holds `(role, storeId)` via `UserRole` before signing a new JWT — a session
can never talk itself into an ungranted role. `GET /me` returns the decoded session +
fresh role list.

Why the ticket: a user's cuid is not a secret (it's in `/me`, `/settings/users`, and
other payloads), so a `/select-role` that trusted a body `userId` let anyone mint a
session as any multi-role user without their password. The ticket
(`signRoleSelectionTicket`/`verifyRoleSelectionTicket` in `lib/jwt.ts`) is a 5-minute
JWT signed with the same secret as sessions, distinguished by a `typ` claim:
sessions carry `typ: "session"`, tickets `typ: "role-selection"`, and each verifier
rejects the other's — so `authenticate`/`verifySession` never accept a ticket as a
session (and a session can't be replayed as a ticket). Don't add a `userId` field
back to `/select-role`. An expired ticket 401s; the web client drops back to the
password form. (Adding the `typ` check invalidated any pre-existing session tokens,
which lacked it — a one-time re-login.)

`/login` and `/select-role` are both rate-limited (`express-rate-limit`, 20 requests /
15 min / IP — see `credentialLimiter` in `auth.routes.ts`) since they're the two
pre-auth, credential-adjacent endpoints. The JWT itself is signed with `JWT_SECRET`
if set, else (packaged installs only) a random secret `bootstrap.ts` generates on
first run and persists as a `jwt-secret` file next to the database — never the
hardcoded fallback string in `lib/jwt.ts`, which only a plain `npm run dev` actually
uses. See root `CLAUDE.md`'s "Roadmap toward a real commercial deployment" for the
rest of the hardening pass this came out of (host binding, helmet, CORS).

## Sign-in-sheet badges (`src/services/badge.service.ts`)

Scan-to-login codes printed on Reports > Employee Sign-In Sheet. `POST
/auth/badge-login { code, role?, storeId? }` mirrors `/login`'s two-step shape, but the
role-choice step re-sends the **code** rather than going through `/select-role`, so
both steps prove possession of the credential. Rules that make a paper credential
acceptable:
- Only `BADGE_ROLES` (`MANAGER`, `EMPLOYEE`, `REGISTER`) can be entered via badge —
  Owner/Admin and account-scoped roles always need a password, even for a person who
  also holds a badge role (Sarah's badge signs in as Manager only, never Consignor).
  Because Manager is the ceiling, every session allowed to issue badges already
  outranks what a badge unlocks; adding `OWNER` to the list would need an issuer-rank
  check too.
- Codes are `TBXB-` + 20 uppercase Crockford-base32 chars (100 random bits, distinct
  from item SKUs, uppercase so HID scanners/Caps Lock can't mangle them). Only a
  SHA-256 is stored (`User.badgeCodeHash`, unique) — the plaintext is returned once
  by `POST /reports/sign-in-sheet/issue`, so printing a sheet **rotates** those
  users' codes and a lost sheet is handled by reprinting or revoking
  (`DELETE /reports/sign-in-sheet/:userId`). Issue/revoke are audited
  (`ISSUE_BADGE`/`REVOKE_BADGE`) and scoped to users with a badge role at the
  session's store.
- `/badge-login` has its own looser limiter (200/15 min) than `credentialLimiter`:
  with the default `127.0.0.1` bind every register shares one IP, and a shift of
  badge logins would trip 20/15 min; 100-bit codes don't need the tighter limit.

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

`formatBarcode(prefix, itemNumber)` → `` `${prefix}-${itemNumber padded to 6}` ``
(e.g. `HT-2000000`), used as `Item.sku` (also the value rendered as a real Code128
barcode by the web `Barcode` component, and what POS scan lookup matches against). The
prefix is the store's `Store.itemPrefix` (1–8 uppercase letters/digits,
`ITEM_PREFIX_PATTERN`). `nextItemIdentity()` (`services/items.service.ts`) picks the
number: **one past the store's highest `itemNumber`, never below
`Store.itemStartNumber`**, inside the intake handler's `prisma.$transaction` (SQLite
serializes writer transactions, so read-then-create is race-free without a DB
sequence).

**Invariant: every SKU encodes its own item's `itemNumber`** — that's what makes max + 1
collision-free under any prefix, including migrated ones (Liberty items keep
`LIB-<ITEM_ID>` with `itemNumber = ITEM_ID`; Teabox pads to 6 digits, Liberty doesn't).
Any path that creates items must keep it (`liberty-etl`'s `npm run validate` checks it).
Numbers are *not* gapless and lowering `itemStartNumber` can't move numbering backwards.
Prefix/start are set at setup (wizard fields, or `SETUP_ITEM_PREFIX`/`SETUP_ITEM_START`
in `config.env`), by a migration (`liberty-etl`'s `store.yaml` `items:`), or later in
Settings > Store (`GET/PUT /settings/store`: view Manager+, edit Owner/Admin, audited
`UPDATE_ITEM_NUMBERING`; the GET includes a `nextSku` preview). History: this replaced
`${storeId}-${count + 1}` (2026-10-11), which replaced an earlier
`generateSku(category)`.

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

`print-batch` takes `{ itemIds: string[], source?: "INTAKE" | "ITEM" }`, re-reads those
items from the DB (never trusts client-supplied ticket text — a tampered
price/description can't reach the printer that way), and applies the same
staff-or-own-account authorization check as `GET /:id` (`loadPrintableItems()`) — a
Consignor/Booth Owner may only print tags for their own items.

**Every print goes through `printItemsAsJob()`** (`src/services/printJobs.service.ts`):
it calls `printTagBatch()`, stamps `Item.tagPrintedAt`, and records one `PrintJob` (who, active role, `source`) with a
`PrintJobItem` per tag snapshotting sku/description/price/category/size as printed,
plus one `PRINT_TAG` audit entry per item (carrying `printJobId`). That's what Reports >
Print Queues browses and reprints (`GET /reports/print-jobs`, `GET /reports/print-jobs/:id`,
`POST /reports/print-jobs/:id/reprint { printJobItemIds? }`, Manager+). A reprint is a
new job (`source: "REPRINT"`, `reprintOfId`) built from the items' *current* data;
lines whose item was deleted are skipped (`PrintJobItem.itemId` is `SET NULL` on item
delete; the snapshot stays). Any new printing path must use `printItemsAsJob()` so the
run is retrievable. Prints from before print queues existed were backfilled from their
`PRINT_TAG` audit rows by the `reporting_suite` migration, one single-tag job each.

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

`GET /` returns every account of a type at once (no paging) — the web filters/sorts
client-side. It includes `lastSaleAt`, a **denormalized** column POS checkout stamps
on every sale: computing `MAX(saleDate)` per account live took ~8s even indexed at
~850k sales (consignors own nearly every item), so don't "simplify" it back into a
query. Anything that inserts `Sale` rows outside checkout (seed, migrations) must
backfill it — the `20261010221750` migration's `UPDATE` is the canonical statement.

**Payout itemization.** `PayoutLine` records what each payout covered (signed
`amount`, `lineType ∈ PAYOUT_LINE_TYPES`, optional `itemId`/`saleId`).
`GET /:id/payouts/:payoutId` returns one payout with its lines + item + sale. Staff
`POST /:id/payouts` goes through `generatePaidPayout()` (`services/accounts.service.ts`),
which writes a `SALE` line per **unpaid** sale — no `PayoutLine` yet *and* sold after
the account's latest `PAID` payout (the date floor stops migrated sales that the old
system never itemized from being swept into a new check) — plus one `ADJUSTMENT` line
for whatever part of `currentBalance` those don't explain, so lines always sum to the
amount. `consignorShareOf()` there is the one split formula, shared with checkout.
`POST /me/payouts` (consignor *request*) writes no lines; nothing approves/pays a
`REQUESTED` payout yet. Every payout gets a `payoutNumber` (the human-facing
"Payout #"; migrated ones keep the source system's number) from `nextPayoutNumber()`
inside the creating transaction — any new payout-creating path must do the same.

**Active flag.** `Account.isActive` (default true; Liberty migrates its one genuinely
inactive client). Inactive = dormant: `GET /` filters `?status=active` by default
(`inactive`/`all` on request — and every account picker calls `GET /`, so pickers only
offer active accounts); the dashboard's pending-payout total counts active accounts only; intake (`resolveIntakeAccountId`) and moving an item
(`PATCH /items/:id`) to an inactive account are refused (400) — reactivating is a
deliberate step. The balance itself is untouched, POS still credits it, and it can still
be paid out. Toggled by `PATCH /:id { isActive }` (Owner/Manager/Admin, audited
`DEACTIVATE`/`REACTIVATE`); never on the built-in STORE account. In bulk by
`POST /bulk-status { accountIds, isActive }` (same roles/rules; STORE skipped; ids from
another store refuse the whole request; one audit entry per changed account via
`recordAuditMany`, details `{ bulk: true }`). `GET /` also returns `lastIntakeAt` and
`lastActivityAt` (latest intake/sale/payout) — the intake MAX is a correlated subquery on
the `(accountId, intakeDate)` index (~30ms; `groupBy` over Item was ~1.3s).

**Store-account flag.** `GET /?accountType=STORE` (the Store tab) returns the built-in
`STORE` account plus every `isStoreAccount` account; any other `accountType` excludes
flagged ones. `PATCH /:id { isStoreAccount }` (Owner/Manager/Admin, audited
`FLAG_STORE_ACCOUNT`/`UNFLAG_STORE_ACCOUNT`) toggles it — only on balance-bearing
types, and flagging is **refused (409) while `currentBalance` ≠ 0**: going from "we
owe $X" to "nobody is owed anything" must go through a payout, not a checkbox. A
flagged account keeps its historical payouts (`GET /:id` returns payouts for every
account).

**Item lists** (`services/itemList.service.ts`): one filtered/sorted/paged query behind
both the Inventory page (`GET /items/browse`, whole store) and an account's Items table
(`GET /accounts/:id/items`, same query scoped to the account), with one shared
query-string parser (`itemListQuerySchema`: `q`, `status`, `category`, `sold`,
`paid`, `payout`, `createdFrom/To`, `soldFrom/To`, `paidFrom/To` as epoch ms, `sort`,
`dir`, `page`, `pageSize`). Sale/payout dates sort and filter through the
**denormalized `Item.soldAt` / `Item.paidOutAt`** (stamped by POS checkout and
`generatePaidPayout()`; anything inserting sales/payout lines another way must run the
`add_item_sold_paid_dates` migration's backfill SQL) with `(storeId, …)` and
`(accountId, …)` indexes — computing them live was ~7s store-wide. Sorting by those
dates pages two segments (dated rows, then undated) instead of `NULLS LAST`, which
defeats the index (~1s vs ~150ms on ~900k items). Only the per-row payout *number* is
looked up, for the returned page. "Created" is `intakeDate` (a migrated item's
`createdAt` is the migration day). `GET /items/categories` feeds the Inventory
category dropdown. `GET /items` (plain array, capped) stays for Booth Owner Pricing.
`GET /accounts/:id` returns only `itemCount` and `payoutCount` — no items or payouts.

**Account payouts** (`GET /:id/payouts?q=&from=&to=&page=&pageSize=`, default 5 per page,
newest first): `q` keeps payouts containing an item whose description includes it, and
each row reports `matchCount` of `itemCount`. The search first collects matching payout
ids with one raw join scoped to the account — Prisma's `lines: { some: { item: ... } }`
scanned every `PayoutLine` in the store (~7s on migrated data) — and leans on
`Payout @@index([accountId, createdAt])`; ~100ms for the busiest migrated consignor.

## Inventory Audit (`src/routes/audit.routes.ts`, `src/services/inventoryAudit.service.ts`)

Explorer over the store's active items (`AVAILABLE`/`PENDING`, ~22k on the real DB).
Each item gets derived dimensions computed as SQL `CASE` expressions over `Item ⋈
Account` (`DIMENSIONS`: `expired`, `age`, `owner`, `accountStatus`, `ownerLastSale`,
`tagged`, `donate`, `split`, `category`, `price`, `status`, `label`); one query string
param per dimension filters (`?age=1-3y,3y%2B`). Measures: count, retail (`price`),
consignor share (`price × effective split`, 0 for store-owned accounts), store share.
Effective split = `item.consignorPercent ?? account.splitPercent ?? 100` — the
checkout rule. `CONSIGNMENT_DAYS = 90` (Hidden Treasures' policy) drives "expired".
Raw queries number their params (`?1` = now, `?2` = storeId); aggregates go through
`Number()` (SQLite returns integer sums as BigInt, which crashes `res.json`).

- `GET /summary?groupBy=` — totals (all filters), the pivot (**faceted**: ignores the
  grouped dimension's own filter so all its values stay selectable), and label progress
  over the whole active set. ~100ms.
- `GET /items` — paged rows (`sort` intake/price/sku/account/category).
- `POST /label { label|null, itemIds | filters }` — sets/clears `auditLabel` on items
  not yet applied; one summary `AUDIT_LABEL` audit entry (labels are working notes).
- `POST /apply { label }` (**Owner/Admin**) — applies every pending item with that label:
  `EXPIRED_TO_STORE` moves it to the store's built-in `STORE` account (stays on the
  floor), `DONATE`/`RETURN`/`WRITE_OFF` set `DONATED`/`RETURNED`/`DISPOSED`; `KEEP` is a
  no-op. Stamps `auditAppliedAt`; per item an `ItemHistory` entry and an audit entry.
- `GET /obligations` — positive/negative balances (balance-bearing accounts), aged by
  last intake/sale/payout, top 50, all negatives, and floor value by owner.

Labels: `AUDIT_LABELS` in `lib/enums.ts`. Everything is Manager+ except apply.

## Item edit / delete (`src/routes/items.routes.ts`)

`PATCH /items/:id` (staff) edits any subset of an item's fields and records each change
in its history the way the dedicated routes do — `PRICE_CHANGE`, `STATUS_CHANGE`, plus
one `EDIT` entry listing other changed fields (`brand: — → Pyrex; account: A → B`) — and
one `EDIT` audit entry with full before/after. Rules: price fields and `accountId` need
Manager+ (same split as `PUT /:id/price`); `SOLD` can't be set by hand (only POS
checkout records a sale); a `SOLD` item's price, status and account are frozen (409) —
its `Sale` and the account credit were recorded against them — but its descriptive
fields stay editable. Moving an unsold item between accounts is safe because balances
are only credited at sale time.

`DELETE /items/:id` (Manager+) hard-deletes the item with its history and photos, for
mistaken/duplicate intakes, and is **refused (409) once the item has any `Sale` or
`PayoutLine`** — mark it `DISPOSED` instead. The `DELETE` audit entry keeps a snapshot.
`GET /items/:id` includes `sales` and `_count.payoutLines` so the page knows these
limits up front.

## POS (`src/routes/pos.routes.ts`)

`GET /lookup?code=` exact SKU match. `GET /inventory-search?q=&category=&size=&brand=`
fuzzy search over `AVAILABLE` items only (the "tagless item" modal). `POST /checkout`
creates one `Sale` per cart line, flips items to `SOLD` (stamping `Item.soldAt`), stamps
`Account.lastSaleAt`, and credits the owning account's balance by `consignorShareOf()` —
only when `isBalanceBearing()` (so not Donor/Store/store-flagged accounts). Inactive
accounts are still credited: money owed is real even on a dormant account. Every line
of one checkout shares a `transactionId` (UUID) and one `saleDate`, so reports count
tickets, not lines. The credit uses the item's own split when it has one
(`item.consignorPercent ?? account.splitPercent` — migrated Liberty items carry one; an
item at 0% credits nothing), and `generatePaidPayout()` itemizes with the same rule.

## Reports (`src/routes/reports.routes.ts`)

Aggregates computed live, not cached; logic in `src/services/salesReport.service.ts`.
All day boundaries are the server's **local** calendar day (`localDateKey()`,
`parseLocalDate()`, `addDays()` via `setDate`, never ms arithmetic or `toISOString()`)
— see root `CLAUDE.md`'s gotcha list. Raw queries bind `getTime()` (Prisma stores
SQLite DateTimes as integer epoch ms). Manager/Owner/Admin only.

- `GET /sales-summary?date=&days=` — `periods` (day / week-to-date, Sunday start /
  year-to-date, each `{ current, lastYear }` Metrics) plus a `days`-long `ledger`
  (7/14/30/60/90), each row with its YoY comparable. **YoY = same weekday 52 weeks
  back (364 days)** for day/week/ledger; YTD compares Jan 1 → same calendar date last
  year. Metrics: `transactions` (`COUNT(DISTINCT COALESCE(transactionId, id))`),
  `itemsSold`, `grossSales`, `inventoryAdded`/`itemsAdded` (tag value `Item.price` by
  `intakeDate`), `payouts`/`payoutCount` (`PAID` payouts by `paidAt`). ~1s on the real
  DB (YTD aggregates over ~40k rows each; `Payout @@index([paidAt])`).
  `/sales-summary/export.csv` = the ledger with `ly_` columns.
- `GET /day-detail?date=` — the day's metrics plus every sale (with `transactionId`),
  intake, `PRICE_CHANGE` history entry (`ItemHistory @@index([timestamp])`), print job
  and paid payout. Lists cap at 1000 rows and report `total` (migrated bulk-intake days).
- Print queues — see "Ticket printing" above.

Liberty-era transactions are nightly *posting batches* (the owner keys the day's paper
tickets into Liberty each evening), so their `transactionId` groups aren't checkouts
and their times are posting times; the UI says so. `/inventory-aging` and `/payouts`
(Consignor Payout Statements) were removed 2026-10-12. Also hosts the
sign-in-sheet badge endpoints (`/sign-in-sheet`, `/sign-in-sheet/issue`,
`/sign-in-sheet/:userId`) — see "Sign-in-sheet badges" above.

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

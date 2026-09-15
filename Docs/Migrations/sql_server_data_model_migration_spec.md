<!-- migration-spec-freshness: schema.prisma=31546296 enums.ts=0661a0ed -->
# Teabox ERP — Data Model Migration Spec (SQL Server source)

Status: **living document**. Update this file whenever the Prisma schema
(`server/prisma/schema.prisma`), the enum source of truth (`server/src/lib/enums.ts`),
or a route's write-path validation changes in a way that affects what a migration
script must produce. This is the spec for moving an existing consignment shop's data
*into* Teabox from another system — not a description of Teabox's own internals (see
root `CLAUDE.md` and `server/CLAUDE.md` for that).

First target source system: **Liberty by ResaleWorld** (confirmed — see §3.1 for the
product profile, confirmed import/export field layouts, and Liberty-specific
capability gaps). Liberty is SQL-Server-backed, so the generic type crosswalk (§6) and
identity notes (§7) below apply directly; everything else in this document is also
written generically enough to extend to another relational consignment/POS package
later (ConsignPro, SimpleConsign, Cashier's Toolbox, Rain POS, a bespoke in-house
schema, etc.), but §3.1's specifics are Liberty-only.

## 0. How to use this document

For each Teabox entity below: read the "Migration guidance" subsection before writing
any transform. It calls out (a) invariants the target schema enforces that the source
probably doesn't, (b) fields with no current write path in the live app (dead columns
you're free to populate directly via SQL since no API validates them), and (c) known
semantic traps specific to consignment data (split-percent direction, balance
reconciliation, timezone-sensitive dates).

This is a **spec**, not a script. It tells a migration engineer what target shape to
produce; it deliberately does not assume a specific ETL tool (SSIS, a Node script
against Prisma Client, `sqlcmd` + `sqlite3` CLI, etc.).

## 1. Scope & assumptions

- Target is the schema in `server/prisma/schema.prisma`, SQLite-backed as shipped (see
  that file's header comment for the Postgres swap path — irrelevant to this doc,
  since the *target* column types are identical either way; Prisma abstracts it).
- One Teabox database = one shop's full operating history (users, accounts, inventory,
  sales, payouts). There is no cross-store data sharing at the schema level currently
  exercised (see §2).
- This doc covers **structural/type migration** — mapping source rows to target rows
  faithfully. It does not cover UI/workflow retraining, hardware re-pairing (`Device`
  rows are local pairing state, not migratable data — see §4.10), or historical report
  parity testing (the reports in `server/src/routes/reports.routes.ts` are computed
  live from `Sale`/`Item`/`Account`, so once those three migrate correctly, reports
  follow automatically).

## 2. Migration unit: what one Teabox install represents

The `Store` model is technically capable of holding multiple stores in one database
(`UserRole`, `Account`, `Item`, `Device`, `Heartbeat` all key off `storeId`), but
**no shipped UI lets a session operate against more than one store** — a session's JWT
carries exactly one `storeId` (`SessionClaims.storeId` in `server/src/lib/jwt.ts`), and
nothing lets a user switch stores the way "Switch Role" switches roles. Treat each
legacy shop *location* as its own Teabox `Store` row and, in the current build, plan
for **one Teabox install (one SQLite file) per physical shop location** unless/until a
store-switching UI is built. If the source system already handles multiple locations
in one database, split it into one target load per location — don't merge multi-store
source data into a single `Store` row and rely on `accountId`/`storeId` filtering to
keep them apart; the app has never been exercised that way.

## 3. Enum crosswalks

SQLite has no native enum type, so every "enum" below is a plain string column,
validated only at the API/service layer against the arrays in `server/src/lib/enums.ts`
— **not** by a DB constraint. A migration that writes directly to the SQLite file
(bypassing the API) can insert any string; it just won't be recognized by the app if
it doesn't exactly match one of these (case-sensitive):

| Teabox set | Values | Source (`enums.ts`) |
|---|---|---|
| `Role` | `SYSTEM_ADMIN`, `OWNER`, `MANAGER`, `EMPLOYEE`, `REGISTER`, `CONSIGNOR`, `VENDOR`, `DONOR`, `BOOTH_OWNER` | `ROLES` |
| `AccountType` | `CONSIGNOR`, `VENDOR`, `DONOR`, `BOOTH_OWNER`, `STORE` | `ACCOUNT_TYPES` |
| `ItemStatus` | `PENDING`, `AVAILABLE`, `SOLD`, `DONATED`, `DISPOSED`, `RETURNED` | `ITEM_STATUSES` |
| `PayoutStatus` | `REQUESTED`, `APPROVED`, `PAID`, `REJECTED` | `PAYOUT_STATUSES` |
| Balance-bearing account types | `CONSIGNOR`, `VENDOR`, `BOOTH_OWNER` (never `DONOR`/`STORE`) | `BALANCE_BEARING_ACCOUNT_TYPES` |

Build an explicit **crosswalk table** (source value → Teabox value) for every one of
these before transforming a single row — do not assume the source uses the same
words. Common mismatches to expect from a legacy consignment schema:

- Source systems frequently model "Vendor" and "Consignor" as the same underlying
  concept with a type flag, or don't distinguish `VENDOR` from `CONSIGNOR` at all
  (Teabox does — different `AccountType`, same `splitPercent`/balance mechanics).
  Decide the mapping with the shop owner, not by guessing from column names.
- "Booth rental" shops (antique malls, vendor malls) often track booth number as a
  free-text field on a generic vendor table rather than a distinct entity — these map
  to `BOOTH_OWNER` accounts, with the booth number/name going into `Account.name`
  (e.g. seed data's `"Vintage Vinyls (Booth #402)"` pattern).
  `Item.consignmentType` (a free-text field, see §4.5) is a reasonable place to
  preserve the source system's original deal-type label per item even after the
  account-level mapping is done.
- A source "Employee" or "Cashier" role with an `IsAdmin`/`IsManager` bit column
  should split into distinct `Role` values per the bit combination — see §7.1, this is
  the same shape problem as passwords: one source row can imply multiple target rows.
- `DONATED`/`DISPOSED`/`RETURNED` item statuses often don't exist as first-class
  states in simpler POS schemas (just "sold" vs "not sold", maybe a `deleted` flag).
  Map "written off"/"trashed" → `DISPOSED`, "given to charity" → `DONATED`,
  "consignor took it back" → `RETURNED`, and default anything ambiguous to `PENDING`
  (never silently to `AVAILABLE` — see §5's `PENDING` note).

## 3.1 Liberty by ResaleWorld — confirmed source profile (Hidden Treasures, Kirksville MO)

**Status: confirmed by direct inspection of the real database**, not just
ResaleWorld's public docs. See the history note at the end of this section for how we
got here — the short version is the client's first backup was an unrelated, unusable
20-year-old archive; the second one restored cleanly. It went into the dockerized SQL
Server instance at `/home/crow/code/fetters/db-analysis`, and
`Docs/Migrations/liberty-etl/scripts/profile.ts` profiled the live schema: **161
tables, 111 populated**. Everything below supersedes the previous speculative mapping
in this section — treat it as ground truth for **this specific shop's install**, not
a general Liberty schema (ResaleWorld still publishes none).

This shop: **"Hidden Treasures"**, Kirksville, MO (`STORE` table, 1 row) — a
single-operator resale shop. `STORE_USER` has exactly two logins: the owner (`Sherry
Stacey`, `SECURITY_LEVEL 10`) and a generic `RWD`/"System Account" placeholder
(`SECURITY_LEVEL 1`) used for old bulk-imported rows, not a second real person. **No
Consignor Center / self-service login table exists anywhere in the 111 populated
tables** — resolves the old open question: this shop's consignors have no login
today, so only `Account` rows are needed for them, no `User`/`UserRole` rows, and
§7.2's password-migration problem doesn't apply to that population at all.

If a future migration targets a shop without a restorable backup, `RECOMMENDED
EXTRACTION PATH (fallback)` below (Liberty's own CSV import/export utilities) is still
the right default — it just wasn't needed here once the real backup restored.

### A pattern to design the whole transform around: free-text fields double as sticky notes

Several columns that look structured are actually used by the owner as an ad hoc
scratchpad — worth calling out because it recurs, not just as isolated examples:

- `CLIENT.WEBSITE` (documented as a URL field) holds, on at least one row, a
  handwritten note about a corrected payout (`"12-12-03 credited payout to Sister,
  item #15,16,&17 Holly was paid for and wasn't..."`).
- `CLIENT.COMPANY_NAME` regularly holds fee-waiver/status notes instead of a company
  name: `"PD 10"`, `"waived 16"`, `"DO NOT ADD INVENTORY IN THIS ACCOUNT"`, `"USE THIS
  ACCOUNT"`.
- `ADDRESS.ADDRESS_3` (nominally a 3rd address line) holds things like `"no
  contract"`, `"locating contract"`.

Don't build heuristics that assume a field means what its name says without a human
(ideally the shop owner) confirming the specific row — this shows up below in the
`CLIENT_TYPE_ID = 3` bucket, which is the clearest case of it.

### `CLIENT` (3,439 rows) → `Account`

`CLIENT_TYPE` has exactly 3 values: `Client` (1,969 of a 2,000-row sample — ordinary
consignors → `CONSIGNOR`), `Retail Vendor` (30 → `VENDOR`), `Store Account` (nominally
1 meaning, but **used on ~46 real rows with at least 3 different real meanings** — see
below). **No Liberty concept here maps to `DONOR` or `BOOTH_OWNER`** — this shop
doesn't use either; item-level donation is tracked via `ITEM.DONATE_IND`/`ITEM_STATUS`
instead (see the `ITEM` section), confirming §3's general guidance not to force a
`DONOR` account type where the source only has an item-level flag.

- `FIRST_NAME` + `LAST_NAME` (or `COMPANY_NAME`, when it's genuinely a company and not
  a sticky note) → `Account.name`.
- `PHONE`/`EMAIL`/`ADDRESS` are **separate child tables** keyed by `CLIENT_ID`, each
  with a `PRIMARY_IND` flag and multiple rows per client (e.g. Home/Cell/Work phone) —
  take the `PRIMARY_IND = 1` row for `Account.phone`/`Account.email`; secondary rows
  are lost on migration (minor, matches `Account` only having one of each field).
- `ADDRESS` (3,442 rows, ~1:1 with `CLIENT`) is real, structured, and populated
  (`ADDRESS_1/2/3`, `CITY`, `STATE`, `ZIP`) — **confirms the mailing-address gap this
  spec already flagged is real**. Added `Account.mailingAddress` (free text,
  concatenated from these columns) to `schema.prisma` — same convention as
  `Store.location`, no write path yet (matches `paymentMethod`'s existing precedent).
- `PAYMENT_ACT` (3 rows: `Check`, `Cash`, `Reconciliation`), referenced by
  `CLIENT.PAYMENT_ACT_ID` and `PAYOUT.PAYMENT_ACT_ID`, → `Account.paymentMethod`'s JSON
  blob (no write path yet, same as the address field).
- **No `currentBalance` column exists anywhere on `CLIENT`.** Liberty computes
  balance-owed live from the `CLIENT_TRANS` ledger (see below) — there's no cached
  "current balance" field to read directly. §5's reconciliation formula becomes:
  `Account.currentBalance = SUM(CLIENT_TRANS.ACT_TRANS_AMT)` for that `CLIENT_ID`,
  **restricted to rows whose `TRANS_CD.PAYABLE_IND = 1`** (excludes `-1`/pending and
  `0`/non-cash rows — see the `CLIENT_TRANS`/`TRANS_CD` section below).
- `NEXT_ITEM_NUM` confirms Liberty's item numbers are account-scoped, not shop-wide
  unique, exactly as this spec already warned generically (see the `ITEM`/SKU note).

**Data-quality landmine found by spot-checking, not by trusting the schema**:
`CLIENT_ID 101508` (`"HIDDEN TREASURES 2004"` / `"2004 Inventory"`, tagged
`CLIENT_TYPE_ID = 1`, i.e. an ordinary `Client`) sums to a `CLIENT_TRANS` balance of
**~$2,000,030,228** — obviously corrupted. Exclude this account from balance migration
and investigate its transaction history separately; don't let one bad row's `SUM()`
poison a report or a payout.

### The `CLIENT_TYPE_ID = 3` ("Store Account") bucket is not one thing

Querying every row tagged `CLIENT_TYPE_ID = 3` (~46 rows) surfaces at least three
different real-world meanings sharing one type code:

1. **Year-named store-inventory placeholders** — `"2006 Inventory"`, `"2007
   Inventory"` … through `"2035 Inventory"` (even future-dated), mostly
   `LAST_NAME = "Hidden Treasures"`. Read as an annual bucket for store-owned stock;
   should consolidate into Teabox's single `STORE`-type `Account`, not become 40+
   separate zero-balance `STORE` accounts.
2. **Real wholesale/vendor product lines** — `"Laser Pegs"`, `"Delton Products
   Corp"`, `"Mosser Glass Inc"` — read as genuine `VENDOR` accounts despite sharing
   the same type code.
3. **Real individual people with a note in `COMPANY_NAME`** — `"Betty McLane-Iles"`
   (`"DEC 2010"`), `"Marlin \"Sparky\" Wenger"` (`"waived 16"`), `"Lisa Salter"`
   (`"Pd-09 Sister can pick up $"`) — read as ordinary consignors the owner flagged
   with a fee-waiver or one-off note, not store-owned inventory at all.

Collapsing all of these to `STORE` would misattribute real vendor and consignor
relationships (and their money) to the shop itself. **This needs the shop owner's
read on each name, not an inferred heuristic** (per the pattern noted above) — see the
open questions at the end of this document.

### `ITEM` (771,073 rows) / `CLIENT_ITEM` (431,231 rows) → `Item`

- `ITEM.ITEM_ACQUISITION_TYPE_ID` (`Store Owned`/`Purchase`/`Consign`/`Trade`) **looks
  like the authoritative acquisition-type field but isn't for the Store-Owned/Consign
  split** — checked against the full table, not a sample: 767,811 of 771,073 items
  (99.6%) are `1` (`Store Owned`), and `Consign` (`3`) is never used at all — this
  can't be right for a consignment shop with 3,439 client accounts and 431,231
  `CLIENT_ITEM` links, and is exactly the "field doing double duty/effectively unused"
  trap the exploration was meant to catch: it's left at its default on intake and
  never corrected. It **is** reliable for the other two explicit values though —
  `Purchase` (2,833 rows) and `Trade` (429 rows) are genuinely set, so those two
  populations are identifiable this way; the Buy-Outright/Trade guidance already in
  this document (intake against the `STORE` account, no ongoing balance to the
  original seller, preserve the deal type in `Item.consignmentType`) still applies to
  them unchanged. **For Store-Owned vs. Consign, use `CLIENT_ITEM` instead**: it's a
  clean 1:1 join (`COUNT(*) = COUNT(DISTINCT ITEM_ID)`, no duplicates) — an item
  present in `CLIENT_ITEM` belongs to that `CLIENT_ID` (→ `Item.accountId` resolves to
  that consignor's `Account`); an item **absent** from `CLIENT_ITEM` (339,842 of
  771,073, ~44%) is store-owned stock → `Item.accountId` resolves to the `STORE`
  account.
- `ITEM.COST` is genuinely populated (real values like `1, 3, 5, 2, 0`, not a
  default-only column) — **confirms this spec's flagged cost-basis gap is real**.
  Added `Item.cost` (nullable `Float`) to `schema.prisma`.
- `ITEM.PRICE_CODE_ID` → `PRICE_CODE.STORE_PCT` is the split, and **it's the store's
  cut, not the consignor's** — directly confirmed from real rows: `"60S/40C"` (60%
  store/40% consignor) has `STORE_PCT = 60`; `"60C/40S"` has `STORE_PCT = 40`; `"100%
  client"` has `STORE_PCT = 0`; `"100% TO STORE"` has `STORE_PCT = 100`; the
  outright-purchase code (`"Purchase Code - Credit"`) also has `STORE_PCT = 100`
  (consistent — no ongoing split once bought outright). **`Account`/`Item`-level
  `splitPercent` (the consignor's share) = `100 - STORE_PCT`.** This is exactly the
  split-direction trap §3 already warns about generically, now confirmed concretely —
  and double-confirmed against real dollar amounts in the ledger, independent of the
  price-code labels: joining `SALE_DETAIL` → `CLIENT_TRANS` for actual historical
  sales, a `30S/70C` (`STORE_PCT=30`) sale of `$6.70` credited the consignor exactly
  `$4.69` (70%); a `60C/40S` (`STORE_PCT=40`) sale of `$89.25` credited exactly
  `$53.55` (60%). `100 - STORE_PCT` is correct, verified two independent ways.
- `PRICE_CODE` + `MARKDOWN` (16 rows, joined by `PRICE_CODE_ID`) implement a real,
  populated, **time-based automatic markdown schedule** (e.g. `MARKDOWN_PERIOD = 60`
  days, `MARKDOWN_PERCENT = 75`) — confirms this spec's already-noted structural gap
  (Teabox's `priceQuickSale`/`pricePremium` are static manually-set tiers, not a
  schedule). Migrate only `Item.price` as the *current* effective price; there's no
  target for the schedule itself.
- `ITEM_ATTR`/`CAT_ATTR`/`ATTR_TYPE`/`ATTR_TYPE_VALUE` (981,797 `ITEM_ATTR` rows) is a
  generic attribute EAV system — this is the "brand/size doing double duty" the
  exploration was meant to find. In practice it's simpler than the schema suggests:
  joining `ITEM_ATTR` → `CAT_ATTR` → `ATTR_TYPE` and grouping by `ATTR_TYPE_DESC`,
  **`Brand` (516,053) plus the `*Size` variants (`Ladies Size` 332,970, `Child Size`
  72,894, `Mens Size` 58,951, plus small others) account for 980,868 of 981,797 rows
  (99.9%)**. Crosswalk: any `ATTR_TYPE_DESC` containing `"Brand"` → `Item.brand`;
  containing `"Size"` → `Item.size`. The remaining 0.1% (color, era/period, material,
  etc., each under 350 rows) isn't worth a bespoke crosswalk — append to
  `Item.description` or drop.
- `ITEM_STATUS` (18 values) and `ITEM_DISPOSITION` (12 values, used on
  `SALE_DETAIL.ITEM_DISPOSITION_ID`) exist as real, fully-enumerated lookup tables
  (18 and 12 rows respectively) — but **only 4 of `ITEM_STATUS`'s 18 values actually
  appear on any real `ITEM` row in this shop's data**: `Unavailable` (749,204 of
  771,073 items, 97%), `Available` (17,605), `Void` (4,196), `Needs Info` (68).
  `Donated`/`Returned`/`Sold`/`Sold Online`/`Expired`/etc. are defined in the lookup
  table but **never used** as an `ITEM.STATUS_ID` value here — a second instance of
  the same "field looks authoritative but isn't" trap as `ITEM_ACQUISITION_TYPE_ID`.
  Caught by checking the full-table `STATUS_ID` distribution (not a sample) after a
  first migration pass mapped 98% of items to `DISPOSED` and that number didn't pass
  the smell test — worth remembering as a reminder to always check a field's *real*
  distribution before trusting a lookup table's existence as a sign it's meaningfully
  used.
  - `Unavailable` turns out to be Liberty's generic "off the floor" catch-all applied
    on sale, not a disposition signal by itself: 745,985 of the 749,204 `Unavailable`
    items (99.6%) have a populated `SALE_DETAIL_ID`. **Check `ITEM.SALE_DETAIL_ID` (or
    equivalently, whether the item made it into the migrated `Sale` table) before
    consulting `STATUS_ID` at all** — populated → `SOLD`, regardless of `STATUS_ID`.
  - Only for items with no `SALE_DETAIL_ID` does `STATUS_ID` itself matter, and here
    it's simple: `Available` → `AVAILABLE`; `Void` → `DISPOSED`; `Needs Info` → 
    `PENDING`. The fuller crosswalk below exists for other shops that might actually
    populate the other 14 values, not because this one does.
- SKU: `ITEM.ITEM_NUM` is confirmed account-scoped (low cardinality per client, driven
  by `CLIENT.NEXT_ITEM_NUM`), exactly as this spec already warned. In practice the
  composite-key strategy originally proposed here (`Account # + Item #`) turned out
  unnecessary once direct SQL access was available: `ITEM.ITEM_ID` (the table's own
  PK) is already globally unique across the whole shop, so `sku = "LIB-" + ITEM_ID`
  is simpler and just as collision-proof. The composite strategy is still the right
  call for a shop reachable only via CSV export, where no globally-unique surrogate
  key is available to fall back on.

**`ITEM_STATUS` → Teabox `ItemStatus` crosswalk** (check `SALE_DETAIL_ID` first, per above):

| Has `SALE_DETAIL_ID`? | `ITEM_STATUS.STATUS_DESC` | → Teabox `Item.status` |
|---|---|---|
| Yes (any status) | — | `SOLD` |
| No | Available | `AVAILABLE` |
| No | Sold, Sold Online | `SOLD` |
| No | Donated | `DONATED` |
| No | Returned | `RETURNED` |
| No | Void, Expired, Item Lost, Unavailable | `DISPOSED` |
| No | Needs Info, Print Labels, Being Sold, Ordered Online, Shipper Data Required, Package Info Required, Contact Shipper, Layaway, Other | `PENDING` (ambiguous/in-flux — per §5, never default these to `AVAILABLE`) |

### `CLIENT_TRANS` (525,145 rows) + `TRANS_CD` (22 rows) — the real balance ledger

`TRANS_CD` is fully self-documenting and directly resolves how to compute balances: it
carries `NEGATIVE_IND` (does this transaction type reduce the balance) and, more
importantly, **`PAYABLE_IND`** (`1` = counts toward payable balance now, `-1` =
pending/not yet payable, `0` = moves money into a different bucket like trade credit
rather than the cash-payable balance). The `-1` rows (`Pending Layaway`, `Pending Web
Sale`, `Suspended Sale`, `Pending Fee`, `Pending Sale Deduction`) are Liberty's
**pay-delay mechanism** made concrete — confirms and operationalizes this spec's
pay-delay caveat: filter these out of the `currentBalance` sum. The `0` rows (`Trade
Item`, `Store Credit (np)`, `Forwarded to Store Credit`) are the **consignor
store-credit draws** already flagged as having no Teabox equivalent — confirmed real
(`TRANS_CD_ID 18/19/502`), still no target; net them out of the cash balance per the
existing guidance rather than migrating them as transactions.

### `PAYOUT` (50,640 rows) → `Payout`

`RECONCILE_STATUS` (a raw char code, no lookup table) breaks down as `P` 45,055 / `N`
5,119 / `R` 233 / `D` 233. Best-guess crosswalk, **worth confirming with the shop
owner** rather than assuming: `P` (Paid) → `PAID`, `N` (Not yet reconciled) →
`REQUESTED`, `R` (Reconciled) → `PAID`, `D` (Deleted/voided) → `REJECTED`.
`PAYMENT_ACT_ID` → `Account.paymentMethod` per above.

### `SALE_HDR`/`SALE_DETAIL`/`SALE_PAY_DTL` → `Sale`

`SALE_HDR` (29,769) is one row per transaction, `SALE_DETAIL` (753,463) one row per
line (`SALE_DETAIL_TYPE_ID = 1`, "Inventory", is the overwhelming majority — other
types like Layaway Payment/Gift Card/Delivery have no `Item` to attach to and should
be skipped for `Sale` migration). `SALE_HDR.CLIENT_ID` is the **buyer/customer**, not
the consignor — Teabox's `Sale` model has no buyer concept at all (only
`processedById`, the cashier), so this column has no target and is fine to drop.
`ITEM.SALE_DETAIL_ID` (88.6% populated on sold items) gives a direct
`Item → SALE_DETAIL` link, avoiding a fragile join. `SALE_PAY_DTL.PAYMENT_TYPE_ID` →
`SALE_PAYMENT_TYPE` needs collapsing onto Teabox's 3-value `paymentType`
(`CASH`/`CARD`/`STORE_CREDIT`) — this shop's actual usage is almost entirely one
card-network type plus cash, so the collapse is low-risk here.

### RECOMMENDED EXTRACTION PATH (fallback, for a shop without a restorable backup)

Because Liberty publishes no public schema, the version-independent fallback is its
own documented, supported export tooling rather than reverse-engineering table names
from scratch:

- **Client Import/Export utility** (Inventory module → Activities → Accounts → CSV
  Import/Export) — exports every `Account` (Liberty calls them "Clients") to CSV.
- **Item Import Utility** (Activities → Inventory → Import Items) also doubles as a
  self-documenting export reference: choosing *Save Sample* produces a sample CSV with
  the exact column order for that shop's installed version.
- **Reports module** exports to CSV/Excel for anything reportable, but is
  report-shaped, not a raw table dump.
- **QuickBooks Desktop Link** exports sales/payout/COGS detail already
  transaction-shaped, if the shop has been using it.

### History note: the two backups

The first backup provided (`RWD.bak`, 793 MB) turned out to be an unrelated ~20-year-
old SQL Server 2000 archive with an essentially empty schema — `RESTORE DATABASE`
reported database version 539, which no available SQL Server engine (and no Linux
Docker image, none exist for anything pre-2017) can restore; chaining ~6-8 intermediate
Windows SQL Server installs to walk it forward was considered and rejected as
disproportionate. The client then located and provided a second, correct `RWD.BAK`
(1.7 GB, dated July 2024, SQL Server 2008 R2 internal version — well within SQL Server
2022's restore-compatibility window) after moving the first one aside to `xxdetritus/`.
**Every finding above is drawn from the second file.** `Docs/Migrations/liberty-etl/
README.md` §0 has the restore steps that worked.



For every entity: Prisma field / SQLite storage type / constraints Teabox's **API
layer** enforces (not the DB — SQLite has almost no column-level constraints here
beyond `NOT NULL` and `UNIQUE`) / migration guidance.

### 4.1 `Store`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | Generate a fresh cuid per target row; do not reuse source IDs (see §7.3). |
| `name` | `String` | required | |
| `location` | `String?` | optional | Free text, e.g. `"Springfield, IL"` in seed data — no structured address fields exist. If the source has structured address columns, concatenate; don't add columns without a schema migration. |
| `createdAt` | `DateTime` | default now | Set to the source shop's actual founding/go-live date if known and meaningful for reporting; otherwise migration date is fine — nothing keys off it besides display. |

One `Store` row per physical location (§2).

### 4.2 `Account` (polymorphic — Consignor/Vendor/Donor/BoothOwner/Store)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | Fresh cuid. |
| `storeId` | `String` | FK, required | |
| `accountType` | `String` | must be one of `ACCOUNT_TYPES` | See §3 crosswalk. |
| `name` | `String` | required | Person/business/booth display name. |
| `email` | `String?` | optional, no uniqueness constraint at DB level | Note: this is **separate** from `User.email` (which *is* unique) — an `Account` (the financial party) and a `User` (a login) are different rows even when the same person is both. Don't conflate them during migration; see §4.3. |
| `phone` | `String?` | optional | |
| `paymentMethod` | `String?` | **no current write path** | JSON-encoded `{ method, details }` per the schema comment (`prisma/schema.prisma:84`), but `accounts.routes.ts`'s `createAccountSchema` doesn't accept this field and no UI reads/writes it. Safe to populate directly via SQL if the source has payout-method data worth preserving (e.g. "Check", "PayPal: foo@bar.com") — nothing will validate or display it yet, but it's forward-compatible storage. Flag to product/eng if this data matters; a feature to surface it doesn't exist yet. |
| `splitPercent` | `Int?` | 0–100 (`z.number().min(0).max(100)`, app-layer only) | **Direction matters**: this is the payee's (consignor/vendor/booth owner's) share, credited to their balance on sale — e.g. `splitPercent: 60` means the consignor keeps 60% and the store keeps 40%. Many legacy systems store the *store's* cut instead ("commission rate"). **Confirm the direction explicitly per source system before loading** — an inverted split silently pays consignors the store's share and vice versa, and nothing in the app catches this (see `pos.routes.ts:112-119`: `consignorShare = salePrice * splitPercent / 100`). Leave `null` only for `DONOR`/`STORE` accounts, which never use it. |
| `currentBalance` | `Float` | default 0; **stripped from API response entirely** for `DONOR`/`STORE` accounts (`serializeAccount()`, `server/src/services/accounts.service.ts`) | This must equal, at cutover: `SUM(credited sale shares since last payout) − SUM(paid payouts not yet reflected)`, i.e. the *currently owed, unpaid* balance — not lifetime earnings. See §5 for the reconciliation formula and §6 for the float-precision caveat. Must be `0` for every `DONOR` and `STORE` account (the app never writes to these accounts' balances — `pos.routes.ts` only credits `BALANCE_BEARING_ACCOUNT_TYPES`). |
| `createdAt` / `updatedAt` | `DateTime` | | |

Every `Store` **must** have exactly one `Account` row with `accountType: "STORE"` —
this is the target for all store-owned (non-consignment) inventory and is created
automatically by `getOrCreateStoreAccount()` (`server/src/services/accounts.service.ts:30`)
whenever anything looks it up and doesn't find one. Create it explicitly during
migration (name it `"Store-Owned Inventory"` to match the convention the app itself
uses) rather than relying on lazy creation — a migration script inserting `Item` rows
directly needs this account to already exist so it has a valid `accountId` to point
store-owned stock at.

### 4.3 `User` (login identity — distinct from `Account`)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | Fresh cuid. |
| `email` | `String` | **unique** across the whole DB | Source systems sometimes allow duplicate emails across roles/locations (e.g. an owner who's also a vendor, logged as two rows with the same email). Teabox instead models this as **one `User` row with two `UserRole` rows** — see §4.4 and §7.1. Deduplicate by email before creating `User` rows. |
| `passwordHash` | `String` | bcrypt, cost 10 (`bcryptjs`) | **Cannot be migrated from a SQL Server source as a hash reuse** — see §7.2. Every migrated login needs a new bcrypt hash, produced via a forced-reset flow, not a hash format conversion. |
| `name` | `String` | required | |
| `createdAt` / `updatedAt` | `DateTime` | | |

A `User` carries **no roles or store affiliation directly** — that's the entire point
of the `UserRole` split (root `CLAUDE.md`'s "one rule that shapes everything"). Never
create a `User` row per role; create one `User` per real person, and one `UserRole`
row per role they hold.

### 4.4 `UserRole` (role grants — the RBAC join table)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | |
| `userId` | `String` | FK → `User` | |
| `role` | `String` | must be one of `ROLES`; unique per `(userId, role, storeId)` | |
| `storeId` | `String` | FK → `Store` | |
| `accountId` | `String?` | FK → `Account`; **required** (non-null) when `role ∈ {CONSIGNOR, VENDOR, DONOR, BOOTH_OWNER}` (`ACCOUNT_SCOPED_ROLES`), must be `null` for staff roles | This is the link between "who can log in as this consignor" and "which financial account they're linked to." A consignor who never gets a login (common — many consignors only interact via phone/in person, never the self-service portal) needs **no `User`/`UserRole` row at all**, just an `Account` row. Only create `User`+`UserRole` rows for people who actually need to log in. |
| `createdAt` | `DateTime` | | |

**Migration-critical**: if a legacy user held equivalent permissions to more than one
Teabox role (e.g. was both a manager and a self-service consignor), or your source
schema uses a multi-value roles/permissions column (bitmask, CSV, junction table),
expand that into **multiple `UserRole` rows** on one `User`, exactly like the seed
data's `sarah@teabox.local` (`MANAGER` + `CONSIGNOR`, `server/prisma/seed.ts:63-69`).
Do not try to collapse multiple source permissions into Teabox's closest single role —
the whole session model is built around a person choosing one active role per login
(see root `CLAUDE.md`), and under-provisioning roles will lock people out of
capabilities they had in the old system, while a wrong single-role guess is much
harder to detect post-migration than an extra `UserRole` row is to revoke later via
Settings → Users & Permissions (`DELETE /settings/users/roles/:userRoleId`).

### 4.5 `Item`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | Fresh cuid — but see §7.3 on preserving the source ID for cross-reference. |
| `sku` | `String` | **unique**, required | Also the value encoded onto the printed barcode tag (`web/src/components/Barcode.tsx`) and matched on POS scan lookup. If the source system's SKU/tag numbers are themselves unique per shop, reuse them verbatim (better for staff continuity — physical tags already printed with old SKUs stay valid). If the source allows SKU reuse across time (e.g. recycled tag numbers) or the format collides with Teabox's own generator (`formatBarcode()`, `server/src/lib/barcode.ts` — `${storeId}-${itemNumber}`), namespace migrated SKUs distinctly (e.g. a prefix) to guarantee no future auto-generated SKU collides with a migrated one. |
| `itemNumber` | `Int` | **required**, unique per `storeId` (`@@unique([storeId, itemNumber])`) | Sequential per-store counter `formatBarcode()` encodes into `sku` for *new* items; migrated items don't need it to match their migrated `sku` at all (that's just carried over verbatim), but it still must be populated with some store-unique integer — e.g. a per-store row-number over intake order, the same backfill strategy `prisma/migrations/20260915011122_add_item_number/migration.sql` used for pre-existing rows when this column was added. |
| `description` | `String` | required | |
| `category` | `String` | required, free text (no enum) | No longer feeds SKU generation (that now comes from `itemNumber`, not `category`); purely descriptive/filterable metadata. |
| `subcategory`, `brand`, `style`, `pattern`, `size`, `serialNumber`, `condition` | `String?` | all optional free text | Direct 1:1 mapping from whatever equivalent columns the source has; leave `null` rather than empty string for anything absent (the intake `zod` schema treats these as `optional()`, not empty-string-required). |
| `consignmentType` | `String?` | optional free text, **no current UI surface** | Schema comment (`prisma/schema.prisma:111`) suggests values like `"Traditional Consignment"`, `"Buy-Outright"`, `"Booth Rental"`, `"Donation"` but there is **no enum enforcing this and no web page reads or writes it** (`grep` for `consignmentType` across `web/src` returns nothing) — it's accepted by the intake API (`items.routes.ts`) and stored, but otherwise dark data today. Good place to preserve the source system's original per-item deal-type label even when it doesn't map cleanly onto Teabox's account-type model (e.g. an item under a "60-day markdown consignment" deal distinct from the account's default split). |
| `status` | `String` | default `"AVAILABLE"`; must be one of `ITEM_STATUSES` | See §5 — **do not default ambiguous source statuses to `AVAILABLE`**; use `PENDING` and let staff triage. |
| `intakeDate` | `DateTime` | default now | Preserve the original intake date from source data — this drives aging reports and default sort order (`orderBy: { intakeDate: "desc" }` throughout). |
| `priceQuickSale` | `Float?` | optional, positive | Markdown/clearance price tier, if the source tracks one. |
| `price` | `Float` | **required**, positive | The standard/current asking price. |
| `pricePremium` | `Float?` | optional, positive | Premium/introductory price tier, if applicable. |
| `accountId` | `String` | **required**, FK → `Account` in the same `storeId` | No item can exist without an owning account — for store-owned stock this is the `STORE` account (§4.2), never `null`. This is enforced at the API layer by `resolveIntakeAccountId()` (`server/src/services/items.service.ts:14`), not by the DB schema, so a direct-SQL migration load must replicate this invariant manually: **every migrated `Item.accountId` must resolve to an `Account` row with the same `storeId`.** |
| `storeId` | `String` | required, FK → `Store` | |
| `createdAt` / `updatedAt` | `DateTime` | | |

### 4.6 `ItemHistory` (append-only per-item changelog)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | |
| `itemId` | `String` | FK → `Item` | |
| `changeType` | `String` | one of `"INTAKE" \| "PRICE_CHANGE" \| "STATUS_CHANGE" \| "EDIT"` (convention, not DB-enforced) | |
| `oldValue` / `newValue` | `String?` | free text, e.g. `"$45.00"` or a status name | The app stores these as pre-formatted display strings (see `items.routes.ts:121,170-171,201-202`), not raw numbers — match that convention if backfilling. |
| `changedById` | `String?` | FK → `User`, nullable | `null` when there's no attributable actor (acceptable for migration-backfilled rows). |
| `activeRole` | `String?` | nullable | `null` is fine for backfilled history; leave real values only where the source data actually distinguishes who acted in what capacity. |
| `timestamp` | `DateTime` | default now | |

**Recommended**: synthesize one `INTAKE` `ItemHistory` row per migrated `Item` (timestamp
= the item's `intakeDate`, `changedById`/`activeRole` = `null`) so the Item Detail
page's history tab isn't empty for every pre-migration item. This is cosmetic, not
required for correctness — nothing else reads `ItemHistory` for business logic.

### 4.7 `Photo`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | |
| `itemId` | `String` | FK → `Item` | |
| `url` | `String` | required | **A URL/path string, not binary data.** Teabox has no blob storage — if the source SQL Server database stores images as `varbinary(max)`/`image` columns, those must be exported to actual files (local disk path or hosted URL) as a *separate* pre-migration step; there is nowhere in this schema to load raw image bytes. |
| `source` | `String` | `"MANUAL" \| "CV_STUB"` (convention, not DB-enforced) | Use `"MANUAL"` for every migrated photo — `"CV_STUB"` is reserved for the computer-vision-suggestion stub adapter's own writes (`server/src/adapters/cv.ts`) and doesn't apply to historical data. |
| `createdAt` | `DateTime` | | Preserve original photo-taken date if known. |

### 4.8 `Sale`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | |
| `itemId` | `String` | FK → `Item` | **Not unique** — an item that was sold, returned (`RETURNED` status), and later resold legitimately has multiple `Sale` rows. This is expected, not a data-quality bug; don't dedupe down to one `Sale` per `itemId` during migration. |
| `salePrice` | `Float` | required, positive | The actual transaction price (may differ from `Item.price` due to negotiation/markdown at time of sale). |
| `saleDate` | `DateTime` | default now | **Timezone-sensitive** — see §6's dates note. This field is bucketed by *server local calendar day* for every report (`localDateKey()`, `server/src/routes/reports.routes.ts:21`), so migrated timestamps must represent the correct real-world instant, not a naive "local time with no offset" value that happens to look right only in the source system's original timezone. |
| `paymentType` | `String` | `"CASH" \| "CARD" \| "STORE_CREDIT"` (zod-enforced on the live checkout endpoint, not DB-enforced) | Map any additional source payment types (check, gift card, layaway, etc.) onto the closest of these three — there is no fourth option in the current build. |
| `registerName` | `String?` | optional | Cosmetic, e.g. which till/terminal processed it. |
| `processedById` | `String?` | FK → `User`, nullable | `null` acceptable if the original cashier can't be reliably mapped to a migrated `User`. |
| `storeId` | `String` | required | |

**One `Sale` credits its item's owning account by `splitPercent`% of `salePrice`
at the moment of sale** (`pos.routes.ts:112-119`) — that credit is *not* re-derivable
from the `Sale` row alone after the fact if `Account.splitPercent` later changes,
because the app applies whatever split is current at sale time and only stores the
resulting balance increment inside `Account.currentBalance`, not on the `Sale` row
itself. For migrated historical sales, this means: **you are migrating `Sale` rows for
historical/reporting purposes; the actual `Account.currentBalance` must be set
directly to the correct current-owed figure (§4.2, §5) — do not expect replaying
migrated `Sale` rows through any app logic to recompute balances, since checkout is a
live-transaction endpoint, not a ledger-replay one.**

### 4.9 `Payout`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | |
| `accountId` | `String` | FK → `Account`; **should only reference `BALANCE_BEARING_ACCOUNT_TYPES` accounts** (`CONSIGNOR`/`VENDOR`/`BOOTH_OWNER`) | Not DB-enforced, but `accounts.routes.ts:111-113` refuses to create new payouts against `DONOR`/`STORE` accounts — don't migrate historical payout rows against those account types either, even if the source data has something superficially similar (e.g. a "donation acknowledgment sent" record — that's not a `Payout`). |
| `amount` | `Float` | required, positive | |
| `status` | `String` | one of `PAYOUT_STATUSES` (`REQUESTED`, `APPROVED`, `PAID`, `REJECTED`) | Historical payouts are almost always `PAID`; only use `REQUESTED`/`APPROVED` for genuinely open-as-of-cutover requests. |
| `createdAt` | `DateTime` | default now | |
| `paidAt` | `DateTime?` | set when `status = "PAID"` | |

Payouts are **account-level aggregates**, not tied to specific `Sale`/`Item` rows —
there is no join table recording "this payout covered these sales." If the source
system tracks per-sale payout allocation and that traceability matters to the shop
owner, it will be **lost** on migration unless preserved out-of-band (e.g. as a note
in `AuditLog.details`, §4.11, or an external archive) — flag this explicitly to
whoever's running the migration project, since it's a real (if narrow) capability
regression, not an oversight in this spec.

### 4.10 `Device` / `Heartbeat`

Both are **local runtime/pairing state, not business data** — do not migrate these
from the source system at all. `Device` rows represent hardware paired to *this*
physical install (`server/src/adapters/printer.ts` etc. are stub adapters — see root
`CLAUDE.md`'s "Deliberate simplifications"); a legacy system's printer/scanner
configuration has no meaningful equivalent here. `Heartbeat` is a single per-store
timestamp stamped by the (stubbed) cloud-sync adapter and self-initializes on first
use — leave it absent and let the app create it.

### 4.11 `AuditLog`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (cuid) | PK | |
| `entity` / `entityId` | `String` | required | Which table/row the action targeted, e.g. `"Item"` / the item's id. |
| `action` | `String` | required, free text, e.g. `"INTAKE"`, `"CHECKOUT"`, `"PRICE_CHANGE"` | |
| `performedById` | `String?` | FK → `User`, nullable | |
| `activeRole` | `String?` | nullable | Per root `CLAUDE.md`: audit entries always record the *role the session was acting as*, not just the user — preserve this distinction if the source system has any equivalent, rather than collapsing to just a user reference. |
| `timestamp` | `DateTime` | default now | |
| `details` | `String?` | JSON-encoded free-form | |

Not required for functional migration (nothing reads `AuditLog` to drive behavior),
but worth backfilling a synthetic `"MIGRATION_IMPORT"` action per major entity batch
(e.g. one `AuditLog` row per migrated `Item`, or one summary row per batch — team's
call) so there's a permanent record inside Teabox itself of when/how historical data
arrived, distinguishable from organically-created records.

## 5. Cross-entity invariants to validate post-load

Run these as validation queries against the freshly-loaded target DB before declaring
migration complete — none of them are enforced by SQLite itself, only by app-layer
code that a bulk SQL load bypasses entirely:

1. **Exactly one `STORE`-type `Account` per `Store`.** (`getOrCreateStoreAccount`'s
   invariant.)
2. **Every `Item.accountId` and `UserRole.accountId` resolves to an `Account` row with
   the same `storeId`** as the `Item`/`UserRole` itself — no cross-store references.
3. **Every `UserRole` with `role ∈ {CONSIGNOR, VENDOR, DONOR, BOOTH_OWNER}` has a
   non-null `accountId`**; every `UserRole` with a staff role has `accountId = null`.
4. **`DONOR` and `STORE` accounts have `currentBalance = 0`** and zero associated
   `Payout` rows.
5. **Balance reconciliation**, per balance-bearing account: `Account.currentBalance`
   should equal `SUM(Sale.salePrice * splitPercent/100 WHERE Sale.item.accountId =
   this account, sale postdates the last full payout)` minus anything already paid out
   since. In practice: pull the source system's own "balance currently owed to
   [consignor]" figure (every consignment package has some version of this report) and
   load `currentBalance` from *that*, rather than trying to replay Teabox's own
   increment logic backward through migrated `Sale` history — the two should agree,
   and reconciling them is a good migration QA step, but the authoritative value is
   the source system's own current-balance figure at cutover instant.
6. **No duplicate `sku` values**, and **no duplicate `(storeId, itemNumber)` pairs**
   (both are DB-level `UNIQUE` and will reject the load outright if violated, but
   resolve source-side duplicates deliberately rather than letting the loader pick one
   arbitrarily via last-write-wins).
7. **No duplicate `User.email`** (same — DB-level `UNIQUE`).
8. **`Item.status` defaults**: for any source item whose sold/available state is
   ambiguous or unknown, load it as `PENDING`, never `AVAILABLE`. `PENDING` is a real,
   intentional status (goods received but not yet priced/tagged/put out) — it keeps
   ambiguous stock out of POS search results (`pos.routes.ts`'s
   `/inventory-search` and `/lookup` both filter `status: "AVAILABLE"` only) until
   staff explicitly triage it, rather than accidentally making unverified stock
   sellable.
9. **`splitPercent` direction sanity check** (§4.2) — spot-check a handful of accounts
   against the source system's own payout history: does `salePrice * splitPercent/100`
   for a known past sale match what that consignor was actually paid? If it matches
   the *store's* cut instead, the crosswalk is inverted.

## 6. Type & precision crosswalk (Prisma/SQLite ↔ SQL Server)

Prisma stores everything in SQLite with fairly loose column affinities; the
**effective** contract is whatever the TypeScript/Zod layer enforces, summarized here
for whoever is writing the T-SQL extraction side:

| Prisma type | Effective JS/JSON type | Typical SQL Server source type(s) | Caveats |
|---|---|---|---|
| `String` (id) | string (cuid, e.g. `"cktz1a2b3c..."`) | `int` IDENTITY, `uniqueidentifier`, or a proprietary code | Always regenerate as a fresh cuid in the target (§7.3) rather than reusing source PK format — Prisma's relations expect cuids but don't strictly require them; the real reason to regenerate is to avoid accidental collisions with anything the live app generates going forward. |
| `String` (data) | string | `nvarchar`/`varchar` | Watch for source-side truncation-by-column-width (`varchar(50)` category names, etc.) that Teabox's unbounded `String` won't reproduce — that's fine, just don't assume symmetry if reconciling row-for-row later. |
| `Float` (money: `price`, `salePrice`, `currentBalance`, `amount`, etc.) | JS `number` (IEEE-754 double) | `decimal(19,4)` / `money` | **No fixed-point decimal type in this schema** — everything money-related is a floating-point double. SQL Server `money`/`decimal` values must be converted carefully: round to cents on load and re-round after any arithmetic during transform to avoid floating-point drift (e.g. `0.1 + 0.2 !== 0.3`-class errors) accumulating across thousands of migrated rows. This is a pre-existing characteristic of the live app too (it does the same float arithmetic at runtime, e.g. `pos.routes.ts:114`), not something migration introduces — but a bulk historical load is exactly the scenario where accumulated float drift becomes visible (e.g. a migrated balance off by a cent from the source system's own decimal-exact figure). |
| `Int` (`splitPercent`) | integer | `int`/`tinyint`/`decimal(5,2)` | Teabox only supports **whole-percent** splits (0–100, no fractional percent like `62.5`). If the source supports fractional splits, round and flag any account where rounding changes the effective payout by a non-trivial amount over typical sale volume. |
| `DateTime` | ISO-8601 string (Prisma serializes SQLite's stored text this way) | `datetime`/`datetime2`/`smalldatetime` | See below — timezone handling is the single easiest thing to get subtly wrong. |
| Enum-like `String` | string, validated against `enums.ts` arrays | `varchar` code, `tinyint` lookup FK, or a separate lookup table | Build the crosswalk (§3) as data, not inline in transform code, so it's auditable and reusable if the source schema has per-shop customized status lists. |

### Dates & timezones

Every `DateTime` column here is stored as an actual timestamp (instant), and one
report code path (`localDateKey()`, `server/src/routes/reports.routes.ts:21`) buckets
sales by the **server process's local calendar day** — deliberately, per the "Local vs.
UTC dates" gotcha in root `CLAUDE.md`. This has a direct migration implication:

- If the source SQL Server database stored sale timestamps as **naive local time**
  (no offset, implicitly "whatever timezone the store's server was in"), and the
  Teabox instance will run in a **different** timezone than that original store
  server, a straight copy of the naive value will bucket historical sales onto the
  wrong calendar day for anything near midnight in the shop's local time.
- Correct approach: attach the shop's actual local timezone (from the shop owner, not
  inferred) to every naive source timestamp during transform, convert to a true UTC
  instant, and store that. Then either (a) run the target Teabox server process in the
  shop's own timezone (matches how a real single-location install normally runs
  anyway — see install/packaging docs, this is the default expectation), or (b) if
  centralizing multiple migrated shops on servers in a different timezone, be aware
  historical report day-buckets will shift relative to what the shop owner remembers
  seeing in their old system.

## 7. Identity & password migration

### 7.1 Splitting one legacy identity into `User` + N × `UserRole`

The most structurally important transform in this whole migration: legacy schemas
almost always model "a login" as one row with a role/permission column (or bitmask,
or CSV, or membership in a `Roles` junction table using SQL Server's/ASP.NET
Identity's typical `AspNetUserRoles` shape). Teabox splits this deliberately — see
§4.3/§4.4. The transform is: **group source login rows by real-world person (usually
by email), create one `User`, then create one `UserRole` row per distinct permission
grant that person held**, resolving each to a Teabox `Role` value via the §3
crosswalk.

### 7.2 Passwords cannot be migrated as hashes

Teabox hashes passwords with `bcrypt` (cost factor 10, via `bcryptjs` —
`server/src/services/auth.service.ts`, `setup.service.ts`, `settings.routes.ts`,
`users.service.ts` all use the same scheme). A SQL Server-backed system will almost
certainly use something else — ASP.NET Identity's PBKDF2-HMAC-SHA256 format, a
vendor-proprietary scheme, MD5/SHA1 (older/smaller POS vendors), or in the worst case
reversible-encrypted or plaintext passwords. **None of these can be converted into a
valid bcrypt hash** — hashing is one-way, so there is no transform that produces
"the bcrypt hash of the same password" without the plaintext password itself.

Two legitimate options, in order of preference:

1. **Forced reset on first migrated login** (recommended): generate a random
   `passwordHash` for every migrated `User` (or reuse the existing invite-flow
   machinery — `inviteUser()` in `server/src/services/users.service.ts` already
   generates a `tempPassword` + hash pattern for exactly this "give someone a
   one-time credential" case) and require every migrated user to set a real password
   before or immediately after their first login. **This requires a small feature
   addition** — there is currently no "force password change on next login" flag
   anywhere in the schema (`User` has no such column) or login flow
   (`auth.service.ts`); the invite flow's `tempPassword` is *returned to the admin
   inviting them*, not emailed/forced-reset at next login. Decide with the team
   whether to (a) build a minimal `mustChangePassword` boolean + login-flow check
   before running a real migration, or (b) have the shop owner/admin manually
   distribute temp passwords out-of-band (phone/text) and rely on Settings → Profile
   (`PUT /settings/profile`, `settings.routes.ts:21`) for self-service change
   afterward — (b) works with **zero code changes** and matches how the invite flow
   already works today, so it's the pragmatic default absent a stated need for (a).
2. **If the source system's plaintext or reversibly-encrypted passwords are somehow
   available** (rare, and a security smell in the source system itself) — hash them
   fresh with `bcrypt.hash(plaintext, 10)` at migration time so users keep their old
   password. Only do this if genuinely available; never attempt to decode/convert an
   irreversible hash format into bcrypt.
3. **Config-supplied password, set directly** (what `liberty-etl` actually does, as
   of 2026-09-07): `config/store.yaml` requires a `password` field on every entry
   (owner and every role grant), hashed with `bcrypt.hash(password, 10)` at creation
   time same as any other login — no random generation, no out-of-band handoff step.
   This is a deliberate trade for shops with **no legal data-security or reporting
   requirement** to avoid a plaintext password sitting in a config file — it
   streamlines setup for exactly that case, at the cost of that file becoming
   sensitive (restrict who can read it, treat it like any other credentials file, and
   change the passwords post-migration if that tradeoff doesn't hold for a given
   deployment). Don't default to this option for a shop where compliance requirements
   make it unacceptable — prefer (b) under option 1 instead.

### 7.3 ID remapping table

Keep a persistent `source_id → teabox_cuid` mapping table (per entity type) for the
duration of the migration project, even after cutover. It's needed to (a) resolve
foreign keys correctly across entities processed in different ETL batches, (b) let
support/QA cross-reference a specific migrated row back to its source-system origin
when investigating a discrepancy, and (c) make a partial re-run/rollback tractable if
a batch needs to be redone. This mapping table itself is migration tooling, not part
of the Teabox schema — don't try to store it in-app (there's no spare column for it on
any Teabox model, and adding one for a one-time migration isn't worth a schema
change).

## 8. Recommended ETL order

Respect FK dependency order (a row can't reference an FK target that doesn't exist
yet):

1. `Store` (one row per physical location, §2)
2. `Account` — the `STORE`-type account first (§4.2), then `CONSIGNOR`/`VENDOR`/
   `DONOR`/`BOOTH_OWNER` accounts
3. `User` (deduplicated by email, §4.3/§7.1)
4. `UserRole` (one row per role grant, resolving `accountId` for account-scoped roles)
5. `Item` (requires `Account`+`Store` to exist; validate `accountId`/`storeId` pairing
   per invariant #2 in §5 as you go, not after)
6. `ItemHistory`, `Photo` (requires `Item`)
7. `Sale` (requires `Item`; does **not** re-trigger balance credits — see §4.8, load
   `Account.currentBalance` from the source system's own current-balance figure
   separately, not by replaying `Sale` rows through app logic)
8. `Payout` (requires `Account`)
9. `AuditLog` (optional, cosmetic — §4.11)

Skip `Device`/`Heartbeat` entirely (§4.10).

Validate every invariant in §5 after each batch, not just once at the end — it's much
cheaper to catch a bad crosswalk after loading 50 test accounts than after loading
50,000 items against them.

**Status: real production migration complete** (`Docs/Migrations/liberty-etl/`,
2026-09-07). Steps 1, 2, 3–4, 5, 7, 8 are built and have run against the packaged
app's real runtime database (`~/.local/share/teabox/teabox.db`, seeded from the
build's fresh empty `template.db`, not a scratch file): 3,395 accounts, 756,418 items,
738,509 sales, 50,552 payouts, 1 `User` (Sherry Stacey, `OWNER`) — §5 invariants pass,
and a live login as Sherry against the running packaged binary was confirmed. Steps 6
(`ItemHistory`/`Photo`) and 9 (`AuditLog`) remain **not built** — deliberately skipped
as cosmetic/non-blocking per their own notes above.

Step 3–4 (`User`/`UserRole`) is now driven by `Docs/Migrations/liberty-etl/config/store.yaml`
rather than hardcoded: it names the shop's identity (overriding whatever free text
Liberty's own `STORE` table held) and the owner, plus a slot for every Teabox `Role`
so any future staff/consignor/vendor/etc. login can be added by editing the YAML.
Two ways to apply it, sharing the same create-or-update logic
(`load/users.ts`): `scripts/migrate.ts` applies it once, during the initial
migration; `scripts/add-users.ts` (added 2026-09-07) applies it **repeatably**
against an already-migrated, already-running store — idempotent, so editing the YAML
to add a new employee/consignor/etc. and re-running only creates what's new
(account-scoped roles resolve by matching an existing `Account.name` exactly). This
shop had no logins beyond Sherry at cutover, so every other role list in the
checked-in config started empty; `EMPLOYEE` now also has 5 real hires
(Samantha Gerena, Jessica Hodges, Amber Parsons, Kennidy Askew — all confirmed
against real, fee-waived Liberty `CLIENT` records with no email on file, hence the
`firstname@hiddentreasures.com` fallback address; Emma McGlumpfry has **no** matching
Liberty record under that name, exact or fuzzy — included on the shop's say-so, worth
double-checking the spelling with her) applied live via `add-users`. Per
§7.2's option 3 (added 2026-09-07), `password` is a required field on every config
entry and is used as-is (bcrypt-hashed at creation, same as any login) — no random
generation, no out-of-band handoff step. This is a deliberate simplification for
shops with no legal data-security/reporting requirement to avoid it; it does mean
`config/store.yaml` itself now holds plaintext passwords and should be treated as a
credentials file.

The following were resolved by project-side decision on 2026-09-07 (standing in for
direct owner sign-off, since a live consult with Sherry wasn't available this round —
worth a real confirmation with her before treating these as permanent):
- The ~46 `CLIENT_TYPE_ID = 3` accounts: **excluded entirely** from this migration
  (same as the prior test run) — see the now-answered `reports/client_type_3_review.md`.
- `CLIENT_ID 101508` (~$2B corrupted balance): **excluded entirely**, not zeroed —
  neither the account, its items, nor its payouts were migrated.
- `PAYOUT.RECONCILE_STATUS` crosswalk: used **as documented** (`P`/`R` → `PAID`,
  `N` → `REQUESTED`, `D` → `REJECTED`), no change.
- Migration scope: **full historical archive**, all ~20 years — not just current
  stock.

## 9. Open questions

Source system is confirmed as **Liberty by ResaleWorld**, running at **Hidden
Treasures** (Kirksville, MO) — direct database inspection (§3.1) resolved every
question this section used to list (generation/version, direct-SQL-vs-CSV access,
whether graduated splits/pay-delays/store-credit/trade-items/consignor-logins/mailed-
checks are in use). The four items below were genuinely **the shop owner's call**,
not something more querying could resolve on its own — they were decided
project-side on 2026-09-07 to unblock the real migration (see §8's status note),
**not by Sherry directly**, so still worth a real confirmation with her:

- **The `CLIENT_TYPE_ID = 3` ("Store Account") bucket mixes at least three different
  real meanings** (§3.1) — year-named store-inventory placeholders, real vendor
  product lines, and real individual consignors with a fee-waiver note. **Decided:
  excluded entirely from the migration** rather than guessed at — `reports/client_type_3_review.md`
  still has the full ~46-name list for whenever Sherry can sort it; re-running a
  follow-up load for just those accounts is straightforward once she does.
- **`CLIENT_ID 101508`'s ~$2 billion ledger balance is corrupted** (§3.1). **Decided:
  excluded entirely** (account, items, and payouts) rather than zeroed or
  hand-corrected — same reasoning as above, pending Sherry's memory of what happened.
- **`PAYOUT.RECONCILE_STATUS`'s 4 codes (`P`/`N`/`R`/`D`) have no lookup table**.
  **Decided: used the §3.1 best-guess crosswalk as documented** (`P`/`R` → `PAID`,
  `N` → `REQUESTED`, `D` → `REJECTED`) — still worth a two-minute confirmation with
  Sherry on what `R` ("Reconciled", distinct from `P` "Paid") and `D` actually mean in
  her workflow, since a correction here only touches `Payout.status` labels, not
  dollar amounts.
- **Migration scope**: `ITEM` has 771,073 rows spanning roughly two decades.
  **Decided: full historical archive migrated**, not just current stock.
- Given how many free-text fields double as the owner's personal sticky notes (§3.1),
  **the classifications above should still be reviewed with Sherry**, not treated as
  final just because a migration ran — she's the ground truth for what her own
  shorthand means, not something inferable purely from the data.

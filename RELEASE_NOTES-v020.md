# Teabox Release Notes

## 0.2.0 — 2026-10-13

Everything since **0.1.0** (Sunday 2026-10-11, mid-afternoon, the copy taken home for
testing). The version now shows at the bottom of the left-hand menu: "Teabox v0.2.0".

### ⚠ Read this first: consignor balances changed

The balance shown for every consignor was wrong in 0.1.0. When we copied the data
over from Liberty, each balance came out as everything that consignor had *ever*
earned. Payouts already made weren't subtracted. Together, Teabox claimed the store
owed about **$1.5 million**.

0.2.0 corrects this. The store owes about **$39,600** across roughly 1,390 consignors
(about $29,300 of it to active accounts), and about 120 accounts are slightly negative,
meaning the consignor owes the store a little. [Andrew Note: this isn't ACTUALLY how much the store owes, I don't think. The task now is figuring out why the system thinks what it does, and then adjusting for it in the next version.] Liberty's **check** payouts (about
5,900 of them) were also showing as unpaid requests. They now show as paid, with their
check numbers.

**Please spot-check this against Liberty before relying on it:**
- Look up one or two consignors you know well and compare what Liberty says they're
  owed with their account page in Teabox.
- Check the largest balance too: "lost & found lost & found", which Teabox shows as
  **$2,874.39**.

Until that's confirmed, please don't pay anyone out from Teabox.

### Reports

- **Daily Sales Summary, rebuilt.** For any day, see it alongside the same weekday
  last year, the **week to date** (Sunday start) and the **year to date**, each against
  last year with the change in %. It covers transactions, items sold, gross sales,
  average transaction, **inventory added** ($ at tag price) and **payouts** ($). A ledger
  below covers the last 7–90 days with last year's numbers under every figure, a
  chart, and a CSV export.
- **Day Detail.** Click any row (or chart bar) to see everything from that day: every
  sale (grouped by transaction), every item taken in, every price change, every tag
  printed, and every payout. Each one links to the item, account or payout.
- **Print Queues.** Every batch of tags you print is now saved. Find any past batch
  (search by tag number or description, or by date), see what each tag said, and
  reprint all of it or just the tags you pick. A tag whose price has changed since is
  flagged.
- **Transactions are real tickets now.** A checkout with five items counts as one
  transaction. Liberty-era history uses Liberty's receipt numbers. Those were your
  nightly posting batches rather than individual customers, so older transaction
  counts read low; the report says so.
- **Removed:** Unsold Inventory Aging and Consignor Payout Statements. They're replaced
  by the new Inventory Audit page.

### Inventory Audit (new menu item)

A workspace for sorting out the roughly 22,500 items still listed as available,
covering who they belong to, what they're worth, and what should happen to them.

- **Start from a question:**
  - Expired consignments: consigned and unsold more than **90 days**.
  - Never tagged.
  - Items on inactive accounts.
  - Old store stock.
- **Break it down** by age, owner, account, when the owner last sold anything, tag
  printed, donate-if-unsold, consignor split, category or price. Click a row to
  narrow down. You always see item count, retail value, the consignors' share and the
  store's share.
- **Label items** in bulk: *Keep*, *Expired → Store*, *Donate*, *Return*, *Write Off*.
  A label is only a note until an Owner clicks **Apply**. Applying moves expired items
  to the store's own account, or takes items off the floor. Every item's history
  records what happened.
- **Payout Obligations tab:** what's owed, grouped by how recently each account was
  active, the biggest balances, and the floor's value split by owner.

### Accounts

- **Active / Inactive accounts.** Mark old accounts inactive one at a time, or select
  many at once from the list. You can select a whole page or every matching account,
  and Shift-click a range. Inactive accounts are hidden by default, aren't offered at
  intake, and don't count toward what the store owes. Their balance is kept.
- **Find dormant accounts** with "No activity since …". New columns show Last Sale,
  Last Payout and Last Activity.
- **An account's items** are now searchable, filterable by date and sortable, a page
  at a time. **Payout history** is paged, with search too.
- **Consignor splits are per item** where Liberty had them. For example, items marked
  "100% to store" no longer credit the consignor when they sell.

### Inventory and intake

- **Inventory page:** browse the whole store with Category and Status dropdowns,
  received/sold/paid-out date ranges, and every column sortable.
- **Item page:** edit any detail, reprint the tag, or delete a mistaken entry
  (Managers and up). Delete only works for items with no sale or payout. Changes are
  recorded in the item's history.
- **Intake:** pick the account by typing part of a name, phone or email.

### Behind the scenes

- **Liberty catch-up tool.** It brings Teabox up to date with anything rung into
  Liberty since Teabox's copy was made (Friday 10/09 at about 10 AM). For Drew to run
  at cutover; see below.
- **Faster on the full history:** account lists, item lists and reports all page on
  the server.

### For Drew: shipping 0.2.0

- **What to ship:**
  - Ship `dist-bin/teabox.exe` together with `dist-bin/teabox.db`, keeping
    `config.env`.
  - The exe **does not migrate an existing database by itself**, so this database
    must be the one that goes. It carries all of this release's schema migrations
    (`add_item_sold_paid_dates` through `liberty_sync`) and the ledger repair.
  - The Sunday 0.1.0 database the owner has been testing on is **not** carried over.
    If anything entered there needs keeping, copy it out first.
- **Closing the Liberty gap at cutover:** `Docs/Migrations/liberty-etl/README.md` §4.
  Fill in `config/liberty-source.env` (the shop's server is `DESKTOP-ALTQTAR\LIBERTY`;
  logins and network notes are in the example file). Then run `--check`, back up,
  `--dry-run`, and finally apply. Re-running it is safe.
- **Version:** bump `server/`, `web/` and `Docs/Migrations/liberty-etl/`
  `package.json` together.
- **Commits in this release:** `9f7c01c` (item pagination), `e66c55d` (inventory and
  intake), `ff7d6f4` (active flag), `2d03efb` (docs), `311d870` (reports),
  `9c8c23e` (Inventory Audit and ledger repair), plus the 0.2.0 commit (version,
  catch-up sync, release notes).
- **Open item:** owner validation of the corrected balances (root `CLAUDE.md` TODO).

## 0.1.0 — 2026-10-11

First build handed to the shop for testing (commit `f4e2d01`): Liberty history
migrated, `HT-` item tags from 2000000, store accounts, payout itemization and paging.

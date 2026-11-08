# What the "Hidden Treasures" / "20XX Inventory" accounts really are

*Analysis 2026-11-08, read-only, against the restored Liberty database (`RWD` on
`.\SQLEXPRESS`, 2026-11-04 backup) plus Teabox's `dist-bin/teabox.db`. Follows up
`client_type_3_review.md`.*

## Sherry's answers (2026-11-08, via Drew)

- **Store accounts = store purchases**, traditionally. In the last few years people
  also drop off goods as if the shop were a donation center (no account wanted); the
  best of those go into the 800xx year account, the rest to donate. So recent year
  accounts mix purchases and walk-in donations.
- **Year-end IRS inventory:** the last **three years'** unsold store-account items are
  reported as store inventory; anything older is assumed gone.
- **Expired consignments really are donated, but never logged.** Almost nobody collects
  unsold items after 90 days, so nearly everything unsold "goes to donate" — without
  being marked in Liberty. That's why so much ancient stock still reads Available and
  why so many small balances stay unpaid. Occasionally a nice overlooked item "flips to
  inventory" instead — also never logged.
- **Lost & Found** (Liberty client 101550, account 2834) is a holding account for
  goods an account holder dropped off unmarked. Items are entered under it, and once
  sold, the proceeds go to the person's account. It's never paid out itself. In Liberty
  the transfer is a manual Deduction naming the person ("advance of sales to Mary
  Jefferies", "boots/Cheryl Ferguson"), although three payouts to it exist ($5,185,
  2008–2018) and one Deduction was "lunch for staff". Teabox imported it as an ordinary
  consignor with a **$2,892.48 balance** (44 active items) — the single biggest
  "obligation", but not owed to anyone identifiable. **Done 2026-11-08 (v0.2.2):** it's
  now a Teabox `HOLDING` account — sales credit nobody until claimed for the owner's
  account from its "Waiting to be claimed" list, and it's out of payout obligations.

The 50/50-payout and bulk-lot-vendor questions below are still open.

**Bottom line:** the 800xx year accounts are mostly the **shop's own purchases**
(vendor buys, closeout/liquidation lots, bought used goods). They are **not** expired
consignments flipped to the store. Each year's account only holds stock entered that
year; unsold stock stays on its original year's account and ages out slowly. Nothing
rolls forward into the next year's account.

## 1. Not expired consignments

| Test | Result |
|---|---|
| Intake date vs. account year | Almost always the account's own year (80024: 4,855 of 4,858 entered in 2024; 80015: 659 of 677 in 2015). Flipped consignments would keep their original, earlier intake dates. |
| Ledger rows under another client | 8 of ~22,000 store-account items have a `CLIENT_TRANS` row under any other account. |
| Re-tagging (same `ITEM_NAME` + `ITEM_DESC` as a consigned item donated/returned/expired/other in the prior 60 days) | 56 of ~20,000 store items with a description match — noise. |
| Item mix | Consignor items (2023+) are ~72% sized clothing (`… LADIES`, `… MENS`, `… GL`, `… BO`). Store accounts are typically 5–15% clothing; exceptions: 80014/80015 (~34%), 80020/80021 (~37%), 80214 (77%), 80009 (2012 capris). |

What Liberty actually does with unsold consignments: closes them out as a $0
`SALE_DETAIL` with disposition **Donated** (~338,000 items in all, 10–20k a year), or
leaves them Available on the consignor's account. Liberty never moves them to the store,
so the 90-day "becomes the store's" policy isn't recorded anywhere in Liberty's data.

## 2. A mix of vendor purchases, bulk lots and bought used goods

- **Melissa & Doug** — ~5,000 M&D items overall. 2011–2012 stock went into the year
  accounts (80011: 208, 80012: 54). From 2014 to 2022 most went to a dedicated account,
  **3810 "Melissa & Doug / Vendor"** (3,463 items, cost recorded on ~1,050, avg cost
  $6.46 vs avg price $9.93). Some M&D also appears in 80014 (150), 80016 (69), 80019 (246),
  80214 (58) and account 1 (249).
- **Chicago Mattress** — only one hit by name. 22 mattress/furniture items in 2014 carry
  the brand label "SORRY NO DISCOUNT SPECIAL PURCHASE". That label marks new purchased
  goods: 196 of 677 items in 2015, 238 of 493 in 2016, 73 in 2014.
- **2023–2026: closeout/liquidation lots.** Intake arrives in big single-day batches —
  816 items on 2025-02-22, 788 on 2026-05-28, 701 on 2024-08-23, 658 on 2025-01-09. New
  goods with wholesale style codes in the description (`DA080 reflective dog vest`,
  `AN391 red panda plush`, `X8136 Mittens`), brands such as Wonder Nation, TZUMI and
  Wrangler; categories Toy / Beauty / PET / Crafts / Stationary / HO / Kitchen; average
  retail about $4–5. Cost is recorded on 15–30% of items.
- **Bought used goods** — vintage glassware, figurines, linens, furniture, movies, some
  clothing, mixed in every year.
- **Other accounts that are really store stock** (still ordinary type-1 clients in
  Liberty, not flagged as store accounts in Teabox): 1 "Shopper SAM HT STORE", 2
  "Stonecreek / KC trip" (a buying trip), 658 "Estate of Dick Marts / hidden treasures
  purchased" (854 items, 2021–22), 3163 "BAG SALE", 3096 "E-Bay Hidden Treasures /
  special bundle deal", 100 "Donations for Donations", and 3810 Melissa & Doug.

## 3. No carry-over — each year ages out

About 50–60% of each year's stock sells within a year (`pct_sold_1y` ranges 41–89%).
What's left stays on that year's account as Available:

| Account (year) | Items | Sold | Donated | Still Available | Available retail |
|---|---|---|---|---|---|
| 80016 (2016) | 493 | 385 | 0 | 99 | $554 |
| 80017 (2017) | 376 | 288 | 3 | 55 | $317 |
| 80018 (2018) | 104 | 89 | 0 | 14 | $80 |
| 80019 (2019) | 607 | 479 | 1 | 124 | $651 |
| 80020 (2020) | 410 | 254 | 83 | 69 | $599 |
| 80021 (2021) | 362 | 293 | 13 | 1 | $4 |
| 80022 (2022) | 466 | 362 | 1 | 98 | $882 |
| 80023 (2023) | 1,571 | 1,128 | 31 | 402 | $1,859 |
| 80024 (2024) | 4,858 | 2,881 | 4 | 1,378 | $5,477 |
| 80025 (2025) | 4,601 | 2,868 | 16 | 1,679 | $7,185 |
| 80026 (2026) | 2,483 | 1,020 | 0 | 1,451 | $5,196 |

- **The 2016 leftovers are probably ghosts:** 98 of its 99 Available items never had a
  tag printed.
- **80024 also has 558 items closed out as "Expired"** (2024-06 → 2026-10, $633 total
  recorded) — the only store account that uses that disposition in volume.
- **The 2015-and-earlier accounts show nothing left**, but partly because Liberty dropped
  old `CLIENT_ITEM` links: 80006 has 853 items in its ledger and none still attached;
  80006–80008 have no linked items at all. Those items are among the ~340k unlinked
  `LIB-` items Teabox puts on the built-in store account.
- **Account slots get reused.** The Liberty client IDs 81001–81036 were all created
  2002-08-23 and renamed over the years: 80026 "2026 Inventory" carries ledger rows from
  2003–2005 (it was "2035 Inventory"); 80020's note reads "waived 2002"; 80214 is "2014
  Inventory #2 — dump account to fix a problem". 80031 (Delton Products) and 80032
  (Mosser Glass) are leftover slots, not year buckets.
- **Two bulk $0 write-offs:** 80214 had 394 items donated on 2019-03-07; account 2
  (Stonecreek) had 297 closed at $0 on 2021-04-26.

## 4. The "balances" were paid out as real checks

Several years' store stock was entered at a **50/50** price code instead of "100% TO
STORE" — all of 80011–80013 (2011–13), 80017 (2017), 80021 (2021) and 80024 (2024), and
part of 80014. Liberty therefore credited half of each sale to the inventory account,
and those balances were then paid out:

| When | To | Amount |
|---|---|---|
| 2008-01-25 | 80007 | $19,669 (check 01502) |
| 2012-10-27 / 2013-04-27 (mostly) | 80006, 80008–80012 | over $60,000 across several checks/cash (80008 $16,506; 80009 $22,857; 80010 $9,925; 80011 $5,166; 80012 $5,927; plus part of 80006's $24,070) |
| 2019-03-07 | 80214 | $809 |
| 2026-01-17 | 3810 M&D ($6,192), 80024 ($6,054), 80021 ($2,066), 80023 ($1,694) | ~$16,000, checks 06420, 06421, 06423, 06424 |
| (various) | 2457 "Hidden Treasures" | $32,734 |

In **2020** one Deduction row per account (80006, 80010–80019) zeroed out what was
still owed. Note M&D is a wholesaler — a "consignor payout" to it is almost certainly
not a real payment to Melissa & Doug.

Teabox imported all of these as `PAID` payouts, so they inflate Reports' "payouts by
value" and the payout history.

## What this means for Teabox

These accounts are really **lots or buys** (when bought, from whom, at what cost), not
consignors. Flagging them `isStoreAccount` is right for now. A better long-term shape:
one store owner, plus a per-item or per-batch **acquisition** record (source — vendor,
estate, trip; date; cost), optionally grouped by "year bought" for aging. Check the
original planning docs before building it.

Cleanup candidates (not done):

- 3810 Melissa & Doug isn't flagged as a store account and still shows a $37.89
  balance; 1, 2, 658, 3163, 3096 and 100 are likewise unflagged.
- Payouts to store accounts probably shouldn't count in payout reports.

## Questions for Sherry

1. Did the 50/50 store-stock payouts (e.g. the 2026-01-17 checks, the 2012–13 batch)
   reach a real person — for example reimbursing her for buys she paid for personally —
   or were they bookkeeping?
2. Who sells the 2023–2026 bulk lots (style codes like `DA080`, `AM976`, `X8136`)?
3. Are the 2016–2022 leftovers (~460 items, ~$3,000 retail) still physically on the floor?

## How these numbers were produced

Ad-hoc read-only queries via `sqlcmd -S .\SQLEXPRESS -E -d RWD`, joining `CLIENT` →
`CLIENT_ITEM` → `ITEM` → `SALE_DETAIL` (via `ITEM.SALE_DETAIL_ID`, disposition from
`ITEM_DISPOSITION`), `CLIENT_TRANS`/`TRANS_CD` for the ledger and `PAYOUT` for payouts.
"Store accounts" = `CLIENT_TYPE_ID = 3` with `ACCOUNT LIKE '80%'`. Note: in this database
`ITEM_ACQUISITION_TYPE` is 1 Consign / 2 Purchase / 3 Trade / 4 Store Owned, and
status 18 "Unavailable" + a `SALE_DETAIL_ID` is how closed-out items look.

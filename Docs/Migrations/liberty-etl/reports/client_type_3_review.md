> **Status (2026-09-07): all excluded from the real migration for this round**,
> project-side decision made to unblock cutover rather than guess with real money on
> the line — see spec §9. Still needs Sherry's actual sort below before a follow-up
> load brings any of these in.

# "Store Account" list for Sherry to sort

These are every account in Liberty tagged `CLIENT_TYPE_ID = 3` ("Store Account").
Before we migrate them into Teabox, each one needs a category: **Store** (the shop's
own inventory, no money owed to anyone), **Vendor** (a real wholesale supplier),
**Consignor** (a real person, treated normally), or **Skip** (nothing in it, not worth
migrating).

A few are flagged with a suggested category where the pattern seems unambiguous
(zero items and zero balance, or a recognizable business with real activity) — please
correct any of these too if they're wrong. Most are marked `?` on purpose: the item
count and ledger balance often don't match what the name suggests (several
"20XX Inventory" accounts carry real dollar balances, which shouldn't happen for pure
store-owned stock), so guessing from the name alone risks attributing real money to
the wrong party.

| Liberty ID | Name | Note in Company field | Items | Ledger $ | Suggested? | Sherry's answer |
|---|---|---|---|---|---|---|
| 3200 | Laser Pegs | HT account - new product | 3 | $206.64 | Vendor | |
| 81001 | Heirlooms Faust | | 0 | $0.00 | Skip (empty) | |
| 81002 | Joe Buck / Finton Art Glass | | 0 | $0.00 | Skip (empty) | |
| 81003 | Ellsworth Bebe | | 0 | $0.00 | Skip (empty) | |
| 81004 | TREASURES past/old Inventory | Sherry Stacey | 0 | $10.38 | ? | |
| 81005 | Guy / International House Of Im[ports] | | 0 | $0.00 | Skip (empty) | |
| 81006 | 2006 Inventory | Sherry Stacey | 0 | $24,070.39 | ? — big balance, no items | |
| 81007 | 2007 Inventory | Sherry Stacey | 0 | $19,669.44 | ? — big balance, no items | |
| 81008 | 2008 Inventory | Sherry Stacey | 0 | $16,506.02 | ? — big balance, no items | |
| 81009 | 2009 Inventory | Sherry Stacey | 59 | $22,857.41 | ? | |
| 81010 | 2010 Inventory | | 1 | $9,925.21 | ? | |
| 81011 | 2011 Inventory | | 948 | $5,166.39 | ? | |
| 81012 | 2012 Inventory | Sherry Stacey | 770 | $5,926.68 | ? | |
| 81013 | 2013 Inventory | | 226 | $0.00 | ? | |
| 81015 | 2015 Inventory | | 677 | $0.00 | ? | |
| 81016 | 2014 Inventory #2 | "dump account to fix a problem / 2014 started 2nd due to error" | 938 | $808.60 | ? | |
| 81017 | Hidden Treasures 2017 | | 376 | $18.08 | ? | |
| 81018 | HIDDEN TREASURES | 2018 | 104 | $13.29 | ? | |
| 81020 | HIDDEN TREAUSURES / Hidden Treasures | waived 2002 | 410 | $0.00 | ? | |
| 81021 | Hidden Treasures | 2021 | 533 | $2,050.59 | ? | |
| 81022 | Hidden Treasures | 2022 Inventory | 471 | $1,733.24 | ? | |
| 81023 | Hidden Treasures | 2023 Inventory | 1,573 | $1,136.70 | ? | |
| 81024 | HIDDEN TREASURES | | 1,900 | $2,074.26 | ? | |
| 81025 | Hidden Treasures | | 0 | $0.00 | Skip (empty) | |
| 81027 | Hidden Treasures 2027 | | 0 | $0.00 | Skip (empty) | |
| 81028 | Hidden Treasures 2028 | | 0 | $0.00 | Skip (empty) | |
| 81029 | Hidden Treasures 2029 | | 0 | $0.00 | Skip (empty) | |
| 81030 | Hidden Treasures | 2016 Inventory | 493 | $2.49 | ? | |
| 81031 | Delton Products Corp | | 0 | $0.00 | Skip (empty)? or Vendor | |
| 81032 | Mosser Glass Inc | | 0 | $0.00 | Skip (empty)? or Vendor | |
| 81033 | Mary Parker | PD-12 | 0 | $289.34 | Consignor? | |
| 81034 | 2014 Inventory | Sherry Stacey | 1,351 | $0.00 | ? | |
| 81035 | 2035 Inventory | Sherry Stacey | 1 | $2,363.82 | ? | |
| 81036 | Hidden Treasures | 2019 Store Account | 607 | $112.12 | ? | |
| 101021 | Betty McLane-Iles | DEC 2010 | 0 | $19.90 | Consignor? | |
| 101156 | Initial purchase transactions | Hidden Treasures | 0 | $81.24 | ? | |
| 101173 | Hidden Treasures | | 2 | $32,734.30 | ? — big balance | |
| 101580 | Marlin "Sparky" Wenger | waived 16 | 1 | $71.02 | Consignor | |
| 101666 | John Smelcer | Pd 2024 | 4 | $241.96 | Consignor | |
| 101680 | Lisa Salter | "Pd-09 Sister can pick up $" | 0 | $290.57 | Consignor | |
| 102092 | NEW ACCOUNT | | 0 | $66.88 | ? | |
| 102483 | COMPTONS | USE THIS ACCOUNT | 1,370 | $7,566.72 | ? | |
| 102522 | Fridays Apparel | HT | 1,837 | $3.25 | Vendor? | |

Separately (not in this list, but flagged in the spec): **`CLIENT_ID 101508`**
("HIDDEN TREASURES 2004" / "2004 Inventory") is tagged as an ordinary `Client`
(type 1), not "Store Account" — but its ledger sums to roughly **$2 billion**, which
is clearly a data error. Worth asking Sherry if she remembers anything about this
account before we decide whether to zero it, exclude it, or hand-correct the bad
transaction.

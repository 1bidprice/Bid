# Investor Control v0.8.1 — Position and Purchase-Lot Performance

Date: 2026-07-28

## Locked product requirement

Each position card must show two clearly labelled percentages:

1. **Ημέρα** — change versus the previous market close.
2. **Από θέση** — performance versus the current open position's weighted all-in cost, including recorded purchase fees.

When the same security is purchased more than once, every purchase must remain separately visible and must retain its own:

- transaction identity;
- purchase number;
- date;
- original and remaining quantity;
- execution price;
- transaction fees;
- all-in price;
- current profit/loss amount;
- current performance percentage.

## Implementation

- Added `mobile/src/position-lots.js`.
- The engine reconstructs open purchase lots directly from the existing immutable transaction ledger.
- No transaction is merged, rewritten or migrated.
- Sales are allocated FIFO only for the expanded purchase-lot display.
- The existing portfolio accounting model v2 remains the source of the aggregate card cost, average all-in and total profit/loss.
- The position card now displays `Ημέρα` and `Από θέση` in a dedicated two-row performance block.
- Expanding the position shows `Επιμέρους αγορές`, with one card per still-open purchase lot.
- A partially sold lot displays remaining quantity versus original quantity.
- Unmatched sells are surfaced as a visible warning instead of being hidden.

## Calculation rules

- Day performance: supplied by the verified quote adapter versus previous close.
- Aggregate position performance: `(current native value - open position cost) / open position cost × 100`.
- Purchase-lot performance: `(current native price / lot all-in price - 1) × 100`.
- Purchase-lot profit/loss: `(current native price - lot all-in price) × remaining lot quantity`.

All currency output continues to use the transaction's native currency and `el-GR` formatting.

## Data preservation

- Android package remains `gr.investorcontrol.app`.
- Existing AsyncStorage transaction key is unchanged.
- No schema migration is introduced.
- No transaction, price, alert, Decision Gate or Market Intelligence record is deleted or rewritten.
- v0.8.1 uses Android versionCode `17` and the same update certificate as prior installed versions.

## Verification

Automated tests cover:

- two purchases of the same security remaining separate;
- fees included in each lot's all-in basis;
- different performance for each purchase;
- FIFO allocation after a sale;
- partial-lot remaining quantity;
- unrelated symbols remaining isolated;
- unavailable-price handling without fabricated performance.

The signed Android build workflow passed patch application, purchase-lot tests, source invariants, Expo Doctor, Android prebuild, Gradle release build, APK signing and APK artifact upload.

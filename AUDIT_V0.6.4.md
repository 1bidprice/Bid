# Investor Control v0.6.4 — Screenshot audit

Date: 2026-07-26
Scope: Installed Android build screenshots and deployed `gh-pages` assets.

## Current project position

- Product: Investor Control Android application / installable web application.
- Repository: `1bidprice/Bid`.
- Data model: local storage per device (`investor-control-state-v3`).
- Market data: automatic multi-market feed for `ALWN.GR`, `SPCE.US` and EUR/USD conversion.
- Installed version shown in the screenshots: `v0.6.4`.
- The accounting values visible in the screenshots are internally consistent for both positions; no accounting correction is recorded without contrary transaction evidence.

## Confirmed problems

### IC-064-01 — Decision Gate overlaps bottom navigation

The fixed circular Decision Gate control is rendered over the **Ρυθμίσεις** navigation item. It hides part of the icon/label and reduces the available touch target. This is visible in all three Investor Control screenshots that include the bottom navigation.

Status: fixed in v0.6.5 by anchoring the control above the navigation safe area.

### IC-064-02 — Version identifiers are fragmented in deployed assets

The installed screen reports `v0.6.4`, while deployed auxiliary scripts still contain older constants (`0.4.0`, `0.5.1`, `0.6.0`). This makes diagnosis and cache verification unreliable.

Status: partially contained in v0.6.5 by forcing one visible version and bumping the service-worker cache. Full internal version consolidation remains a separate task.

## Explicitly not recorded as bugs

- Allwyn: 193 shares, value 2,480.05 €, cost 2,630.00 €, loss 149.95 € — mathematically consistent.
- Virgin Galactic: 720 shares, value $1,800.00, cost $2,282.72, loss $482.72 — mathematically consistent.
- Portfolio summary values are consistent with EUR conversion of the USD position plus the Allwyn position, within normal FX/rounding precision.

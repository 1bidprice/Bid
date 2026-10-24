# MINBEIS Product Recovery — v1.8.1 build 33

Date: 2026-09-30  
Branch: `investor-control-minbeis-integration-v1`  
PR: #23 (draft — do not merge without Nikos's explicit approval)

## Recovery scope

This build addresses the production-quality failures observed when the app was installed by another person: foreign/local portfolio leakage, incomplete valuation visibility, misleading no-data rendering, and the absence of useful portfolio history charts.

## Fresh install and local privacy

- A new installation starts with zero transactions.
- Portfolio state is bound to a local installation owner ID.
- Legacy state with no owner and state owned by another installation are quarantined and never loaded automatically.
- The same ownership check now also runs when the app returns from background; resume cannot bypass startup isolation.
- Android backup remains disabled (`allowBackup=false`).
- Background alert and intelligence tasks reject portfolio state that is not owned by the current installation.
- The explicit "Delete all local data" flow clears AsyncStorage, removes the optional Finnhub token, resets legal acceptance, rotates the installation owner identifier and recreates an empty owned portfolio.
- Exported backup files outside the app are not deleted by the app.

## Network privacy disclosure

The app does not send portfolio quantities, acquisition cost, P/L or personal notes to the market gateway.

For market-data/research requests, the app can send:
- the requested market symbol;
- a pseudonymous technical installation/client identifier;
- normal network metadata visible to infrastructure providers, such as IP address.

The in-app legal/privacy wording and the Greek privacy-policy draft now match this behavior.

The public privacy-policy page was corrected on the `gh-pages` branch on 2026-09-30 (commit `2b54e405d7e4b1bfdffe8e8c6891b0ed0cfcdd70`) so it no longer claims that only the ticker is transmitted. It now discloses the pseudonymous technical identifier, network metadata, research-queue storage and current Cloudflare Workers Logs retention limits.

## Portfolio data correctness

The canonical portfolio engine remains fail-closed:
- a position is valued only with a verified instrument route, matching currency, valuation-eligible usable quote, positive price and required FX reference;
- unsupported/unverified positions remain stored but are excluded from aggregate valuation;
- missing data is rendered as unavailable, not silently coerced to zero.

A specific UI bug was fixed: `null` performance can no longer become `0.00%` through JavaScript numeric coercion.

Permanent Product Recovery regression now covers:
- canonical US quote -> usable valuation -> position value/P&L;
- canonical Euronext Athens quote -> usable valuation -> position value/P&L;
- presence of the value/P&L UI;
- no-data rendering contract.

## Portfolio charts

v1.8.1 introduces owned local portfolio valuation history and a line chart with:
- 1H
- 1D
- 1W
- 1M
- 6M
- 1Y

History rules:
- stored locally and tied to the current installation owner;
- recorded only when the entire portfolio has a complete verified valuation;
- minimum capture interval: 5 minutes;
- compacted over time to control storage growth;
- retained for approximately 370 days;
- no fabricated historical backfill.

Therefore a fresh v1.8.1 installation will need real observations before longer ranges contain a meaningful line. This build does not pretend to know portfolio values from periods it never observed.

Current chart scope is the total portfolio value. Per-instrument historical charts are not claimed as implemented.

## CI release gates

The mobile validation and standalone APK workflows are gated on:
- local-data ownership/privacy regression;
- portfolio-history ownership/capture/compaction regression;
- gateway-to-portfolio value/P&L regression.

The standalone APK is not allowed to proceed past the gate when any of these fail.

## Remaining evidence before Product Recovery is considered complete

1. All workflows green on the final v1.8.1 build-33 commit.
2. Standalone APK artifact produced from that exact head.
3. Clean-device/fresh-install QA demonstrating zero inherited transactions.
4. Second-install/device QA demonstrating no cross-install portfolio leakage.
5. Real transaction QA confirming value, cost and P/L on at least one US and one Euronext Athens holding.
6. Chart observation QA after multiple real samples.
7. Verify the GitHub Pages deployment serves the updated 2026-09-30 privacy page from the published `gh-pages` commit.

No PR merge or Play production/closed-testing submission is authorized by this document.

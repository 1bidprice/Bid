# Investor Control v1.1.0 — Unified Investment Intelligence

## Objective

Create one deterministic data and decision path for Portfolio, Research, Alerts and Decision Gate without modifying or migrating the user's local transaction ledger.

## Non-negotiable rules

1. One canonical quote contract per symbol.
2. A price may be visible but still be ineligible for valuation or decisions.
3. No fallback provider can silently become an official Athens Exchange source.
4. No raw provider exception is shown in the application UI.
5. Infrastructure health and portfolio/data coverage are separate states.
6. Discovery priority is not an investment score.
7. AI may propose a source; deterministic policy approves or rejects it.
8. Missing evidence produces WATCH/BLOCKED, never a fabricated directional action.
9. The application never submits broker orders.
10. Existing local transactions, costs, alerts and plans remain on the device.

## Source Governor

Policy version: `2026-08-04.1`.

Source roles:

- `PRIMARY_REGULATORY`
- `PRIMARY_EXCHANGE`
- `PRIMARY_ISSUER`
- `LICENSED_MARKET_DATA`
- `SECONDARY_INDEPENDENT`
- `FALLBACK_UNVERIFIED`
- `UNKNOWN`

Unknown domains are rejected. Independent publishers may corroborate a claim but cannot replace regulatory, exchange, issuer or licensed market data for primary facts and quotes.

## Canonical quote contract

Each quote independently declares:

- source approval and role;
- timestamp verification;
- valuation eligibility;
- decision eligibility;
- daily-change eligibility;
- public status and user-safe explanation;
- diagnostic codes.

The backend publishes a `quoteRegistry` keyed by the application's canonical symbols, such as `ALWN.GR`, `CREDIA.GR` and `SPCE.US`. The Android application revalidates freshness locally before accepting a registry quote.

## Athens Exchange fallback rule

Yahoo-derived Athens prices remain information-only. They cannot:

- value a portfolio position;
- calculate portfolio profit/loss;
- trigger a price alert;
- support Decision Gate;
- support a final BUY/SELL/HOLD conclusion.

## Operational health

The feed reports separate states for:

- infrastructure;
- market data;
- fundamentals;
- research;
- decision engine.

The global state is `OPERATIONAL` only when required coverage thresholds pass. A healthy workflow with incomplete evidence remains `DEGRADED` or `BLOCKED_BY_EVIDENCE` for decisions.

## Discovery semantics

`discoveryScore` is presented as **investigation priority**. It ranks recent official events for research allocation. It is never shown as an investment score and cannot by itself generate a buy recommendation.

## Release identity

- App version: `1.1.0`
- Android versionCode: `22`
- Package: `gr.investorcontrol.app`
- Existing update certificate must remain unchanged.

## Verification gates

- deterministic intelligence tests;
- canonical quote and Source Governor tests;
- JSON schema parsing;
- purchase-lot accounting tests;
- Expo compatibility and Expo Doctor;
- Android JavaScript export;
- native Android Gradle release build;
- APK signature and certificate check;
- embedded JavaScript bundle check.

Physical-device behavior is not considered verified until the signed APK is installed over the existing application and screenshots are reviewed.

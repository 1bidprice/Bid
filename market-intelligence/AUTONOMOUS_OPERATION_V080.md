# Investor Control v0.8.0 — Autonomous Market Intelligence Operation

Date locked: 2026-07-27

## Product outcome

The repository and Android application now support an autonomous decision cycle:

1. collect official issuer, exchange and regulatory evidence;
2. discover independent financial reporting;
3. review source documents under bounded security and copyright limits;
4. connect evidence to a canonical company and claim;
5. calculate fundamentals, valuation, price history, trend, volatility, drawdown, liquidity and relative strength deterministically;
6. detect contradictions, duplicate content, missing coverage and stale data;
7. build the complete research dossier;
8. apply a versioned final-action policy;
9. publish only a decision that passes every evidence, data-quality, freshness and risk gate;
10. deliver the verified feed to the Android app and keep an audit history.

## Final action vocabulary

- `BUY_NOW` — immediate buy setup confirmed;
- `SELL_NOW` — immediate sale or reduction for an existing holder;
- `HOLD` — existing holder should retain the position under the current thesis;
- `DO_NOT_BUY` — new capital should not enter the position under current conditions;
- `AVOID` — severe risk configuration or unsupported risk/reward;
- `WATCH` — no final direction is permitted yet.

The engine generates a global market action and separate actions for an existing holder and a non-holder. The Android application selects the relevant one by checking the user's local portfolio. No portfolio transaction key is changed.

## Immediate-action gate

A final action is blocked unless all required conditions are true:

- the dossier is `REVIEW_READY` or `PUBLISHED` and has no readiness blockers;
- a reviewed primary factual source exists;
- reviewed independent evidence confirms the same canonical claim;
- no unresolved contradiction exists;
- deterministic fundamentals are sufficiently complete;
- historical price, volume, liquidity and relative-strength metrics are sufficiently complete;
- a valid reference price exists and is fresh;
- the dossier and market history are fresh;
- thesis, causal mechanism, catalyst, bull case, bear case, material risks, invalidation and review date are complete.

`BUY_NOW` additionally requires adequate liquidity, positive trend and relative strength, acceptable fundamental risk and confidence of at least 80/100. Severe fundamental or market risk can produce `AVOID` for non-holders and `SELL_NOW` for holders.

## Continuous repository operation

The workflow on the default `main` branch runs the production source from `investor-control-v1-market-intelligence-foundation` and publishes to `investor-control-live-feed`.

Cadence:

- hourly on weekdays;
- every three hours on weekends;
- manual dispatch remains available.

Published live files:

- `mobile-intelligence-feed.json` — compact Android contract;
- `autonomous-intelligence.json` — full evidence and calculation package;
- `status.json` — feed hash, source-health counts, policy version and run identity;
- `decision-history.json` — append-only-style bounded audit history of final decisions.

The app refreshes on opening the Opportunities screen and every five minutes while that screen remains active. It preserves the last valid cached feed during network failure and refuses older or malformed payloads.

## Safety and execution boundary

The system produces decisive decision support but never sends an order to a broker. Every final-action record contains:

- `automaticBrokerOrder: false`;
- `requiresUserExecution: true`.

This is a permanent boundary unless a separate, explicitly designed and legally reviewed execution project is approved.

## Required production data configuration

Final decisions cannot be created from missing data. Production requires:

- repository variable `SEC_USER_AGENT` for compliant SEC access;
- repository secret `FINNHUB_TOKEN` for US quote access;
- appropriate entitlement for historical US price/volume data;
- a lawful backend source and licence for Allwyn/Athens historical and current market data plus structured fundamentals.

Missing configuration remains visible as blockers. The engine must never invent prices, fundamentals, sources or final actions.

## 2026-07-27 — Live credentials activation check

The repository owner confirmed that `SEC_USER_AGENT` and `FINNHUB_TOKEN` were added to GitHub Actions configuration. This commit intentionally triggers a fresh production pipeline run so the live source-health report can confirm which adapters are now active and which remaining blockers are data-entitlement or market-coverage issues rather than missing credentials.

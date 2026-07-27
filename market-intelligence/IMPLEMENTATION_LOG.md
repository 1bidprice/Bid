# Investor Control Market Intelligence — Implementation Log

## 2026-07-27 — Product direction locked

The Investor Control project continues from the installed Android v0.6.5. It is not a new application and it does not replace the existing transaction ledger, portfolio accounting, alerts or Decision Gate.

The product target is now a personal **Market Intelligence & Decision System** that can:

1. monitor official corporate, regulatory, exchange, market and macro developments;
2. resolve each development to the correct listed company and related companies;
3. separate verified facts, deterministic calculations, estimates and inference;
4. cross-check evidence and surface contradictions;
5. create autonomous, fully sourced signal candidates;
6. classify signals by investment use rather than showing a generic BUY/SELL label;
7. learn from the measured outcome of every published signal;
8. personalise ranking to the user's holdings, limits, time horizon and risk rules;
9. remain advisory and never execute orders automatically.

## Locked signal categories

- `QUALITY_COMPOUNDER`
- `VALUE_REPRICING`
- `EVENT_DRIVEN`
- `SPECULATIVE_CATALYST`
- `MOMENTUM_CONFIRMED`
- `TURNAROUND`
- `INCOME_STABILITY`
- `DETERIORATION`
- `EVENT_RISK`
- `INSUFFICIENT_EVIDENCE`

## Locked recommendation contract

No recommendation may be published as a bare BUY or SELL. Every signal must include:

- canonical company identity, symbol and exchange;
- category and proposed action;
- reference price with timestamp;
- time horizon;
- thesis and causal mechanism;
- verified catalysts;
- bull and bear case;
- risks and explicit invalidation condition;
- confidence and data-quality score;
- evidence list and contradiction notes;
- review date;
- outcome tracking fields.

## Source hierarchy

1. Regulatory filings and official exchange disclosures.
2. Issuer Investor Relations and official company announcements.
3. Independent high-quality financial reporting.
4. Licensed market, fundamental and macro datasets.
5. Alternative data only as supporting evidence.
6. Social media may trigger investigation but can never support a published signal on its own.

## Publication gate

A material signal needs either:

- at least one primary, high-reliability factual source; or
- at least two independent reliable sources.

The system must block publication when evidence is stale, social-only, materially contradictory without resolution, or not connected to the canonical company identity.

## Training strategy

Initial development uses deterministic calculations, retrieval of current evidence, structured outputs and continuous evaluation. Fine-tuning is deferred until a sufficiently large, reviewed history of signals and outcomes exists.

Every signal will eventually be measured at 1 day, 1 week, 1 month, 3 months, 6 months and 12 months, including maximum adverse excursion, maximum favourable excursion and catalyst confirmation/failure.

## Coverage sequence

### Stage 1

- current portfolio;
- watchlist;
- Allwyn AG (`ATHEX: ALWN`);
- Virgin Galactic Holdings, Inc. (`NYSE: SPCE`);
- Athens Exchange core universe;
- S&P 500 and Nasdaq-100.

### Stage 2

- active NYSE and Nasdaq equities;
- Euronext regulated equities.

### Stage 3

- additional exchanges only where lawful, reliable and economically sustainable data access exists.

## 2026-07-27 — First working pipeline completed

Completed on branch `investor-control-v1-market-intelligence-foundation`:

- company identity, evidence-record and market-signal schemas;
- canonical seed registry for Allwyn AG and Virgin Galactic;
- evidence publication gate and deterministic signal ranking;
- official Allwyn regulatory-announcement adapter;
- official SEC EDGAR recent-filings adapter;
- deterministic event classification;
- end-to-end daily intelligence runner;
- deep-document-review guard that forces index/title-level discoveries to remain `DRAFT / WATCH`;
- scheduled daily GitHub Actions execution at 05:30 UTC;
- manual and branch-triggered pipeline execution;
- archived JSON output for every successful run;
- tests covering source adapters, event classification, schema discipline and guarded actions;
- successful expanded CI on commit `272cdaf99f2a493473a905bb4fac5f905e8bcc1b`.

Operational configuration still required:

- repository variable `SEC_USER_AGENT` must contain an identifying SEC-compliant User-Agent before live SPCE EDGAR collection is considered production-ready.

Next implementation target:

- retrieve underlying filing and announcement documents, not only index metadata;
- extract verified claims and numeric facts;
- calculate deterministic market, valuation, liquidity and balance-sheet metrics;
- cross-check independent evidence;
- produce the first complete Allwyn and SPCE signal reports with thesis, bull case, bear case, risks, invalidation condition, confidence and review date.

## Non-negotiable rules

- No fabricated facts, prices, metrics or sources.
- AI never calculates critical financial numbers when code can calculate them.
- Inference is labelled as inference.
- Conflicting evidence is shown, not hidden.
- Failed signals remain in history.
- Existing Android local data and accounting keys remain untouched until an explicit migration is designed and tested.

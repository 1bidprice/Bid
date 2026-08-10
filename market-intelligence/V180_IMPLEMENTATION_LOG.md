# Investor Control v1.8.0 — Implementation Checkpoint

Date: 2026-08-11

This file records the implementation state of the forecasting architecture defined in `FORECAST_ENGINE_V180.md`. It is intentionally separate from older v1.x implementation history so the v1.8 forecasting work can be audited without rewriting prior records.

## Locked product direction

Investor Control v1.8.0 is a backend-first, multi-asset probabilistic forecasting system. It does not replace the existing evidence, risk, execution or final-action gates and it does not execute broker orders.

The forecasting architecture must combine validated historical-pattern evidence with asset-specific fundamentals/valuation, momentum/trend, volatility/risk, relative strength/peers, events/catalysts, macro/regime and portfolio context. A confidence score or data-quality score is never interpreted as a probability of appreciation.

## Implemented and verified

### Historical Pattern Engine

- multi-horizon return/trend/volatility/drawdown/volume/trajectory features;
- robust median/MAD standardisation;
- historical analog similarity;
- regime conditioning;
- purged independent historical anchors;
- empirical forward-return distributions;
- explicit raw historical positive frequency;
- no calibrated probability until OOS validation exists;
- strict fail-closed behaviour when history is insufficient;
- regression test proving future data after the forecast as-of cannot change the forecast.

### Probabilistic Forecast Contract

- raw pattern probability is separate from calibrated probability;
- expected return and bear/base/bull distribution fields;
- supporting/opposing/neutral drivers separated;
- unverified drivers explicitly excluded;
- unknowns and invalidation conditions retained;
- forecast promotion remains separate from final-action eligibility.

### Walk-forward validation

- expanding-window chronological simulation;
- `WALK_FORWARD_OOS` records only;
- outcome observed only after the forecast horizon elapses;
- calibration metrics include Brier score, log loss, expected calibration error, base-rate benchmark and probabilistic skill;
- subperiod stability diagnostics;
- walk-forward validator cannot emit or promote a final trade action.

### Explainable Forecast Drivers

- peer-normalized valuation, quality, growth and momentum;
- relative strength and SMA regime;
- volatility and drawdown;
- liquidity as execution evidence, never automatically bullish;
- profitability, free cash flow, dilution, cash runway and verified risk flags;
- verified catalysts and thesis risks retain evidence IDs;
- absolute low P/S or P/B cannot be called “cheap” without peer-normalized evidence.

### Autonomous shadow integration

- real autonomous dossiers now generate forecasts in `SHADOW_ONLY` mode;
- `decisionImpact: NONE`;
- `finalActionEligible: false`;
- existing final action is retained as an independent comparison snapshot;
- historical candles are kept in-memory for forecast computation and are not dumped into the production report;
- short history produces `LONG_HISTORY_REQUIRED_FOR_PATTERN_LEARNING` instead of a fabricated forecast.

### Forecast Outcome Ledger

- append-only deterministic forecast IDs;
- live forecasts use `LIVE_SHADOW_OOS`;
- historical validation uses `WALK_FORWARD_OOS`;
- `IN_SAMPLE` records are excluded from probability calibration;
- each horizon remains `OPEN` until its future market outcome exists;
- matured records capture realised return and positive/negative outcome;
- a matured result cannot be overwritten by an older OPEN copy;
- calibration summaries group actual matured OOS outcomes by asset class and horizon.

## Verified checkpoint

Branch: `investor-control-v1-market-intelligence-foundation`

Forecast Outcome Ledger commit: `6dc2d9b61afac9a3bd49265256d07ce4dbe6f47e`

Market Intelligence deterministic suite: **220/220 PASS, 0 FAIL**.

Runtime release: **v1.8.0**.

PR #14 remains **Draft / unmerged**.

## Current data limitation

The existing Finnhub daily-history path defaults to approximately 420 calendar days. That is useful for market metrics but is not enough to claim serious multi-year historical-pattern learning or calibration.

An existing Yahoo Chart adapter can provide adjusted historical data and is classified as `SECONDARY_VALIDATED`, but long-history use must remain research-only unless its overlapping recent history is cross-checked against canonical market data. A secondary provider must never silently become execution-grade evidence.

## Next engineering target

1. Build a long-history research data layer with multi-year coverage and explicit provenance.
2. Cross-check overlapping recent closes/returns against canonical market history and fail closed on material mismatch.
3. Create a persistent forecast-outcome archive so live `LIVE_SHADOW_OOS` records survive successive production runs.
4. Mature open forecast outcomes automatically as each horizon becomes observable.
5. Run calibration/skill/stability gates by asset class and horizon.
6. Only after sufficient OOS evidence exists, allow calibrated forecasts to become one input to the existing final-action engine.

## Non-negotiable invariants

- no look-ahead leakage;
- no survivorship-biased “perfect” history;
- no in-sample result used for calibration;
- no confidence/data-quality score presented as probability;
- no uncalibrated historical hit rate presented as final probability;
- no hidden contradictions or fabricated missing data;
- no forecast may bypass evidence, risk, liquidity or execution gates;
- no automatic broker order.

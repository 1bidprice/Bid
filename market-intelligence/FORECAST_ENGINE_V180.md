# Investor Control v1.8.0 — Historical Pattern & Probabilistic Forecast Engine

Status: **LOCKED ARCHITECTURE / IMPLEMENTATION STARTED**  
Date: 2026-08-11  
Scope: backend market intelligence first. No mobile UI work is required for this stage.

## 1. Objective

Investor Control must evolve from a deterministic research/rules engine into a multi-asset **probabilistic forecasting and decision system** that can:

1. read long historical paths for each supported instrument;
2. discover recurring historical market states and sequence patterns;
3. test whether those patterns contain out-of-sample predictive information;
4. combine validated historical-pattern evidence with fundamentals, valuation, momentum, macro regime, events, risk, liquidity, peers and portfolio context;
5. estimate a probability distribution of future outcomes over multiple horizons;
6. explain exactly what supports and opposes the forecast;
7. convert only validated, calibrated forecasts into an input to the separate final-action engine;
8. learn continuously from the real outcome of every forecast and recommendation.

The system must **never claim certainty** and must never interpret a confidence/data-quality score as a probability of price appreciation.

## 2. Supported asset architecture

The common forecasting contract applies to all supported asset classes, while the factor set and model are asset-specific:

- Equities: price/volume, fundamentals, valuation, balance sheet, earnings, revisions, peer relative strength, corporate events.
- ETFs: price/volume, breadth, holdings, concentration, flows, tracking quality, fees, factor/sector regime.
- Funds: NAV/performance, benchmark alpha, downside control, holdings, fees, manager consistency.
- Bonds: yield, spread, duration, curve, credit quality, default/upgrade risk, rate regime.
- Crypto: price/volume/liquidity, token supply/tokenomics, network/protocol metrics when lawful and reliable, market regime.
- FX: rate differentials, macro divergence, carry, volatility, positioning when reliable, risk regime.
- Commodities: spot/front price, futures curve, inventories, supply-demand, USD/rates, seasonality and macro regime.
- Futures: underlying regime, curve, expiry, basis, liquidity, margin/risk and strategy context.
- Options: implied/realised volatility, skew/term structure, Greeks, liquidity, payoff asymmetry and strategy context.
- Cash: real yield, liquidity, counterparty quality and optionality.

No model may reuse an equity-specific interpretation for a different asset class merely because a price series exists.

## 3. Historical Pattern Engine

### 3.1 Input discipline

Every observation used at forecast time `t` must have been available at or before `t`.

Mandatory controls:

- timestamped observations;
- corporate-action-adjusted history where appropriate;
- delisted/failed instruments retained where required to avoid survivorship bias;
- no revised future fundamentals leaking into past feature snapshots;
- no future candles, outcomes or benchmark values used in a historical feature snapshot;
- explicit currency and session handling;
- transaction costs/slippage considered before decision promotion.

### 3.2 Pattern families

The engine searches recurrent states across multiple families rather than a single chart pattern:

- multi-horizon returns and momentum;
- moving-average/trend state;
- drawdown and recovery structure;
- realised/downside volatility and volatility regime;
- volume, turnover and liquidity regime;
- gap/acceleration/deceleration structure where data permits;
- relative strength versus benchmark, sector and peer cohort;
- fundamental + price combinations;
- event + price-response combinations;
- macro + asset-response combinations;
- cross-asset state combinations;
- sequence similarity over recent trajectory windows.

The first production implementation starts with robust price/volume trajectory features and expands in asset-specific layers.

### 3.3 Historical analog search

For each current state:

1. construct a feature snapshot using only information known at the anchor date;
2. build the historical candidate set whose future horizon outcome is fully known by the current as-of date;
3. robustly standardise features to avoid scale domination;
4. compare the current state against historical states;
5. condition on compatible regime where appropriate;
6. rank by similarity;
7. purge overlapping/near-duplicate anchors so one market episode cannot masquerade as dozens of independent examples;
8. calculate the empirical forward-return distribution from the retained analogs.

The output includes sample size, effective sample size, similarity, historical analog summaries and the full return distribution.

## 4. Forecast horizons and output distribution

Canonical horizons:

- 1 trading day;
- 1 week (5 trading days where applicable);
- 1 month (~21 sessions);
- 3 months (~63 sessions);
- 6 months (~126 sessions);
- 12 months (~252 sessions).

For every supported horizon the engine should eventually provide:

- calibrated probability of positive return;
- expected return;
- median return;
- bear/base/bull cases;
- p10/p25/p75/p90 return distribution;
- downside probability;
- expected/observed adverse excursion where available;
- confidence and data quality as separate concepts;
- sample/effective-sample information;
- regime and historical analog evidence.

## 5. Raw pattern probability is not a final probability

The fraction of positive historical analogs is recorded as `rawPatternProbabilityPositive`.

It must **not** be exposed as the final investment probability until it passes chronological walk-forward out-of-sample calibration.

Therefore:

- raw analog frequency may be used for research;
- `probabilityPositive` remains null until calibrated;
- the forecast remains research-only;
- the final-action engine cannot use it as a directional probability until promotion gates pass.

## 6. Anti-overfitting and multiple-pattern controls

Because a system searching millions of patterns will always find attractive coincidences, the following controls are non-negotiable:

- chronological train / validation / test separation;
- purged walk-forward validation;
- embargo around validation windows where overlapping labels can leak information;
- minimum independent sample size;
- effective sample-size measurement;
- regime stability checks;
- multiple-testing correction / false-discovery control for large pattern searches;
- no hyperparameter selection on the final holdout period;
- benchmark against simple naive models;
- reject patterns whose apparent edge disappears after costs or across subperiods;
- retain failed patterns and failed forecasts in the ledger.

A visually impressive backtest is not sufficient evidence.

## 7. Walk-forward calibration

Every historical and future forecast must be recorded with the model version, raw probability and realised outcome.

Only forecasts generated in strict chronological `WALK_FORWARD_OOS` mode are allowed into the probability calibration dataset.

Tracked calibration metrics include:

- Brier score;
- log loss;
- expected calibration error;
- base-rate Brier score;
- probabilistic skill versus the naive base rate;
- sample size overall and by probability region.

Initial calibration uses empirical probability bins with shrinkage toward the OOS base rate. More advanced calibration may replace it only after evidence proves superior out-of-sample performance.

Promotion into the decision layer requires all of:

- minimum OOS sample size;
- positive skill versus naive probability;
- acceptable calibration error;
- adequate local support around the probability being issued.

## 8. Ensemble forecasting layer

The final forecast is not controlled by historical pattern similarity alone.

The ensemble combines independent evidence families, each with its own provenance and reliability:

1. Historical Pattern / Sequence model.
2. Fundamental quality and deterioration model.
3. Valuation / relative-value model.
4. Momentum / trend model.
5. Volatility / risk model.
6. Relative strength / peer model.
7. Event / catalyst model.
8. Macro / market-regime model.
9. Asset-specific model.
10. Portfolio fit / concentration / diversification context.

Scores are not automatically converted into probabilities. Probability outputs must be learned and calibrated from OOS outcomes.

## 9. Explainability contract

Every forecast must expose both the case **for** and **against** the trade.

Required explainability fields:

- supporting verified drivers;
- opposing verified drivers;
- neutral drivers;
- unverified drivers explicitly excluded from the decision;
- unknown/missing data;
- invalidation conditions;
- evidence IDs and source counts;
- evidence quality;
- contradiction count;
- historical analog count and effective sample size;
- pattern/regime match;
- model and policy versions.

A future recommendation such as BUY/HOLD/SELL must be able to answer: **“Why exactly?”** without relying on opaque prose.

## 10. Decision layer

The forecast engine does not directly submit or execute a trade.

Once promotion gates pass, calibrated forecast distributions may become an input to the existing final-action policy together with:

- portfolio ownership state;
- risk limits;
- liquidity/execution quality;
- expected return versus downside;
- evidence quality;
- unresolved contradictions;
- costs/slippage;
- asset-specific hard risk gates.

Target user actions:

- Non-holder: `BUY`, `WAIT`, `AVOID`.
- Holder: `ADD`, `HOLD`, `REDUCE`, `SELL`.

The engine must always keep automatic broker execution disabled unless a completely separate future product decision explicitly changes that boundary.

## 11. Learning loop

For every forecast/recommendation, the outcome ledger must retain:

- forecast timestamp and version;
- raw and calibrated probabilities;
- forecast distribution;
- final action;
- reference price;
- realised returns at canonical horizons;
- maximum favourable/adverse excursion;
- market regime;
- catalyst success/failure;
- thesis success/failure.

The system periodically re-evaluates calibration and pattern/model skill. A model losing OOS skill is downgraded or removed; it is never protected merely because it worked historically.

## 12. v1.8.0 implementation sequence

### Phase A — implemented first

- Historical Pattern Engine foundation.
- Strict as-of/no-lookahead logic.
- Robust historical analog similarity.
- Purged independent anchors.
- Empirical multi-horizon forward-return distributions.
- OOS calibration metrics and calibration gate.
- Probabilistic Forecast Contract and explainability structure.

### Phase B

- Walk-forward forecast generator over archived historical series.
- calibration dataset persistence;
- naive benchmark comparison;
- subperiod/regime stability tests;
- multiple-testing controls.

### Phase C

- asset-specific pattern/factor collectors for ETF, bonds, crypto, FX, commodities, futures/options and cash;
- relative/peer/cross-asset feature panels;
- macro-regime integration.

### Phase D

- ensemble model;
- calibrated probability distribution;
- expected utility / downside-aware decision bridge;
- explainable BUY/ADD/HOLD/REDUCE/SELL/WAIT/AVOID recommendation.

### Phase E

- shadow/live validation;
- mobile presentation only after the engine is demonstrably correct and auditable.

## 13. Locked safety invariants

- No look-ahead leakage.
- No survivorship-biased “perfect” universe.
- No probability from a confidence score.
- No uncalibrated historical hit rate shown as final probability.
- No pattern promotion without sufficient independent OOS support.
- No recommendation without explicit opposing evidence and invalidation logic.
- No hidden contradictions.
- No fabricated missing data.
- No model may bypass final risk, evidence or execution gates.
- No automatic broker order.

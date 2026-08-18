# Investor Control v1.8.0 — Forecast-Time Market Regime Lineage Checkpoint

Date: 2026-08-12

## Verified code checkpoint

Verified v1815 code head: `15b99f87f98bb3bbfbc26f4ba022bdc2cae78ee9`.

Runtime release: **v1.8.0**.
Runtime patch chain: **64 unique test patches / 63 unique build patches**.

v1815 establishes immutable forecast-time market-regime lineage using benchmark history that the production pipeline already retrieves. It does not introduce a new market-data provider and does not change final-action logic.

## Purpose

The Historical Pattern / Forecast engine must eventually know not only whether a historical setup looks similar, but also whether it occurred under a comparable market environment.

v1815 therefore freezes benchmark context at forecast time so future OOS analysis can answer questions such as:

- did this pattern work mainly in risk-on or risk-off conditions;
- did the factor score behave differently in bull, bear or mixed benchmark trends;
- did high-volatility environments change hit rate, realised return or drawdown;
- is apparent model skill stable across distinct market regimes.

v1815 intentionally stops before using regime context to alter pattern ranking, probabilities, factor weights or BUY/HOLD/SELL.

## Existing data reused

No new provider or network dependency was added.

The existing market-history pipeline already fetches benchmark daily history alongside each instrument:

- US: SPY benchmark history;
- Athens: the existing Athens benchmark resolution/fallback path (`GD.AT` / related canonical fallback handling).

Previously that benchmark series was consumed for relative-strength metrics and then discarded.

v1815 keeps the same already-fetched benchmark series in an internal `benchmarkSeriesCollector` Map for the duration of the autonomous run only.

Raw benchmark candles are not persisted into the report or archive.

## Forecast-time market regime contract

New core module:

`src/forecast-market-regime.js`

Contract:

`FORECAST_TIME_MARKET_REGIME_SNAPSHOT_V1`

Policy version:

`2026-08-12.1`

The snapshot records compact research metadata only:

- captured timestamp;
- benchmark as-of timestamp;
- benchmark symbol/source/source quality;
- observation count;
- regime status/key;
- risk tone;
- trend regime;
- momentum regime;
- volatility regime;
- 20/60/120-period benchmark returns;
- SMA50 / SMA200;
- 20/60-period annualized volatility;
- rolling 20-period volatility percentile;
- 120-period maximum drawdown.

Permanent authority boundary:

- `researchOnly:true`;
- `modelDerived:true`;
- `finalActionEligible:false`;
- `decisionImpact:'NONE'`.

Raw `series` or `candles` fields are explicitly forbidden by the validator.

## No-lookahead boundary

The regime builder normalizes benchmark history and applies a strict cutoff:

`benchmark candle timestamp <= capturedAt`.

Future benchmark candles are excluded before any regime metric is calculated.

The validator also rejects:

- a benchmark timestamp later than snapshot capture;
- a snapshot captured after the forecast timestamp;
- benchmark data later than the forecast timestamp;
- incomplete regime identity;
- non-research usage;
- any final-action authority;
- raw benchmark-series leakage.

## Regime definitions

### Trend

- `BULL_TREND`: benchmark close > SMA50 and SMA200, with positive 60-period return;
- `BEAR_TREND`: benchmark close < SMA50 and SMA200, with negative 60-period return;
- otherwise `MIXED_TREND`.

### Momentum

- positive 20- and 60-period returns: `POSITIVE_MOMENTUM`;
- negative 20- and 60-period returns: `NEGATIVE_MOMENTUM`;
- otherwise `MIXED_MOMENTUM`.

### Volatility

Current annualized 20-period volatility is ranked against the recent rolling-volatility distribution:

- percentile >= 67: `HIGH_VOLATILITY`;
- percentile <= 33: `LOW_VOLATILITY`;
- otherwise `NORMAL_VOLATILITY`.

### Risk tone

- bull trend + positive momentum + non-high volatility: `RISK_ON`;
- bear trend, or negative momentum combined with high volatility: `RISK_OFF`;
- otherwise `NEUTRAL`.

## Immutable OOS lineage

The market regime is built in `shadow-forecast-engine.js` from the forecast-time benchmark series.

It is attached to the shadow forecast as compact research metadata before persistence.

`forecast-outcome-ledger.js` validates the candidate again before freezing it on a new OOS record.

The forecast identity remains unchanged.
Market-regime metadata is deliberately excluded from `forecastId`.

Therefore adding regime metadata cannot create a second OOS sample for the same instrument / horizon / trading date.

## NO-BACKFILL invariant

v1815 extends the already proven immutable-lineage merge boundary.

If an existing forecast identity does not contain a market-regime snapshot, a later run cannot attach one retroactively.

If an existing forecast identity already contains a valid market-regime snapshot, that original snapshot is preserved exactly through maturation.

This prevents current benchmark conditions from being written onto historical forecasts.

## Archive verification

The production forecast archive verifier remains backward compatible:

- legacy records without regime metadata are valid;
- new records may contain a regime snapshot;
- if present, the snapshot is validated strictly against the forecast timestamp.

The verifier rejects:

- future benchmark data;
- capture after forecast;
- final-action authority;
- non-research metadata;
- raw benchmark candle/series leakage.

Archive cycle telemetry adds `candidateMarketRegimeSnapshotRecordCount` for observability only.

## Dedicated regression coverage

Six pure market-regime tests verify:

1. smooth positive benchmark context becomes READY bull / positive-momentum / low-volatility / risk-on;
2. falling high-volatility context becomes bear / negative-momentum / high-volatility / risk-off;
3. future benchmark candles are excluded by the as-of cutoff;
4. insufficient benchmark history fails closed;
5. post-forecast regime timestamps are rejected;
6. decision authority or non-research use is rejected.

Nine lineage tests verify:

1. benchmark history stays internal and is passed only to shadow research;
2. regime metadata does not change forecast identity;
3. only valid READY regime metadata is frozen;
4. NOT_READY or post-forecast regime metadata is not persisted;
5. a legacy forecast without regime cannot be backfilled;
6. an original regime snapshot is preserved exactly through maturation;
7. legacy records without regime remain archive-compatible;
8. future or decision-authority regime metadata is rejected;
9. raw benchmark series leakage is rejected.

## CI correction history

The first activated v1815 run reached the full deterministic suite:

- 370 tests executed;
- 369 passed;
- 1 failed.

The only failure was a test-fixture construction error in the lineage test for post-forecast regime metadata.

The fixture moved `capturedAt` to the future but also allowed the helper to use that future time as the forecast timestamp, so the fixture was not actually post-forecast.

Fix commit:

`15b99f87f98bb3bbfbc26f4ba022bdc2cae78ee9`

The fix changed only the test helper by allowing a fixed forecast-time override.

No v1815 production source, metric, threshold, regime definition or validator rule changed.

## Final deterministic verification

Market Intelligence workflow run: `31539117618`.
Job: `93937225694`.

Result: **370/370 PASS, 0 FAIL**.

The run also passed:

- source governor / quote / feed contracts;
- all JSON schemas;
- runtime migration uniqueness with **64 unique test patches**.

Test artifact id: `9119960948`.
Recorded deterministic artifact digest: `sha256:38132647929e3bdaf98744c7f5a71c24731426c8bbe12ef62903fd18a7bb719f`.

## Mobile and Android regression boundary

Mobile validation workflow run: `31539117446` — **SUCCESS**.

Standalone Android workflow run: `31539117542` — **SUCCESS**.

Android artifact:

- artifact id: `9120216756`;
- name: `investor-control-standalone-release-apk`;
- archive digest: `sha256:4f72ad422dcd9d8e4e7c51869dabc903c198fd4902a8983fb6bfb6dc3e4df16e`.

The exact-head Android run completed:

- release identity verification;
- Android project generation;
- Gradle release build;
- embedded JavaScript bundle verification;
- artifact upload.

No mobile source file changed in v1815.

## Successful production publication

Production workflow run: `31488784580`.
Verified v1815 rerun job: `93937793476`.

The full production path completed **SUCCESS**:

- verified source checkout;
- 370 deterministic tests/contracts;
- autonomous intelligence build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- regime-aware forecast archive verification;
- transactional live publication;
- remote feed re-verification;
- evidence artifact upload.

Latest production evidence artifact:

- artifact id: `9120080318`;
- digest: `sha256:17cabdf67f270a01abc6043956dcf1b3edf22563e814fee36c639cb0cb697b65`.

## Verified live status

Live source commit:

`15b99f87f98bb3bbfbc26f4ba022bdc2cae78ee9`

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At this publication:

- analysed companies: 32;
- market snapshots: 32;
- ready historical metric sets: 31;
- fundamental snapshots: 31;
- factor-learning lineage records: 107;
- matured factor-score OOS records: 15;
- factor-learning promotion candidate groups: 0;
- factor-attribution lineage records: 107;
- manual weight-review candidates: 0;
- governance lineage records: 107;
- governance groups: 2;
- governance proposals: 0;
- forecast outcome records: 157;
- OPEN: 108;
- MATURED: 49.

All automatic authority flags remain false:

- automatic factor-weight adjustment: false;
- automatic governance proposal application: false;
- probability calibration integration: false;
- factor decision integration: false;
- factor influence on final action: false.

## Real shadow-regime evidence

The live autonomous report contains 32 shadow forecasts and forecast-time market-regime snapshots produced before persistence.

Observed live benchmark contexts include:

### US / SPY

- benchmark: SPY;
- benchmark as-of: `2026-08-11T13:30:00.000Z`;
- source: Yahoo Finance Chart;
- source quality: `SECONDARY_VALIDATED`;
- regime: `NEUTRAL|BULL_TREND|HIGH_VOLATILITY|POSITIVE_MOMENTUM`;
- risk tone: `NEUTRAL`.

### Athens / GD.AT

- benchmark: GD.AT;
- benchmark as-of: `2026-07-17T07:30:00.000Z`;
- source: Yahoo Finance Chart;
- source quality: `SECONDARY_VALIDATED`;
- regime: `NEUTRAL|BULL_TREND|NORMAL_VOLATILITY|MIXED_MOMENTUM`;
- risk tone: `NEUTRAL`.

These snapshots remain research-only and have no final-action authority.

## Real archive no-backfill proof

Previous v1814 archive:

- 151 records;
- 0 market-regime snapshots.

New v1815 archive:

- 157 records;
- 6 market-regime snapshots.

Identity comparison:

- common forecast IDs: **151**;
- new forecast IDs: **6**;
- removed forecast IDs: **0**;
- regime backfills on common old IDs: **0**;
- regime changes on common old IDs: **0**;
- new forecast IDs carrying valid regime snapshot: **6/6**.

The six new records are OPEN OOS records for RDVT, INUV and GRWG across day1/week1 horizons.

All six freeze the actual US SPY regime at forecast time.

No raw `candles` or `series` field exists in any frozen regime snapshot.

## Diff safety from v1814

Compared with v1814 checkpoint `1452c30ef569f01f138c0c5c8b4583d9ea7c0be7`, v1815 changes only five market-intelligence artifacts:

- `config/runtime-release-manifest.json`;
- `scripts/apply-v1815-forecast-market-regime-lineage.js`;
- `src/forecast-market-regime.js`;
- `test/forecast-market-regime-lineage.test.js`;
- `test/forecast-market-regime.test.js`.

No mobile, portfolio, accounting ledger, factor-weight configuration, Opportunity Hunter scoring or final-action production source file changed.

## Current algorithmic boundary

v1815 does **not** use market regime to improve or modify forecasts yet.

That is deliberate.

The next safe phase is **Regime-Stratified OOS Learning**:

- group matured OOS forecasts by their immutable forecast-time regime;
- measure model performance separately by risk tone / regime key;
- measure hit rate, realised return, calibration/skill and factor discrimination conditional on regime;
- require adequate OOS sample and regime coverage before drawing conclusions;
- prohibit automatic reweighting, probability promotion or BUY/HOLD/SELL influence.

Only after this conditional evidence matures should regime context be considered as an input to historical-analog weighting or forecast calibration.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**.

This checkpoint does not authorize:

- merge;
- Play Store publication;
- automatic broker execution;
- automatic factor reweighting;
- automatic application of governance proposals;
- market-regime probability promotion;
- market-regime influence on final BUY/HOLD/SELL.

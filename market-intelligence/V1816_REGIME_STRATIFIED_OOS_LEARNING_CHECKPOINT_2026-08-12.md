# Investor Control v1.8.0 — Regime-Stratified OOS Learning Checkpoint

Date: 2026-08-12

## Verified code checkpoint

Verified v1816 code head:

`35b0a8843253b25de6f284c34c8e0f6f833d5a08`

Runtime release: **v1.8.0**.
Runtime patch chain: **65 unique test patches / 64 unique build patches**.

v1816 adds a research-only OOS learning layer that measures historical-pattern forecast performance conditionally on the immutable market regime that was frozen at forecast time by v1815.

It does not alter forecasts, factor weights, historical-analog ranking, portfolio state or final BUY/HOLD/SELL actions.

## Regime-learning lineage

New source module:

`src/forecast-regime-learning-status.js`

Contract:

`investor-control-forecast-regime-learning-status`

Policy version:

`2026-08-12.1`

Only records satisfying all of the following enter the lineage:

- `validationMode === LIVE_SHADOW_OOS`;
- explicit `historicalPatternPolicyVersion`;
- matured OOS outcome with strict numeric binary outcome 0/1;
- valid immutable forecast-time `marketRegimeSnapshot` for regime-specific evaluation.

Model groups remain separated by:

- historical-pattern policy version;
- asset class;
- horizon.

Within each model group, matured evidence is further stratified by the immutable `regimeKey`.

No current-day regime lookup is performed during this learning pass.

## Regime coverage gate

The engine first evaluates whether enough matured OOS history actually contains a valid forecast-time regime snapshot.

Default minimum matured-regime coverage:

**70%**.

The coverage object records:

- total matured OOS count;
- matured records with valid regime snapshot;
- matured legacy records without regime;
- invalid regime snapshots;
- regime coverage percentage;
- coverage blockers.

An invalid snapshot blocks coverage readiness even if the percentage floor would otherwise pass.

This prevents the engine from drawing regime conclusions from a small recent subset while most older matured outcomes lack immutable regime lineage.

## Per-regime metrics

For each model/horizon/regime cohort, v1816 measures:

- matured sample size;
- positive and negative outcome counts;
- positive hit rate;
- mean realised return;
- median realised return;
- mean expected return;
- mean and median realised-minus-expected forecast error;
- mean raw probability of a positive outcome;
- probability sample size;
- realised-return sample size;
- expected-return sample size.

Probability calibration is measured through the existing OOS calibration engine, including:

- Brier score;
- log loss;
- calibration error / bins;
- base-rate benchmark;
- probabilistic skill where sufficient evidence exists.

String probabilities are not coerced into numeric probabilities.
Only strict numeric values in [0,1] are eligible.

## Per-regime research thresholds

Default research readiness requires all of the following in the same immutable regime cohort:

- matured OOS sample >= **60**;
- positive outcomes >= **10**;
- negative outcomes >= **10**;
- distinct forecast dates >= **20**;
- distinct instruments >= **8**;
- maximum one-date share <= **15%**;
- effective non-overlapping outcome windows >= **8**;
- maximum one-instrument share <= **30%**;
- inverse-HHI effective instrument count >= **5**;
- complete strict numeric probability sample;
- OOS calibration metrics ready.

These gates are in addition to the model-level regime coverage requirement.

The status can become `REGIME_RESEARCH_READY` only after every blocker is absent.

## Permanent authority boundary

Even a statistically READY regime remains research-only.

At top level, group level and regime level, the following remain disabled:

- automatic regime weighting;
- probability-calibration integration;
- factor reweighting;
- decision integration;
- influence on final BUY/HOLD/SELL.

No regime result can submit an order or modify broker execution.

## Production safety firewall

New source module:

`src/forecast-regime-production-safety.js`

Policy version:

`2026-08-12.1`

The production verifier independently checks the serialized regime-learning object before publication.

It verifies:

- research-only contract and version;
- all authority flags remain false;
- group and ready-regime counts match the actual serialized groups;
- every `REGIME_RESEARCH_READY` cohort has model-level coverage READY;
- READY cohorts contain zero blockers;
- calibration is `OOS_METRICS_READY`;
- sample independence is READY;
- outcome-window independence is READY;
- instrument diversification is READY;
- compact operational telemetry exactly matches the full regime-learning object.

A serialized status string alone is never trusted.

## Compact operational telemetry

The live `operationalHealth` now includes:

- `forecastRegimeObservabilityContract`;
- regime-learning lineage record count;
- group count;
- ready-regime count;
- matured OOS count;
- matured OOS count with valid regime lineage;
- all five authority flags, permanently false.

The compact status does not contain raw OOS records or raw benchmark history.

## Pure research verification

Pure regime-learning core commit:

`2c4a760d58f28457adb685191ad5c41baa4ac103`

Pure Market Intelligence workflow run:

`31540171527`

Job:

`93940545711`

Result:

**378/378 PASS, 0 FAIL**.

The eight dedicated research regressions verify:

1. two forecast-time regimes are measured independently;
2. low regime coverage blocks conclusions;
3. post-forecast regime snapshots are excluded;
4. raw sample size cannot replace date and outcome-window independence;
5. one-instrument dominance blocks regime research;
6. string probabilities cannot enter calibration by coercion;
7. model-version and horizon lineages stay separate;
8. even fully READY regime research retains zero decision authority.

## v1816 runtime and safety verification

v1816 runtime migration:

`scripts/apply-v1816-regime-stratified-oos-learning.js`

Production safety regressions:

`test/forecast-regime-production-safety.test.js`

Six additional tests verify:

1. no-regime lineage remains a valid zero-count research-only production state;
2. a statistically READY regime remains authority-free;
3. any attempt to enable decision integration is rejected;
4. a serialized READY regime whose statistical gate is later weakened is rejected;
5. telemetry/full-object mismatches are rejected;
6. transformed runtime wiring includes full research status, compact telemetry and the strict production verifier.

## Final deterministic verification

Verified code head:

`35b0a8843253b25de6f284c34c8e0f6f833d5a08`

Market Intelligence workflow run:

`31540543156`

Job:

`93941704998`

Result:

**384/384 PASS, 0 FAIL**.

The run also passed:

- source-governor / quote / feed contracts;
- all JSON schemas;
- runtime migration uniqueness with **65 unique test patches**.

Test artifact:

- artifact id: `9120491029`;
- digest: `sha256:4c35a10358cdd06ee84b831696eb2ccdf658b599a2e60fafc7b2f4c901c011db`.

## Mobile and Android regression boundary

Mobile validation workflow run:

`31540543144` — **SUCCESS**.

Standalone Android workflow run:

`31540543098` — **SUCCESS**.

Android artifact:

- artifact id: `9120700863`;
- name: `investor-control-standalone-release-apk`;
- archive digest: `sha256:201bcdbe46f56544c9bd3cf3cdda008264eaf3c000c3ac09ef418f5379c5c58a`.

The exact-head Android run completed release identity verification, Android project generation, Gradle release build, embedded JavaScript bundle verification and artifact upload.

No mobile source file changed in v1816.

## Successful production publication

Production workflow run:

`31488784580`

Verified v1816 production job:

`93942034783`

The full production path completed **SUCCESS**:

- verified source checkout;
- 384 deterministic tests/contracts;
- autonomous intelligence build;
- existing factor-research production safety;
- new regime-stratified production safety;
- Opportunity Hunter safety;
- forecast archive safety;
- transactional live publication;
- remote feed re-verification;
- evidence artifact upload.

Latest production evidence artifact:

- artifact id: `9120579138`;
- digest: `sha256:fee3f16de7c3e3ddb2c4d3742f5867bd03035ce6962e47cf3d0d560348e8a302`.

## Verified live status

Live source commit:

`35b0a8843253b25de6f284c34c8e0f6f833d5a08`

Runtime release:

`1.8.0`

Operational status:

`OPERATIONAL`

`staleOutput:false`.

Live regime telemetry:

- regime-learning lineage records: **157**;
- model/horizon groups: **2**;
- ready regimes: **0**;
- matured OOS records: **49**;
- matured OOS records with valid forecast-time regime: **0**;
- automatic regime weighting: false;
- probability-calibration integration: false;
- factor reweighting: false;
- decision integration: false;
- regime influence on final action: false.

## Why READY regimes = 0 is the correct result

The v1815 forecast-time market-regime lineage only began on new forecast identities.

The existing 49 matured OOS records predate that lineage and therefore correctly remain without regime metadata under the NO-BACKFILL rule.

The new v1815 regime-tagged records are still OPEN and have not yet matured.

The live full regime-learning object therefore shows:

### EQUITY / day1

- matured OOS: **49**;
- matured with valid regime: **0**;
- regime coverage: **0%**;
- minimum required coverage: **70%**;
- blocker: `MARKET_REGIME_MATURED_COVERAGE_TOO_LOW`;
- ready regimes: **0**.

### EQUITY / week1

- matured OOS: **0**;
- valid regime matured: **0**;
- blockers include matured-history required and regime coverage too low;
- ready regimes: **0**.

This is an intentional fail-closed result, not a defect.

No historical regime backfill is performed simply to increase coverage.

## Other live research state

At the same publication:

- factor-learning lineage records: **107**;
- matured factor-scored OOS records: **15**;
- factor promotion candidates: **0**;
- factor-attribution manual weight-review candidates: **0**;
- factor-governance proposals: **0**;
- forecast outcome records: **157**;
- OPEN: **108**;
- MATURED: **49**.

All factor and regime automatic-authority flags remain false.

## Diff safety from v1815

Compared with v1815 checkpoint `6d9fed5aacc8575b7fcc4e968fb5a173d64f2ad6`, v1816 changes only six Market Intelligence artifacts:

- `config/runtime-release-manifest.json`;
- `scripts/apply-v1816-regime-stratified-oos-learning.js`;
- `src/forecast-regime-learning-status.js`;
- `src/forecast-regime-production-safety.js`;
- `test/forecast-regime-learning-status.test.js`;
- `test/forecast-regime-production-safety.test.js`.

No mobile, portfolio, transaction, accounting-ledger, factor-weight configuration, Opportunity Hunter scoring or final-action production source file changed.

## Current algorithmic boundary

v1816 measures conditional model performance by immutable market regime but does **not** use that information to modify the model.

The next safe algorithmic phase is **Regime-Conditional Factor / Driver Performance**:

- evaluate the latent factor score inside each immutable regime;
- evaluate factor domains such as Momentum, Quality, Valuation, Risk and Catalysts separately inside each regime;
- measure ROC AUC, outcome spread, realised-return spread and feature coverage conditionally on regime;
- require adequate regime coverage, matured OOS sample, dates, instruments and non-overlapping windows;
- identify only research evidence such as `SUPPORTED_IN_REGIME`, `INVERTED_IN_REGIME` or `INCONCLUSIVE`;
- prohibit automatic weight changes, probability changes or final-action influence.

Only after substantial matured regime-specific OOS evidence exists should regime-aware historical-analog weighting or calibration be considered.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**.

This checkpoint does not authorize:

- merge;
- Play Store publication;
- automatic broker execution;
- automatic factor reweighting;
- automatic governance proposal application;
- regime-based probability adjustment;
- regime-aware historical analog weighting;
- regime-based BUY/HOLD/SELL influence.

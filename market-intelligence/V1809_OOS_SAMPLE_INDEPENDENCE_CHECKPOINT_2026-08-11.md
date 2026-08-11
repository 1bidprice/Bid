# Investor Control v1.8.0 — OOS Sample Independence Checkpoint

Date: 2026-08-11

## Verified code checkpoint

Verified v1809 code head: `75c65174e28148e949d9c0fdce7b338f3d151e25`.

Runtime release: **v1.8.0**.
Runtime patch chain: **58 unique test patches / 57 unique build patches**.

The v1809 layer adds an effective out-of-sample sample-independence gate to factor learning, factor attribution and manual factor-weight governance. It only makes future research-promotion and weight-review gates stricter. It does not change factor coefficients, current weights, probability calibration, final-action rules or broker execution.

## Statistical problem closed

Raw OOS record count is not sufficient evidence of independent statistical support.

Many instruments observed on the same trading date share market regime, macro conditions and cross-sectional shocks. Treating all of those records as independent can create pseudo-replication and overstate the effective OOS evidence base.

v1809 therefore requires independent support in addition to the existing raw sample floors.

## OOS independence contract

Shared contract: `OOS_SAMPLE_INDEPENDENCE_V1`.

Policy version: `2026-08-11.1`.

The gate evaluates:

- distinct forecast dates;
- distinct instrument identities;
- missing forecast-date records;
- missing instrument identities;
- maximum single-date record concentration;
- the most concentrated forecast date.

Strict date parsing is fail-closed. Malformed `YYYY-MM-DD` dates are not silently normalized into another calendar date.

Instrument identity is resolved from immutable OOS record identity in this order:

1. `instrumentId`;
2. `companyId`;
3. immutable listing MIC + symbol fallback.

## Thresholds

Factor learning / promotion:

- existing raw matured OOS floor remains in force;
- at least **40 distinct forecast dates**;
- at least **10 distinct instruments**;
- no single forecast date may exceed **10%** of the matured sample.

Factor-domain attribution / manual weight-review nomination:

- existing raw matured OOS and class-support floors remain in force;
- at least **40 distinct forecast dates**;
- at least **10 distinct instruments**;
- no single forecast date may exceed **10%** of the matured sample.

Factor Weight Governance:

- existing **300 matured OOS** governance floor remains in force;
- existing positive/negative class support and domain-coverage requirements remain in force;
- at least **60 distinct forecast dates**;
- at least **10 distinct instruments**;
- no single forecast date may exceed **10%** of the matured governance sample.

The independence thresholds are additive safety requirements. They do not replace any previous sample-size, discrimination, temporal-stability or attribution gate.

## Date-preserving temporal stability

The previous chronological split divided records by record count. With multiple instruments on one trading date, a single date could theoretically be split across adjacent temporal blocks.

v1809 changes factor-learning and governance temporal partitioning so that all observations from the same forecast date stay in the same chronological block.

This prevents one market regime/date shock from appearing in two different stability periods merely because many instruments were observed that day.

## Regression coverage

Six dedicated v1809 regressions were added:

- rejects excessive one-date concentration even with sufficient raw records, dates and instruments;
- accepts properly diversified date/instrument support and fails closed on missing identity;
- verifies chronological blocks never split one forecast date;
- blocks factor promotion when 240 raw records come from only 20 forecast dates;
- blocks factor-attribution manual review when 220 records come from only five instruments;
- blocks a governance proposal when 360 records come from fewer than 60 distinct forecast dates.

Existing successful factor-learning, attribution and governance fixtures were updated to represent diversified instrument identities rather than identity-less synthetic records.

## CI defect found and corrected

The first activated v1809 CI run reached **312/317 PASS**.

All six new independence regressions passed. The five failures were limited to the older production-safety test helper: it generated synthetic governance records with dates but no `companyId` or `instrumentId`.

The new independence gate correctly refused to create the synthetic weight proposal, which caused the downstream adversarial safety tests to have no proposal object to mutate.

This was not a production-engine defect and the independence gate was not weakened.

Only the legacy production-safety fixture was corrected to use 20 distinct synthetic instrument identities.

Final fixture-only fix commit: `75c65174e28148e949d9c0fdce7b338f3d151e25`.

## Final source verification

Market Intelligence workflow run `31483858126`: **SUCCESS**.

Deterministic suite: **317/317 PASS, 0 FAIL**.

Runtime patch chain applied: **58 unique test patches**.

Mobile validation workflow run `31483858116`: **SUCCESS**.

Standalone APK workflow run `31483858104`: **SUCCESS**.

The APK verified the embedded JavaScript bundle and uploaded the standalone artifact successfully on the exact v1809 code head.

## Successful production publication

Production workflow run: `31481179075`.
Successful v1809 rerun job: `93754974118`.

The production path completed **SUCCESS end-to-end**:

- verified source checkout;
- deterministic source contracts/tests;
- autonomous live intelligence build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- forecast outcome archive verification;
- transactional live publication;
- remote published-feed re-verification;
- evidence artifact upload.

The production verifier and all existing governance restrictions remained unchanged and fail-closed.

## Verified live state

Live source commit: `75c65174e28148e949d9c0fdce7b338f3d151e25`.

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At publication:

- factor-learning lineage records: **17**;
- matured factor-score OOS records: **0**;
- factor-learning promotion candidates: **0**;
- factor-attribution lineage records: **17**;
- manual weight-review candidates: **0**;
- governance lineage records: **17**;
- governance groups: **2**;
- governance proposals: **0**;
- governance status: `NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS`.

Verified safety flags remain:

- `forecastFactorAutomaticWeightAdjustmentEnabled:false`;
- `forecastFactorAutomaticProposalApplicationEnabled:false`;
- `forecastFactorProbabilityCalibrationEnabled:false`;
- `forecastFactorDecisionIntegrationEnabled:false`;
- `forecastFactorMayInfluenceFinalAction:false`.

## Live independence evidence

The production evidence artifact contains the new `sampleIndependence` objects inside the real factor learning, attribution and governance status objects.

Because no factor outcomes have matured yet, the current independence status is correctly `INDEPENDENCE_NOT_READY` with sample size zero.

Factor learning/attribution live thresholds are present as:

- minimum distinct forecast dates: 40;
- minimum distinct instruments: 10;
- maximum one-date concentration: 10%.

Governance live thresholds are present as:

- minimum distinct forecast dates: 60;
- minimum distinct instruments: 10;
- maximum one-date concentration: 10%.

No weight proposal is therefore possible before both the existing raw OOS floors and the new independence requirements pass.

## Current forecast archive state

At the same publication:

- forecast outcome records: **67**;
- OPEN: **67**;
- MATURED: **0**;
- forecast-learning live OOS records: **67**;
- long-history research ready: **0**;
- long-history rejected: **8**.

The research stack remains in evidence-collection mode. It has no permission to promote the factor model or alter weights from open records.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**. This checkpoint does not authorize merge.

## Next statistical boundary

The next remaining independence risk is overlapping future outcome windows.

For multi-session horizons such as week1 or month1, forecasts created on nearby trading dates may share much of the same realised-return window. Distinct forecast dates alone therefore do not guarantee independent outcome evidence.

Any next research-safety layer should evaluate horizon-aware overlap/effective independent outcome windows before model promotion or weight governance is allowed. It must be fail-closed and must not change forecasts, weights, final actions or execution authority.

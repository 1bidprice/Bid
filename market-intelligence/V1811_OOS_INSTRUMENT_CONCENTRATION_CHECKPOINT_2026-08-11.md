# Investor Control v1.8.0 — OOS Instrument Concentration Checkpoint

Date: 2026-08-11

## Verified code checkpoint

Verified v1811 code head: `f83b0189732fe716d7b5096a9ff11bd3042b8599`.

Runtime release: **v1.8.0**.
Runtime patch chain: **60 unique test patches / 59 unique build patches**.

v1811 closes a third OOS pseudo-replication risk: a statistically large sample can still be dominated by one instrument or by a small cluster of instruments even after distinct-date, distinct-instrument and non-overlapping-outcome-window gates pass.

The layer only makes research promotion, factor attribution and manual factor-weight governance stricter. It does not change factor coefficients, current weights, probability calibration, final-action rules or broker execution.

## Why distinct instrument count was not enough

v1809 already requires at least 10 distinct instruments. That alone does not prevent concentration. For example, three instruments could supply most observations while seven additional instruments appear only rarely.

v1811 therefore adds two independent concentration measures:

1. maximum share of the matured sample contributed by a single instrument;
2. effective instrument count using inverse Herfindahl concentration: `1 / sum(p_i^2)`.

The second measure blocks a small dominant cluster even when every individual instrument remains just below the single-instrument cap.

## Immutable identity source

The concentration gate uses the existing immutable OOS instrument identity resolver:

1. `instrumentId`;
2. `companyId`;
3. immutable listing MIC + symbol fallback.

Missing instrument identity is fail-closed.

Contract: `OOS_INSTRUMENT_CONCENTRATION_V1`.
Policy version: `2026-08-11.1`.

Statuses:

- `INSTRUMENT_DIVERSIFICATION_READY`;
- `INSTRUMENT_DIVERSIFICATION_NOT_READY`.

Blockers include:

- `OOS_INSTRUMENT_CONCENTRATION_SAMPLE_EMPTY`;
- `OOS_INSTRUMENT_IDENTITY_MISSING_FOR_CONCENTRATION`;
- `OOS_SINGLE_INSTRUMENT_CONCENTRATION_TOO_HIGH`;
- `OOS_EFFECTIVE_INSTRUMENT_COUNT_TOO_SMALL`.

## Thresholds

Factor Learning / promotion:

- all previous raw OOS, date, instrument-count and outcome-window gates remain required;
- maximum one-instrument share: **25%**;
- effective instrument count: **at least 6**.

Factor Attribution / manual weight-review nomination:

- all previous gates remain required;
- maximum one-instrument share: **25%**;
- effective instrument count: **at least 6**.

Factor Weight Governance:

- existing 300 matured OOS floor remains required;
- existing 60 distinct forecast dates, 10 distinct instruments and <=10% one-date concentration remain required;
- existing 18 effective non-overlapping outcome-window requirement remains required;
- all class-support, attribution and temporal-stability gates remain required;
- maximum one-instrument share: **20%**;
- effective instrument count: **at least 8**.

These thresholds are additive and do not replace previous safeguards.

## Production-verifier hardening

Any future governance proposal must independently pass production verification of its instrument-concentration evidence.

The verifier requires:

- contract `OOS_INSTRUMENT_CONCENTRATION_V1`;
- status `INSTRUMENT_DIVERSIFICATION_READY`;
- governance single-instrument threshold no weaker than 20%;
- governance effective-instrument threshold at least 8;
- zero missing instrument identities;
- actual maximum instrument share at or below the declared threshold;
- actual effective instrument count at or above the declared threshold.

This verification runs in addition to the existing sample-independence, outcome-window, weight-sum, RISK-floor, rollback, versioning and manual-only governance checks.

## Regression coverage

Seven dedicated v1811 regressions were added:

- balanced 20-instrument OOS sample is diversification-ready;
- one instrument contributing 30% is blocked even with 10 distinct instruments;
- inverse-HHI effective count blocks a three-instrument dominant cluster while the individual 25% cap still passes;
- Factor Learning cannot promote strong date/window-ready evidence dominated by a small instrument cluster;
- Factor Attribution cannot nominate manual weight review from the same concentrated evidence;
- Weight Governance rejects concentrated evidence even when raw sample, date and outcome-window gates pass;
- Production Safety independently rejects weakened instrument-diversification evidence on an otherwise valid proposal.

No legacy positive-path test fixture needed to be weakened or specially bypassed. Existing diversified fixtures already represented 20 balanced instruments.

## Final source verification

Market Intelligence workflow run `31487026788`: **SUCCESS**.

Deterministic suite: **332/332 PASS, 0 FAIL**.

Runtime patch chain applied: **60 unique test patches**.

Mobile validation workflow run `31487026783`: **SUCCESS**.

Standalone APK workflow run `31487026809`: **SUCCESS**.

The exact-head Android run successfully completed:

- Gradle release APK build;
- embedded JavaScript bundle verification;
- standalone APK artifact upload.

## Successful production publication

Production workflow run: `31485148969`.
Successful v1811 rerun job: `93764946021`.

The production path completed **SUCCESS end-to-end**:

- verified source checkout;
- deterministic source contracts/tests;
- autonomous live-intelligence build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- forecast outcome archive verification;
- transactional live publication;
- remote published-feed re-verification;
- evidence artifact upload.

## Verified live state

Live source commit: `f83b0189732fe716d7b5096a9ff11bd3042b8599`.

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At publication:

- analysed companies: 32;
- current market snapshots: 32;
- ready historical sets: 32/32;
- fundamental snapshots: 32;
- factor-learning lineage records: 29;
- matured factor-score OOS records: 0;
- factor-learning promotion candidates: 0;
- factor-attribution lineage records: 29;
- manual weight-review candidates: 0;
- governance lineage records: 29;
- governance groups: 2;
- governance proposals: 0;
- governance status: `NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS`.

Verified safety flags remain:

- `forecastFactorAutomaticWeightAdjustmentEnabled:false`;
- `forecastFactorAutomaticProposalApplicationEnabled:false`;
- `forecastFactorProbabilityCalibrationEnabled:false`;
- `forecastFactorDecisionIntegrationEnabled:false`;
- `forecastFactorMayInfluenceFinalAction:false`.

## Live v1811 evidence

The successful production evidence artifact contains the real `instrumentConcentration` objects.

Factor Learning and Factor Attribution expose:

- contract `OOS_INSTRUMENT_CONCENTRATION_V1`;
- maximum one-instrument threshold **25%**;
- minimum effective instrument count **6**;
- current status `INSTRUMENT_DIVERSIFICATION_NOT_READY` because matured sample size is zero.

Factor Weight Governance exposes:

- maximum one-instrument threshold **20%**;
- minimum effective instrument count **8**;
- current status `INSTRUMENT_DIVERSIFICATION_NOT_READY`;
- zero proposals.

This is the correct live state. OPEN forecasts contribute archive coverage but cannot satisfy a matured concentration gate.

## Current forecast archive state

At the same live publication:

- forecast outcome records: **79**;
- OPEN: **79**;
- MATURED: **0**;
- forecast-learning live OOS records: **79**.

No OPEN record can authorize model promotion or weight changes.

## Sector / correlated-cluster boundary

The company identity schema contains sector and optional industry metadata, but the immutable OOS forecast records do not currently persist sector/industry snapshots.

Therefore v1811 intentionally does **not** infer historical sector concentration from today's company classification. Doing so could create historical classification leakage if an issuer's sector metadata changes over time.

A future sector/cluster concentration gate must first persist an immutable classification snapshot on NEW forecast records. Existing historical records must not be retrospectively filled from current metadata and must not be silently pooled with the new classification lineage.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**. This checkpoint does not authorize merge.

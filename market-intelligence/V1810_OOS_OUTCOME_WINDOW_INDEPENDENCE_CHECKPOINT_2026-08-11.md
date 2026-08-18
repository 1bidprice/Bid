# Investor Control v1.8.0 — OOS Outcome-Window Independence Checkpoint

Date: 2026-08-11

## Verified code checkpoint

Verified v1810 code head: `b6f9271b4b3d96c16d251502be8a12f402571b31`.

Runtime release: **v1.8.0**.
Runtime patch chain: **59 unique test patches / 58 unique build patches**.

v1810 closes a second OOS pseudo-replication risk: forecasts from different dates can still share most of the same future realised-return window. This matters especially for week1, month1, month3, month6 and month12 horizons.

The layer only makes future research-promotion, factor attribution and manual weight-governance gates stricter. It does not change factor weights, score coefficients, calibrated probabilities, final-action rules or broker execution.

## Horizon map

The existing historical-pattern engine defines these forecast horizons:

- day1: 1 trading session;
- week1: 5 trading sessions;
- month1: 21 trading sessions;
- month3: 63 trading sessions;
- month6: 126 trading sessions;
- month12: 252 trading sessions.

The outcome-window gate uses the actual matured archive interval rather than an estimated calendar window:

- start: `referencePrice.timestamp`;
- end: `realisedOutcome.timestamp`;
- horizon metadata: `tradingDays`.

## Outcome-window independence contract

Shared contract: `OOS_OUTCOME_WINDOW_INDEPENDENCE_V1`.

Policy version: `2026-08-11.1`.

For each matured statistical sample:

1. all records from the same `forecastSampleDate` are collapsed into one conservative date cohort;
2. cohort start is the earliest valid reference timestamp on that date;
3. cohort end is the latest realised-outcome timestamp on that date;
4. cohorts are sorted by end time;
5. the maximum set of non-overlapping cohort windows is selected with deterministic interval scheduling.

This prevents many instruments on one forecast date and many adjacent forecast dates from artificially inflating the effective temporal OOS sample.

The gate fails closed on:

- empty samples;
- missing or invalid outcome-window fields;
- inconsistent `tradingDays` inside one evaluated horizon group;
- too few effective non-overlapping outcome windows.

Strict timestamp parsing also rejects malformed calendar-date prefixes instead of silently normalizing impossible dates.

## Thresholds

Factor Learning / promotion:

- all previous raw OOS and sample-independence gates remain required;
- at least **12 effective non-overlapping outcome windows**.

Factor Attribution / manual weight-review nomination:

- all previous raw OOS, date-diversity and instrument-diversity gates remain required;
- at least **12 effective non-overlapping outcome windows**.

Factor Weight Governance:

- existing **300 matured OOS** floor remains required;
- existing 60 distinct forecast dates, 10 distinct instruments and <=10% one-date concentration remain required;
- all class-support, attribution and temporal-stability gates remain required;
- at least **18 effective non-overlapping outcome windows**.

These thresholds are additive. They do not replace any previous safety gate.

## Production-verifier hardening

The production safety verifier independently re-checks any future governance proposal and rejects it unless the proposal evidence contains:

- `OOS_SAMPLE_INDEPENDENCE_V1` with `INDEPENDENCE_READY`;
- distinct-date threshold at least 60;
- distinct-instrument threshold at least 10;
- one-date concentration threshold no weaker than 10%;
- no missing forecast dates or instrument identities;
- `OOS_OUTCOME_WINDOW_INDEPENDENCE_V1` with `WINDOW_INDEPENDENCE_READY`;
- governance non-overlap threshold at least 18;
- zero invalid window records;
- effective non-overlapping windows at or above the declared threshold.

The verifier therefore rejects a future serialization or configuration change that attempts to weaken the v1809/v1810 evidence contract even if the governance engine itself were accidentally bypassed.

## Regression coverage

Eight dedicated v1810 regressions were added:

- 60 consecutive month1 forecast dates do not masquerade as 60 independent windows;
- 12 truly non-overlapping month1 windows satisfy the learning threshold;
- 20 instruments from one forecast date collapse into one conservative time cohort;
- malformed window fields and inconsistent horizon metadata fail closed;
- factor learning cannot promote 240 strong records when effective month1 time support is too small;
- factor attribution cannot nominate manual weight review from heavily overlapping month1 outcomes;
- governance cannot propose a weight change from 360 strong records across 60 dates when the realised windows still overlap too heavily;
- the production verifier independently rejects weakened outcome-window or date-independence evidence.

Legacy synthetic positive-path fixtures were aligned with the real archive contract by including `tradingDays`, `referencePrice.timestamp` and `realisedOutcome.timestamp`. The gates themselves were not weakened.

## Final source verification

Market Intelligence workflow run `31485744385`: **SUCCESS**.

Deterministic suite: **325/325 PASS, 0 FAIL**.

Runtime patch chain applied: **59 unique test patches**.

Mobile validation workflow run `31485744331`: **SUCCESS**.

Standalone APK workflow run `31485744343`: **SUCCESS**.

The exact-head Android run successfully completed:

- Gradle release APK build;
- embedded JavaScript bundle verification;
- standalone APK artifact upload.

## Successful production publication

Production workflow run: `31485148969`.
Successful v1810 rerun job: `93761125357`.

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

Live source commit: `b6f9271b4b3d96c16d251502be8a12f402571b31`.

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At publication:

- analysed companies: 32;
- current market snapshots: 32;
- ready historical sets: 31/32;
- fundamental snapshots: 32;
- factor-learning lineage records: 24;
- matured factor-score OOS records: 0;
- factor-learning promotion candidates: 0;
- factor-attribution lineage records: 24;
- manual weight-review candidates: 0;
- governance lineage records: 24;
- governance groups: 2;
- governance proposals: 0;
- governance status: `NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS`.

Verified safety flags remain:

- `forecastFactorAutomaticWeightAdjustmentEnabled:false`;
- `forecastFactorAutomaticProposalApplicationEnabled:false`;
- `forecastFactorProbabilityCalibrationEnabled:false`;
- `forecastFactorDecisionIntegrationEnabled:false`;
- `forecastFactorMayInfluenceFinalAction:false`.

## Live v1810 evidence

The successful production evidence artifact contains the real v1810 outcome-window objects.

Factor Learning groups expose:

- contract `OOS_OUTCOME_WINDOW_INDEPENDENCE_V1`;
- threshold **12** effective non-overlapping windows;
- current status `WINDOW_INDEPENDENCE_NOT_READY` because matured sample size is 0.

Factor Attribution domain evaluations expose the same contract and **12-window** threshold.

Factor Weight Governance domain evaluations expose:

- the same outcome-window contract;
- threshold **18** effective non-overlapping windows;
- current status `WINDOW_INDEPENDENCE_NOT_READY`;
- zero proposals.

This is the correct current state. OPEN forecasts may increase archive coverage but cannot satisfy a matured outcome-window gate.

## Current forecast archive state

At the same live publication:

- forecast outcome records: **74**;
- OPEN: **74**;
- MATURED: **0**;
- forecast-learning live OOS records: **74**;
- long-history research ready: 0;
- long-history research rejected: 8.

The research system remains in evidence-collection mode. No OPEN record can authorize model promotion or weight changes.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**. This checkpoint does not authorize merge.

## Next statistical boundary

The next independence risk is cross-sectional concentration by instrument and correlated group. v1809 requires at least 10 distinct instruments, but it does not yet limit how much of the matured statistical evidence may come from one instrument or a small correlated cluster/sector.

Any next safety slice should first address direct per-instrument concentration using immutable instrument identity, then evaluate whether a reliable sector/group identity exists before adding a broader cluster-concentration gate. It must remain research-only and fail closed without changing weights, forecasts, final actions or execution authority.

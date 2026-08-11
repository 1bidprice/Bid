# Investor Control v1.8.0 — Factor Production Observability Checkpoint

Date: 2026-08-11

## Verified source checkpoint

Production-observability source commit: `1678b8264ee75abd147d0536cba61551764ab9a9`.

Runtime release: **v1.8.0**.
Runtime patch chain: **57 unique test patches / 56 unique build patches**.

The v1808 layer adds compact live observability and fail-closed production verification for factor learning, factor attribution and manual-only factor-weight governance. It does not change factor weights, forecast probabilities, final actions or broker execution.

## Source verification

Market Intelligence workflow run `31479481811` completed **SUCCESS**.

Deterministic suite: **311/311 PASS, 0 FAIL**.

Source/quote contract checks and all JSON schema parse checks passed.

Mobile validation workflow run `31479481820` completed **SUCCESS**.

Standalone APK workflow run `31479481824` was still in the Gradle release-build step at the time this checkpoint was written. It had not reported a failure. This backend-only observability checkpoint does not claim an APK success that was not yet verified.

## Production safety contract

Production observability contract:

`FACTOR_RESEARCH_GOVERNANCE_OBSERVABILITY_V1`

The autonomous report exposes only compact factor telemetry through the canonical production `operationalHealth` object:

- factor-learning lineage record count;
- matured scored count;
- factor-learning promotion-candidate group count;
- factor-attribution lineage count;
- factor-attribution manual-weight-review candidate count;
- governance lineage count;
- governance group count;
- governance proposal count;
- governance status;
- five explicit research/automation safety flags.

Raw factor-domain snapshots, before/after weight vectors and raw proposal payloads are not copied into `operationalHealth` or live `status.json`.

## Fail-closed verifier

The existing production verifier now independently checks the factor research/governance contract before publication and again after remote publication.

It rejects, among other conditions:

- automatic weight adjustment or automatic proposal application;
- probability calibration or decision integration enabled by governance;
- final-action influence from factor governance;
- stale or non-current feature-vector/factor-score lineage;
- malformed proposal identities or directions;
- before/after weight vectors that do not sum to 1.0;
- direct factor-weight changes beyond the bounded proposal limit;
- any proposal that reduces the RISK weight;
- missing new-policy-version requirement;
- rollback plans that do not restore the prior full vector;
- retrospective rewriting of historical OOS records;
- telemetry counters that do not match the actual factor status objects;
- raw proposal payload leaking into operational health.

The verifier was intentionally not weakened while production integration defects were corrected.

## Production integration defects found and fixed

Early v1808 production attempts correctly failed before publication because the new telemetry was not present in the final canonical `operationalHealth` object.

Two ordering assumptions were rejected during verification:

1. Adding a second return-level `operationalHealth` property was unsafe because an older production patch already owned the canonical health object.
2. Mutating `baseReport.operationalHealth` was also insufficient because the later canonical production health object replaced it.

The final root cause was the historical patch chain:

- the v1.0 production patch creates the return-level production health object;
- the v1.1 unified-intelligence patch replaces/extends that object and adds `blockedDecisionCount` before `staleOutput:false`.

The final v1808 fix anchors to that actual unified health block and spreads `...forecastFactorOperationalTelemetry` inside the single canonical production `operationalHealth` writer.

No verifier relaxation was used to make production pass.

## Successful live production verification

Production workflow run: `31469755715`, final successful rerun job `93741661849`.

The final attempt completed **SUCCESS end-to-end**:

- source checkout;
- deterministic tests;
- autonomous intelligence build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- forecast archive verification;
- transactional live publication;
- published-remote re-verification;
- evidence artifact upload.

## Verified live state

Live publication after the successful run:

- source commit: `1678b8264ee75abd147d0536cba61551764ab9a9`;
- runtime release: `1.8.0`;
- operational status: `OPERATIONAL`;
- stale output: `false`;
- factor observability contract: `FACTOR_RESEARCH_GOVERNANCE_OBSERVABILITY_V1`;
- factor-learning lineage records: **7**;
- matured factor-score OOS records: **0**;
- factor-learning promotion-candidate groups: **0**;
- factor-attribution lineage records: **7**;
- attribution manual-weight-review candidates: **0**;
- factor-governance lineage records: **7**;
- factor-governance groups: **2**;
- factor-governance proposals: **0**;
- governance status: `NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS`.

Verified live safety flags:

- `forecastFactorAutomaticWeightAdjustmentEnabled:false`
- `forecastFactorAutomaticProposalApplicationEnabled:false`
- `forecastFactorProbabilityCalibrationEnabled:false`
- `forecastFactorDecisionIntegrationEnabled:false`
- `forecastFactorMayInfluenceFinalAction:false`

The zero-proposal result is expected and correct because no factor-model outcomes have matured yet.

## Forecast archive / long-history live state

At the same successful publication:

- forecast outcome records: **57**;
- OPEN: **57**;
- MATURED: **0**;
- long-history research ready: **0**;
- long-history rejected: **8**;
- independent overlap attempted: **0**;
- independent overlap ready: **0**;
- independent overlap rejected: **8**.

The missing independent Twelve Data witness therefore continues to fail closed rather than permitting Yahoo history to validate itself.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**. This checkpoint does not authorize merging it.

## Next statistical boundary

Before matured factor OOS records can eventually support model promotion or weight-review proposals, raw record count alone must not be treated as statistical independence. Multiple instruments observed on the same trading date may share the same market regime and can create pseudo-replication.

The next permitted research-safety layer should therefore evaluate **effective OOS sample independence** using at minimum distinct forecast dates, distinct instruments and chronological/date-cluster support. This layer must only make promotion/governance gates stricter; it must not change existing forecasts, weights or final actions.

# Investor Control v1.8.0 — Factor OOS Learning Checkpoint

Date: 2026-08-11

## Verified implementation

Code commit: `35b453f39f1ecc141f4a8b276f28d18bb99bebaa`

Workflow run: `31455083620`

Deterministic Market Intelligence suite: **281/281 PASS, 0 FAIL**.

Runtime release: **v1.8.0**.

Runtime migration chain: **54 unique patches**.

## Purpose

The deterministic multi-factor latent score is evaluated independently from the historical-pattern probability model. It is not treated as a probability and is not passed through Brier score, log loss or calibration-error metrics.

The factor-learning layer consumes only actual `LIVE_SHADOW_OOS` records carrying an explicit `factorScorePolicyVersion`. Historical pre-factor records, `WALK_FORWARD_OOS` records from other model families and `IN_SAMPLE` data are excluded from this live factor promotion sample.

## Model-version isolation

Every learning group is keyed by:

- `factorScorePolicyVersion`;
- asset class;
- forecast horizon.

Future changes to the factor model therefore start a separate learning lineage instead of silently pooling incompatible scores.

## Coverage accounting

Per group the system records:

- factor-lineage record count;
- score-ready record count;
- blocked/unavailable factor-score count;
- OPEN scored count;
- MATURED scored count;
- positive and negative matured outcome counts;
- progress toward the minimum matured-score floor.

An OPEN forecast can contribute to lineage/coverage telemetry but never to discrimination metrics.

## OOS discrimination metrics

The latent score is evaluated using ranking/discrimination metrics appropriate for a non-probabilistic score:

- ROC AUC;
- top-quartile versus bottom-quartile empirical positive-outcome rate;
- top-minus-bottom positive-rate spread;
- top-quartile versus bottom-quartile mean realised return;
- top-minus-bottom realised-return spread;
- fixed score bins across `[-1,+1]`;
- empirical positive rate and mean realised return per sufficiently populated bin;
- monotonic-ordering inversion count.

No probability mapping is produced by this layer.

## Default promotion thresholds

A factor group cannot become a promotion candidate unless all of the following pass:

- at least 200 matured scored live OOS records;
- at least 30 positive outcomes;
- at least 30 negative outcomes;
- ROC AUC at least 0.56;
- top-versus-bottom positive-rate spread at least 0.10;
- top-versus-bottom realised-return spread greater than 0;
- at least 3 score bins with sufficient sample;
- no more than 1 monotonic-ordering inversion;
- chronological temporal-stability gate passes.

The default sufficient score-bin sample is 20 observations.

## Temporal stability

The model is additionally evaluated over three contiguous chronological subperiods.

Default stability requirements:

- at least 150 matured scored records overall before stability is assessed;
- at least 40 observations per subperiod;
- at least 8 positive and 8 negative outcomes per subperiod;
- subperiod ROC AUC at least 0.50;
- positive top-versus-bottom outcome spread in every sufficiently evaluated subperiod.

A model that performs well only in a later regime but is inverted in an earlier regime fails `FACTOR_DISCRIMINATION_NOT_STABLE_ACROSS_SUBPERIODS`.

## Locked output boundary

Even when every discrimination and stability threshold passes, the factor group can become only:

`PROMOTION_CANDIDATE`

The contract remains:

- `probabilityCalibrationEnabled: false`;
- `decisionIntegrationEnabled: false`;
- `forecastMayInfluenceFinalAction: false`.

A successful latent score therefore still cannot produce, alter or bypass BUY/HOLD/SELL logic.

## Regression guarantees verified

The 281-test suite proves that:

- pre-factor records do not count;
- different factor-model versions never pool;
- missing/blocked latent scores do not enter discrimination samples;
- strong synthetic ordering passes AUC, tail spread, bin ordering and temporal stability;
- inverted scores fail discrimination;
- regime-dependent scores fail chronological stability;
- OPEN records cannot leak future outcomes;
- no calibrated-probability mapping is emitted;
- decision integration remains disabled.

## Next production boundary

Expose factor-learning telemetry in the live production status without changing any final-action rule. Initial live factor lineage may remain zero for the already-created first-day OOS records because existing daily records are intentionally not retroactively rewritten with the newly introduced factor score.
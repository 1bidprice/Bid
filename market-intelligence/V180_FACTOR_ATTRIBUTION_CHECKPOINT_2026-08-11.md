# Investor Control v1.8.0 — Factor Attribution Checkpoint

Date: 2026-08-11

## Verified implementation

Code commit: `3e4fc5d50d20d06fdf91fe64032049d6af458fee`

Workflow run: `31455872125`

Deterministic Market Intelligence suite: **288/288 PASS, 0 FAIL**.

Runtime release: **v1.8.0**.

Runtime migration chain: **55 unique patches**.

## Purpose

The factor model can now preserve enough immutable OOS context to evaluate not only whether the aggregate latent score worked, but which factor domains actually contributed predictive information.

This is intentionally an attribution and governance layer. It does not change factor weights automatically and cannot alter any final action.

## Compact immutable domain snapshot

Every new live daily OOS forecast record can retain, per available verified factor domain:

- domain name;
- normalized domain value in `[-1,+1]`;
- configured domain weight;
- verified-driver count.

The archive also retains:

- `factorFeatureVectorPolicyVersion`;
- `factorScorePolicyVersion`;
- available-domain count;
- available total factor weight.

The snapshot deliberately excludes full evidence payloads, article text and large research objects. It is a compact learning record rather than a second research archive.

Adding the domain snapshot does not change the daily forecast identity. Existing same-day OOS records are not duplicated or rewritten retrospectively.

## Attribution isolation

Attribution groups are isolated by:

- factor-feature-vector version;
- factor-score version;
- asset class;
- forecast horizon.

Future changes to feature definitions or score methodology therefore cannot silently contaminate older OOS attribution history.

## Per-domain OOS diagnostics

For every domain with sufficient lineage the attribution engine tracks:

- lineage coverage count and percentage;
- matured sample size;
- positive and negative outcome counts;
- ROC AUC of the signed domain value versus realised positive/negative outcome;
- top-versus-bottom empirical positive-rate spread;
- top-versus-bottom mean realised-return spread;
- average configured domain weight.

Default attribution-readiness floor:

- at least 100 matured OOS observations for the domain;
- at least 20 positive and 20 negative outcomes;
- at least 60% domain coverage in the relevant lineage.

A domain can then be classified as:

- `PREDICTIVE_DIRECTION_SUPPORTED`;
- `INVERTED_OR_NONPREDICTIVE`;
- `INCONCLUSIVE`;
- `INSUFFICIENT_OOS_HISTORY`.

## Weight-governance boundary

A domain may become only a `manualWeightReviewCandidate` after substantial OOS evidence. This is a review signal, not an automatic optimization instruction.

Hard invariants:

- `automaticWeightAdjustmentEnabled: false`;
- `decisionIntegrationEnabled: false`;
- `forecastMayInfluenceFinalAction: false`.

No learned attribution result can silently rewrite production weights, change the latent score formula or generate BUY/HOLD/SELL.

## Regression guarantees

The 288-test suite proves that:

- new records retain compact factor-domain snapshots;
- evidence-detail payloads are not copied into the compact snapshot;
- pre-snapshot records do not enter attribution lineage;
- feature-vector versions are never pooled;
- strong synthetic domain ordering is recognized as supported;
- inverted domains are surfaced rather than cosmetically promoted;
- OPEN records contribute only coverage and cannot leak future outcomes;
- even a strong or inverted domain cannot trigger automatic weight adjustment or decision integration.

## Next boundary

Accumulate live daily OOS factor snapshots and mature them normally. Once sufficient real data exists, attribution can support a separately reviewed factor-weight governance decision. Until then, fixed production research weights remain unchanged.
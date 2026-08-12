# Investor Control v1.8.0 — v1822 Regime-Conditional Stacked Ensemble Checkpoint

Date: 2026-08-13

## Verified code boundary

- Source head before this documentation commit: `faec8b8dd55854c92ee771894ae377bbcb179436`
- Runtime release: `1.8.0`
- Runtime migrations: 71 unique test patches / 70 build patches
- Deterministic Market Intelligence suite: **443/443 PASS, 0 FAIL**
- Mobile validation: **SUCCESS**
- Standalone Android build: **SUCCESS**
- PR #14: **open, draft, unmerged**

## Production verification

Production workflow run `31649163636`, re-run job `94296466451`, completed successfully end-to-end using source commit `faec8b8dd55854c92ee771894ae377bbcb179436`.

Verified gates:

- deterministic source tests
- autonomous live intelligence build
- strict production safety
- pooled v1821 stacked-ensemble firewall
- v1822 regime-conditional stacked-ensemble firewall
- Opportunity Hunter safety
- forecast archive safety
- transactional publication
- remote published-feed re-verification

Live publication after the run:

- source commit: `faec8b8dd55854c92ee771894ae377bbcb179436`
- runtime: `1.8.0`
- staleOutput: `false`
- infrastructure: `OPERATIONAL`
- research: `ACTIVE`
- decision engine: `READY`
- overall operational health: `DEGRADED` because current market/history coverage is degraded, not because the production workflow failed

Current market/history state at publication:

- analysed companies: 32
- market snapshots: 31/32
- ready historical metrics: 25/31
- fundamental snapshots: 30/32
- final actions: 11
- blocked decisions: 21

## v1822 capability

v1822 preserves the v1821 pooled stacked ensemble as an aggregate diagnostic baseline and adds a second, stricter research layer in which every target forecast is trained only from prior realised outcomes that shared the **same immutable forecast-time market regime**.

Model lineage remains separated by:

- historical-pattern policy version
- factor-score policy version
- asset class
- horizon

Within each model lineage, training is then separated again by the exact immutable `regimeKey`.

The enforced anti-leak rule is:

`TRAIN_ONLY_ON_SAME_REGIME_OUTCOMES_REALIZED_STRICTLY_BEFORE_TARGET_FORECAST_TIME`

The pooled v1821 stack is diagnostic only and **cannot satisfy or bypass regime-specific readiness**.

## Live research state

Pooled v1821 stack:

- lineage records: 215
- matured eligible records: 42
- prequential predictions: 0
- groups: 2
- ready groups: 0

Regime-conditional v1822 stack:

- lineage records: 215
- matured stack inputs: 42
- strictly valid immutable-regime matured inputs: 10
- groups: 2
- regime buckets: 2
- ready regimes: 0

The regime layer therefore remains correctly `RESEARCH_ONLY`. The small valid regime-matured sample is a consequence of the immutable no-backfill policy and the young regime lineage, not a reason to weaken thresholds.

## Research-only safety invariants

All remain false / disabled:

- automatic model promotion
- automatic factor reweighting
- probability calibration authority
- decision integration
- final-action influence
- broker execution

No v1822 code changed portfolio, transactions, mobile UI, Opportunity Hunter scoring, final-action logic, or broker execution paths.

## Diff safety

Compared with v1821 source `8f4cd11fd667de3de20003aaf23ee05a0c1c093e`, v1822 changed only Market Intelligence research/safety/tests/manifest/documentation files.

## Next capability boundary

The primary bottleneck is now **training depth**, not another safety gate.

The next engineering work should increase genuine historical predictive evidence without contaminating the live OOS archive. Priority is a separate historical walk-forward research lineage that can reconstruct market-regime state from information available at each historical anchor date, evaluate pattern outcomes under those regimes, and remain explicitly separate from live `LIVE_SHADOW_OOS` calibration evidence.

Legacy live OOS records must never be backfilled, and historical walk-forward evidence must never be mislabelled as live OOS evidence.

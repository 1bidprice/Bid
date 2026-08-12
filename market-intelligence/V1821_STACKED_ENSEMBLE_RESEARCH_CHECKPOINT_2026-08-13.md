# Investor Control v1.8.0 — v1821 Stacked Ensemble Research Checkpoint

Date: 2026-08-13

## Verified code boundary

- Source head before this documentation commit: `8f4cd11fd667de3de20003aaf23ee05a0c1c093e`
- Runtime release: `1.8.0`
- Runtime test migrations: 70 unique patches
- Deterministic Market Intelligence suite: **435/435 PASS, 0 FAIL**
- Mobile validation: **SUCCESS**
- Standalone Android build: **SUCCESS**
- PR #14 remains **open, draft, unmerged**.

## Production verification

Production workflow run `31649163636` completed successfully and published source commit `8f4cd11fd667de3de20003aaf23ee05a0c1c093e` transactionally to `investor-control-live-feed`.

Live status after publication:

- runtimeReleaseVersion: `1.8.0`
- staleOutput: `false`
- infrastructureStatus: `OPERATIONAL`
- researchStatus: `ACTIVE`
- decisionEngineStatus: `READY`
- forecast outcome archive: 265 total / 110 matured / 155 open
- factor lineage: 215 records / 43 matured scored
- regime lineage: 265 records / 110 matured OOS / 20 valid regime-matured
- stacked ensemble lineage: 215 records / 42 matured eligible / 0 prequential predictions
- stacked ensemble ready groups: 0

## v1821 capability

The v1821 stacked ensemble is a leakage-safe research layer that combines:

1. raw historical-pattern probability, and
2. latent multi-factor score

through a prequential logistic stack.

For every target forecast date, model fitting is restricted to outcomes that were realised **strictly before** the target forecast time. Future outcomes cannot enter the target model.

The stack is version-separated by:

- historical-pattern policy version,
- factor-score policy version,
- asset class,
- forecast horizon.

It is also blocked by existing OOS evidence gates including:

- forecast-date/instrument sample independence,
- non-overlapping outcome-window evidence,
- instrument concentration,
- taxonomy-native concentration,
- chronological temporal-stability requirements.

## Research-only safety invariants

The stacked ensemble remains permanently authority-free at this checkpoint:

- automatic model promotion: `false`
- probability calibration authority: `false`
- decision integration: `false`
- final-action influence: `false`
- broker execution: impossible

A statistically strong research result cannot directly create, replace, promote, or modify `BUY_NOW`, `SELL_NOW`, `HOLD`, `AVOID`, `DO_NOT_BUY`, or any broker order.

## Current live interpretation

The live archive has 42 matured records currently eligible for the stacked research lineage, but the minimum prequential training/class-support gates are not yet satisfied. Therefore live prequential prediction count remains **0**, which is the correct fail-closed behavior. No probability or performance claim is manufactured before sufficient prior realised outcomes exist.

## Next statistical boundary

The next required hardening is **regime-conditional ensemble learning**.

Reason: v1815–v1818 already established immutable forecast-time market-regime lineage and showed that factor usefulness can differ or invert across regimes. The v1821 stack still groups by pattern version + factor version + asset class + horizon, so it must not be allowed to claim general ensemble superiority if the stack only works because opposite regime relationships were pooled together.

Planned v1822 boundary:

- preserve prequential anti-leak training,
- stratify or explicitly gate ensemble evidence by immutable forecast-time regime,
- require sufficient regime coverage/support before any regime-specific ensemble conclusion,
- never backfill legacy regime metadata,
- keep all outputs research-only,
- keep all current final-action and broker-execution paths unchanged.

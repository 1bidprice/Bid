# Investor Control v1.8.0 — v1823 Cross-Sectional Historical Regime Walk-Forward Runtime Checkpoint

Date: 2026-08-13

## Verified code boundary

- Source head before the original checkpoint documentation commit: `e275132eefb7a115000e3b0047f64bd53012d377`
- Runtime release: `1.8.0`
- Runtime migrations: 72 unique test patches / 71 build patches
- Deterministic Market Intelligence suite: **459/459 PASS, 0 FAIL**
- Mobile validation: **SUCCESS**
- Standalone Android build: **SUCCESS**
- PR #14 remains **open, draft, unmerged**

## Android verification

Exact-head standalone Android run `31652906380`, job `94300917451`, completed **SUCCESS** for source `e275132eefb7a115000e3b0047f64bd53012d377`.

Verified Android steps included:

- release-identity verification
- Android project generation
- Gradle release build
- embedded JavaScript bundle verification
- standalone APK artifact upload

Diff safety against the previous exact-head Android-green v1822 source `faec8b8dd55854c92ee771894ae377bbcb179436` also confirmed that all v1823 changes were confined to `market-intelligence/*`; no mobile, Android, portfolio, transaction, Opportunity Hunter, final-action, or broker-execution source file changed.

## Production verification

Production workflow run `31649163636`, job `94301298007`, completed **SUCCESS** end-to-end using source `e275132eefb7a115000e3b0047f64bd53012d377`.

Verified production gates:

- 459 deterministic tests
- autonomous live intelligence build
- strict production safety
- pooled stacked-ensemble safety
- regime-conditional stacked-ensemble safety
- v1823 historical-walk-forward runtime firewall
- Opportunity Hunter safety
- forecast archive safety
- transactional publication
- remote published-feed re-verification

Live feed after publication:

- source commit: `e275132eefb7a115000e3b0047f64bd53012d377`
- runtime: `1.8.0`
- stale output: `false`
- infrastructure: `OPERATIONAL`
- research: `ACTIVE`
- decision engine: `READY`

## v1823 pure research capability

The cross-sectional historical walk-forward engine creates historical `WALK_FORWARD_OOS` pattern forecasts instrument-by-instrument, then pools them only after per-instrument generation for regime-stratified statistical evaluation.

The historical market regime at every forecast anchor is reconstructed using benchmark observations available **at or before that historical forecast timestamp**. Future benchmark candles are excluded.

Current forecast-time classification is never copied backwards into historical records.

Historical research evidence is explicitly separate from the live forecast archive:

- evidence class: `HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH`
- live archive eligibility: `false`
- live calibration eligibility: `false`
- factor-weight governance eligibility: `false`
- automatic model promotion: `false`
- decision integration: `false`
- final-action influence: `false`
- broker execution: `false`

Raw historical records are omitted from normal output. Only bounded audit samples can be explicitly requested for testing/research inspection.

## Normal-production runtime behavior

The heavy historical engine is **present but disabled by default** in the normal production cadence.

Live telemetry after publication proves:

- execution state: `DISABLED_BY_CADENCE`
- status: `HISTORICAL_RESEARCH_NOT_EXECUTED`
- cadence requested: `false`
- eligible instruments: `0`
- selected instruments: `0`
- generated historical records: `0`
- valid historical regime records: `0`
- historical research groups: `0`
- ready groups: `0`
- network fetch by v1823 runtime: `false`
- live archive/calibration/decision/final-action/broker authority: all `false`

This means the normal three-hour production feed carries the v1823 safety contract and telemetry but pays effectively zero historical walk-forward compute cost.

## Research cadence boundary

The next step is a **separate sparse historical-research execution path**. It must:

1. opt in to v1823 explicitly;
2. never change the normal production default-off behavior;
3. use only histories already loaded by the autonomous analysis run;
4. publish no live feed and write no live forecast archive;
5. produce a standalone research artifact only;
6. pass the v1823 production firewall before artifact upload;
7. begin as manual or one-off proof before any recurring schedule is enabled.

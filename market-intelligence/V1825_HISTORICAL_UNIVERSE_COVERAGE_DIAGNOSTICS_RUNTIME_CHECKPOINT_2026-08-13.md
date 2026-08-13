# Investor Control v1.8.0 — v1825 Historical Universe Coverage Diagnostics Runtime Checkpoint

Date: 2026-08-13

## Scope

v1825 continues directly from v1824. It identifies the real statistical-coverage bottleneck before any further Forecast Engine expansion, adds bounded upstream universe diagnostics, and proves one research-only event-cohort expansion without changing normal production defaults or readiness thresholds.

## Verified code boundary

- Verified Forecast source head: `7746a64101696e3093d4346196820a85d8474a27`
- Runtime release remains: `1.8.0`
- Historical research job policy: `2026-08-13.5`
- Universe coverage contract: `HISTORICAL_WALK_FORWARD_UNIVERSE_COVERAGE_V1`
- Source cohort contract: `HISTORICAL_RESEARCH_SOURCE_COHORT_SUMMARY_V1`
- Research-only cohort expansion contract: `RESEARCH_ONLY_EVENT_COHORT_EXPANSION_V1`
- Deterministic Market Intelligence suite: **470/470 PASS, 0 FAIL**
- Validate Market Intelligence run `31730797897`: **SUCCESS**
- Validate Mobile v1.7.0 run `31730797921`: **SUCCESS**
- Installed mobile release identity remains `1.7.0` / Android versionCode `28`

## What v1825 proved before expansion

The original historical walk-forward maximum of 24 instruments was not the active bottleneck.

Exact artifact before the cohort experiment showed:

- research dossiers: `8`
- loaded validated histories: `8`
- loaded benchmarks: `8`
- eligible instruments: `8`
- selected instruments: `8`
- excluded dossiers: `0`
- omitted because of max-24 bound: `0`

Source-cohort diagnostics then traced the upstream chain:

- seed companies: `3`
- event candidates: `8`
- default deep-analysis companies: `5`
- event-discovered additions: `5`
- broad US screen additions: `0`
- final analysed universe: `8`
- long-history eligible: `8`
- long-history selected: `8`
- long-history skipped by limit: `0`
- final Forecast research dossiers: `8`

Therefore the Forecast max-24 bound and the long-history default limit were not responsible for the initial eight-instrument universe. The binding upstream control was the normal autonomous event deep-analysis default of five additions.

## Research-only cohort expansion

v1825 performs one isolated experiment in the standalone historical-research job:

- normal production deep-analysis default: unchanged at `5`
- artifact-only research deep-analysis limit: `8`
- hard research bound: `12`
- candidate score / canonical identity gates: unchanged
- data-quality gates: unchanged
- statistical readiness gates: unchanged
- live feed writes: forbidden
- automatic promotion: forbidden
- decision integration: forbidden

Regression tests prove the research job overrides only its own execution and that a requested excessive value is bounded.

## Exact expanded historical proof

Historical workflow run `31653775637`, job `94550844345`, completed **SUCCESS** end-to-end on source `7746a64101696e3093d4346196820a85d8474a27`.

Artifact:

- artifact id: `9193269124`
- digest: `sha256:43c24b8f22af67ed19ead4b374e1ef05972f1493c4c6a322125c628dd8c9a0c6`
- policy: `2026-08-13.5`
- production-safety verification: `VERIFIED`

Expanded source cohort:

- seed companies: `3`
- event candidates: `8`
- event deep-analysis companies: `8`
- event-discovered additions: `8`
- analysed universe: `11`
- final research dossiers: `11`
- walk-forward loaded histories: `11`
- walk-forward loaded benchmarks: `11`
- eligible instruments: `11`
- selected instruments: `11`
- omitted by Forecast max-24 bound: `0`
- exclusions: `0`

The long-history shadow collector reports `11` eligible, `8` selected and `3` skipped by its own limit, but this does **not** constrain the historical walk-forward: the walk-forward independently received all `11` validated standard histories.

## Statistical effect

Compared with the v1824/baseline eight-instrument run:

- instruments: `8 → 11`
- valid historical OOS records: `279 → 360`
- maximum sample size: `60 → 73`
- maximum distinct instruments inside a regime group: `7 → 10`
- maximum effective instrument count: `6.76 → 9.4174`
- instrument-diversification-ready groups: `4 / 20 → 6 / 20`
- distinct-instrument blocker: `20 / 20 → 14 / 20`

The expansion therefore added real independent cross-sectional evidence rather than merely duplicating records.

## Remaining binding bottleneck

Ready groups remain `0 / 20` because independent time coverage did not improve enough:

- maximum distinct forecast dates: `19`
- required distinct forecast dates: `30`
- maximum effective non-overlapping windows: `15`
- required effective non-overlapping windows: `12`

The distinct-date gate is now the dominant universal blocker: `20 / 20` groups remain below 30 dates.

Current validated history lengths in the expanded universe are approximately:

- minimum candles: `252`
- median candles: `495`
- maximum candles: `501`

This is consistent with roughly one-to-two years of daily history being available to the current standard analysis path.

## Authority boundary remains locked

No readiness threshold was weakened.

- raw historical candle export: `false`
- live feed write: `false`
- forecast outcome ledger write: `false`
- decision history write: `false`
- live archive eligibility: `false`
- live calibration eligibility: `false`
- automatic model promotion: `false`
- final-action influence: `false`
- broker execution eligibility: `false`
- decision impact: `NONE`

## Mobile status

Investor Control mobile `v1.7.0` remains the correct installed client. Forecast research changes are backend/feed-side and do not require an APK reinstall. Current-head mobile validation is successful. A new APK should be distributed only when a genuine mobile UI, storage, compatibility, or client-contract change requires it.

## Next development boundary

The next Forecast Engine step is v1826: **research-only validated historical depth expansion**.

Before changing anything, the exact effective history adapter and its lookback bounds must be verified. Any experiment must:

1. increase history depth only inside the standalone historical-research execution;
2. preserve the same source-quality and benchmark validation requirements;
3. preserve all current statistical readiness thresholds;
4. preserve normal production defaults;
5. remain artifact-only with zero decision authority;
6. prove with a real artifact whether distinct forecast dates materially increase beyond the current maximum of 19.

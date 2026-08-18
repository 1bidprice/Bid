# Investor Control Forecast Engine v1826 Checkpoint

Date: 2026-08-13
Scope: research-only five-year historical depth and sample sufficiency

## Status

v1826 is complete as a historical-data-depth experiment.

It successfully removed the prior sample-depth bottleneck without changing production defaults, decision authority, broker authority, or the existing statistical independence thresholds.

It does **not** establish predictive skill and must never be interpreted as production model promotion.

## Exact research run

- Workflow: `Investor Control v1826 Historical Research`
- Workflow run ID: `31733949353`
- Source commit: `2e1489e83411067c2cfcbce2219651e9ea83d64c`
- Artifact ID: `9194599032`
- Artifact: `investor-control-v1826-historical-research-31733949353`
- Full deterministic suite before research: `474/474 PASS`
- End-to-end workflow result: `SUCCESS`

## What changed in research only

- Historical lookback: `1825` days
- Yahoo requested history depth: `5y`
- Company history and benchmark history use the same requested depth
- Normal production history default changed: `false`
- Quality validation changed: `false`
- Statistical readiness thresholds changed: `false`
- Historical research only: `true`

## Sample sufficiency result

Compared with v1825:

- Historical records: `360 -> 2609`
- Maximum distinct forecast dates: `19 -> 125`
- Required distinct forecast dates: remains `30`
- Maximum distinct instruments: `10`
- Maximum effective non-overlapping windows: `90`
- Maximum effective instrument count: `8.801`
- Selected instruments: `11`
- Eligible instruments: `11`
- Excluded instruments: `0`
- Omitted by hard bound: `0`

The five-year history therefore solved the historical-depth/sample-sufficiency bottleneck that prevented the engine from reaching the existing independence floor.

## Critical interpretation of the 7 evaluation-ready groups

The v1826 artifact contains `7` groups with status `HISTORICAL_REGIME_RESEARCH_READY` under the existing v1823 contract.

That status means the group has enough independent dates, outcome windows, instrument diversification, and OOS calibration observations to be evaluated. It does **not** mean the forecast demonstrates positive predictive skill.

Manual audit of the seven groups found all seven had negative `skillVsBaseRatePct`:

1. month1 / NEUTRAL / BULL / HIGH VOL / POSITIVE MOMENTUM: `-6.38%`
2. month1 / RISK_ON / BULL / LOW VOL / POSITIVE MOMENTUM: `-9.87%`
3. month1 / RISK_ON / BULL / NORMAL VOL / POSITIVE MOMENTUM: `-7.80%`
4. week1 / NEUTRAL / BULL / HIGH VOL / POSITIVE MOMENTUM: `-1.58%`
5. week1 / NEUTRAL / MIXED / NORMAL VOL / MIXED MOMENTUM: `-8.68%`
6. week1 / RISK_ON / BULL / LOW VOL / POSITIVE MOMENTUM: `-9.89%`
7. week1 / RISK_ON / BULL / NORMAL VOL / POSITIVE MOMENTUM: `-0.72%`

Therefore:

- `evaluation-ready group count = 7`
- demonstrated predictive-skill-ready group count = `0` under the already existing canonical promotion-quality floor (`minimum sample 200`, `minimum skill 5%`, `maximum ECE 0.08`).

## Safety lock

The v1826 artifact verified all of the following:

- `minimumDistinctForecastDates = 30`
- `executionState = ENABLED_RESEARCH_ONLY`
- live feed write allowed: `false`
- forecast outcome ledger write allowed: `false`
- decision history write allowed: `false`
- git push allowed by research artifact: `false`
- automatic model promotion enabled: `false`
- decision integration enabled: `false`
- forecast may influence final action: `false`
- broker execution eligible: `false`
- decision impact: `NONE`
- raw historical record export: `false`
- raw historical candle export: `false`

## Next checkpoint

v1827 must keep the existing evaluation-readiness contract intact and add a separate, explicit predictive-skill readiness layer.

The new layer must reuse the existing canonical forecast-promotion quality thresholds rather than inventing easier thresholds:

- minimum OOS sample: `200`
- minimum skill vs base rate: `5%`
- maximum expected calibration error: `0.08`

Even if a historical group passes this new predictive-skill layer, it must remain research-only and must not gain automatic model promotion, final-action influence, or broker authority.

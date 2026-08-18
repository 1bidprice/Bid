# Investor Control v1.8.0 — v1818 Regime-Conditional Factor Weight Governance Checkpoint

Date: 2026-08-12

## Purpose

v1818 adds a manual-review-only governance layer for factor weights **inside a frozen forecast-time market regime**. It does not alter global factor weights, does not create a probability mapping, does not alter BUY/HOLD/SELL logic, and cannot submit broker orders.

This slice sits downstream of:

- immutable forecast-time market-regime lineage (v1815),
- regime-stratified OOS learning (v1816),
- regime-conditional factor attribution (v1817),
- all prior OOS independence, outcome-window, instrument-concentration and taxonomy-native concentration gates.

## Verified code boundary

Verified code head:

`b9fa06750df5a49466d6fa3e10c3aa51c0cb2a0d`

Runtime release remains:

`1.8.0`

Runtime patch chain after activation:

- test patches: 67 unique patches
- build patches: 66 unique patches
- final patch: `apply-v1818-regime-factor-weight-governance.js`

PR #14 remained open, draft and unmerged throughout verification.

## New source contracts

### `src/forecast-regime-factor-weight-governance.js`

Builds research-only governance status by:

- using only current feature-vector and factor-score lineage,
- accepting only `LIVE_SHADOW_OOS` matured records with strict numeric 0/1 outcomes,
- requiring a valid immutable forecast-time market-regime snapshot,
- grouping records by asset class + horizon + exact regime key,
- never pooling different regimes to satisfy sample floors,
- requiring upstream `REGIME_RESEARCH_READY`,
- requiring upstream `REGIME_FACTOR_RESEARCH_READY`,
- requiring a supported or inverted factor direction inside the same regime.

Default governance thresholds inside a regime:

- matured OOS sample >= 200,
- positive outcomes >= 40,
- negative outcomes >= 40,
- factor feature coverage >= 80%,
- support AUC >= 0.60 for increase review,
- inversion AUC <= 0.40 for decrease review,
- absolute positive-rate spread >= 0.12 with matching realised-return direction,
- distinct forecast dates >= 40,
- distinct instruments >= 10,
- maximum one-date share <= 10%,
- effective non-overlapping outcome windows >= 12,
- maximum one-instrument share <= 25%,
- effective instrument count >= 6,
- classification coverage >= 90%,
- material taxonomy floor: >=15% share and >=50 records,
- maximum one native taxonomy cluster <= 30%,
- effective native taxonomy clusters >= 4,
- temporal stability across 3 date-preserving chronological blocks,
- each temporal block >= 40 samples and >=10 observations per binary class.

A valid proposal is limited to:

- scope: `REGIME_ONLY_MANUAL_REVIEW`,
- maximum direct factor-weight delta: +/-0.01,
- hypothetical regime-specific review vector only,
- no mutation of global weights,
- RISK weight may never be proposed downward,
- manual review required,
- a new regime-policy version required before any future approval,
- rollback must remove the regime overlay and restore current global weights,
- historical OOS records may never be rewritten.

### `src/forecast-regime-factor-governance-production-safety.js`

Adds an independent production firewall that re-validates serialized governance output rather than trusting the research builder.

It rejects, among other cases:

- automatic regime weighting,
- automatic factor reweighting,
- automatic proposal application,
- decision integration,
- final-action influence,
- probability calibration,
- non-regime-only scope,
- direct delta above 0.01,
- global-weight mutation,
- RISK decrease,
- weak upstream regime/factor readiness,
- insufficient sample/class/feature coverage,
- weakened date/instrument/outcome-window/taxonomy thresholds,
- unstable temporal subperiods,
- missing immutable rollback,
- missing new regime-policy version requirement,
- proposal ID/content-hash mismatch,
- compact telemetry mismatch.

Telemetry contract:

`REGIME_FACTOR_WEIGHT_GOVERNANCE_OBSERVABILITY_V1`

## Regression coverage

New v1818 regression suite verifies:

1. no proposal below the 200 matured-OOS floor,
2. strong stable supported factor can produce only a bounded +0.01 regime-specific manual review proposal,
3. strong stable inverted non-risk factor can produce only a bounded -0.01 regime-specific manual review proposal,
4. RISK decrease is prohibited,
5. different regimes are never pooled to reach the sample floor,
6. temporal instability blocks proposals,
7. taxonomy concentration blocks proposals,
8. both upstream regime learning and regime-factor attribution readiness are required,
9. production firewall accepts a valid manual-only proposal and rejects authority escalation / global scope / weakened evidence,
10. transformed runtime publishes governance status and invokes the production firewall.

## Exact-head verification

### Market Intelligence

Commit:

`b9fa06750df5a49466d6fa3e10c3aa51c0cb2a0d`

Result:

**408 / 408 PASS — 0 FAIL**

The CI log confirmed:

`Investor Control release v1.8.0: test migrations complete (67 unique patches).`

### Mobile validation

Workflow run:

`31608928117`

Result:

**SUCCESS**

v1818 is backend/research-governance only; no mobile portfolio, transaction, accounting, local-storage or UI source was changed by the slice.

### Standalone Android build

Workflow run:

`31608928049`

Result:

**SUCCESS**

Verified steps included:

- release identity,
- Android project generation,
- Gradle release build,
- embedded JavaScript bundle verification,
- standalone APK artifact upload.

## Production verification

Production workflow run:

`31603311503`

v1818 verification attempt job:

`94155934527`

Result:

**SUCCESS end-to-end**

The production path passed:

- deterministic source tests,
- autonomous intelligence build,
- strict production safety including the v1818 firewall,
- Opportunity Hunter safety,
- forecast outcome archive safety,
- transactional live-feed publication,
- remote published-feed re-verification.

## Live state after v1818 publication

Live publication source commit:

`b9fa06750df5a49466d6fa3e10c3aa51c0cb2a0d`

Runtime:

`1.8.0`

Publication state:

- staleOutput: `false`
- regime-factor governance lineage records: `6`
- regime-factor governance groups: `1`
- regime-factor governance proposals: `0`
- governance status: `NO_ELIGIBLE_REGIME_WEIGHT_PROPOSALS`

All regime-governance authority flags remain false:

- automatic regime weighting: false
- automatic factor reweighting: false
- automatic proposal application: false
- probability calibration: false
- decision integration: false
- forecast may influence final action: false

This is the correct live result. The research lineage is far below the v1818 OOS evidence floors, so the system must not propose any regime weight overlay yet.

## Operational issue observed during the same production audit

The v1818 publication itself passed every strict safety gate, but the live operational health was **DEGRADED** due to market-history coverage in that specific run:

- analysed companies: 32
- historical metric sets: 32
- history-ready sets: 26
- history coverage ratio: 0.8125
- market-data status: DEGRADED
- staleOutput: false

This degradation is **not** a v1818 governance failure and did not bypass publication safety. It is a separate market-history/provider operational issue and must be investigated independently before treating the live market-data layer as fully healthy.

## Locked safety conclusion

v1818 is verified and production-live, but it remains a research-governance layer only.

No v1818 output can:

- change global factor weights,
- change a BUY/HOLD/SELL/AVOID decision,
- create calibrated probabilities,
- submit an order,
- apply a regime overlay automatically.

Any future regime-specific weighting requires separate evidence, manual governance, a new versioned policy and its own regression/production verification boundary.

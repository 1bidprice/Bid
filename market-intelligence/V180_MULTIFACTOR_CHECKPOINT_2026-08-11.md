# Investor Control v1.8.0 — Multi-Factor Forecast Checkpoint

Date: 2026-08-11

## Verified implementation

Commit: `8e64483240ca6bc157aafd7c818e3e83f9639d16`

Deterministic Market Intelligence suite: **272/272 PASS, 0 FAIL** on workflow run `31454673230`.

The multi-factor layer adds a deterministic, versioned latent research score on top of the existing verified forecast drivers. It does not replace the historical-pattern engine, does not create a probability and has no BUY/SELL authority.

## Factor domains and fixed research weights

- Historical pattern: 0.22
- Peer-normalized valuation: 0.14
- Quality: 0.12
- Growth: 0.10
- Momentum / relative strength: 0.16
- Fundamentals / balance sheet / capital structure: 0.12
- Risk: 0.09
- Verified catalysts: 0.05

The weights sum to 1.0 and are versioned. Missing domains are excluded from the denominator rather than silently zero-filled.

## Locked feature rules

- only `verified:true` drivers are eligible;
- missing data is not treated as neutral data;
- unverified valuation is excluded;
- execution liquidity is not a return-forecast factor;
- portfolio fit belongs to the decision layer and is not an instrument-return factor;
- historical analog frequency remains a research feature rather than a calibrated probability;
- evidence IDs and source counts remain attached to auditable domain contributions;
- unresolved contradictions block the usable latent score;
- severe verified risk can cap a positive latent score;
- the score range is `[-1,+1]` and is explicitly named a **latent score**, not a probability.

## Default score-readiness gates

- minimum verified factor domains: 3;
- minimum available factor-weight coverage: 0.45;
- minimum evidence-quality score: 50;
- unresolved contradiction count must be zero.

The raw weighted research score remains visible for audit when a gate blocks the usable score. A blocked score cannot become a trade action.

## Shadow integration

Each historical forecast horizon now has:

- a versioned feature vector;
- a deterministic factor score;
- domain-level weighted contributions;
- missing/excluded factor diagnostics;
- risk-cap diagnostics;
- `decisionImpact: NONE`;
- `finalActionEligible: false`.

The existing probabilistic historical-pattern contract remains separate.

## OOS anti-duplication decision

The shadow forecast policy version was deliberately **not** changed merely because the new factor score was added. The daily forecast identity therefore remains stable for the same model/instrument/horizon/trading date.

The factor model records its own `factorScorePolicyVersion`, but that version does not enter the daily `forecastId`. This prevents a new research feature from creating a second correlated OOS sample on the same trading day.

New daily OOS records can retain:

- `factorScorePolicyVersion`;
- `latentFactorScore`;
- `rawLatentFactorScore`;
- `factorScoreStatus`.

Existing live records are not rewritten retrospectively.

## Next model-evaluation boundary

The latent factor score must be evaluated independently from the existing historical-pattern probability calibration. It must not be converted to a probability merely because it has a numeric range.

The next engine therefore measures only live `LIVE_SHADOW_OOS` records carrying a valid factor-score lineage. It must evaluate discrimination, score ordering, top-versus-bottom outcome spread, temporal stability and sample coverage by factor-model version, asset class and horizon. Any eventual probability mapping requires a separate future OOS calibration contract.

## Non-negotiable boundary

Even a statistically successful factor model remains research-only until a separately reviewed decision-engine integration is designed and tested. No automatic broker order and no forecast bypass of evidence, risk, liquidity or execution gates.
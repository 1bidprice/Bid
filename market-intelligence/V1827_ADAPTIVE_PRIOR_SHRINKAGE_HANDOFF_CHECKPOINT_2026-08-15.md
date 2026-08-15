# Investor Control v1827 — Adaptive Prior Shrinkage Handoff Checkpoint

Date: 2026-08-15
Branch: `investor-control-v1-market-intelligence-foundation`
Repository: `1bidprice/Bid`

## Exact continuation point

Code head immediately before this checkpoint commit:

`a67b8656134be99f2777af62538d1ca87365ea65`

Do **not** regress to v1813–v1826 or redo the already-completed benchmark/data-depth work.

## Already completed and verified before this handoff

1. Athens 5-year benchmark acquisition defect was fixed fail-closed.
   - `GD.AT` must meet real deep-history requirements before being accepted/cached.
   - bounded retry/fallback is allowed only for acquisition recovery.
   - statistical/safety thresholds were not weakened.

2. Current-head 5-year historical research after the benchmark fix achieved:
   - 3,084 / 3,084 records with valid regime
   - 100% regime coverage
   - 11 / 11 instruments represented
   - 6 evaluation-ready groups in the underlying historical coverage diagnostics

3. Domain-separated candidate was evaluated on identical OOS sample and did not beat scalar overall.
   - no promotion
   - thresholds unchanged

4. Fixed prior-shrunk scalar candidate was evaluated on the same OOS sample.
   - modest aggregate improvement vs scalar
   - still below promotion requirements / no READY predictive group
   - no promotion and no threshold relaxation

5. Duplicate scalar fitting was removed from the runtime path and guarded by deep-equality regression so the optimization does not change probabilities/metrics.

6. Adaptive prior-shrinkage selector was implemented in:
   - `market-intelligence/src/forecast-historical-market-adaptive-prior-shrinkage.js`
   - `market-intelligence/test/forecast-historical-market-adaptive-prior-shrinkage.test.js`

   Pre-registered support grid:
   - `[1x, 2x, 4x, 8x]` of canonical minimum training sample

   Selection objective:
   - minimum Brier score

   Anti-leak rule:
   - only same-lineage prior OOS predictions whose outcomes were realized strictly before the target forecast time may influence support-floor selection
   - target outcome cannot influence its own selection
   - delayed outcomes after target time are excluded
   - ties prefer stronger shrinkage

7. Robustness fix completed at commit:

`5aa259020e86303e087310f2bf8b15a0aa12022a`

   The adaptive selection map is keyed by the prediction object itself, not `forecastId`, so duplicate/null IDs cannot leak a selection between different target timestamps.

## Latest code change

Commit:

`a67b8656134be99f2777af62538d1ca87365ea65`

The adaptive prior-shrunk candidate was connected to the common historical stacked-ensemble research evaluator in:

`market-intelligence/src/forecast-historical-market-stacked-ensemble-research.js`

It now uses the **same** evaluation gates as scalar/domain/fixed-prior candidates:
- minimum evaluation sample
- minimum class counts
- minimum probabilistic skill (+5% floor remains unchanged)
- maximum ECE
- Brier improvement floor
- log-loss non-regression
- ECE non-regression
- sample independence
- outcome-window independence
- instrument concentration
- chronological stability

The adaptive candidate remains research-only with zero authority.

## Important: work NOT YET completed after `a67b8656...`

Do these next, in this order:

1. Add a dedicated adaptive-candidate production-safety/firewall module and tests.
   - verify exact adaptive contract/model variant
   - verify fixed support grid and training-only / prior-OOS chronology rules
   - reject raw predictions/candles/history export
   - enforce historicalResearchOnly=true
   - enforce automaticModelPromotionEnabled=false
   - enforce probabilityCalibrationEnabled=false
   - enforce decisionIntegrationEnabled=false
   - enforce forecastMayInfluenceFinalAction=false
   - enforce finalActionEligible=false where applicable
   - enforce brokerExecutionEligible=false
   - enforce decisionImpact='NONE'
   - do not weaken any scientific/statistical gates

2. Wire the adaptive candidate into `market-intelligence/scripts/run-cross-sectional-regime-walk-forward-research-v1827.js`.
   - artifact should include compact adaptive summary only
   - include support-floor selection counts / warmup-vs-ready counts
   - no raw predictions, no raw historical records, no raw candles
   - runner must fail closed if adaptive candidate firewall fails

3. Update v1827 workflow trigger paths only if necessary so current adaptive source/safety files trigger a fresh run.

4. Run exact deterministic Market Intelligence CI on the new head.

5. Run a new **current-head** v1827 5-year historical experiment with scalar + domain + fixed prior-shrunk + adaptive prior-shrunk on the identical OOS sample.

6. Compare adaptive candidate against scalar and fixed prior-shrunk on:
   - weighted/aggregate skill vs base rate
   - Brier
   - log loss
   - ECE
   - chronological blocks
   - group readiness
   - support-floor selection distribution

7. Promotion rule remains strict:
   - do not promote unless existing gates are actually met
   - do not tune or lower thresholds to manufacture a READY group
   - no live calibration/model promotion/decision/final-action/broker authority from this research artifact

8. Only after green CI + green firewall + successful current-head 5y artifact, write the next completed v1827/v1828 checkpoint.

## Known unrelated production-candidate issue

A prior Production Candidate workflow failed on an unrelated live-data identity blocker for AKTOR. Deterministic Forecast/Market Intelligence tests passed. Do not treat that live-data blocker as evidence against the adaptive Forecast candidate, and do not change Forecast statistical policy to address it.

## Continuation command for a fresh ChatGPT conversation

Use:

`Συνέχισε το Investor Control από το checkpoint V1827_ADAPTIVE_PRIOR_SHRINKAGE_HANDOFF_CHECKPOINT_2026-08-15.md. Μην ξανακάνεις παλιά δουλειά. Συνέχισε από το adaptive candidate firewall -> v1827 runner -> CI -> νέο 5ετές current-head proof.`

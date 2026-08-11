# Investor Control v1.8.0 — Implementation Checkpoint

Date: 2026-08-11

This file records the implementation state of the forecasting architecture defined in `FORECAST_ENGINE_V180.md`. It is intentionally separate from older v1.x implementation history so the v1.8 forecasting work can be audited without rewriting prior records.

## Locked product direction

Investor Control v1.8.0 is a backend-first, multi-asset probabilistic forecasting system. It does not replace the existing evidence, risk, execution or final-action gates and it does not execute broker orders.

The forecasting architecture must combine validated historical-pattern evidence with asset-specific fundamentals/valuation, momentum/trend, volatility/risk, relative strength/peers, events/catalysts, macro/regime and portfolio context. A confidence score or data-quality score is never interpreted as a probability of appreciation.

## Implemented and verified

### Historical Pattern Engine

- multi-horizon return/trend/volatility/drawdown/volume/trajectory features;
- robust median/MAD standardisation;
- historical analog similarity;
- regime conditioning;
- purged independent historical anchors;
- empirical forward-return distributions;
- explicit raw historical positive frequency;
- no calibrated probability until OOS validation exists;
- strict fail-closed behaviour when history is insufficient;
- regression test proving future data after the forecast as-of cannot change the forecast.

### Probabilistic Forecast Contract

- raw pattern probability is separate from calibrated probability;
- expected return and bear/base/bull distribution fields;
- supporting/opposing/neutral drivers separated;
- unverified drivers explicitly excluded;
- unknowns and invalidation conditions retained;
- forecast promotion remains separate from final-action eligibility.

### Walk-forward validation

- expanding-window chronological simulation;
- `WALK_FORWARD_OOS` records only;
- outcome observed only after the forecast horizon elapses;
- calibration metrics include Brier score, log loss, expected calibration error, base-rate benchmark and probabilistic skill;
- subperiod stability diagnostics;
- walk-forward validator cannot emit or promote a final trade action.

### Explainable Forecast Drivers

- peer-normalized valuation, quality, growth and momentum;
- relative strength and SMA regime;
- volatility and drawdown;
- liquidity as execution evidence, never automatically bullish;
- profitability, free cash flow, dilution, cash runway and verified risk flags;
- verified catalysts and thesis risks retain evidence IDs;
- absolute low P/S or P/B cannot be called “cheap” without peer-normalized evidence.

### Autonomous shadow integration

- real autonomous dossiers now generate forecasts in `SHADOW_ONLY` mode;
- `decisionImpact: NONE`;
- `finalActionEligible: false`;
- existing final action is retained as an independent comparison snapshot;
- historical candles are kept in-memory for forecast computation and are not dumped into the production report;
- short history produces `LONG_HISTORY_REQUIRED_FOR_PATTERN_LEARNING` instead of a fabricated forecast.

### Forecast Outcome Ledger

- append-only deterministic forecast IDs;
- live forecasts use `LIVE_SHADOW_OOS`;
- historical validation uses `WALK_FORWARD_OOS`;
- `IN_SAMPLE` records are excluded from probability calibration;
- each horizon remains `OPEN` until its future market outcome exists;
- matured records capture realised return and positive/negative outcome;
- a matured result cannot be overwritten by an older OPEN copy;
- calibration summaries group actual matured OOS outcomes by asset class and horizon.

## Superseding verified checkpoint — long-history and live learning loop

The earlier 220/220 checkpoint below is retained as historical implementation evidence. The current verified state is newer and supersedes it.

### Validated Long-History Research Layer

Implemented across commits:

- `46a658642e46082eb3ae2b2876849ef4a7bf6142` — validated multi-year research series and independent overlap cross-check;
- `15282c15d5bfa6d1d63e11dbbc0c3c69ceb341f1` — shadow forecasts prefer validated long history only under the strict research-only contract;
- `ca2cc9695bff380115df7fa0195cb8ee04548ca8` — bounded long-history acquisition collector and autonomous runtime wiring.

Locked rules:

- default long-history request is daily `range=max` research data;
- default minimum history is 1,260 observations;
- recent overlap must be checked against an independent canonical source;
- adjusted close may support research returns, while recent overlap is compared using raw close to avoid split/dividend adjustment false positives;
- long history always remains `decisionEligible:false` and `executionEligible:false`;
- same-source or same-host self-validation is rejected;
- insufficient overlap, material return mismatch, unstable close scale, missing provenance or malformed research contracts fail closed;
- long-history candles remain in memory and are not dumped into the autonomous/mobile production payloads;
- acquisition is bounded and prioritises final/recommendation-ready dossiers rather than crawling the entire universe;
- no hardcoded company-specific provider identities are used.

Production evidence exposed a real data constraint: the first live cohort had Yahoo as its recent canonical historical source for all eight long-history candidates. The independent-source rule therefore correctly rejected all eight instead of allowing Yahoo to validate Yahoo. Live telemetry recorded `longHistoryResearchReadyCount: 0` and `longHistoryResearchRejectedCount: 8`. This is a safety success, not a reason to weaken the gate.

### Persistent LIVE_SHADOW_OOS Forecast Outcome Archive

Implemented in commit:

- `d8547ee968572cfb1c7d860c802607b1a706c64b` — persistent daily-sampled forecast outcome archive, maturation cycle, transactional merge tooling and archive verifier.

Locked anti-bias rules:

- production may run several times per day, but only one OOS sample is permitted per model/instrument/horizon/trading date;
- the forecast identity intentionally excludes the intraday run timestamp so repeated three-hour runs cannot inflate the calibration sample size with near-duplicates;
- a new trading date creates a new independent live OOS sample;
- `MATURED` records always outrank stale `OPEN` copies during archive merge;
- missing future market data leaves a record OPEN instead of inventing an outcome;
- only `LIVE_SHADOW_OOS` records are accepted by the live archive verifier;
- archive records remain a separate sidecar and the autonomous report exposes summary telemetry only.

Production persistence was wired on `main` in commit `a8791568…` (`feat(production): persist verified forecast outcome archive`). The publisher merges the incoming archive with the newest remote live archive inside each transactional retry, verifies it before push, re-fetches the remote branch and verifies it again after publication. This prevents a stale retry from overwriting a newer matured result.

Verified production run:

- workflow: `Investor Control Production Intelligence v2`;
- run ID: `31452578108`;
- run number: `55`;
- result: **SUCCESS end-to-end**;
- source commit used for that publication: `d8547ee968572cfb1c7d860c802607b1a706c64b`;
- runtime release: `v1.8.0`;
- publisher contract: `TRANSACTIONAL_V2_SINGLE_WRITER`;
- forecast archive contract: `DAILY_OOS_TRANSACTIONAL_V1`;
- strict production safety, Opportunity Hunter safety, forecast archive verification, transactional push and remote re-verification all passed.

First live archive state after production activation:

- 50 `LIVE_SHADOW_OOS` records;
- 50 OPEN;
- 0 MATURED, which is correct on the first forecast day;
- five horizons per instrument: 1 day, 1 week, 1 month, 3 months and 6 months;
- no raw forecast archive is serialized inside the autonomous report;
- no forecast has any broker-execution authority.

### Due-Outcome Maturation Backstop

Implemented in commit:

- `43c7dbfd9ca180dd4f662dd515cfee4916b4f81b` — backfill due forecast outcome history.

This closes a future learning-loop failure mode: an instrument forecast today may disappear from tomorrow's deep-analysis cohort, so the ordinary daily pipeline may stop fetching its history before the old forecast matures.

The maturation backstop therefore:

- scans only existing OPEN `LIVE_SHADOW_OOS` records whose lower-bound horizon date is due;
- performs zero network work for records that are not yet due;
- groups multiple due horizons by company and performs at most one bounded history fetch per company;
- skips redundant fetching when the normal daily collector already has a usable canonical series;
- accepts primary/licensed history or secondary history only when the existing canonical cross-check explicitly passed;
- reconstructs an archived instrument from its immutable listing snapshot when it is no longer in the current universe;
- supplements market history only for outcome measurement and has `finalActionImpact: NONE`;
- leaves the forecast OPEN when a validated future market observation still does not exist.

New live forecast records retain an immutable listing snapshot (`symbol`, `MIC`, `exchange`, `currency`) specifically so they can be evaluated months later without relying on today's discovery cohort.

### Forecast Learning Status

Implemented in commit:

- `f3ae57f3d0055c82591035b8456fb382f6f83c6f` — expose live forecast learning status.

This contract is intentionally stricter than a simple sample-count threshold. Per asset class and horizon it reports:

- total live OOS records, OPEN records and MATURED records;
- maturity rate;
- progress toward the default promotion floor of 200 matured samples;
- Brier score, log loss, expected calibration error, base-rate benchmark and skill versus base rate;
- chronological temporal-stability diagnostics;
- explicit promotion blockers.

Stability defaults to three contiguous chronological subperiods, at least 40 matured observations per subperiod and at least 150 matured observations overall before stability can be assessed. Each subperiod must preserve non-negative probabilistic skill versus the base rate and stay inside the bounded subperiod calibration-error threshold.

The ordinary promotion gate still requires at least 200 matured live OOS observations, at least 5% probabilistic skill versus the base-rate Brier score and expected calibration error no greater than 0.08. Passing those metrics is still not enough by itself: temporal stability must also pass.

Even after every statistical gate passes, the group can become only `PROMOTION_CANDIDATE`. The contract remains hard-coded to `decisionIntegrationEnabled:false` and `forecastMayInfluenceFinalAction:false`. Live learning therefore cannot silently grant itself BUY/SELL authority.

Verification:

- workflow run `31453370894`;
- deterministic suite: **256/256 PASS, 0 FAIL**;
- runtime migration chain: **53 unique patches**.

### Independent US History Overlap Witness

Implemented in commit:

- `a1ac9ef00c4a221c8b711e9d40513e2da9ac8cc0` — add independent US history overlap witness.

The purpose of this layer is narrow: break the Yahoo-self-validation deadlock for eligible US instruments without making a second provider a new source of truth.

The current implementation uses Twelve Data only as an optional recent daily overlap witness for US listings. It is not a canonical quote provider, not a final-action input and not execution-grade data.

Locked rules:

- the witness is US-only in the current implementation;
- it is normalized as `SECONDARY_UNVALIDATED`, `researchOnly:true`, `decisionEligible:false`, `executionEligible:false`;
- only raw daily close is used for the overlap witness;
- the witness must independently agree with the recent Yahoo series under the existing long-history return/scale cross-check before Yahoo `range=max` history is even requested;
- if the witness is missing, rate-limited, malformed, too short or materially disagrees with Yahoo, long-history remains blocked;
- non-US Yahoo history remains blocked rather than being forced through a US-only witness;
- no hardcoded company-specific symbols are introduced;
- acquisition remains bounded;
- the API key is accepted only from runtime secret/configuration and is never written into the sanitized `sourceUrl`, diagnostics, report, archive or live status;
- provider or exception messages are redacted defensively before diagnostics are persisted;
- if no API key is configured, zero witness network calls are performed and the prior fail-closed behaviour remains intact.

Verification:

- workflow run `31453705867`;
- deterministic suite: **263/263 PASS, 0 FAIL**;
- all schemas parsed successfully;
- source governor, canonical quote contract and feed registry verification passed;
- runtime migration chain remains **53 unique patches**, because the provider is consumed by the already-installed long-history collector contract and required no additional migration patch.

Production wiring for the optional secret and witness telemetry was added on `main` in commit `de3eb249552358a9528490ebc00f029a15cdd98d`. That workflow change does not prove the provider is configured or live by itself; production activation is considered verified only after the triggered production run completes and the remote live-feed telemetry is re-read.

### Current deterministic verification

Current source branch: `investor-control-v1-market-intelligence-foundation`.

Current implementation head before this documentation-only checkpoint: `a1ac9ef00c4a221c8b711e9d40513e2da9ac8cc0`.

Runtime release: **v1.8.0**.

Runtime migration chain: **53 unique patches**.

Market Intelligence deterministic suite: **263/263 PASS, 0 FAIL** on workflow run `31453705867`.

All JSON schemas parsed successfully. Source governor, canonical quote contract and feed registry verification also passed.

PR #14 remains **Draft / unmerged**.

## Earlier verified checkpoint retained for audit history

Branch: `investor-control-v1-market-intelligence-foundation`

Forecast Outcome Ledger commit: `6dc2d9b61afac9a3bd49265256d07ce4dbe6f47e`

Market Intelligence deterministic suite at that point: **220/220 PASS, 0 FAIL**.

Runtime release: **v1.8.0**.

PR #14 remained **Draft / unmerged**.

## Current data limitation

The existing short/recent market-history path is sufficient for ordinary market metrics but is not enough to claim serious multi-year historical-pattern learning on its own.

Yahoo can provide adjusted multi-year research history, but it is accepted only when overlapping recent observations are independently cross-checked. The optional Twelve Data witness can now provide that independence for eligible US instruments when a runtime API key is configured and the cross-check passes.

This does not solve non-US coverage. Athens and other non-US Yahoo-fallback histories remain blocked from multi-year pattern learning until a lawful, independent and operationally reliable overlap source exists for those markets.

The independent-source requirement remains intentionally stricter than ordinary research availability. A secondary provider must never silently become execution-grade evidence, and an unverified second endpoint from the same provider must not be counted as independent corroboration.

## Next engineering target

1. Verify the production run triggered by the optional Twelve Data secret wiring and read the remote overlap telemetry; do not infer that a secret exists merely because the workflow accepts it.
2. If the secret is absent, keep production fail-closed and configure it only through repository secrets rather than code or files.
3. If the witness is active, measure actual overlap pass/fail rates before expanding provider usage or request volume.
4. Keep accumulating one daily `LIVE_SHADOW_OOS` sample per model/instrument/horizon/trading date.
5. Let the maturation backstop convert due records to MATURED only from validated future market observations.
6. Maintain learning-status promotion blockers until live sample, calibration, skill and temporal-stability gates all pass.
7. Keep forecast influence on final action disabled even for a `PROMOTION_CANDIDATE` until a separate reviewed decision-engine integration is designed and tested.
8. Add a lawful independent overlap path for Athens/non-US only if it preserves the same fail-closed provenance and independence guarantees.

## Non-negotiable invariants

- no look-ahead leakage;
- no survivorship-biased “perfect” history;
- no in-sample result used for calibration;
- no confidence/data-quality score presented as probability;
- no uncalibrated historical hit rate presented as final probability;
- no correlated intraday forecast duplication used to inflate OOS sample size;
- no same-provider self-validation counted as independent history corroboration;
- no API secret serialized into source URLs, diagnostics, reports, archives or live status;
- no unvalidated secondary witness promoted to canonical or execution-grade market data;
- no hidden contradictions or fabricated missing data;
- no forecast may bypass evidence, risk, liquidity or execution gates;
- no automatic broker order.

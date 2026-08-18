# Investor Control v1.8.0 — Production Learning Verification

Date: 2026-08-11

This checkpoint supplements `V180_IMPLEMENTATION_LOG.md` and records the production facts verified after the optional independent-history witness was wired.

## Production run #56 — verified

Workflow: `Investor Control Production Intelligence v2`

- run ID: `31453897277`;
- run number: `56`;
- workflow commit on `main`: `de3eb249552358a9528490ebc00f029a15cdd98d`;
- tested/published source commit: `a1ac9ef00c4a221c8b711e9d40513e2da9ac8cc0`;
- runtime release: `v1.8.0`;
- result: **SUCCESS end-to-end**;
- deterministic tests, autonomous build, strict production safety, Opportunity Hunter safety, forecast archive verification, transactional publication and remote re-verification all completed successfully.

Live status after publication:

- operational status: `OPERATIONAL`;
- stale output: `false`;
- publisher contract: `TRANSACTIONAL_V2_SINGLE_WRITER`;
- forecast archive contract: `DAILY_OOS_TRANSACTIONAL_V1`;
- forecast learning contract: `LIVE_SHADOW_OOS_RESEARCH_ONLY_V1`;
- live forecast outcome records: `50`;
- OPEN: `50`;
- MATURED: `0`;
- forecast-learning promotion candidate groups: `0`;
- long-history research ready: `0`;
- long-history research rejected: `8`;
- independent overlap attempted: `0`;
- independent overlap ready: `0`;
- independent overlap rejected: `8`.

## Twelve Data configuration result

The production workflow accepts `TWELVE_DATA_API_KEY` only as a GitHub Actions secret. The verified live telemetry (`attempted=0`, `ready=0`, `rejected=8`) proves the optional witness was **not configured/available to the run**. Under the implemented fail-closed policy, this caused zero Twelve Data requests and did not interrupt the production workflow.

No API secret is stored in repository files, source URLs, diagnostics, reports, archives or live status.

## Finnhub historical-candle entitlement — verified blocker

The live autonomous diagnostics explain why the already-connected Finnhub account cannot currently provide the independent US historical-candle overlap:

- `FINNHUB_CANDLES_PREMIUM_REQUIRED`;
- HTTP status `403`;
- observed for US equities including SPCE and KNSA, and for the SPY benchmark.

Therefore the Yahoo fallback is not merely the result of requesting too short a history window. The currently configured Finnhub entitlement does not permit the candle-history endpoint needed for this use case.

This path must not be treated as available unless entitlement changes and production diagnostics subsequently prove it.

## Locked interpretation

- Do not weaken Yahoo self-validation protection.
- Do not count another Yahoo endpoint as an independent source.
- Do not infer Twelve Data availability from workflow wiring alone.
- Do not upgrade Finnhub candle history in code merely by increasing the requested date range while the live entitlement returns 403.
- Do not let any optional history witness affect canonical quotes, final actions or execution eligibility.
- Continue live OOS accumulation and maturation independently of the long-history provider bottleneck.

## Next technical direction

Continue with the provider-independent forecasting architecture: a deterministic, versioned multi-factor feature vector and latent forecast score combining historical-pattern evidence with validated valuation/quality, growth/profitability, momentum/relative strength, risk and evidence-backed catalysts. The latent score is not a probability and remains shadow-only until a future live-OOS calibration layer demonstrates probabilistic skill and stability.
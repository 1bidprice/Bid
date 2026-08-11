# Investor Control v1.8.0 — Forecast Classification Lineage Checkpoint

Date: 2026-08-11

## Verified code checkpoint

Verified v1812 code head: `a0c2eaae7023bc2bf82bb54dc81036b2c522bfbe`.

Runtime release: **v1.8.0**.
Runtime patch chain: **61 unique test patches / 60 unique build patches**.

v1812 establishes canonical forecast-time classification lineage as a prerequisite for future sector/correlated-cluster OOS independence analysis.

The layer is deliberately metadata-only. It does not change factor weights, factor coefficients, probability calibration, opportunity ranking, final-action rules, portfolio logic, transaction logic, mobile UI or broker execution.

## Why classification needed a separate lineage

The active SEC universe registry (`company_tickers_exchange.json`) does not provide canonical sector/industry classification. The existing universe adapter therefore leaves `sector` and `industry` unset.

The production pipeline already performs one official SEC submissions request for analysed US issuers. The SEC submissions JSON contains top-level `sic` and `sicDescription` fields, so v1812 reuses that same existing official response rather than performing another request.

Classification is not written into `company.sector` or `company.industry`. It is carried separately as research metadata so current ranking and decision behavior cannot change as a side effect of this lineage work.

## Canonical classification contract

Contract: `FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1`.
Policy version: `2026-08-11.1`.

Current canonical source support:

- authority: `SEC_EDGAR_SUBMISSIONS`;
- taxonomy: `SEC_SIC`;
- source: official `https://data.sec.gov/submissions/CIK##########.json` payload already fetched by the evidence pipeline;
- code: normalized four-digit SIC code;
- description: official SEC SIC description;
- source document identity: CIK;
- captured timestamp: exact forecast-time pipeline retrieval timestamp;
- `inferenceUsed:false`;
- `decisionImpact:'NONE'`.

No SIC-to-GICS mapping is performed. No sector or industry label is inferred from ticker, company name, financial ratios, model route or narrative text.

## Fail-closed validation

A classification snapshot is not persisted when required canonical evidence is unavailable or malformed.

Validation rejects:

- invalid classification contract or policy version;
- unsupported source authority;
- unsupported taxonomy;
- malformed SIC code;
- missing official description;
- any inferred classification;
- any classification decision impact;
- missing or mismatched company/instrument identity;
- malformed SEC source URL or CIK document identity;
- invalid capture timestamp;
- classification captured after the forecast itself.

Legacy forecast records without a classification snapshot remain valid.

## Immutable forecast-time snapshot rule

Classification is frozen only when a NEW OOS forecast record is created and the canonical classification was available at that forecast's creation time.

The snapshot is stored on the forecast outcome record as `classificationSnapshot` and is treated as immutable forecast-time evidence.

The archive merge has an explicit NO-BACKFILL invariant:

- if an existing forecast record did not have classification, a later OPEN/MATURED copy cannot add one;
- if an existing forecast already had classification, later maturation preserves the original snapshot even if the incoming copy carries a different or tampered classification;
- old records are never retrospectively populated using today's issuer classification.

This prevents historical classification leakage.

## Pipeline wiring

v1812 uses the existing production flow:

1. the existing SEC submissions request extracts the official SIC snapshot;
2. the daily intelligence report collects snapshots in a separate `classificationSnapshots` array;
3. autonomous intelligence passes that separate array directly to the forecast archive cycle;
4. only newly created OOS forecast records may freeze a valid matching snapshot;
5. archive merge preserves original forecast-time classification lineage;
6. the archive verifier independently validates any snapshot that exists;
7. records without a snapshot remain backward compatible.

Classification is not passed through current final-action or opportunity-scoring inputs.

## Archive observability

The archive cycle now records `candidateClassificationSnapshotRecordCount`, allowing production evidence to show how many newly generated candidate forecast records carried canonical classification.

This observability does not grant classification any scoring or decision authority.

## Regression coverage

Seven dedicated v1812 regressions were added:

1. SEC submissions extracts canonical SIC classification from the existing single official request;
2. missing/malformed SIC never creates inferred classification, and post-forecast capture is rejected;
3. classification remains a separate research lineage and is not written into `company.sector`, `company.industry`, final-action or opportunity-factor code;
4. a new OOS forecast freezes a valid forecast-time SEC classification snapshot;
5. a legacy forecast without classification is never backfilled when the same forecast later matures;
6. an already classified OPEN forecast preserves its original immutable snapshot when an incoming MATURED copy contains a changed classification;
7. the archive verifier accepts legacy absence but rejects malformed/inferred classification snapshots.

## Migration compatibility incident

The first two v1812 CI attempts failed before the test suite because the migration script used anchors that were too dependent on older source layout.

No classification semantic test failed.

The two fixes were deliberately limited to migration anchors:

- daily-runner accumulator anchor narrowed to the stable `documentLimit` boundary;
- forecast-archive wiring anchor narrowed to the exact `createLiveShadowForecastRecords(...)` line.

No classification contract, no-backfill rule, scoring logic, weights or decision logic was relaxed to make CI pass.

## Final source verification

Market Intelligence workflow run `31493219109`: **SUCCESS**.

Deterministic suite: **339/339 PASS, 0 FAIL**.

Runtime patch chain applied: **61 unique test patches**.

All seven v1812 classification regressions passed.

Source/quote contracts passed.
All JSON schemas parsed successfully.

Mobile validation workflow run `31493219062`: **SUCCESS**.

Standalone Android workflow run `31493219074`: **SUCCESS**.

The exact-head Android run successfully completed:

- mobile release identity verification;
- native Android generation;
- Gradle release build;
- embedded JavaScript bundle verification;
- standalone Android artifact upload.

No mobile source file changed in v1812.

## Successful production publication

Production workflow run: `31488784580`.
Successful v1812 rerun job: `93785211775`.

The production path completed **SUCCESS end-to-end**:

- verified source checkout;
- deterministic source contracts/tests;
- autonomous live-intelligence build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- classification-aware forecast outcome archive verification;
- transactional live publication;
- remote published-feed re-verification;
- evidence artifact upload.

## Verified live state

Live source commit: `a0c2eaae7023bc2bf82bb54dc81036b2c522bfbe`.

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At publication:

- analysed companies: 32;
- current market snapshots: 32;
- ready historical sets: 32/32;
- fundamental snapshots: 30;
- factor-learning lineage records: 41;
- matured factor-score OOS records: 0;
- factor-learning promotion candidates: 0;
- factor-attribution lineage records: 41;
- manual weight-review candidates: 0;
- governance lineage records: 41;
- governance proposals: 0;
- governance status: `NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS`;
- forecast outcome records: 91;
- OPEN forecast records: 91;
- MATURED forecast records: 0.

Verified safety flags remain:

- `forecastFactorAutomaticWeightAdjustmentEnabled:false`;
- `forecastFactorAutomaticProposalApplicationEnabled:false`;
- `forecastFactorProbabilityCalibrationEnabled:false`;
- `forecastFactorDecisionIntegrationEnabled:false`;
- `forecastFactorMayInfluenceFinalAction:false`.

## Real production classification evidence

The successful production archive contains **91** OOS forecast records.

Exactly **5** records carry a v1812 classification snapshot.

Those five records belong to three US issuers and use only canonical SEC SIC metadata:

- EFOI — SIC 3640 — `Electric Lighting & Wiring Equipment`;
- TWLO — SIC 7372 — `Services-Prepackaged Software`;
- MREO — SIC 2834 — `Pharmaceutical Preparations`.

Across all five snapshots:

- source authority is `SEC_EDGAR_SUBMISSIONS`;
- taxonomy is `SEC_SIC`;
- `inferenceUsed:false`;
- `decisionImpact:'NONE'`;
- source URLs point to official SEC submissions payloads.

## Real production NO-BACKFILL proof

The immediately preceding production archive contained **86** forecast records.

Comparison against the v1812 archive shows:

- previous records: 86;
- current records: 91;
- forecast IDs common to both archives: 86;
- removed prior forecast IDs: 0;
- common prior forecast IDs that gained classification: **0**;
- common prior forecast IDs whose classification changed: **0**;
- newly added forecast IDs: 5;
- newly added forecast IDs with canonical classification: **5/5**.

Therefore v1812 did not retrospectively classify any pre-existing forecast. Classification lineage begins only with newly created OOS records, exactly as designed.

## Current statistical boundary

v1812 does **not** activate a sector or correlated-cluster concentration gate.

Reasons:

- SEC SIC currently covers only canonical US issuer classification available through the existing SEC path;
- Athens currently has no equivalent canonical forecast-time classification source wired into this lineage;
- SIC is not silently mapped to GICS/ICB or another cross-market taxonomy;
- the classified OOS sample has not matured;
- historical unclassified forecasts must remain unclassified and cannot be pooled as if their old classification were known.

A future cluster-independence gate must use only matured records carrying a valid forecast-time classification snapshot and must define a documented cross-market taxonomy before US and Athens sector evidence can be pooled.

## Diff safety

Compared with the v1811 checkpoint, the v1812 code head is ahead by five commits and changes only four market-intelligence artifacts:

- `market-intelligence/config/runtime-release-manifest.json`;
- `market-intelligence/scripts/apply-v1812-forecast-classification-lineage.js`;
- `market-intelligence/src/forecast-classification-lineage.js`;
- `market-intelligence/test/forecast-classification-lineage.test.js`.

No mobile, portfolio, transaction, opportunity-ranking, factor-weight or final-action source file changed in this slice.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**.

This checkpoint does not authorize merge, Play Store publication, automatic broker execution, probability promotion or factor-weight application.

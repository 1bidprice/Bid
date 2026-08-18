# Investor Control v1.8.0 — Taxonomy-Native OOS Concentration Checkpoint

Date: 2026-08-12

## Verified code checkpoint

Verified v1814 code head: `8e800a5612ecdd082de0ef8e3d14071004e69e6f`.

Runtime release: **v1.8.0**.
Runtime patch chain: **63 unique test patches / 62 unique build patches**.

v1814 adds a taxonomy-native concentration gate to the existing OOS learning, factor-attribution and manual-only factor-weight-governance pipeline.

The purpose is to prevent apparently strong research evidence from being promoted when it is concentrated in one economic/industry cluster, while preserving the strict forecast-time classification lineage introduced by v1812/v1813.

## Taxonomy boundary

v1814 explicitly refuses to pretend that SEC SIC and FTSE Russell ICB are one common taxonomy.

Native clustering is defined independently:

### SEC / US

- source taxonomy: `SEC_SIC`;
- native cluster level: 2-digit SIC major group;
- cluster key shape: `SEC_SIC_MAJOR_GROUP:<XX>`;
- the major group is derived only from the frozen 4-digit SEC SIC code already present in the forecast-time snapshot;
- no description-based sector inference is used.

### Euronext Athens

- source taxonomy: `FTSE_RUSSELL_ICB`;
- native cluster level: exact forecast-time published ICB `Sector` label;
- cluster key shape: `FTSE_RUSSELL_ICB_SECTOR:<sector>`;
- no numeric ICB code is invented;
- no mapping from SIC is attempted.

Even if a SEC description and an Athens ICB label use identical text such as `Banks`, their cluster keys remain different because their source taxonomies are different.

The output contract permanently declares:

- `crossTaxonomyMappingUsed:false`;
- `inferenceUsed:false`;
- `decisionImpact:'NONE'`.

## New research contract

New source module:

`src/forecast-oos-taxonomy-concentration.js`

Contract:

`OOS_TAXONOMY_NATIVE_CONCENTRATION_V1`

Policy version:

`2026-08-12.1`

The evaluator accepts only the immutable `classificationSnapshot` already frozen on OOS forecast records.

It re-validates each snapshot against the forecast record and rejects snapshots that:

- are malformed;
- were captured after the forecast;
- contain forbidden inference;
- contain an unsupported taxonomy;
- lack a valid native cluster identity.

No current-day classification is looked up inside this evaluator.
No old forecast is backfilled.

## Learning / attribution thresholds

For Factor Learning and Factor Attribution, the new additional requirements are:

- minimum valid forecast-time classification coverage: **80%**;
- a taxonomy becomes material when it represents at least **15%** of the valid classified sample;
- minimum records in a material taxonomy: **30**;
- maximum share of one native cluster inside a material taxonomy: **40%**;
- minimum inverse-HHI effective native cluster count: **3**.

These are additional gates.
They do not replace any prior requirement for:

- matured OOS sample count;
- positive/negative class support;
- distinct forecast dates;
- distinct instruments;
- maximum single-date concentration;
- horizon-aware non-overlapping realised-outcome windows;
- maximum single-instrument concentration;
- effective instrument count;
- ROC AUC;
- top/bottom outcome spread;
- realised-return spread;
- score-bin ordering;
- temporal stability.

## Weight-governance thresholds

Factor Weight Governance remains intentionally stricter.

A governance proposal additionally requires:

- minimum valid forecast-time classification coverage: **90%**;
- material taxonomy share: **15%**;
- minimum records in each material taxonomy: **50**;
- maximum share of one native cluster: **30%**;
- minimum inverse-HHI effective native cluster count: **4**.

The existing governance sample floor and all prior independence/stability gates remain mandatory.

Passing this gate does **not** apply a weight change.
It can only contribute to a future `MANUAL_WEIGHT_REVIEW_PROPOSAL_READY` state after all other gates pass.

## Independent production verification

The strict production verifier independently re-checks governance taxonomy evidence rather than trusting serialized status text.

For every governance proposal it verifies:

- contract is `OOS_TAXONOMY_NATIVE_CONCENTRATION_V1`;
- status is `TAXONOMY_DIVERSIFICATION_READY`;
- cross-taxonomy mapping is false;
- inference is false;
- decision impact is `NONE`;
- invalid classification count is zero;
- missing native-cluster count is zero;
- coverage threshold is at least 90%;
- actual coverage reaches the configured threshold;
- material-taxonomy share threshold is not weakened beyond 15%;
- material-taxonomy record requirement is present and not weakened beyond the approved contract;
- maximum native-cluster share threshold is no weaker than 30%;
- minimum effective native-cluster count is at least 4;
- at least one material taxonomy exists;
- each material taxonomy independently passes its own native-cluster gate.

The verifier rejects any attempt to serialize a cross-mapped, inferred, weakened or concentration-dominated proposal.

## Separation from decisions

The taxonomy gate is research-governance evidence only.

It does not change:

- company ranking;
- Opportunity Hunter scoring;
- factor feature values;
- factor weights;
- latent factor score;
- probability calibration;
- BUY/HOLD/SELL policy;
- portfolio state;
- transaction ledger;
- mobile UI;
- broker execution.

All automatic factor research-to-decision flags remain disabled.

## Dedicated regression coverage

Eight dedicated v1814 taxonomy regressions were added:

1. SEC SIC clustering uses the native 2-digit major group rather than description inference;
2. Athens ICB clustering uses the exact published forecast-time sector;
3. identical descriptive text across SEC and ICB cannot create one cross-taxonomy cluster;
4. diversified material SEC and Athens taxonomies can pass independently;
5. low classification coverage blocks promotion even when the classified subset is diversified;
6. a material taxonomy dominated by one native cluster is rejected;
7. strict governance thresholds require broad native clusters separately in each material taxonomy;
8. a classification captured after forecast time is excluded and blocks the gate.

The production-safety suite also adds an adversarial regression proving that weakened taxonomy thresholds or `crossTaxonomyMappingUsed:true` are rejected.

## CI correction history

The first activated v1814 deterministic run reached the full suite and executed **355 tests**.

Result:

- 353 passed;
- 2 failed.

Both failures were legacy adversarial test fixtures, not production defects.

The old fixtures in:

- `forecast-oos-instrument-concentration.test.js`;
- `forecast-oos-outcome-window-independence.test.js`;

constructed otherwise-valid governance proposals without the new mandatory forecast-time classification evidence.

The fix changed only those two test fixtures:

- synthetic immutable SEC classification snapshots were added;
- six distinct SIC major groups were used so the fixture represents diversified taxonomy evidence;
- existing dates, instruments, outcomes, scores and statistical thresholds were not weakened.

No v1814 production source or threshold changed after that failure.

## Final deterministic verification

Market Intelligence workflow run: `31537017419`.

Verified source head: `8e800a5612ecdd082de0ef8e3d14071004e69e6f`.

Deterministic suite: **355/355 PASS, 0 FAIL**.

Runtime chain: **63 unique test patches / 62 unique build patches**.

All eight taxonomy-native concentration regressions passed.
All prior classification, no-backfill, sample independence, outcome-window independence, instrument concentration, factor learning, attribution, governance, production safety, Hunter and final-action regressions passed.

Source/quote contracts passed.
All JSON schemas parsed successfully.

## Mobile and Android regression boundary

Mobile validation workflow run: `31537017431` — **SUCCESS**.

Standalone Android workflow run: `31537017506` — **SUCCESS**.

Android artifact:

- artifact id: `9119418945`;
- name: `investor-control-standalone-release-apk`;
- archive digest: `sha256:48e88cd1919f7bf863e83025ab70004a2e6212f5275d4d1d07bf188138c7d898`.

The exact-head Android run completed:

- release identity verification;
- native Android project generation;
- Gradle release build;
- embedded JavaScript bundle verification;
- artifact upload.

No mobile source file changed in v1814.

## Successful production publication

Production workflow run: `31488784580`.
Verified v1814 rerun job: `93930950167`.

The full production path completed **SUCCESS**:

- verified source checkout;
- 355 deterministic tests/contracts;
- autonomous intelligence build;
- taxonomy-aware strict production safety verification;
- Opportunity Hunter safety verification;
- forecast archive safety verification;
- transactional live publication;
- remote feed re-verification;
- evidence artifact upload.

Latest production evidence artifact:

- artifact id: `9119284319`;
- digest: `sha256:efe00c2c126cb802f3c9668b118f07017a10e46bd0da447f0bc844df8bd0d643`.

## Verified live status

Live source commit:

`8e800a5612ecdd082de0ef8e3d14071004e69e6f`

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At this publication:

- factor-learning lineage records: **101**;
- matured factor-score OOS records: **15**;
- factor-learning promotion candidate groups: **0**;
- factor-attribution lineage records: **101**;
- manual weight-review candidates: **0**;
- governance lineage records: **101**;
- governance groups: **2**;
- governance proposals: **0**;
- forecast outcome records: **151**;
- OPEN records: **102**;
- MATURED records: **49**.

All automatic authority flags remain false:

- automatic factor-weight adjustment: false;
- automatic governance proposal application: false;
- probability calibration integration: false;
- factor decision integration: false;
- factor influence on final action: false.

## Real live taxonomy-gate evidence

The taxonomy-native gate is visible in the actual autonomous production report.

One current factor-learning sample shows:

- sample size: 15 matured scored records;
- valid forecast-time classifications: 3;
- unclassified records: 12;
- invalid classification snapshots: 0;
- missing native clusters: 0;
- classification coverage: **20%**;
- required learning coverage: **80%**;
- taxonomy-native status: `TAXONOMY_DIVERSIFICATION_NOT_READY`.

Other current groups similarly show low classification coverage because immutable classification lineage only began recently.

This is the intended behavior.
The system does not backfill old OOS records merely to make the statistical gate pass.

The live governance objects contain the stricter v1814 thresholds:

- classification coverage: **90%**;
- material taxonomy share: **15%**;
- material taxonomy minimum records: **50**;
- maximum one native cluster: **30%**;
- minimum effective native clusters: **4**.

Current groups do not meet those coverage/history requirements and therefore remain blocked.

## Classification collection continues independently

The same production report contains **38 current canonical classification snapshots**, including official Athens ICB snapshots and SEC SIC snapshots.

Those current classifications remain useful only for newly created forecast identities.

They are not retroactively attached to historical OOS records.

The classification coverage of matured evidence will therefore rise naturally only as new classified forecasts are created and subsequently mature.

## Diff safety from v1813

Compared with v1813 checkpoint `c11203a4f1a96251858cc3f8a1606d4355088603`, v1814 changes exactly six market-intelligence artifacts:

- `config/runtime-release-manifest.json`;
- `scripts/apply-v1814-oos-taxonomy-concentration.js`;
- `src/forecast-oos-taxonomy-concentration.js`;
- `test/forecast-oos-taxonomy-concentration.test.js`;
- `test/forecast-oos-instrument-concentration.test.js` — fixture-only enrichment;
- `test/forecast-oos-outcome-window-independence.test.js` — fixture-only enrichment.

No mobile, portfolio, transaction, broker, Opportunity Hunter scoring, factor-weight configuration or final-action production source file changed.

## Current statistical boundary

v1814 does **not** claim that taxonomy independence is already mature.

It establishes a fail-closed rule for the future:

- learning/attribution cannot promote until enough matured forecast-time classifications exist;
- governance cannot propose a manual weight review until stricter classification coverage and native-cluster diversity exist;
- SIC and ICB remain separate native taxonomies;
- no historical backfill is allowed;
- no classification inference is allowed;
- no taxonomy result can directly influence BUY/HOLD/SELL.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**.

This checkpoint does not authorize:

- merge;
- Play Store publication;
- automatic broker execution;
- automatic factor reweighting;
- automatic application of governance proposals;
- probability promotion;
- taxonomy-based final-action influence.

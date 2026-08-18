# Investor Control v1.8.0 — Athens ICB Classification Lineage Checkpoint

Date: 2026-08-11

## Verified code checkpoint

Verified v1813 code head: `388430d8ce2456aabc386f5ecb78d6b56d3f1874`.

Runtime release: **v1.8.0**.
Runtime patch chain: **62 unique test patches / 61 unique build patches**.

v1813 extends the v1812 forecast-time classification lineage with a canonical Athens classification source while keeping classification metadata completely outside portfolio, trading, opportunity-ranking, factor-weight and final-action authority.

## Canonical Athens source

Euronext Athens issuer profiles publish `Sector / Sub-sector` labels for resolved issuers. v1813 uses only the official issuer profile for a company that already has a canonical numeric `issuerId`.

Canonical URL shape:

`https://athens.euronext.com/en/market-data/issuers/<issuerId>`

The adapter performs a bounded official profile request and extracts the published labels exactly. It does not infer the profile ID from taxonomy-term IDs, company names, OASIS symbols, financial statements or any other heuristic.

## Athens classification contract

The existing v1812 classification contract remains:

- contract: `FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1`;
- policy version: `2026-08-11.1`.

Athens snapshots use:

- source authority: `EURONEXT_ATHENS_ISSUER_PROFILE`;
- taxonomy: `FTSE_RUSSELL_ICB`;
- exact published `sector` label;
- exact published `subSector` label;
- description: `<sector> / <subSector>`;
- official issuer-profile URL;
- source document identity: `EURONEXT_ATHENS_ISSUER_<issuerId>`;
- exact forecast-time capture timestamp;
- `inferenceUsed:false`;
- `decisionImpact:'NONE'`.

No ICB numeric code is invented. If a code is present without canonical evidence, validation rejects the snapshot with `CLASSIFICATION_UNVERIFIED_CODE_FORBIDDEN`.

## Identity boundary

A key v1813 invariant is that an Athens announcement taxonomy term is **not** treated as an issuer-profile ID.

`taxonomyTermId` and canonical `issuerId` remain separate identities.

If a company is resolved only through taxonomy/trading-directory identity and has no canonical issuerId, classification fails closed with `ATHENS_ICB_ISSUER_ID_REQUIRED`.

The classification layer never guesses that a taxonomy term number is the issuer-profile number.

## Parser and network safety

The Athens adapter:

- requests only the official canonical issuer-profile URL;
- accepts the published HTML profile;
- searches for `Sector / Sub-sector` in the structured profile table;
- has a bounded text fallback for equivalent rendered profile content;
- rejects missing classification;
- rejects ambiguous multiple classification values;
- converts HTTP/network failures into diagnostics rather than throwing into identity/discovery logic;
- never changes symbol resolution or issuer identity because classification is unavailable.

Classification failure is therefore metadata-only and cannot break market discovery or a final action.

## Separation from decisions

Athens classification snapshots are propagated through a separate `classificationSnapshots` array:

1. Athens discovery resolves canonical companies;
2. the bounded classification adapter reads official issuer profiles only where an actual issuerId exists;
3. autonomous discovery carries the snapshots as separate metadata;
4. the daily report seeds its existing v1812 `classificationSnapshots` array with those Athens snapshots;
5. SEC snapshots continue to append through the existing submissions path;
6. the v1812 archive logic may freeze a matching snapshot only on a newly created OOS forecast identity.

The classification data is not written to `company.sector` or `company.industry`.

It is not read by:

- the Opportunity Hunter scoring path;
- factor-weight calculation;
- probability calibration;
- final-action policy;
- mobile trading UI;
- portfolio logic;
- transaction logic;
- broker execution.

## NO-BACKFILL remains mandatory

The v1812 immutable lineage rule is unchanged.

If an existing forecast identity was created without classification, a later execution cannot attach today's Athens classification to that old forecast.

If a record already has a snapshot, later maturation must preserve the original snapshot.

This ensures historical OOS evidence is not retrospectively enriched with information that was not frozen at forecast creation time.

## Regression coverage

Seven dedicated v1813 regressions were added:

1. exact extraction of published Athens `Sector / Sub-sector` labels;
2. missing or ambiguous profile classification fails closed;
3. exactly one canonical issuer-profile request creates an Athens snapshot with no guessed code;
4. validator rejects invented ICB codes;
5. issuer-profile HTTP failure is diagnostic-only;
6. Athens classification remains outside sector mutation, opportunity scoring and final-action authority;
7. new Athens OOS forecasts can freeze ICB lineage while legacy forecasts remain non-backfillable.

Legacy Athens discovery tests were updated only where their output contract changed from discovery version 6 to version 7 or where classification metadata diagnostics now exist.

Synthetic taxonomy-only fixtures explicitly expect zero classification snapshots rather than pretending their taxonomy term is a canonical issuer ID.

## CI correction history

The first v1813 activation failed before tests because the autonomous runner migration anchor assumed the pre-v180 `runDailyIntelligence(...)` call shape. The existing shadow-forecast migration had already added `historicalSeriesCollector`.

The fix changed only the migration anchor and inserted classification metadata alongside the existing historical collector.

The next deterministic run reached the suite and exposed test/fixture compatibility failures only:

- legacy Athens tests expected discovery version 6 instead of version 7;
- the v1812 static test expected an initially empty classification array instead of the new seeded array;
- one new static regex over-specified code formatting;
- two legacy taxonomy-only fixtures incorrectly expected classification even though no canonical issuerId existed.

Those failures were corrected only in tests/fixtures. No production classification rule, identity rule, no-backfill rule, scoring rule or decision boundary was relaxed.

## Final deterministic verification

Market Intelligence workflow run `31496861837`: **SUCCESS**.

Deterministic suite: **346/346 PASS, 0 FAIL**.

Runtime chain: **62 unique test patches**.

All seven v1813 Athens classification regressions passed.
All prior Athens identity, SEC classification, OOS no-backfill, factor safety, Hunter and decision-policy regressions also passed.

Source/quote contracts passed.
All JSON schemas parsed successfully.

## Mobile and Android verification

Mobile validation workflow run `31496861833`: **SUCCESS**.

Standalone Android workflow run `31496861842`: **SUCCESS**.

Android artifact:

- artifact id: `9103635705`;
- name: `investor-control-standalone-release-apk`;
- archive digest: `sha256:31c80015eb961fd20ad8ca167ed4f34eeb74564046821305d4f7a620193aaa12`.

The exact-head Android run completed:

- mobile release identity verification;
- native Android project generation;
- Gradle release build;
- embedded JavaScript bundle verification;
- artifact upload.

No mobile source file changed in v1813.

## Successful production publication

Production workflow run: `31488784580`.
Verified v1813 rerun job: `93797378199`.

The full production path completed **SUCCESS**:

- verified source checkout;
- 346 deterministic source tests/contracts;
- autonomous intelligence build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- classification-aware forecast archive verification;
- transactional live publication;
- published remote feed re-verification;
- evidence artifact upload.

Latest production evidence artifact: `9103475072`.

## Verified live status

Live source commit: `388430d8ce2456aabc386f5ecb78d6b56d3f1874`.

Runtime release: `1.8.0`.

Operational status: `OPERATIONAL`.

`staleOutput:false`.

At this publication:

- analysed companies: 32;
- market snapshots: 32;
- ready historical metrics: 32/32;
- fundamental snapshots: 30;
- factor-learning lineage records: 85;
- matured factor-score OOS records: 0;
- factor-learning promotion candidate groups: 0;
- factor-attribution lineage records: 85;
- manual weight-review candidates: 0;
- governance lineage records: 85;
- governance proposals: 0;
- forecast outcome records: 135;
- OPEN forecast records: 135;
- MATURED forecast records: 0.

Automatic research-to-decision safety flags remain disabled:

- automatic factor-weight adjustment: false;
- automatic governance proposal application: false;
- probability calibration integration: false;
- factor decision integration: false;
- factor influence on final action: false.

## Real production Athens ICB evidence

The live autonomous report contains **37 canonical classification snapshots**:

- 28 SEC / `SEC_SIC` snapshots;
- 9 Euronext Athens / `FTSE_RUSSELL_ICB` snapshots.

The 9 Athens snapshots came from actual official issuer profiles and included observed classifications such as:

- `Travel & Leisure / Travel & Tourism`;
- `Financial Services / Closed End Investments`;
- `Retail / Specialty Retailers`;
- `Utilities / Conventional Electricity`;
- `Construction & Materials / Cement`;
- `Banks / Banks`;
- `Basic Resources / Textile Products`;
- `Travel & Leisure / Casinos & Gambling`.

Every Athens snapshot has:

- `sourceAuthority: EURONEXT_ATHENS_ISSUER_PROFILE`;
- `taxonomy: FTSE_RUSSELL_ICB`;
- an official `athens.euronext.com/en/market-data/issuers/<issuerId>` source URL;
- `inferenceUsed:false`;
- `decisionImpact:'NONE'`;
- no guessed numeric ICB code.

Two Athens companies with canonical ICB snapshots were also present in the current shadow-forecast set (`TITC` and `ETE`).

## Real production NO-BACKFILL proof

The immediately preceding v1812 archive contained **91** forecast records.
The v1813 archive contains **135** forecast records.

Direct forecast-ID comparison shows:

- previous records: 91;
- current records: 135;
- common forecast IDs: 91;
- removed previous IDs: 0;
- newly created forecast IDs: 44;
- classification backfills onto common old IDs: **0**;
- classification changes on common old IDs: **0**;
- new classified records: 44.

The 44 new records in this production run were SEC-classified records. No Athens classification snapshot was written into an existing same-day Athens forecast identity.

This is the expected fail-closed behavior: Athens ICB classification was successfully collected in the live report, but the current Athens shadow identities already existed from the same trading date without classification. The NO-BACKFILL rule therefore correctly prevented retrospective enrichment.

A new Athens forecast identity created on a later trading date can freeze the canonical Athens ICB snapshot at creation time.

## Diff safety from v1812

Compared with v1812 checkpoint `793f42c260cf425afab96519933e4dbed4505dc2`, v1813 changes only eight market-intelligence files:

- runtime manifest;
- v1813 migration patch;
- Athens classification adapter;
- shared forecast-classification lineage validator/builder;
- v1813 Athens classification regression suite;
- three test/fixture compatibility files.

No mobile, portfolio, transaction, factor-weight, Opportunity Hunter scoring or final-action production source file changed.

## Current statistical boundary

v1813 **does not activate sector/correlated-cluster OOS concentration analysis**.

The system now has canonical forecast-time classification sources for:

- US issuers: SEC SIC;
- Athens issuers with canonical profile IDs: Euronext Athens ICB labels.

However:

- SEC SIC and FTSE Russell ICB are different taxonomies and must not be silently pooled;
- old OOS records remain legitimately unclassified;
- current classified OOS records are still OPEN and none have matured;
- Athens classification must be frozen on genuinely new forecast identities before it can enter historical independence evidence.

The next statistical layer must therefore define a documented cluster-independence method that never pretends SIC and ICB are the same taxonomy and only evaluates matured records carrying their original forecast-time classification snapshots.

## Pull-request boundary

PR #14 remains **open, draft and unmerged**.

This checkpoint does not authorize merge, Play Store publication, automatic broker execution, probability promotion, factor-weight application or sector-based decision influence.

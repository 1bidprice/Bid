# Investor Control v1.8.0 — Factor Weight Governance Checkpoint

Date: 2026-08-11

## Verified source checkpoint

Governance runtime implementation commit: `214cfad4d3f5d1303fe683c75ed4b27e16ee1e59`.

Runtime release: **v1.8.0**.
Runtime migration chain: **56 unique patches**.

The factor-weight layer is a change-control firewall. It does not optimize or apply weights automatically. It can only create bounded, versioned proposals for future manual review after demanding live OOS evidence gates pass.

## Statistical foundation hardened first

Before weight governance was allowed, all forecast-learning layers were aligned on one strict outcome invariant:

> An eligible realised binary outcome is only the actual numeric value `0` or actual numeric value `1`.

`null`, `undefined`, strings such as `'0'`/`'1'`, and other coercible values are excluded from matured learning samples.

Strict-outcome hardening commit: `67ca9ba202724d86765dfc16aa5e2b38acbe7af6`.

Verified on workflow run `31474196624`: **292/292 PASS, 0 FAIL**.

The change hardened:

- probabilistic forecast calibration;
- forecast learning status;
- factor learning status;
- malformed matured-outcome diagnostics and promotion blocking.

## Governance core

Core implementation commit: `694114e96d8ec066d605e48c8dc7a338761f198b`.

Verified on workflow run `31474809580`: **301/301 PASS, 0 FAIL**.

Governance policy version: `2026-08-11.1`.

Only current live model lineage is eligible:

- validation mode: `LIVE_SHADOW_OOS`;
- feature-vector policy version: `2026-08-11.1`;
- factor-score policy version: `2026-08-11.1`;
- compact factor-domain snapshot required.

Older feature-vector or factor-score versions are never pooled into a proposal for the current model.

## Manual proposal gates

A factor-domain weight proposal requires all of the following by default within its own asset-class/horizon cohort:

- current upstream attribution domain exists;
- upstream attribution has `manualWeightReviewCandidate:true`;
- at least **300** matured live OOS domain observations;
- at least **50 positive** and **50 negative** outcomes;
- at least **70%** domain lineage coverage;
- no malformed matured binary outcomes;
- for an increase review: full-period ROC AUC >= **0.60**, positive-rate top/bottom spread >= **0.12**, and positive realised-return spread;
- for a decrease review: ROC AUC <= **0.40**, positive-rate spread <= **-0.12**, and negative realised-return spread;
- the same direction must remain supported across **3 contiguous chronological subperiods**;
- each subperiod requires at least **60** samples and **15** examples of each binary class.

Aggregate full-period strength cannot bypass temporal instability.

## Weight-change boundary

Even when all gates pass, the system creates only `MANUAL_REVIEW_REQUIRED` proposals.

Default direct proposed change is bounded to at most **+/-0.02** for one domain.

The proposed complete weight vector must continue to sum deterministically to **1.0**.

The `RISK` factor is protected:

- a proposal may never reduce the `RISK` weight;
- an increase to another domain takes weight only from other non-RISK domains;
- a decrease to another domain may redistribute some weight into RISK.

## Approval and rollback boundary

No proposal can change the live factor model automatically.

Any future approved weight change requires:

- a new versioned feature-vector policy;
- a new versioned factor-score policy;
- preservation of existing historical OOS records under their original lineage;
- no retrospective rewriting of old OOS forecasts;
- an explicit rollback plan restoring the prior complete weight vector under another new version if rollback is required.

Locked flags remain:

- `automaticWeightAdjustmentEnabled:false`
- `automaticProposalApplicationEnabled:false`
- `probabilityCalibrationEnabled:false`
- `decisionIntegrationEnabled:false`
- `forecastMayInfluenceFinalAction:false`

No BUY/SELL action and no broker order can be produced by the governance layer.

## Runtime integration

Runtime wiring commit: `214cfad4d3f5d1303fe683c75ed4b27e16ee1e59`.

The autonomous runner now builds factor-weight governance only after factor attribution and passes the same attribution status into the governance engine as an upstream gate.

Verified source workflow run `31475040821`: **302/302 PASS, 0 FAIL**.

The source/quote contract checks and all JSON schema parse checks passed.

Mobile validation workflow run `31475040779`: **SUCCESS**.

Standalone APK workflow run `31475040784`: **SUCCESS** including Android project generation, Gradle release build, embedded JavaScript bundle verification and APK artifact upload.

## Production recovery and live verification

The prior production failure `31469755715` attempt 1 was traced to the already-fixed attribution outcome-coercion regression on old source head `2fb53f18...`.

The failed production run was rerun after the strict outcome and governance fixes. Attempt 2 completed **SUCCESS end-to-end**:

- source checkout;
- deterministic tests;
- live autonomous build;
- strict production safety verification;
- Opportunity Hunter safety verification;
- forecast archive verification;
- transactional publication;
- published-remote re-verification;
- evidence artifact upload.

Live publication state after recovery:

- source workflow run: `31469755715`, successful rerun attempt;
- source commit: `214cfad4d3f5d1303fe683c75ed4b27e16ee1e59`;
- runtime release: `1.8.0`;
- operational status: `OPERATIONAL`;
- stale output: `false`;
- forecast archive: **54 records / 54 OPEN / 0 MATURED**;
- current factor-model lineage records: **4**;
- factor governance groups: **2**;
- factor governance proposals: **0**;
- governance status: `NO_ELIGIBLE_WEIGHT_CHANGE_PROPOSALS`.

The zero-proposal result is expected and correct because no factor-model outcomes have matured yet.

Live governance safety flags were verified from the production evidence artifact:

- `automaticWeightAdjustmentEnabled:false`
- `automaticProposalApplicationEnabled:false`
- `probabilityCalibrationEnabled:false`
- `decisionIntegrationEnabled:false`
- `forecastMayInfluenceFinalAction:false`

## Long-history state remains fail-closed

The same live report still shows:

- long-history research ready: 0;
- long-history rejected: 8;
- independent Twelve Data overlap attempts: 0;
- independent overlap ready: 0;
- independent overlap rejected: 8.

The missing Twelve Data secret therefore continues to leave the long-history channel blocked rather than self-validating Yahoo history.

## Pull-request boundary

PR #14 remains **draft, open and unmerged**. This checkpoint does not authorize merging it.

## Next permitted boundary

The next engineering step is production observability only: compact factor-learning / attribution / governance telemetry and fail-closed remote verification may be added to the production status channel. Raw factor-domain OOS records and raw proposal payloads must not be copied into `status.json`.

No automatic weight application is permitted by this checkpoint.

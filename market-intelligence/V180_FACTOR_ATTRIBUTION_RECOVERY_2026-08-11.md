# Investor Control v1.8.0 — Factor Attribution Recovery Checkpoint

Date: 2026-08-11

## Recovery status

Verified source head before this documentation commit: `f29720ac4482522c6ad2d87e8ea5632bbc799daf`.

Runtime release: **v1.8.0**.
Runtime migration chain: **55 unique patches**.

This checkpoint closes the branch/ref recovery and the factor-attribution outcome-eligibility regression discovered during the recovery verification.

## Bug discovered by recovery CI

After the attribution files were restored onto the correct branch, the deterministic suite exposed a real research-metrics bug rather than a cosmetic test mismatch.

The factor-attribution evaluator used numeric coercion when deciding whether an observation carried a binary realised outcome. In JavaScript, `Number(null) === 0`. As a result, an OPEN live-shadow record with `positiveOutcome: null` could be counted as a matured negative observation inside factor-attribution sample metrics.

The defect was confined to the research attribution layer; it did not grant final-action authority, did not produce BUY/SELL actions and did not submit broker orders. Nevertheless, it contaminated matured sample-size and discrimination statistics and therefore had to fail closed.

## Fix

Implementation commit:

- `f6fd97ca25f6d91aa7d1f0fa8377cd0f75046464` — `fix(intelligence): exclude open outcomes from factor attribution`

Regression-test commit:

- `f29720ac4482522c6ad2d87e8ea5632bbc799daf` — `test(intelligence): lock strict factor outcome eligibility`

The attribution contract now accepts an outcome for discrimination only when it is explicitly numeric `0` or numeric `1` on a `MATURED` record. `null`, `undefined`, string `'0'`, string `'1'`, coercible values and OPEN records remain in lineage/coverage accounting only and cannot enter matured attribution metrics.

Factor attribution policy version was advanced to `2026-08-11.2`.

## Regression locks

The deterministic tests now explicitly verify that:

- OPEN snapshots may increase lineage coverage but cannot increase matured sample size;
- positive plus negative matured counts equal the true matured sample count;
- `null` cannot coerce to outcome `0`;
- string `'0'` and string `'1'` cannot enter the matured discrimination sample;
- the research attribution layer remains isolated from final actions and automatic weight changes.

## Verified gates on `f29720ac...`

### Market Intelligence

Workflow run: `31472776422`.

Result: **289/289 PASS, 0 FAIL**.

The source/quote contract gate and all JSON schema parse checks also passed.

### Mobile validation

Workflow run: `31472776371`.

Result: **SUCCESS**.

Verified stages included dependency installation, Opportunity Hunter mobile contract, mobile release identity, Expo package compatibility, Expo Doctor and Android bundle export.

### Standalone APK

Workflow run: `31472776348`.

Result: **SUCCESS**.

Verified stages included Android project generation, standalone release APK build, embedded JavaScript bundle verification and APK artifact upload.

## Locked safety boundary

Factor attribution remains live-shadow research only.

- `automaticWeightAdjustmentEnabled: false`
- `decisionIntegrationEnabled: false`
- `forecastMayInfluenceFinalAction: false`
- no probability mapping from latent factor score
- no automatic broker order

The next permitted engineering boundary is Factor Weight Governance: deterministic, versioned **manual-review proposals only**, with no automatic application and with explicit rollback/version requirements for any future approved weight change.

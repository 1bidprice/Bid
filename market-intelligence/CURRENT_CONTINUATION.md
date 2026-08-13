# Investor Control — CURRENT CONTINUATION

Updated: 2026-08-13

## Mandatory new-chat procedure

Before doing any work in a new conversation:

1. Fetch PR #14 and read its current `head_sha`.
2. Read this file from that exact branch head.
3. Compare the current PR head with the `working source head before this handoff` recorded below.
4. If the branch has moved, inspect the commits after the recorded working source head **before** changing code. Never continue from an older conversational checkpoint just because it is in chat memory.
5. Do not repeat completed v1.8 work, do not merge PR #14, and do not change mobile/portfolio/ledger/final-action code unless the next verified slice explicitly requires it.
6. At the end of every new verified checkpoint, update this file with the new exact state and next action.

This file is the canonical conversational handoff, but the live GitHub PR head is the ultimate source of truth if they differ.

## Repository / branch

- Repository: `1bidprice/Bid`
- Branch: `investor-control-v1-market-intelligence-foundation`
- PR: #14
- PR state at handoff: **open, draft, unmerged**
- Runtime release: `1.8.0`

## Last fully documented runtime checkpoint

**v1823 — Cross-Sectional Historical Regime Walk-Forward**

Checkpoint file:
`market-intelligence/V1823_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RUNTIME_CHECKPOINT_2026-08-13.md`

Original verified v1823 source boundary:
`e275132eefb7a115000e3b0047f64bd53012d377`

Verified at that boundary:

- runtime migrations: 72 unique test patches / 71 build patches
- deterministic Market Intelligence: **459/459 PASS, 0 FAIL**
- Mobile validation: **SUCCESS**
- Standalone Android build: **SUCCESS**
- production run `31649163636`: **SUCCESS end-to-end**
- live production after that publication: `OPERATIONAL`, `staleOutput:false`

## v1823 safety contract

The cross-sectional historical walk-forward engine is **pure research**:

- evidence class: `HISTORICAL_CROSS_SECTIONAL_REGIME_WALK_FORWARD_RESEARCH`
- `validationMode: WALK_FORWARD_OOS`
- historical market regime must be reconstructed only from benchmark observations available at or before each historical forecast timestamp
- current classification must never be copied backwards into historical records
- live archive eligibility: `false`
- live calibration eligibility: `false`
- factor-weight governance eligibility: `false`
- automatic model promotion: `false`
- decision integration: `false`
- final-action influence: `false`
- broker execution: `false`

Normal three-hour production keeps this heavy historical engine **disabled by default** (`DISABLED_BY_CADENCE`) and incurs effectively zero v1823 historical-walk-forward compute/network cost.

## Working source head before this handoff

`8aa7bdb80653a941261e1467a3f951d09cd24bf8`

This is newer than the original v1823 checkpoint boundary.

Latest post-checkpoint fixes:

1. `e8ba4a72cea148ac004551626ff00faaecb5b3de`
   - `fix(intelligence): mark historical walk-forward outcomes matured`
   - historical research records now explicitly carry `status: 'MATURED'`
   - compact audit records expose that status

2. `8aa7bdb80653a941261e1467a3f951d09cd24bf8`
   - `test(intelligence): require matured historical outcome windows`
   - regression requires audit historical records to be `MATURED`
   - regression requires at least one group with valid outcome-window records and zero invalid-window records

Exact-head CI for `8aa7bdb8...` is green:

- Validate Market Intelligence: **SUCCESS**
- Validate Investor Control Mobile: **SUCCESS**
- Standalone APK: **SUCCESS**

The latest two commits are research-only historical-walk-forward hardening. Do not treat them as permission to feed historical research evidence into live calibration or decisions.

## Immediate next action

Continue with the **separate sparse historical-research execution path** described by the v1823 checkpoint.

It must satisfy all of the following:

1. Explicitly opt in to v1823; never change normal production default-off behavior.
2. Use only histories already loaded by the autonomous analysis run; do not create a new uncontrolled historical-data fetch path.
3. Publish **no live feed**.
4. Write **no live forecast archive**.
5. Produce a standalone research artifact only.
6. Pass the v1823 historical-walk-forward production firewall before artifact upload.
7. Start as a manual or one-off proof. Do **not** enable a recurring schedule yet.
8. Preserve `WALK_FORWARD_OOS`, `MATURED`, valid outcome-window evidence, no-lookahead benchmark regime reconstruction, and no historical classification backfill.

## What not to do next

- Do not resume from v1813/v1814; the branch is already far beyond that work.
- Do not reopen the old mobile v1.7.1 holder/currency fixes.
- Do not change portfolio transactions, ledger/storage schema, Opportunity Hunter execution boundaries, final-action authority, or broker execution.
- Do not map historical research outputs directly to BUY/HOLD/SELL.
- Do not merge PR #14.
- Do not enable recurring historical-research cadence until a manual/one-off standalone artifact is verified.

## Handoff rule going forward

Every completed checkpoint must end with a visible chat section named **`ΣΗΜΕΙΟ ΣΥΝΕΧΕΙΑΣ`** and an update to this file containing:

- exact PR/source head
- last fully verified checkpoint
- test count and relevant CI/production state
- any in-progress/inert code that is not yet active
- exact next engineering action
- explicit prohibitions / safety boundaries

This prevents a new conversation from spending time reconstructing state or accidentally resuming from an older checkpoint.

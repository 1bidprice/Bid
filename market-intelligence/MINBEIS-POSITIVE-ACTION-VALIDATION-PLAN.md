# MINBEIS Positive-Action Validation Plan

Baseline: `7e124773d0605b6187a010a198f2d5aec2d52920`

## Objective

Prove that MINBEIS can issue positive actions when evidence supports them, without weakening the fail-closed safety contract or tuning thresholds by intuition.

The target is not "more BUY signals". The target is a balanced decision engine whose positive, neutral and defensive actions are all reachable for the right reasons.

## Non-negotiable rules

1. No BUY/SELL threshold is changed before the deterministic boundary matrix is green.
2. No threshold is changed because a single current stock "looks good" or "looks bad".
3. Opportunity ranking can nominate a candidate but can never bypass the final-action policy.
4. BUY_NOW requires the existing strict final-action policy plus purchase reconciliation.
5. Human approval remains required; automatic broker orders remain disabled.
6. Fail-closed identity, source, freshness, evidence and publication checks stay mandatory.
7. Every threshold change must add a regression showing both sides of the boundary.

## Stage 0 — Green baseline

Entry:
- PR #23 open/draft/unmerged.
- Current gateway, mobile, market-intelligence, MINBEIS integration, recommendation integrity and APK workflows green.

Exit:
- Baseline SHA recorded.
- No production threshold mutation.

Status: COMPLETE.

## Stage 1 — Positive-action falsification matrix

Purpose:
Prove that BUY is reachable and that each important boundary changes the result exactly where intended.

Required cases:
- Fully qualified dossier -> BUY_NOW.
- Fundamental risk 55 -> BUY_NOW; 56 -> no BUY.
- Liquidity 65 -> BUY_NOW; 64 -> no BUY.
- Relative strength > 0 -> eligible; = 0 -> no BUY.
- Distance from SMA50 > 0 -> eligible; = 0 -> no BUY.
- Distance from SMA200 > -3 -> eligible; = -3 -> no BUY.
- Reference price age <= 2h -> immediate BUY eligible; > 2h -> no immediate BUY.
- Severe risk -> AVOID, never BUY.
- Missing execution-grade price -> blocked, never BUY.
- High-priority candidate + strict BUY -> BUY_CONFIRMED -> BUY_PROBE.
- Exceptional candidate + high quality/confidence -> BUY_STARTER.
- BUY_CORE remains unreachable in v1.

Exit:
- Dedicated test matrix passes in isolation and in the full suite.
- No threshold changes.

Status: IN PROGRESS.

## Stage 2 — Historical replay and calibration

Purpose:
Measure the real behavior of the decision policy instead of guessing from today's feed.

Method:
- Replay a fixed, versioned historical validation universe across US and Athens-listed equities where source coverage permits.
- Record, for every observation: final action, failed gate(s), risk score, liquidity, trend conditions, price freshness, confidence/data quality and subsequent outcome windows already supported by the outcome ledger.
- Separate opportunity nomination from strict purchase confirmation.

Metrics to publish:
- Action distribution: BUY_NOW / WATCH / DO_NOT_BUY / AVOID / SELL_NOW.
- Candidate-to-BUY conversion rate.
- Top blockers and their frequency.
- Boundary concentration: how many candidates fail by only one gate and which gate.
- Outcome summaries by action, using out-of-sample windows only.
- US vs Athens coverage and blocker differences.

Exit:
- Replay artifact is reproducible from a frozen input version.
- No threshold tuning until the report exists.

## Stage 3 — Calibration decision

Threshold changes are permitted only when Stage 2 shows a repeatable structural issue.

Examples:
- If nearly all otherwise-qualified candidates fail one boundary by a tiny margin and historical OOS outcomes support them, evaluate that boundary.
- If BUY_NOW cases show weak OOS behavior, tighten rather than loosen.
- If a market lacks sufficient source quality, improve data coverage instead of lowering decision standards.

Every accepted change requires:
- written evidence in the calibration report,
- before/after action distribution,
- before/after OOS outcome summary,
- new boundary regressions,
- no deterioration of fail-closed invariants.

## Stage 4 — Portfolio-aware action validation

Validate that the market-level action and the user's portfolio-level action remain distinct:
- A market BUY candidate may still be blocked/reduced by concentration or user-defined limits.
- An existing position may be HOLD/REDUCE even when a non-holder action differs.
- Accounting state never changes automatically from a MINBEIS signal.

Exit:
- Deterministic portfolio scenarios pass.
- No automatic execution path exists.

## Stage 5 — Release candidate

Only after Stages 1-4:
- freeze policy version,
- finalize user-facing action language,
- generate signed Play candidate,
- verify production gateway/feed contract,
- complete store/privacy/signing readiness,
- then branding/icon polish and release QA.

## Decision record

Current thresholds remain unchanged:
- immediate price age: <= 2 hours,
- minimum liquidity: >= 65,
- positive trend: relative strength > 0, SMA50 distance > 0, SMA200 distance > -3 when present,
- fundamental risk: <= 55 for BUY,
- confidence: >= 80,
- BUY_STARTER: opportunity score >= 88, confidence >= 85, data quality >= 85.

These are validation targets, not promises of investment performance.

# MINBEIS × Investor Control integration v1

## Canonical architecture

Investor Control remains the product and mobile application.

The existing `market-intelligence` subsystem remains the single canonical intelligence/decision engine. MINBEIS is integrated as the user-facing decision/risk layer and operating workflow; it must not create a second independent scoring brain.

## Source of truth

- Instrument identity, routing, quote integrity: existing Investor Control canonical core.
- Discovery and ranking: `opportunity-universe-scanner.js` + `opportunity-engine.js`.
- Final directional decision: `final-action-policy.js`.
- Purchase reconciliation: existing opportunity purchase pipeline.
- MINBEIS translation/sizing: `minbeis-decision-layer.js`.
- Mobile presentation: Investor Control Opportunities / portfolio views.
- Human execution: required. No automatic broker order.

## MINBEIS v1 actions

- NO_BUY
- WATCH
- HOLD
- REDUCE
- BUY_PROBE — 0.5% default when strict BUY_NOW + purchase reconciliation both pass.
- BUY_STARTER — 1.0% only for exceptionally strong confirmed opportunity/data quality.
- BUY_CORE — reserved; disabled in v1 until portfolio-aware concentration and correlation controls are canonical.

## Safety invariants

1. BLOCKED/missing final action can never become a MINBEIS buy.
2. BUY_NOW alone is insufficient: purchase reconciliation must also be BUY_CONFIRMED.
3. Human approval is always required.
4. Automatic broker execution is always false.
5. MINBEIS must consume canonical Investor Control facts; it must not refetch/reinvent an independent truth.
6. PR #22 remains unmerged until Nikos explicitly approves it.

## Migration of the standalone MINBEIS prototype

The standalone `1bidprice/ase-proxy/minbeis_automation_v1` remains a prototype/reference during migration. Its useful concepts are ported into Investor Control, but its independent valuation/scoring engine must not remain production-authoritative after integration.

Useful concepts to preserve:
- explicit NO BUY / PAPER / PROBE / STARTER states;
- entry/invalidation/risk presentation;
- scheduled audit/run history;
- human approval boundary;
- broker-export style handoff if later required.

Do not duplicate:
- quote truth;
- valuation truth;
- opportunity scoring;
- final action policy;
- instrument universe discovery.

## Next implementation steps

1. Feed `minbeisDecision` into the canonical mobile intelligence feed.
2. Render MINBEIS action/allocation in OpportunitiesView and FinalDecisionCard.
3. Add portfolio-aware allocation caps and concentration/correlation gates before enabling BUY_CORE.
4. Add notification policy for new BUY_PROBE/BUY_STARTER transitions.
5. Migrate scheduled run/audit observability from the standalone prototype into Investor Control workflows.
6. After parity verification, freeze the standalone MINBEIS engine as legacy/reference.

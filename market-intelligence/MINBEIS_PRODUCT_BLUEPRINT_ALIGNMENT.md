# MINBEIS Product Blueprint Alignment

Source of truth for product direction: MINBEIS Product Blueprint v1.0 supplied by the founder.

## Product north star

Investor Control is the product shell. MINBEIS is the intelligence and decision-support layer.

The product must NOT become a generic signal app. Its core job is to reduce bad entries, identify traps, explain uncertainty, and measure whether its warnings and classifications add value over simple baselines.

Private-alpha action labels (HOLD / WATCH / REDUCE / BUY_PROBE / BUY_STARTER) are allowed as an execution-support layer, but they must not replace the core MINBEIS framing:
- SETUP
- TRAP / WEAK SETUP
- NO-TRADE / WAIT
- CONFIRMATION REQUIRED
- EXPLANATION
- MEASURED OUTCOME

## Blueprint mapping to current canonical implementation

| Blueprint module | Current Investor Control implementation | Status |
| --- | --- | --- |
| Data Collector | canonical market gateway, official Euronext Athens delayed feed, licensed US quote provider, historical collectors | PRESENT |
| Market Regime Engine | forecast-market-regime.js and regime research/production-safety stack | PRESENT |
| Pattern Engine | historical-pattern-engine.js plus opportunity/factor engines | PRESENT, needs user-facing taxonomy |
| Historical Analogs Engine | historical-pattern-engine.js weighted independent analogs + shadow forecast stack | PRESENT |
| Trap / No-Trade Engine | final-action policy, signal readiness, evidence/risk gates, purchase reconciliation | FUNCTIONALLY PRESENT, needs explicit trap/no-trade product surface |
| Explanation Engine | dossier synthesis, final-action reasons, driver synthesis, mobile explanations | PARTIAL, needs 30-60 second explanation packet |
| Alert + Log | notification policy, forecast outcome ledger, MINBEIS decision outcome ledger | PRESENT |
| Shadow testing | shadow-forecast-engine.js, prospective holdout/outcome maturation | PRESENT |
| Calibration | forecast-calibration.js and outcome summaries | PRESENT |
| Baseline comparison | research stack includes OOS/holdout machinery; explicit simple EMA/RSI/volume product benchmark must remain a required gate | PARTIAL |
| Repeat-usefulness / time-to-clarity | not yet a canonical product metric | MISSING |

## Product rules retained from Blueprint

1. Private alpha first. Do not market performance claims before measurement.
2. No guaranteed profits or predictive certainty.
3. Public positioning is market research / decision support, not personal investment advice.
4. The system must be judged by measured results, not by AI branding.
5. A strong NO-TRADE / TRAP call is a first-class successful output.
6. Confidence must be calibrated against historical observed outcomes.
7. Every actionable output must remain explainable and auditable.
8. If the intelligent system does not beat simple baselines in prospective testing, it does not earn stronger product claims.

## Updated unified product flow

Portfolio + discovered instruments
→ canonical identity / data integrity
→ market regime
→ pattern classification
→ historical analogs
→ fundamentals / catalysts / risk
→ trap / no-trade gate
→ strict final-action policy
→ MINBEIS explanation + optional position-sizing layer
→ alert only on material transition
→ immutable outcome ledger
→ 7/30/90-day and forecast-horizon evaluation
→ calibration / baseline comparison

## UX hierarchy

The MINBEIS tab should prioritize:

1. My Positions — what changed and what requires attention.
2. Trap / No-Trade / Confirmation Required — why a position or idea is unsafe now.
3. New Opportunities — only after the safety layer.
4. Explanation packet — concise, human-readable, 30-60 second clarity.
5. Evidence / system diagnostics — collapsed detail for audit, not the primary user experience.

## Public-product gating

Do not progress to public performance marketing until:
- enough prospective decisions have matured;
- calibration is measurable;
- no-trade accuracy can be defined and audited;
- false-signal reduction is compared with simple baselines;
- time-to-clarity and repeat-usefulness are measured with real users;
- compliance review is complete.

## Technology interpretation

The Blueprint's Python/FastAPI/PostgreSQL/Telegram/Next.js stack was an implementation proposal for the original private alpha, not the product identity. The current canonical Investor Control architecture may supersede those exact technology choices as long as the functional contracts, auditability, safety, measurement, and validation goals above are preserved.

## Immediate implementation priorities

1. Expose explicit SETUP / TRAP / NO-TRADE classification in the MINBEIS mobile contract.
2. Build a concise explanation packet for every portfolio position and candidate.
3. Add baseline-comparison reporting against simple technical rules.
4. Add product metrics for time-to-clarity and repeat-usefulness during private alpha.
5. Keep all outcome/calibration research shadow-only until production-safety gates are satisfied.

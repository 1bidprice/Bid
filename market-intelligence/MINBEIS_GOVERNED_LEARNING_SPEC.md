# MINBEIS Governed Learning System — Technical Evidence Spec

Status: implementation in PR #23 / branch `investor-control-minbeis-integration-v1`
Authority: research and shadow learning only. No autonomous broker execution. No automatic production-policy mutation.

## Purpose

MINBEIS is being built as an auditable investment-intelligence system that learns from its own decisions without rewriting history. The learning system is designed around prospective evidence, point-in-time replay, shadow challengers and explicit promotion gates.

## 1. Decision Journal

Every tracked FINAL decision can produce an immutable outcome record containing:
- instrument identity, symbol and decision timestamp;
- MINBEIS action and allocation intent;
- reference price and currency;
- confidence and data-quality scores;
- policy version, decision reason and blockers;
- compact context snapshot;
- SHA-256 context hash;
- optional simple-baseline snapshot.

The merge contract preserves the first immutable context and cannot overwrite it with later hindsight.

## 2. Outcome maturation

Tracked decisions mature at 7 / 30 / 90 trading-day horizons when canonical historical prices are available.

Each matured horizon records:
- realised return;
- benchmark return and excess return when benchmark data exists;
- maximum favourable excursion;
- maximum adverse excursion;
- evaluation timestamp.

Outcome statistics are descriptive and do not authorize model changes.

## 3. Learning Review Queue

Matured decisions can be flagged for controlled review:
- negative BUY outcomes;
- benchmark underperformance;
- adverse excursion;
- missed upside after NO_BUY / WATCH;
- negative HOLD outcomes;
- REDUCE before material upside.

Candidate attributions are hypotheses only. Causality is never marked as established automatically.

## 4. Context learning

Decision outcomes are grouped by:
- action;
- market regime;
- lead event;
- decision reason;
- action × regime;
- action × lead event;
- action × reason;
- catalyst event type;
- risk event type.

A cohort becomes evidence-ready only after minimum sample, date-diversity and instrument-diversity gates.

## 5. Historical Event Archive

Research dossiers preserve event taxonomy:
- event type;
- category;
- event window;
- evidence IDs.

Historical event records are append-only. Event availability is derived from the publication timestamps of all supporting evidence. Missing or undated supporting evidence blocks strict replay eligibility.

## 6. Point-in-time replay

Historical replay uses only information known by the chosen `asOf` timestamp.

Strict separation contract:
- evidence published after `asOf` is excluded;
- undated evidence cannot enter strict replay;
- future market candles are excluded from decision input;
- future outcomes are stored only in an EVALUATION_ONLY section;
- replay decision input is hashed;
- raw future-aware decision input is not persisted as production authority.

Price-pattern research already enforces that historical analogue outcomes must have been known by the forecast `asOf`.

## 7. Event-outcome learning

Replay-eligible historical events can be evaluated over 5 / 21 / 63 trading-day horizons.

Cohorts describe:
- positive-return rate;
- average and median return;
- average maximum favourable excursion;
- average maximum adverse excursion;
- company/date diversity.

These are observational associations, not causal claims and not predictions of future performance.

## 8. Learning Proposal

Evidence-ready negative BUY contexts can generate immutable learning proposals such as:

`SUPPRESS_BUY_IN_CONTEXT: BUY_PROBE × RISK_OFF -> WATCH`

Each proposal contains:
- frozen context target;
- evidence snapshot;
- evidence hash;
- champion action;
- challenger action;
- creation timestamp;
- prospective-shadow-only validation mode.

Identical evidence produces a stable proposal identity so the validation clock is not reset by later runs.

## 9. Prospective shadow validation

A proposal is evaluated only against decisions strictly after its creation timestamp.

Training evidence cannot be reused as validation evidence.

For matched future decisions:
- champion outcome is recorded;
- challenger counterfactual action is recorded;
- challenger delta is calculated;
- validation mode is `PROSPECTIVE_SHADOW_OOS`.

## 10. Promotion gate

A learning proposal can become a `PROMOTION_CANDIDATE` only after all configured gates pass, including:
- minimum prospective sample;
- minimum distinct decision dates;
- minimum distinct instruments;
- minimum average challenger advantage;
- minimum challenger win rate;
- positive performance across chronological subperiods.

Even a promotion candidate:
- cannot auto-apply;
- cannot mutate production policy;
- requires explicit human approval;
- requires the full release regression suite.

## 11. Existing forecast governance reused

MINBEIS already contains separate forecast research governance including:
- live shadow OOS records;
- calibration metrics;
- Brier score / expected calibration error;
- stability across chronological subperiods;
- factor attribution;
- regime learning;
- factor-weight governance;
- cross-sectional regime walk-forward research.

Forecast research remains unable to influence FINAL action unless a separate integration authority is explicitly enabled.

## 12. Scientific claims allowed

Allowed:
- "MINBEIS maintains an immutable journal of its decisions and measures later outcomes."
- "Learning proposals are evaluated prospectively in shadow mode."
- "Historical replay is point-in-time and blocks post-event information leakage."
- "Production-policy changes require validation gates and explicit approval."

Not allowed:
- "MINBEIS predicts the market."
- "MINBEIS guarantees higher returns."
- "The system has proven causal relationships between events and prices."
- "The self-learning model automatically improves itself in production."

## 13. Current evidence class

The architecture and regression contracts are implemented. Statistical learning claims remain limited by the number of matured prospective observations and the breadth/quality/licensing of historical market and event data.

The technical moat is therefore the governed learning architecture and auditability; performance superiority must be established prospectively, not asserted in advance.

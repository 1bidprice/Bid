# MINBEIS — NBG Business Seeds 17th Innovation & Technology Competition
## Application Draft — 2026

Submission deadline: 14 October 2026, 15:00
Theme fit: Fintech / Advanced Technologies & AI / Financial Empowerment

> This draft must be adapted to the exact online form fields before submission. Legal-entity/team fields remain intentionally blank until verified.

## Project name

MINBEIS

## One-line description

MINBEIS is an auditable investment decision-support platform that helps retail investors track portfolios, structure decisions, preserve what was known at the time, measure later outcomes, and test model improvements prospectively before any change can influence production decisions.

## Problem

Retail investors increasingly have access to portfolio apps, news, analytics and AI assistants, but the decision process remains fragmented.

Three gaps remain:

1. Portfolio trackers show holdings and P/L but usually do not preserve why a decision was made.
2. Research and AI outputs can change over time, making it difficult to audit what information was actually available at the moment of a decision.
3. A model can appear successful in historical testing if future information leaks into the analysis or if the same data is used both to invent and validate a strategy.

This makes disciplined learning from past investment decisions difficult and creates a trust problem around AI-assisted investing.

## Solution

MINBEIS combines:

- canonical portfolio accounting;
- verified market-data routing;
- research and evidence dossiers;
- structured decision support;
- human approval;
- immutable decision journaling;
- later outcome measurement;
- point-in-time historical replay;
- context learning;
- prospective shadow challengers;
- controlled promotion gates.

The system is designed to learn from decisions without silently rewriting history.

## What the user sees

The current Android application supports:

- transactions and positions;
- market value, cost and P/L;
- US and Euronext Athens instruments;
- allocation/concentration views;
- P/L contribution by position;
- local portfolio history;
- decision controls;
- research/opportunity views;
- explicit data-quality and fail-closed states.

## Core innovation

### Immutable Decision Journal

Each tracked final decision can preserve timestamp, reference price, action, confidence, data-quality score, blockers, policy version, contextual evidence and an integrity hash.

### Outcome Engine

Decisions are evaluated later at 7 / 30 / 90 trading-day horizons with realised return, benchmark/excess return where available, and maximum favourable/adverse excursion.

### Point-in-time historical replay

The replay engine excludes evidence published after the replay time, excludes future market candles from the decision input, blocks undated evidence in strict mode, and stores future outcomes separately for evaluation only.

### Learning Proposal / Challenger

If a sufficiently supported decision context performs poorly, MINBEIS can create a frozen proposal such as: BUY_PROBE in RISK_OFF context -> shadow challenger WATCH.

The proposal is not applied to production. Only decisions that occur after the proposal was created can validate it.

### Promotion Gate

A challenger must pass prospective sample-size thresholds, date diversity, instrument diversity, minimum observed advantage, win-rate threshold and chronological subperiod stability.

Even after passing, it becomes only a promotion candidate. Automatic production mutation remains disabled and explicit human approval is required.

## Why this is different

MINBEIS is designed around four principles:

1. Auditability — preserve what was known at decision time.
2. No hindsight leakage — future information cannot enter historical decision inputs.
3. Prospective validation — training evidence cannot validate its own proposed change.
4. Human-controlled promotion — the system cannot silently rewrite its live decision policy.

## Privacy design

Portfolio data is local to the installation. The application has ownership isolation and legacy-data quarantine/recovery logic. Android backup is disabled to reduce silent portfolio transfer between installations. Quote requests do not transmit portfolio quantities, cost basis, P/L or notes.

## Current proof

Funding-readiness build:
- MINBEIS v1.8.3
- Android build 35
- exact all-green source head: 9f0c22f099d9c4478a7259b0be2c75be80775fc8

At that head all six CI workflows succeeded, covering market gateway, mobile validation, deterministic market-intelligence tests, recommendation integrity, MINBEIS integration and standalone APK build.

The APK is currently internal-demo signed with Android Debug certificate. Production signing remains a separate distribution gate and is not presented as complete.

## Current stage

Working MVP / technical validation stage.

Implemented:
- portfolio product;
- decision architecture;
- research pipeline;
- governed-learning architecture;
- automated regression suite;
- Android demo build.

Validation still required:
- external beta cohort;
- licensed user-facing historical-data plan;
- production signing / Play testing;
- legal/regulatory review;
- sufficient prospective outcome sample to measure whether learning proposals improve results.

## Business direction

Initial target: self-directed retail investors who want structured portfolio oversight and decision discipline rather than automated trading.

Potential future models to validate:
- premium subscription;
- advanced portfolio/research tier;
- B2B/B2B2C decision-intelligence licensing;
- partnerships with financial-education, wealth and fintech ecosystems.

No business model is presented as validated before user testing.

## Why now

AI is making investment information easier to generate but not necessarily easier to trust. MINBEIS focuses on the missing layer: recording, evaluating and governing investment decisions over time.

The product is being built so that future claims of model improvement can be supported by prospective evidence rather than marketing or hindsight backtests.

## Use of prize / funding

Priority use:

1. licensed historical and market data;
2. external beta and user research;
3. security/privacy review;
4. legal/regulatory review;
5. production Android distribution;
6. operational monitoring;
7. UX/onboarding refinement;
8. systematic prospective model validation.

## Financial empowerment relevance

MINBEIS aims to improve financial decision discipline by making uncertainty, data quality, concentration, blockers and prior outcomes visible rather than hiding them behind a single AI recommendation.

The system never executes broker orders automatically.

## Evidence available for evaluation

- working Android APK;
- exact version/build and hashes;
- GitHub CI evidence;
- governed-learning technical specification;
- funding one-pager;
- privacy policy;
- product-recovery/QA evidence;
- five-minute product demo script;
- due-diligence evidence index.

## Claims deliberately excluded

We do not claim guaranteed returns, proven alpha, superior predictive accuracy, causal event-price relationships or autonomous profitable self-learning. These require prospective statistical evidence that does not yet exist.

## Team / legal entity

TO COMPLETE WITH VERIFIED INFORMATION:
- applicant name / legal entity;
- founders and roles;
- legal form;
- registration details;
- relevant professional/technical background;
- ownership of IP/code.

## Competition-specific closing statement

MINBEIS addresses fintech and financial empowerment through an AI-assisted system whose differentiator is not automation for its own sake, but controlled and auditable learning.

The project seeks support to move from a technically validated MVP into structured external validation, licensed data, production distribution and measurable commercial traction.

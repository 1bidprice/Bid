# MINBEIS Sponsor / Funding Evidence Pack

Status date: 2026-10-03
Repository: `1bidprice/Bid`
Development line: `investor-control-minbeis-integration-v1`
PR #23: DRAFT / must not be merged without explicit approval.

## One-sentence product

MINBEIS is a privacy-conscious portfolio and investment-intelligence application that combines verified portfolio accounting, market/research evidence, disciplined decision support and an auditable learning system that evaluates its own past decisions before any model change can reach production.

## Problem

Retail investors commonly face three disconnected problems:
1. portfolio tracking tells them what they own but not whether a new decision is disciplined;
2. research tools expose large volumes of data without preserving why a decision was made at that time;
3. "AI investing" claims often lack auditable outcome tracking, point-in-time controls and controlled model promotion.

MINBEIS is being built around the decision lifecycle rather than only price display.

## Current product proof

Implemented and regression-tested:
- local portfolio transactions and canonical accounting;
- position value, cost and P/L;
- US and Euronext Athens routing with fail-closed quote integrity;
- privacy ownership isolation and legacy-data quarantine/recovery;
- Android backup disabled to prevent silent portfolio transfer;
- public privacy disclosure aligned with gateway behavior;
- portfolio allocation/concentration and P/L contribution views;
- local total-portfolio history with 1H / 1D / 1W / 1M / 6M / 1Y ranges;
- research dossiers, evidence and market-opportunity pipeline;
- MINBEIS decision layer with mandatory human approval and no broker execution;
- immutable decision/outcome journal;
- 7/30/90-day outcome maturation;
- learning review queue;
- context learning by regime/event/reason;
- append-only historical event archive;
- strict point-in-time replay;
- historical event outcome learning;
- prospective learning proposals;
- shadow challenger validation;
- promotion gates that never auto-mutate production policy.

## Technical differentiation

### Auditable decisions
Every tracked decision can be tied to a timestamped context snapshot and integrity hash.

### No hindsight learning
Historical replay excludes post-`asOf` information. Future outcomes are evaluation-only.

### Prospective learning
A learning proposal cannot validate itself using the same evidence that created it. Only decisions after proposal creation count.

### Governed promotion
A challenger must pass sample-size, diversity and temporal-stability gates. Even then it is only a promotion candidate and still requires explicit approval and regression testing.

### Fail-closed data policy
Unavailable, stale, identity-mismatched or insufficiently verified data blocks valuation/recommendation paths instead of being silently approximated.

### Privacy-first local portfolio ownership
Portfolio holdings are not silently shared between installations. Quote requests do not send portfolio quantities, cost basis, P/L or notes.

## What MINBEIS is not

- not a broker;
- not an autonomous trading bot;
- not a promise of profit;
- not a production-proven predictive model yet;
- not a substitute for licensed financial advice where regulation would require it.

## Evidence currently suitable for a sponsor/funder demo

A live demo can truthfully show:
1. clean portfolio and transaction workflow;
2. verified value/cost/P&L;
3. allocation and P/L contribution;
4. decision discipline and human approval;
5. research/opportunity evidence;
6. immutable decision journal architecture;
7. outcome maturation contract;
8. point-in-time historical replay safeguards;
9. learning proposals and prospective promotion gates;
10. CI evidence showing regression enforcement.

## Claims that must wait for prospective data

Do not claim:
- superior returns;
- statistically proven alpha;
- predictive accuracy above a benchmark;
- validated event causality;
- successful automatic self-improvement.

Those claims require sufficient matured OOS evidence.

## Current external-readiness gaps

The product can be prepared for early sponsor/incubator conversations while the following remain explicit diligence items:
- second physical-device clean-install privacy QA;
- APK/AAB signing identity verification and Play Closed Testing;
- external beta cohort and repeat-usage evidence;
- historical market-data display/redistribution licensing strategy;
- legal review of public financial-advice positioning;
- crash/operational telemetry policy;
- final public landing page and waitlist/beta funnel;
- 12–18 month operating and data-cost model;
- company/legal-entity and IP ownership documentation where required by the funding route.

## Sponsor / funding narrative

The strongest defensible narrative is not "another portfolio tracker".

It is:
> An auditable investment decision system that records what it knew at the time, measures what happened later, replays historical events without future-information leakage, proposes bounded model changes, and validates those changes prospectively before human-approved promotion.

## Suggested funding use

A credible first funding budget should prioritize:
- licensed historical and real-time market-data access;
- cloud research/event archive infrastructure;
- security/privacy review;
- regulatory/legal review;
- Android production distribution and monitoring;
- structured external beta/pilot;
- model validation and data-science work;
- product design and onboarding;
- founder/company operations and commercial validation.

## Due-diligence folder structure

Recommended artifacts:
- 01_Product_One_Pager
- 02_Technical_Architecture
- 03_Governed_Learning_Spec
- 04_Privacy_and_Data_Flow
- 05_QA_and_CI_Evidence
- 06_Demo_Script_and_Screenshots
- 07_Beta_Evidence
- 08_Market_and_Competition
- 09_Data_Licensing_and_Costs
- 10_Regulatory_Positioning
- 11_Budget_and_Milestones
- 12_IP_and_Company_Documents

## Readiness definition

MINBEIS is **outreach-ready** when the product demo, technical evidence, one-pager and honest gap register are coherent.

MINBEIS is **due-diligence-ready** only after the distribution/privacy/data-licensing/legal/beta evidence gates above are closed.

No funding material should blur those two states.

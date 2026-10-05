# MINBEIS Due-Diligence Index

This index separates available evidence from evidence still required.

## A. Product and architecture — AVAILABLE

- `mobile/MINBEIS_SPONSOR_FUNDING_EVIDENCE_PACK.md`
- `market-intelligence/MINBEIS_GOVERNED_LEARNING_SPEC.md`
- `mobile/MINBEIS_5_MINUTE_FUNDING_DEMO.md`
- `mobile/MINBEIS_FUNDING_READINESS.md`
- `mobile/PRODUCT_RECOVERY_1.8.1.md`

## B. Code and CI evidence — AVAILABLE

Evidence source:
- PR #23;
- immutable Git commit SHAs;
- GitHub Actions regression runs;
- APK build artifacts.

Required for each external diligence snapshot:
- exact head SHA;
- workflow run IDs and conclusions;
- artifact ID/digest;
- app version/build number;
- signing certificate fingerprint.

## C. Privacy and data flow — PARTIAL

Available:
- installation ownership isolation;
- local portfolio quarantine/recovery;
- Android backup disabled;
- public privacy disclosure;
- quote-request data disclosure.

Still required:
- second-device fresh-install evidence;
- operational/privacy review;
- final data-flow diagram for external diligence.

## D. Market-data rights — OPEN

Required:
- provider shortlist;
- real-time/delayed/historical rights;
- display rights;
- redistribution restrictions;
- commercial pricing;
- expected cost by user scale.

No financing material should imply rights that are not contractually available.

## E. Security and operations — PARTIAL

Available:
- HTTPS gateway contract;
- fail-closed provider behavior;
- CI regression suite.

Still required:
- signing fingerprint record;
- crash/error telemetry decision;
- incident response;
- rollback plan;
- dependency/security review.

## F. Product validation — OPEN

Required:
- structured beta protocol;
- participant count;
- install completion;
- portfolio setup completion;
- valuation coverage;
- repeat usage;
- decision-feature usage;
- qualitative interviews;
- retention evidence.

## G. Scientific/model validation — ARCHITECTURE AVAILABLE / PERFORMANCE OPEN

Available:
- immutable decision journal;
- outcome maturation;
- point-in-time replay;
- event learning;
- prospective learning proposals;
- shadow challenger;
- promotion gates.

Still required:
- enough matured OOS observations;
- stable results across time periods/instruments;
- independent statistical review when sample size warrants it;
- no performance claim before evidence threshold is met.

## H. Regulatory/legal — OPEN

Required before broad public financial-advice claims:
- legal classification of product functionality;
- review of wording/marketing;
- terms and disclaimers;
- data/licensing review;
- company/IP ownership documentation.

## I. Commercial model — OPEN

Required:
- customer segment validation;
- pricing tests;
- acquisition assumptions;
- gross-margin/data-cost model;
- 12–18 month budget;
- milestones and use of funds.

## J. Funding materials — IN PROGRESS

Available:
- technical evidence pack;
- one-pager;
- demo script;
- readiness/gap register.

Still required:
- pitch deck;
- founder/company section;
- budget/use-of-funds;
- current funding-program matrix;
- public landing page / beta CTA;
- demo-safe screenshots/video.

## External claim rule

Every external statement must be classed as one of:
- IMPLEMENTED;
- CI-VERIFIED;
- DEVICE-VERIFIED;
- PROSPECTIVELY VALIDATED;
- PLANNED.

No material may silently upgrade one evidence class into another.

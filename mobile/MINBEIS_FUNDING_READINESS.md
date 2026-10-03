# MINBEIS Funding Readiness Gate

Status date: 2026-10-03
Branch: `investor-control-minbeis-integration-v1`
PR: #23 remains draft and MUST NOT be merged without Nikos's explicit approval.

## Readiness levels

### Outreach-ready
Enough verified product and technical evidence to begin conversations with sponsors, incubators, grant programmes and early investors without overstating product maturity.

### Due-diligence-ready
All material product, privacy, distribution, data-rights, legal, beta and cost evidence is available for detailed third-party review.

MINBEIS must never present outreach-readiness as due-diligence-readiness.

## Current verified product proof

Implemented and covered by regression/CI contracts:
- canonical portfolio accounting with value, cost and P/L;
- US and Euronext Athens quote/instrument routing with fail-closed integrity;
- local portfolio ownership isolation, quarantine and explicit recovery;
- Android backup disabled to prevent silent portfolio transfer;
- privacy disclosure aligned with gateway behavior;
- portfolio allocation/concentration and P/L contribution;
- local total-portfolio history with 1H / 1D / 1W / 1M / 6M / 1Y ranges;
- MINBEIS decision layer with human approval and no broker execution;
- immutable decision/outcome journal;
- 7 / 30 / 90 trading-day outcome maturation;
- maximum favourable/adverse excursion;
- decision learning-review queue;
- context learning by regime/event/reason;
- append-only historical event archive;
- strict point-in-time historical replay;
- historical event outcome learning;
- prospective learning proposals;
- shadow challenger observations that exclude pre-proposal decisions;
- promotion gate with sample/diversity/temporal-stability requirements;
- automatic production mutation disabled by contract;
- five-minute funding demo script;
- sponsor/funding evidence pack;
- governed-learning technical evidence specification.

## Critical scientific truth

The architecture for self-evaluation and controlled learning is implemented.

MINBEIS does **not** yet have enough matured prospective observations to claim:
- statistically proven alpha;
- superior investment returns;
- causal event-price relationships;
- production-proven self-improvement.

Those claims remain prohibited until prospective evidence supports them.

## P0 gates before serious due diligence

1. **External-device privacy evidence**
   - clean install on a second physical device;
   - zero inherited transactions/positions;
   - recovery/import only after explicit user action.

2. **Distribution-quality Android**
   - verify signing certificate identity on the funding-readiness APK/AAB;
   - Play Internal/Closed Testing;
   - clean install/update path;
   - no production release without explicit approval.

3. **Historical market-data product strategy**
   - retain honest local observed portfolio history;
   - select licensed/approved historical data source for immediate user-facing charts;
   - document display/redistribution rights and expected cost;
   - never fabricate pre-install portfolio valuations.

4. **External beta evidence**
   - structured beta cohort;
   - install completion;
   - portfolio-entry completion;
   - valuation coverage;
   - repeat usage;
   - qualitative problem/solution evidence;
   - no collection of portfolio amounts without explicit consent.

5. **Regulatory/product positioning**
   - information/decision support clearly separated from execution;
   - human approval remains mandatory;
   - no broker execution;
   - legal review before public claims that could imply regulated investment advice.

6. **Operational evidence**
   - crash/error telemetry policy;
   - privacy-safe diagnostics;
   - uptime/data-source failure handling;
   - incident and rollback procedure.

## P1 gates for a strong financing package

- first-run onboarding;
- public landing page with waitlist/beta CTA;
- demo dataset isolated from real portfolios;
- product screenshots/video;
- 12–18 month operating budget;
- market-data/cloud cost model;
- competitor capability matrix;
- founder/company profile;
- ownership/IP documentation;
- one-page product brief;
- pitch deck;
- due-diligence folder;
- external pilot/beta evidence.

## Current funding narrative

The defensible story is not "another portfolio tracker" and not "AI that predicts stocks".

It is:

> MINBEIS is an auditable investment decision system that records what it knew at the time, measures what happened later, replays historical events without future-information leakage, proposes bounded model changes, and validates those changes prospectively before human-approved promotion.

## Current readiness assessment

### Technically
The product now has a credible differentiated architecture suitable for early external conversations.

### Commercially
Market validation and beta evidence are still required.

### Scientifically
The learning governance is implemented; performance superiority remains to be established prospectively.

### Distribution
The funding-readiness build is MINBEIS v1.8.3 build 35 at head `9f0c22f099d9c4478a7259b0be2c75be80775fc8`, with all six CI workflows successful.

APK artifact:
- GitHub Actions artifact ID: `11281980753`
- artifact ZIP SHA-256: `c6dccb23bb5f60d7b038646c8e2661b0ec75a25891c56af955849673cae4a528`
- extracted APK SHA-256: `994828bf3f8812a9a61622b45d020769d3cf80df063a8ad4fc3b7f82634d33b6`

Signing audit:
- current standalone APK certificate subject: `CN=Android Debug`
- SHA-256 certificate fingerprint: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
- therefore the current APK is **INTERNAL DEMO ONLY**, not production-signed.

Still open:
- secure upload/release key or Play App Signing path;
- Play Internal/Closed Testing;
- second-device privacy QA.

### Funding materials
Core technical evidence pack and demo script exist. Public-facing one-pager/pitch deck/landing page and budget remain to be produced.

## Next implementation tranche

Target: funding-readiness release after all-green CI.

- lock governed learning proposal archive and promotion evaluation;
- produce clean funding-readiness APK identity;
- verify signing certificate;
- prepare demo-safe dataset;
- prepare one-page funding brief;
- prepare pitch deck;
- prepare cost/budget model;
- begin structured beta and sponsor/funder outreach only with claims supported by the evidence above.

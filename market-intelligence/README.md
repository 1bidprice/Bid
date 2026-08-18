# Investor Control Market Intelligence

This module is the backend intelligence foundation for the existing Investor Control Android application. It does not replace the local transaction ledger, portfolio accounting, alerts or Decision Gate.

## Product purpose

The engine converts current corporate, regulatory, fundamental and market evidence into auditable research dossiers. It is designed to discover and classify opportunities and risks without presenting unsupported generic BUY/SELL labels.

Core flow:

```text
Official and independent evidence
  → canonical company identity
  → controlled document review
  → canonical claim clusters
  → deterministic fundamentals / market / risk metrics
  → evidence-only synthesis
  → DRAFT_RESEARCH
  → REVIEW_READY
  → explicit reviewed publication
  → Opportunities feed
  → outcome ledger
```

No component executes broker orders.

## Current coverage

Initial universe:

- Allwyn AG — `XATH: ALWN`, ISIN `GRS419003009`;
- Virgin Galactic Holdings, Inc. — `XNYS: SPCE`, SEC CIK `0001706946`.

The architecture supports staged expansion to Athens Exchange, S&P 500, Nasdaq-100 and additional exchanges when lawful, reliable data access is available.

## Evidence sources

Implemented:

- Allwyn official regulatory announcements;
- SEC EDGAR submissions and filing documents;
- SEC Company Facts XBRL;
- trusted financial-publisher RSS discovery with an explicit allowlist;
- bounded underlying-article review where lawful access succeeds;
- current Finnhub US quote;
- guarded Finnhub historical-candle adapter with visible entitlement diagnostics;
- controlled PDF extraction with page-level provenance.

RSS titles and snippets remain discovery evidence. They become factual independent evidence only after the underlying article is retrieved, company-matched, event-classified and reviewed under strict size and retention limits.

## Recommendation gate

A directional dossier cannot reach `REVIEW_READY` unless it has:

- reviewed primary factual evidence;
- reviewed independent factual corroboration tied to the same canonical claim;
- no unresolved contradiction;
- sufficient deterministic fundamental coverage;
- sufficient historical price, volume, liquidity and relative-strength coverage;
- a current reference price;
- thesis and causal mechanism;
- bull and bear case;
- verified catalyst;
- at least two material risks;
- explicit invalidation condition;
- review date.

Missing fields force `DRAFT_RESEARCH / WATCH`.

## Canonical claims

Evidence is clustered by company, event type and event window. Claim states are:

- `DISCOVERY_ONLY`
- `PRIMARY_CONFIRMED`
- `CORROBORATED_DISCOVERY`
- `RECOMMENDATION_GRADE`
- `CONTRADICTED`

Company-level source counts cannot corroborate unrelated events.

## Daily report

Run:

```bash
cd market-intelligence
npm test
npm run run:daily
```

Output:

```text
out/daily-intelligence.json
```

Report contract version 4 contains:

- evidence and diagnostics;
- reviewed-document and PDF counts;
- trusted-news discovery count;
- canonical claim clusters;
- fundamental snapshots and risk assessments;
- market snapshots and historical metrics;
- guarded research dossiers;
- production Opportunities feed;
- guarded signal candidates.

The production Opportunities feed accepts only `PUBLISHED` dossiers and is normally empty while research remains draft or review-ready.

## Reviewed publication

Review decisions live in:

```text
config/review-decisions.json
```

An empty registry is committed by default. A decision requires:

- dossier ID;
- identified reviewer;
- `APPROVE`, `REJECT` or `DEFER`;
- review timestamp;
- optional notes.

Publish reviewed research with:

```bash
npm run publish:reviewed
```

Output:

```text
out/reviewed-publication.json
```

Approval still fails when the dossier is not `REVIEW_READY`, the reference price or dossier is stale, or the review date has expired. A successful publication package creates:

- published dossiers;
- production Opportunities feed;
- initial outcome-ledger records;
- complete publication audit.

## Outcome evaluation

The outcome ledger measures each published dossier at:

- 1 day;
- 1 week;
- 1 month;
- 3 months;
- 6 months;
- 12 months.

It stores raw return, action-aligned return and close-based maximum favourable/adverse excursion. Failed theses remain in history.

## Required configuration

- repository variable `SEC_USER_AGENT` for compliant SEC access;
- repository secret `FINNHUB_TOKEN` for US quote access;
- an entitled historical US market-data source;
- a lawful historical price/volume and fundamental source for Allwyn.

Missing configuration never produces fabricated data; it produces explicit diagnostics and publication blockers.

## Safety boundary

- no fabricated facts, prices or sources;
- critical financial calculations are deterministic;
- inference is marked as inference;
- duplicate content is not independent corroboration;
- contradictions remain visible;
- no broker/order integration;
- existing Android local-storage and accounting keys are untouched.

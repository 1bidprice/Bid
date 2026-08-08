# Investor Control Market Intelligence — Implementation Log

## 2026-07-27 — Product direction locked

The Investor Control project continues from the installed Android v0.6.5. It is not a new application and it does not replace the existing transaction ledger, portfolio accounting, alerts or Decision Gate.

The product target is now a personal **Market Intelligence & Decision System** that can:

1. monitor official corporate, regulatory, exchange, market and macro developments;
2. resolve each development to the correct listed company and related companies;
3. separate verified facts, deterministic calculations, estimates and inference;
4. cross-check evidence and surface contradictions;
5. create autonomous, fully sourced signal candidates;
6. classify signals by investment use rather than showing a generic BUY/SELL label;
7. learn from the measured outcome of every published signal;
8. personalise ranking to the user's holdings, limits, time horizon and risk rules;
9. remain advisory and never execute orders automatically.

## Locked signal categories

- `QUALITY_COMPOUNDER`
- `VALUE_REPRICING`
- `EVENT_DRIVEN`
- `SPECULATIVE_CATALYST`
- `MOMENTUM_CONFIRMED`
- `TURNAROUND`
- `INCOME_STABILITY`
- `DETERIORATION`
- `EVENT_RISK`
- `INSUFFICIENT_EVIDENCE`

## Locked recommendation contract

No recommendation may be published as a bare BUY or SELL. Every signal must include:

- canonical company identity, symbol and exchange;
- category and proposed action;
- reference price with timestamp;
- time horizon;
- thesis and causal mechanism;
- verified catalysts;
- bull and bear case;
- risks and explicit invalidation condition;
- confidence and data-quality score;
- evidence list and contradiction notes;
- review date;
- outcome tracking fields.

## Source hierarchy

1. Regulatory filings and official exchange disclosures.
2. Issuer Investor Relations and official company announcements.
3. Independent high-quality financial reporting.
4. Licensed market, fundamental and macro datasets.
5. Alternative data only as supporting evidence.
6. Social media may trigger investigation but can never support a published signal on its own.

## Publication gate

Discovery may begin from one reliable primary source or two independent reliable sources. Directional recommendation-grade output is stricter and now requires all of the following:

- a reviewed primary factual source;
- a reviewed independent factual source from a separate source group;
- canonical claim-level linking between the sources;
- no unresolved contradiction;
- sufficient fundamental coverage;
- sufficient historical price, volume, liquidity and relative-strength coverage;
- a reference price with timestamp;
- a complete thesis, causal mechanism, bull case, bear case, verified catalyst, material risks, invalidation condition and review date.

Unreviewed RSS snippets, duplicate reports, social-only evidence, stale evidence and attractive scores cannot satisfy the publication gate.

## Training strategy

Initial development uses deterministic calculations, retrieval of current evidence, structured outputs and continuous evaluation. Fine-tuning is deferred until a sufficiently large, reviewed history of signals and outcomes exists.

Every published dossier is measured at 1 day, 1 week, 1 month, 3 months, 6 months and 12 months, including action-aligned return, maximum adverse excursion, maximum favourable excursion and catalyst confirmation/failure.

## Coverage sequence

### Stage 1

- current portfolio;
- watchlist;
- Allwyn AG (`ATHEX: ALWN`);
- Virgin Galactic Holdings, Inc. (`NYSE: SPCE`);
- Athens Exchange core universe;
- S&P 500 and Nasdaq-100.

### Stage 2

- active NYSE and Nasdaq equities;
- Euronext regulated equities.

### Stage 3

- additional exchanges only where lawful, reliable and economically sustainable data access exists.

## 2026-07-27 — First working pipeline completed

Completed on branch `investor-control-v1-market-intelligence-foundation`:

- company identity, evidence-record and market-signal schemas;
- canonical seed registry for Allwyn AG and Virgin Galactic;
- evidence publication gate and deterministic signal ranking;
- official Allwyn regulatory-announcement adapter;
- official SEC EDGAR recent-filings adapter;
- deterministic event classification;
- end-to-end daily intelligence runner;
- deep-document-review guard that forces index/title-level discoveries to remain `DRAFT / WATCH`;
- scheduled daily GitHub Actions execution at 05:30 UTC;
- manual and branch-triggered pipeline execution;
- archived JSON output for every successful run;
- tests covering source adapters, event classification, schema discipline and guarded actions;
- successful expanded CI on commit `272cdaf99f2a493473a905bb4fac5f905e8bcc1b`.

## 2026-07-27 — Official document and deterministic metrics stage completed

The pipeline now goes beyond index titles:

- retrieves official HTML/XHTML/text source documents with size and content-type limits;
- strips scripts, styles and executable markup before analysis;
- records document status, content type, byte length, text length and review state;
- extracts auditable currency amounts, percentages, share counts, dates and recognised sections with source excerpts;
- distinguishes `INDEX_DISCOVERY` from `DOCUMENT_REVIEWED` in every signal;
- keeps reviewed documents at `DRAFT / WATCH` until fundamental and market requirements are satisfied;
- retrieves SEC Company Facts for US issuers using the official companyfacts endpoint;
- calculates provenance-backed annual revenue growth, net margin, diluted-share change and annual free cash flow;
- records latest cash, assets, liabilities and equity with concept, unit, period, accession and filing date;
- retrieves a current US quote through Finnhub when a backend token is configured;
- records quote timestamp, age, current price, previous close and daily change;
- explicitly keeps liquidity and relative-strength readiness false because a point-in-time quote cannot prove either metric;
- expanded deterministic tests pass on commit `e1d8ca7b0aa571a50a0615bd3c99ddebda25c815`.

## 2026-07-27 — PDF, historical-market and recommendation-readiness stage completed

The next evidence and metrics layer is now implemented:

- PDF text extraction uses a controlled `pdftotext` runtime with file-size, execution-time and output-size limits;
- page boundaries are preserved with page number, text offsets, text length and content hash;
- extracted currency amounts, percentages, share counts and dates carry page-level provenance;
- PDFs remain unreviewed when the extractor is unavailable, fails or returns insufficient text;
- a guarded Finnhub daily-candle adapter normalises OHLCV arrays and reports entitlement, rate-limit and no-data failures explicitly;
- historical metrics calculate 20/60/120-session returns, 20/50/200-session moving averages, 60-session annualised volatility and 120-session maximum drawdown;
- liquidity is measured from average daily traded value, median volume and volume coverage;
- 60-session relative strength is calculated only against timestamp-aligned benchmark observations;
- a point-in-time quote cannot satisfy historical-market readiness;
- duplicate content does not count as an independent source;
- unresolved contradiction links block recommendation readiness;
- deterministic valuation and balance-sheet risk rules calculate market capitalisation, price-to-sales, price-to-book, liabilities-to-assets, cash runway, dilution, margins and risk flags where source coverage permits;
- the daily workflow installs the PDF extraction runtime before collection;
- the complete deterministic test suite passes on commit `593b3ecd46ee6f9e2b3df7e8e780cb06eab1b174`.

## 2026-07-27 — Claim intelligence, dossiers and learning loop completed

The pipeline now produces a controlled research product rather than isolated signal scores:

- trusted financial-publisher RSS discovery supports Reuters, Bloomberg, Financial Times, Wall Street Journal, Associated Press, CNBC, MarketWatch and Fortune through an explicit allowlist;
- RSS items are company-resolved through canonical names, aliases and tickers and remain `ESTIMATE / discovery only` until the underlying article is reviewed;
- bounded trusted-news review follows redirects, removes executable markup, enforces byte and text limits, verifies the company and a material event, retains only limited factual excerpts and records `REVIEWED_NEWS` provenance;
- unreviewed articles, paywalls, short pages, unsupported content and failed redirects remain visible diagnostics and cannot silently become facts;
- evidence cross-check version 2 requires reviewed primary and reviewed independent factual evidence for recommendation readiness;
- canonical claim clusters link evidence by company, event type and event window and classify each claim as `DISCOVERY_ONLY`, `PRIMARY_CONFIRMED`, `CORROBORATED_DISCOVERY`, `RECOMMENDATION_GRADE` or `CONTRADICTED`;
- company-level source counts can no longer falsely corroborate unrelated events because each dossier and signal is evaluated against its own claim cluster;
- deterministic evidence-only synthesis creates category, proposed action, time horizon, thesis, causal mechanism, catalyst, bull case, bear case, risks, invalidation and review date from reviewed records and deterministic metrics;
- incomplete research cannot leak a directional action: the Research Dossier builder forces `DRAFT_RESEARCH / WATCH` until every gate passes;
- dossier states are explicit: `DRAFT_RESEARCH → REVIEW_READY → PUBLISHED`;
- daily intelligence report contract version 4 includes evidence, trusted-news discoveries, claim clusters, fundamental risk, historical metrics, research dossiers, Opportunities feed and diagnostics;
- the production Opportunities feed accepts only `PUBLISHED` dossiers;
- the outcome ledger creates 1-day, 1-week, 1-month, 3-month, 6-month and 12-month checkpoints and tracks action-aligned performance and close-based favourable/adverse excursion;
- reviewed publication is a separate audited pipeline: an identified `APPROVE` decision, fresh reference price, fresh dossier and valid review date are required before a dossier enters Opportunities and outcome tracking;
- no publication step executes a broker order;
- deterministic tests and schema parsing pass in GitHub Actions on workflow run `30261503308`.

## Current operational constraints

- repository variable `SEC_USER_AGENT` must contain an identifying SEC-compliant User-Agent;
- repository secret `FINNHUB_TOKEN` is required for backend US quote access;
- historical US candles require an entitled source; rejection remains a visible diagnostic rather than fabricated history;
- Allwyn still needs a lawful backend source for historical price and volume data and structured fundamental coverage;
- independent article review depends on lawful access to the underlying publisher page and may remain discovery-only when blocked;
- no Allwyn or SPCE dossier is yet claimed as live `REVIEW_READY` or `PUBLISHED` without a successful evidence-and-data run.

## Next implementation target

- configure and validate the live SEC and market-data environment;
- obtain lawful historical price/volume coverage for Allwyn and production-entitled history for SPCE;
- run claim-level independent corroboration against current Allwyn and SPCE developments;
- generate the first populated source-backed dossiers and inspect every blocker;
- publish only a dossier that actually reaches `REVIEW_READY` and receives an explicit review decision;
- expose draft research, review blockers and published Opportunities through an Android-facing backend contract;
- then integrate the Opportunities screen and the specialised AI Assistant without touching existing local transaction/accounting keys.

## Non-negotiable rules

- No fabricated facts, prices, metrics or sources.
- AI never calculates critical financial numbers when code can calculate them.
- Inference is labelled as inference.
- Conflicting evidence is shown, not hidden.
- Failed signals remain in history.
- Existing Android local data and accounting keys remain untouched until an explicit migration is designed and tested.

# Investor Control v0.9.0 — Autonomous Discovery Radar

Date locked: 2026-07-28

## Who selects the sources

Source selection is not delegated to a generative model at runtime.

The admissible source classes and independent publisher allowlist are controlled by the versioned code policy in `src/source-policy.js`. The current policy version is `2026-07-28.1`.

The policy requires:

- an official regulatory, exchange or issuer source for factual confirmation;
- an independent reviewed source confirming the same canonical claim before a final direction is allowed;
- rejection of unresolved contradictions;
- rejection of stale reference prices;
- no social-media-only recommendation evidence;
- no runtime expansion to arbitrary domains selected by AI.

AI may synthesize and explain records that already passed the evidence boundary. It cannot invent a source, silently approve a new publisher or promote an unreviewed domain into recommendation-grade evidence.

## Autonomous discovery cycle

The previous fixed universe contained only Allwyn and Virgin Galactic. Version 0.9.0 adds an autonomous US market discovery cycle:

1. download the official SEC listed-company registry;
2. scan the SEC current-filings stream for new company events;
3. map each filing to its canonical CIK and listed symbol;
4. score the event by filing type, keywords and freshness;
5. produce a ranked discovery shortlist;
6. add the strongest new companies to the existing deep-analysis universe;
7. collect official filings, structured SEC fundamentals, quote and historical-market inputs, and independent reporting;
8. build the same guarded research dossier used for portfolio companies;
9. permit a final action only after all normal evidence, market, liquidity, freshness, contradiction and risk gates pass.

Default controlled limits:

- discovery shortlist: up to 12 new candidates per run;
- new companies admitted to deep analysis: up to 5 per run;
- discovery window: recent official events, normally up to 36 hours;
- discovery alone always emits `WATCH`, never `BUY_NOW` or `SELL_NOW`.

## What the radar means

A high discovery score means that a material and recent official event deserves investigation. It does not mean that the security is attractive.

Examples of events that can raise discovery priority:

- acquisition, merger or tender offer;
- strategic alternatives;
- earnings or guidance change;
- financing, offering or dilution risk;
- bankruptcy or going-concern warning;
- buyback or dividend change;
- clinical or regulatory milestone;
- material contract or commercial award.

After discovery, the company must still pass the full research pipeline. The final result may be `BUY_NOW`, `HOLD`, `DO_NOT_BUY`, `SELL_NOW`, `AVOID` or remain `WATCH`.

## Coverage boundary

The first market-wide discovery implementation covers companies mapped through the official SEC registry and current-filings stream. It is a real automated US discovery engine, not a claim of instant full analysis of every exchange worldwide.

Allwyn and Athens-market broad discovery remain separate because lawful, structured and sufficiently complete Athens market data and announcement coverage require their own licensed adapter. The existing Allwyn focus-company analysis remains active.

## Android presentation

The Android `Έρευνα` screen now includes:

- `Ραντάρ νέων μετοχών` for automatically discovered companies;
- the event reasons and discovery score;
- an explicit warning that discovery is not yet a buy proposal;
- the version of the source-selection policy;
- separate deep-research dossiers and final actions;
- age of the reference price;
- distinct timestamps for automatic data refresh and formal thesis review.

## Portfolio clarity changes included in v0.9.0

- the daily return and every purchase-lot return use full card width;
- each purchase remains separate with its own date and all-in return;
- the quote card shows source, time, quality and session information;
- average all-in is displayed with four decimal places;
- Decision Gate explicitly distinguishes an existing position from a proposed new purchase or reinforcement;
- a blocked new purchase never implies an automatic instruction to sell the existing position.

## Execution boundary

The discovery and final-action systems do not send orders to a broker. Every final action retains:

- `automaticBrokerOrder: false`;
- `requiresUserExecution: true`.

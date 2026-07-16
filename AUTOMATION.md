# Investor Control — Automation record

## Version 0.4.0 — 16 July 2026

### Implemented

- Added a scheduled GitHub Actions market-data job.
- The job runs every 30 minutes on weekdays between 07:00 and 15:59 UTC and can also be run manually.
- It checks public quote sources for the Athens-listed Allwyn share, trying `ALWN.AT` first and legacy/fallback symbols only if needed.
- The result is published to `market-data.json` on the `gh-pages` branch.
- The mobile web app automatically switches existing manual installations to the new `githubfeed` provider once.
- The app checks the feed on opening, when returning to the foreground, when connectivity returns, on manual refresh, and every 15 minutes while open.
- Price alerts are evaluated after every successful feed synchronization.
- The service-worker cache was upgraded to `investor-control-v0.4.0`, with network-first handling for `market-data.json`.

### Safety rules

- No Piraeus Bank credentials are requested or stored.
- No API key is embedded in the public source code.
- Failed source checks do not invent prices. The last valid value is retained and the feed is marked `stale` or `error`.
- The quote includes source, provider symbol, quote timestamp, and feed-check timestamp.

### Current limitation

The market feed updates in the background, but browser push notifications while the app is completely closed still require a dedicated push backend and stored device subscription. That is the next automation layer; the current version evaluates and displays alerts whenever the app synchronizes.

### Data-source note

The no-key feed currently uses public, unofficial quote endpoints with fallbacks. It is suitable for personal monitoring, not order execution. An official paid market-data vendor can replace it without changing the portfolio ledger.

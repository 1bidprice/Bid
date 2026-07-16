# Investor Control — Automation record

## Version 0.5.1 — 16 July 2026

### Implemented

- The automatic feed now supports both `ALWN.GR` and `SPCE.US`.
- The backend checks the market every 5 minutes on weekdays from 07:00 through 22:59 UTC, covering Athens and the US session.
- While the web app is open, every detected portfolio symbol is checked every 30 seconds while its exchange is open.
- Symbols ending in `.US` are mapped automatically to their Yahoo market symbol, so new US holdings do not require an application-code change for the direct browser check.
- US prices are converted from USD to EUR with the current `EURUSD=X` quote before portfolio value and profit/loss calculations.
- The original USD price, EUR conversion rate, source timestamp, checking timestamp, and delay are retained with every quote.
- The static GitHub feed currently publishes `ALWN.GR`, `SPCE.US`, and `EURUSD` as a reliable fallback when direct browser retrieval is unavailable.
- A missing price that becomes available causes one controlled reload, so newly entered holdings appear in the summary without manual re-entry.
- The service-worker cache was upgraded to `investor-control-v0.5.1`.

### Safety rules

- No bank credentials are requested or stored.
- No private API key is embedded in the public source code.
- A USD price is never shown as euros without currency conversion.
- Failed checks do not invent prices. The last valid value is retained and the source/error state is recorded.
- Every displayed quote keeps its provider symbol, native currency, native price, converted EUR price, and quote timestamp.

### Current limitation

- The public no-key sources are suitable for personal portfolio monitoring, not for order execution.
- Notifications while the web app is completely closed still require a dedicated push backend and stored device subscription.
- The backend fallback list must be extended for each new holding that also needs closed-app coverage. Direct checks while the application is open are symbol-driven and support new `.US` holdings automatically.

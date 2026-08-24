# Investor Control Core Stabilization Log

## 2026-08-24 — stabilization start

Reason: live device QA of v1.7.3 build 31 exposed a reconciliation defect in the SPCE transaction display: 720 shares at a rounded 3.17 USD execution price could not reproduce the authoritative 2,282.72 USD cash cost.

### Locked decisions

- No new product features until the core is stable.
- Broker/settlement cash totals, fees and quantity are the accounting source of truth.
- Execution price and all-in price are derived whenever a stored display price cannot reproduce the authoritative cash amount at cent precision.
- A provider execution price is preserved when it already reconciles after currency-cent rounding (for example the Allwyn 13.565 EUR execution).
- Quote identity, source, timestamp and market session determine valuation eligibility and decision eligibility separately.
- UI must render canonical outputs instead of implementing its own accounting or quote rules.
- Euronext Athens is a first-class supported market, not a ticker-specific exception or a US-market afterthought.
- Greek instruments use `.GR`, MIC-family identity XATH at the intelligence layer, EUR as native currency, Europe/Athens time and primary-exchange quote authority.
- The official Euronext Athens delayed quote is eligible for portfolio valuation only when instrument identity, currency, source and market calendar are verified. Lack of an exact trade timestamp keeps it out of automatic decision eligibility.
- Yahoo/other fallback Greek quotes remain informational only; they cannot silently become authoritative valuation or decision inputs.
- Unknown future Athens holiday calendars fail closed instead of assuming the exchange is open.

### Completed

1. Created dedicated stabilization branch and draft PR #22.
2. Added a canonical accounting invariant engine and regression report.
3. Added explicit SPCE live regression coverage plus Allwyn backward-compatibility coverage.
4. Added 2,000 deterministic synthetic transaction invariant tests.
5. Captured the exact postinstall-generated production source in CI.
6. Materialized that generated output into normal repository source.
7. Removed the historical `apply-v*` patch chain from production `postinstall` execution.
8. Added a permanent canonical-source guard so the patch chain cannot silently return to production.
9. Moved position construction, valuation and portfolio summary logic out of `PortfolioApp.js` into `src/portfolio-engine.js`.
10. Added real ALWN.GR, CREDIA.GR and SPCE.US portfolio regressions plus 500 synthetic position tests.
11. Added null-safe numeric invariants so `null`, `undefined` and empty values cannot masquerade as numeric zero.
12. Removed SPCE-specific live subscription behavior; live US symbols are derived generically from verified positions and use a stable dependency key.
13. Added canonical `src/market-rules.js` with explicit US and GR market identities instead of treating every non-US symbol as Athens.
14. Corrected Euronext Athens regular session handling to 10:15–17:20 Europe/Athens.
15. Added the official 2026 and 2027 Euronext Athens holiday calendars and fail-closed behavior for calendar years that have not been verified.
16. Generalized the official Athens quote adapter to any verified `.GR` symbol instead of ALWN-only handling, with page-identity checks and EUR enforcement.
17. Added a dedicated Athens invariant suite covering open/close boundaries, holidays, calendar uncertainty, CREDIA.GR routing, official delayed-price valuation, fallback rejection and US/GR separation.
18. Core stabilization CI run #55 passed canonical core tests, Expo dependency compatibility, Expo Doctor and Android JavaScript export, then materialized the verified canonical portfolio/Athens/numeric source in commit `1be663a4d26844330e347dc21f39ce65c72f1f28`.

### Current verification gate

This log update intentionally triggers a fresh human-authored CI run against the already-materialized canonical source. The gate is not considered closed until the second run passes without needing another source-materialization repair. Legacy workflows that still try to execute the retired historical patch chain are not release authority and must be retired or rewritten before final release packaging.

### Next locked milestone

1. Prove the materialized canonical source is idempotent under a clean CI/build run.
2. Retire/update legacy APK workflows that still depend on the old patch chain.
3. Audit the Market Intelligence focus/discovery universe so Euronext Athens coverage is broader than the current Allwyn-focused seed, without weakening evidence gates or manufacturing Greek BUY/SELL recommendations.
4. Only after those gates pass, create a new release candidate and perform live-device regression on ALWN.GR, CREDIA.GR and SPCE.US before calling the product final.

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
19. A clean repeat stabilization run passed without requiring another source-materialization repair, proving the canonical source is idempotent under the stabilization workflow.
20. Replaced the obsolete signed-APK patch-chain workflow with a canonical-source v1.7.3 signed build path.
21. Canonical Market Integrity workflow run `32732130516` passed end-to-end: autonomous Market Intelligence validation, canonical mobile integrity, Android prebuild, release APK build, signing verification and artifact upload.
22. Signed Canonical Core APK workflow run `32732130412` passed end-to-end and produced artifact `investor-control-v1.7.3-canonical-core-signed-apk` (artifact id `9522114548`).
23. APK signature certificate SHA-256 remains `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, preserving update-certificate continuity.
24. The live Market Intelligence feed already carries multiple Euronext Athens instruments beyond the original Allwyn seed, including CREDIA.GR, OLYMP.GR and ORILINA.GR, while autonomous discovery continues to treat discovery as WATCH/research until strict evidence gates pass.

## 2026-08-30 — live-device release QA

Real-device testing found two release-blocking regressions in the canonical APK:

1. Tapping the bottom `Συναλλαγές` tab closed the application. Root cause: `TransactionCard` invoked `transactionTotal(transaction)` but `PortfolioApp.js` did not import `transactionTotal` from the canonical accounting module. The JavaScript bundle could be produced without exercising that render path, so the undefined identifier survived build-time validation and failed only when the tab rendered on device.
2. `SPCE.US` was incorrectly excluded from weekend valuation as stale even though the Friday regular-session Finnhub close was verified and still inside the 96-hour closed-market valuation window. Root cause: canonical-registry quotes were reclassified without the current `exchangeOpen`, session and calendar context, so the existing closed-market integrity rule could not activate.

Both defects are now materialized in canonical source at commit `75640c7d1ff3df4a69aef45f48c01f57e9e6951d`:

- `PortfolioApp.js` imports `transactionTotal`; the Transactions render path is now guarded by the permanent canonical-source verifier.
- `readCanonicalFeedQuotes()` supplies current exchange open/session/calendar state to `quoteFromRegistry()`, using the same market context as direct-provider quote classification.
- The existing SPCE closed-market invariant remains strict: last verified regular-session price may value a position while the market is closed, but it is not eligible for a new automatic decision.
- The canonical-source verifier now fails if either live-device regression returns.
- Stabilization run `33318807389` passed core invariants, Expo compatibility, Expo Doctor and Android JavaScript export before the fixes were materialized by the stabilization workflow.

### Stabilization gate status

**REOPENED FOR ONE FINAL SIGNED DEVICE HOTFIX.**

The previous APK is no longer release authority because the device exposed a Transactions runtime crash and a closed-market SPCE valuation regression. No new feature work is allowed in this gate.

### Next locked milestone

Run the complete human-triggered CI/build suite against the already-materialized source, produce a newly signed update APK with the same package/update certificate, and verify on the real device only:

1. Bottom `Συναλλαγές` opens and renders the three stored transactions without a crash.
2. `SPCE.US` uses the last verified regular-session close for valuation while the US market is closed, but remains blocked from a new automatic decision.
3. `ALWN.GR` and `CREDIA.GR` retain official Euronext Athens routing, EUR accounting and fail-closed decision behavior.

If these three checks pass, close stabilization and stop changing the core.
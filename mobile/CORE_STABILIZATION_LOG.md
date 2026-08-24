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
23. Final APK SHA-256: `a892f67b95ab9e3052c183a2dd8c5618471856d798efa36608d3c60f0dce2c13`.
24. Final APK signature certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, preserving update-certificate continuity.
25. The live Market Intelligence feed already carries multiple Euronext Athens instruments beyond the original Allwyn seed, including CREDIA.GR, OLYMP.GR and ORILINA.GR, while autonomous discovery continues to treat discovery as WATCH/research until strict evidence gates pass.

### Stabilization gate status

**CLOSED FOR BUILD/INSTALL TESTING.**

The canonical accounting, portfolio, quote-integrity, Euronext Athens market rules and native Android release build now pass the dedicated stabilization and canonical market-integrity gates. The resulting signed v1.7.3 APK is the only release artifact from this branch that should be used for the next device test.

This does not waive the final real-device regression requirement. A build can be structurally correct and still expose a UI/device-only defect. Do not call a future Play/production release final until ALWN.GR, CREDIA.GR and SPCE.US have been checked on the actual device.

### Next locked milestone

Install the signed canonical v1.7.3 APK on the real Android device **over the existing app without clearing data**, then verify exactly these three positions and nothing else first:

1. `ALWN.GR` — quantity, authoritative cash cost, average/all-in, official delayed Athens price and EUR valuation.
2. `CREDIA.GR` — position visibility, official Athens routing, EUR valuation and no fallback promoted to authority.
3. `SPCE.US` — 720-share quantity, authoritative USD cash cost 2,282.72, reconciled average/all-in, current quote, FX-derived EUR valuation and P/L.

If those pass, stabilization is complete and the branch can move to release integration. If any one fails, fix only the failing canonical layer and rerun the same gate; do not reopen the historical patch chain.
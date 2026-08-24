# Investor Control Core Stabilization Log

## 2026-08-24 — stabilization start

Reason: live device QA of v1.7.3 build 31 exposed a reconciliation defect in the SPCE transaction display: 720 shares at a rounded 3.17 USD execution price could not reproduce the authoritative 2,282.72 USD cash cost.

### Locked decisions

- No new features until the core is stable.
- Broker/settlement cash totals, fees and quantity are the accounting source of truth.
- Execution price and all-in price are derived whenever a stored display price cannot reproduce the authoritative cash amount at cent precision.
- A provider execution price is preserved when it already reconciles after currency-cent rounding (for example the Allwyn 13.565 EUR execution).
- Quote identity, source, timestamp and market session determine valuation eligibility and decision eligibility separately.
- UI must render canonical outputs instead of implementing its own accounting or quote rules.

### Completed

1. Created dedicated stabilization branch and draft PR #22.
2. Added a canonical accounting invariant engine and regression report.
3. Added explicit SPCE live regression coverage plus Allwyn backward-compatibility coverage.
4. Added 2,000 deterministic synthetic transaction invariant tests.
5. Captured the exact postinstall-generated production source in CI.
6. Materialized that generated output into normal repository source.
7. Removed the historical `apply-v*` patch chain from production `postinstall` execution.
8. Added a permanent canonical-source guard so the patch chain cannot silently return to production.

### Next locked milestone

Move portfolio construction/valuation out of `PortfolioApp.js` into a pure canonical portfolio engine, then run the complete CI/build suite and live-device regression before any version is called final.

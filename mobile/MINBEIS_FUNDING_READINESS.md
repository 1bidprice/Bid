# MINBEIS Funding Readiness Gate

Status date: 2026-10-03
Branch: `investor-control-minbeis-integration-v1`
PR: #23 remains draft and MUST NOT be merged without Nikos's explicit approval.

## Goal

Funding-ready does not mean "finished app". It means a credible MVP with:
- a demonstrable user problem and differentiated product;
- trustworthy data/accounting/privacy behavior;
- a repeatable demo on a clean device;
- enough product evidence to support a grant, incubator or investor conversation;
- no claims that exceed the actual implementation or data licences.

## Current verified product proof

- Canonical portfolio accounting with value, cost and P/L.
- Euronext Athens and US market-data routes with fail-closed valuation rules.
- Local privacy ownership isolation and quarantine/recovery of legacy data.
- Android backup disabled to prevent silent portfolio transfer.
- Public privacy policy aligned with gateway behavior.
- MINBEIS portfolio/decision layer and market-opportunity workflow.
- Local portfolio value history with 1H, 1D, 1W, 1M, 6M and 1Y ranges.
- Automated CI gates for accounting, quote integrity, privacy, history and portfolio data flow.
- Recovery build v1.8.1 build 33 produced from an all-green CI head.

## P0 gates before external funding outreach

1. **External-device privacy evidence**
   - clean install on a second physical device;
   - zero inherited transactions/positions;
   - recovery/import works only after explicit user action.

2. **Professional portfolio insight**
   - allocation/concentration visualization;
   - P/L contribution by position;
   - valuation coverage and source transparency.

3. **Historical market-data strategy**
   - keep local observed portfolio history;
   - add licensed/approved historical market data for immediate charts;
   - do not fabricate pre-install portfolio valuations;
   - document display/redistribution rights for every external market-data source.

4. **Distribution-quality Android build**
   - verify APK/AAB signing identity;
   - Play Internal/Closed Testing;
   - crash-free install/update path;
   - no production release without explicit approval.

5. **Beta evidence**
   - minimum structured external beta cohort;
   - record install success, portfolio-entry completion, valuation coverage, repeat usage and qualitative feedback;
   - no collection of portfolio amounts without explicit consent.

6. **Regulatory/product positioning**
   - clearly separate information/decision support from execution;
   - no broker execution;
   - human approval remains mandatory;
   - legal review before public claims that could imply regulated investment advice.

## P1 gates for a strong financing package

- First-run onboarding that explains privacy, data quality and what MINBEIS does.
- Crash/error telemetry with privacy-safe opt-in or strictly necessary operational diagnostics.
- Historical-data provider contract/cost model.
- Product analytics focused on funnel/retention, not portfolio contents.
- Demo dataset isolated from real user portfolios.
- Public landing page with product narrative, screenshots, privacy and waitlist/beta CTA.
- Founder/company profile, ownership/IP documentation and repository provenance.
- 12-18 month operating budget and market-data/cloud cost model.
- Competitive matrix based on documented capabilities, not marketing adjectives.
- One-page product brief, pitch deck, demo script and due-diligence folder.

## Funding-path implications

### Elevate Greece
The official National Startup Registry evaluates innovation and scalability and requires an eligible legal entity. Product evidence should therefore make the standardised/scalable nature of MINBEIS visible, not present it as bespoke consulting.

### EIC Accelerator
This is a later-stage path for high-risk, market-creating innovations around TRL 6-8. MINBEIS should not be positioned as EIC-ready until there is credible external validation/pilot evidence and a defensible innovation case beyond a conventional portfolio tracker.

## Current product truth

The v1.8.1 chart is an honest observed-value chart. It starts when this build begins collecting verified complete valuations. It is not yet a licensed historical market chart and must not be marketed as one.

## Next implementation tranche

Target: v1.8.2 funding-readiness build.

- portfolio allocation/concentration visualisation;
- P/L contribution visualisation;
- historical-market-data contract/interface designed fail-closed;
- signing verification and closed-testing readiness;
- beta QA checklist and evidence capture;
- funding demo pack only after the above passes CI and device QA.

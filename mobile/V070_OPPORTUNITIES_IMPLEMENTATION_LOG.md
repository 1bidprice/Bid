# Investor Control Android v0.7.0 — Opportunities Implementation Log

## Continuity and data boundary

- v0.7.0 is an in-place continuation of the installed v0.6.5 application.
- Android package remains `gr.investorcontrol.app`.
- Android `versionCode` advances from 13 to 14.
- Existing transaction storage, accounting schema, prices, alerts and Decision Gate are not migrated or renamed.
- Market Intelligence is stored under the separate AsyncStorage key `investor-control.intelligence-feed.v1`.
- Clearing imported research does not delete transactions, portfolio positions, alerts or the Finnhub token.

## New Opportunities / Research screen

A fifth bottom-navigation destination named `Έρευνα` is added without moving the floating Decision Gate button.

The screen separates:

- increased-priority risks;
- published opportunities;
- dossiers ready for final review;
- research still in progress.

Every card can show:

- company, symbol and exchange;
- evidence-backed category and supported action;
- reference price and source time;
- thesis and causal mechanism;
- bull and bear case;
- catalysts and risks;
- invalidation condition;
- review date;
- source list and review state;
- explicit blockers and one next action.

`DRAFT_RESEARCH` can never display a directional action in the Android client. It is normalized to `WATCH / Παρακολούθηση` even if a malformed imported file contains another action.

## Feed contract and first delivery mode

The backend produces `mobile-intelligence-feed.json` using the contract `investor-control-mobile-intelligence-feed` version 1.

The first v0.7.0 delivery imports that JSON through Android Document Picker and caches it locally. This makes the full research UI testable without embedding API keys or exposing an unfinished public backend.

Automatic authenticated synchronization is a later stage. The import path is intentionally isolated and replaceable.

## Build invariants

The signed v0.7.0 build workflow verifies:

- app version `0.7.0`;
- Android versionCode `14`;
- unchanged package `gr.investorcontrol.app`;
- Opportunities screen import and fifth navigation item;
- separate Market Intelligence storage key;
- draft research forced to `WATCH`;
- explicit transaction-safety wording;
- existing Android safe-area fixes;
- same update-signing certificate as v0.6.5;
- embedded native React Native bundle.

## Acceptance boundary

The build is not considered complete until:

1. Gradle release assembly succeeds;
2. the APK is aligned, signed and certificate-verified;
3. the artifact is downloaded and independently inspected;
4. the APK installs over v0.6.5 without uninstalling;
5. existing Allwyn and SPCE local transactions remain present;
6. the new `Έρευνα` tab opens and imports a valid feed;
7. a screenshot confirms the five-item bottom navigation and research layout on the physical device.

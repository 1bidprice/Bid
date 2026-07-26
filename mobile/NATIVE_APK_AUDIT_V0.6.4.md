# Investor Control native APK v0.6.4 — verified audit

Date: 2026-07-26

## Inspected artifact

- File: `Investor-Control-v0.6.4.apk`
- SHA-256: `144fb8477850dc78fc1c27c491ea150375eab031a2fe523c7bd242ea0ef32d36`
- Android package: `gr.investorcontrol.app`
- Version: `0.6.4`
- Version code: `12`
- Expo SDK: `55.0.0`
- React Native: `0.83.0`
- Runtime: native Expo / React Native application with an embedded Hermes bytecode bundle at `assets/index.android.bundle`
- This APK does **not** load the GitHub Pages application in a WebView.
- Portfolio data is stored in the Android application sandbox through AsyncStorage; Finnhub credentials use SecureStore.

## Signing and update continuity

The installed APK is signed with the standard Expo/React Native debug certificate:

- SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- SHA-256: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`

A v0.6.5 APK with package `gr.investorcontrol.app`, versionCode `13`, and the same certificate can install over v0.6.4 without deleting the local portfolio.

## Confirmed native UI defects

### IC-NATIVE-064-01 — Decision Gate overlaps bottom navigation

`DecisionOverlay.js` places the floating control at a fixed `bottom: 90`, while the portfolio navigation is 78 px high and also sits above the Android bottom safe area. The overlay is a sibling of the portfolio safe-area provider, so the button does not know the device bottom inset. On the inspected Samsung device it covers the **Ρυθμίσεις** target.

### IC-NATIVE-064-02 — Decision Gate ignores Android top and bottom safe areas

`DecisionOverlay.js` imports `SafeAreaView` from core React Native. The actual portfolio app uses `react-native-safe-area-context`, but the Decision Gate is outside that provider. This is why:

- the Decision Gate header enters the Android status-bar region;
- the final content can sit behind the Android navigation region;
- the layout differs from the correctly inset main portfolio screen.

## First correction implemented for v0.6.5

- A single root `SafeAreaProvider` is added around both the portfolio and Decision Gate.
- Decision Gate uses `SafeAreaView` and `useSafeAreaInsets` from `react-native-safe-area-context`.
- The floating button bottom position becomes `92 + bottomInset`, placing it above the 78 px app navigation with a 14 px gap.
- The modal receives all four safe-area edges.
- Version is raised to `0.6.5`, Android versionCode to `13`.

No accounting, transaction, Decision Gate evaluation, market-price, alert, backup, or storage key logic is changed.

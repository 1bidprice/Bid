# Investor Control v1.2.1 — Release Status

**Recorded:** 2026-08-06 (Europe/Athens)  
**Branch:** `investor-control-play-store-release`  
**Package:** `gr.investorcontrol.app`  
**Version:** `1.2.1`  
**Android versionCode:** `24`

## Completed and committed

- Unified the static app config, package metadata and runtime release patch under version `1.2.1`.
- Added `apply-v121-play-permission-minimization.js` to the actual production patch chain.
- Kept local Android notifications working while blocking unused remote-push and overlay permissions.
- Enforced API 36, HTTPS-only traffic, no backup of app data and the existing package identity.
- Replaced the misleading unsigned “Play release candidate” flow with two explicit outputs:
  - validated **preflight** AAB, not uploadable to Play;
  - separately signed **Play AAB**, generated only with protected upload-key secrets.
- Added removal and verification of inherited/debug AAB signatures before release signing.
- Added verification of package name, version, versionCode, target SDK, forbidden permissions, legal disclosure, privacy URL, decision gates and local-notification implementation.
- Kept the device-test APK separate from the Play bundle. Its debug-compatible certificate is never presented as a Play signing key.

## Independently checked

- The v1.2.1 patch was executed against an isolated fixture and correctly updated runtime version, app/package metadata, versionCode and blocked permissions.
- The app uses local notification scheduling and does not request an Expo remote push token.
- Google Play requires a signed AAB using an upload key; an unsigned bundle is not a publishable artifact.
- Because the app provides portfolio management and directional investment-research signals, the Play declaration must include:
  - `Stock trading and portfolio management`
  - `Financial advice`
- The developer account must be an Organization account with verified organization data and a D-U-N-S number.

## Hard blockers still open

1. **GitHub Actions outage (external):** on 2026-08-06 GitHub reported major Actions disruption, throttled webhook triggers and delayed/failed runners. The new v1.2.1 workflow has therefore not yet produced an execution result. No build is marked passed until the workflow actually runs.
2. **No Play Console organization account recorded:** the user previously stated that no Google Play Console account existed. A financial app must not be registered under a personal developer account.
3. **No Investor Control upload key configured:** the protected secrets below are intentionally absent until a dedicated upload key is created and securely stored:
   - `ANDROID_UPLOAD_KEYSTORE_BASE64`
   - `ANDROID_UPLOAD_KEY_ALIAS`
   - `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
   - `ANDROID_UPLOAD_KEY_PASSWORD`
4. **No signed Play AAB exists yet:** the signed artifact is generated only by a manual workflow run with `sign_for_play=true` after the four secrets exist.
5. **Market intelligence is safe but degraded:** the evidence gate currently blocks final actions when history/fundamentals are incomplete. This is correct safety behavior, not full production completeness.

## Next controlled action

After GitHub Actions recovers, require a successful automatic **v1.2.1 validated preflight** run. Do not create or upload a Play bundle from the older v1.2.0 artifact. After the preflight passes, create/verify the Organization Play Console account and D-U-N-S identity, create one dedicated Investor Control upload key, store it only as protected secrets, and manually run the workflow with `sign_for_play=true`.

## Release rule

Investor Control is **not Play-ready** until all of the following are simultaneously true:

- v1.2.1 workflow succeeds;
- signed AAB exists and `jarsigner` verification passes;
- bundletool validation passes;
- upload certificate is recorded;
- Play Organization account and D-U-N-S verification are complete;
- Financial features and Data Safety declarations match the shipped binary;
- no legal or regulatory review blocker remains for public distribution of investment signals.

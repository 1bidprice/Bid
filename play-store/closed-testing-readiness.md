# Investor Control — Closed Testing release gate

## Verified starting state — 2026-09-18 UTC

- Repository: `1bidprice/Bid`.
- `main`: `f29da31afa067a0166263875468781d6d1953b68`.
- PR #22: draft, open, unmerged; head `a3022bfe92f1ded641c92099fed9f41828e8a4b2` at the start of this continuation. Base is `investor-control-v1-market-intelligence-foundation`, not `main`.
- All ten most recent PR workflows at that head succeeded. This proves their executed checks, not the steps marked skipped.
- [Play preflight run 34723122013](https://github.com/1bidprice/Bid/actions/runs/34723122013): actual signing, protected key checks and live gateway embedding checks were **skipped**.
- Downloaded artifact `10306804182`, `investor-control-v1.7.3-play-preflight`; ZIP SHA-256 matched GitHub's digest `0b8e4a5b4d16703914164bbba002c41b78e2d5c1e8250f7dea9e7c23e2fee05f`.
- Extracted AAB SHA-256: `33ef88093eeb3608f11fa5fe02cd468f963261686919b7f40328d6362458d6d9`.
- Direct ZIP inspection: no `.RSA`, `.DSA`, `.EC` or `.SF` signing entries; the live gateway URL is absent from the embedded JS bundle. This artifact cannot be treated as the upload candidate.
- Identity remains `gr.investorcontrol.app`, `1.7.3`, versionCode `31`, target SDK `36`. Whether Play has already consumed versionCode 31 is unverified.
- Existing side-loaded QA APK certificate is the known Android debug certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. It preserves existing QA update compatibility only.

## Technical gates now implemented

### Executed signing audit and continuation — 2026-09-19 UTC

- Commit `c113c9a7ef9ee37bd476cf8a2983046101e95026`: all 11 PR workflows and the three existing push build/core workflows completed successfully. The separate protected signing audit failed on missing configuration; this is not an all-green release.
- [Protected audit 35401657107](https://github.com/1bidprice/Bid/actions/runs/35401657107): 13 cryptographic regression tests passed; the protected-key job returned `BLOCKED` because all four upload-key secrets and the public certificate variable were unavailable to the workflow. Public report artifact: `10570507083`.
- [Play preflight 35401661125](https://github.com/1bidprice/Bid/actions/runs/35401661125): actual manifest and bundle checks passed; artifact `10570603245` remains explicitly unsigned preflight. No signed Play candidate or Console acceptance has been obtained.
- Live Play Console access stopped before credential entry: the Google sign-in destination returned `502 Bad Gateway` / connection refused. App registration, upload certificate, account type and used version codes remain unverified. No key was created or replaced.
- Prepared [Greek privacy-policy replacement draft](privacy-policy-el-GR.draft.md), with the actual installation ID and deletion limits. Retention/provider confirmation and public publication are still pending.

### Implemented controls

1. `investor-control-play-signing-readiness.yml` runs signature regressions and, on the controlled branch only, audits the configured upload key. A missing/mismatched key is a failed gate with a public JSON report; it cannot be reported as Play-ready.
2. Four existing GitHub secrets are used: `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_PASSWORD`. No new production key is generated.
3. Repository variable `ANDROID_UPLOAD_CERTIFICATE_SHA256` must contain the **upload key certificate** SHA-256 verified from Play Console. It is not the AAB file hash, the QA APK certificate, or the Play app-signing certificate. For a new app, explicitly establish the intended upload certificate through initial Play setup before treating it as registered.
4. The signed build validates its upload certificate before Gradle work. Debug, expired, weak and mismatched certificates are blocked. A certificate match does not by itself prove the key password, Play registration, or Console acceptance.
5. Every payload entry in the signed AAB is read and verified by the JDK against the expected certificate. Unsigned additions, altered payloads and multiple signers are rejected. `bundletool` still independently validates bundle structure and identity.
6. Signed artifacts record the exact source commit, configured live gateway, binary hash and certificate fingerprint. Play acceptance remains explicitly `UNVERIFIED` until checked in Console.

## Remaining release evidence

| Gate | Required evidence |
|---|---|
| Upload key | Successful protected-key audit plus upload certificate match in Play Console. Never paste a private keystore or password into chat. |
| Actual release | Successful manual `sign_for_play=true` run with exact authorized SHA and gateway URL; download the `play-signed` artifact, never `play-preflight`. |
| Version code | Check current App Bundle Explorer before reusing code 31; if already consumed, increment coherently before building. |
| Privacy / Data Safety | Correct the public policy for the installation ID and verify operational log retention, provider relationships and deletion claims. See `data-safety.md`. |
| Console setup | Verified developer account/app ownership, completed app content, finance declaration, rating, listing graphics/screenshots and privacy URL. These cannot be inferred from GitHub. |
| Play-generated install | Install from the actual test track and inspect Play's pre-launch report; test transactions, local backup/restore, quote failure states and notifications on device. A side-loaded debug APK is not evidence for this install. |
| Existing QA data | Export and verify the local JSON backup before any uninstall. A Play app-signing key different from the QA certificate cannot update the debug-signed installation in place. |
| Test distribution | Real tester access, opt-in URL, countries and track status verified in Console. No invitation, enrollment, release rollout or approval has been claimed. |

The 12-testers/14-continuous-days production-access requirement applies to new personal accounts covered by Google's rule. Do not impose or waive it without checking the actual account type/status. Closed Testing readiness is separate from public production approval.

## Next execution

Read the protected-key readiness report from the current branch's CI. Resolve only its concrete missing configuration, verify the public upload fingerprint in Play Console, then run the existing signed-build workflow at that exact head with:

```text
sign_for_play=true
expected_sha=<current verified full branch SHA>
market_gateway_url=https://investor-control-market-gateway.bidprice-alerts.workers.dev
```

No PR merge, signing-key replacement, Play App Signing enrollment, publication, or user-data deletion is implied by this document. PR #22 requires Nikos's explicit merge approval.

Sources: [Android app signing](https://developer.android.com/studio/publish/app-signing), [bundle updates/version codes](https://developer.android.com/studio/publish/upload-bundle), [Google's personal-account testing requirement](https://support.google.com/googleplay/android-developer/answer/14151465), [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

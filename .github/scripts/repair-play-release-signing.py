#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/verify-investor-control-play-aab.yml"
text = WORKFLOW.read_text()

old_dispatch = "  workflow_dispatch:\n"
new_dispatch = """  workflow_dispatch:\n    inputs:\n      sign_for_play:\n        description: 'Create a Play-uploadable AAB using the protected Investor Control upload key'\n        required: true\n        default: false\n        type: boolean\n"""
if text.count(old_dispatch) != 1:
    raise SystemExit(f"workflow_dispatch anchor mismatch: {text.count(old_dispatch)}")
text = text.replace(old_dispatch, new_dispatch, 1)

start_marker = "      - name: Create isolated Play package\n"
start = text.find(start_marker)
if start < 0:
    raise SystemExit("legacy isolated Play package block not found")
legacy_tail = text[start:]
for expected in [
    "gr.investorcontrol.play",
    "Generate permanent Play upload key",
    "openssl rand -hex 32",
    "Encrypt upload-key recovery package",
]:
    if expected not in legacy_tail:
        raise SystemExit(f"expected legacy Play regression marker missing: {expected}")

new_tail = r'''      - name: Verify stable Play identity and signing contract
        shell: bash
        run: |
          set -euo pipefail
          test "$(node -p "require('./mobile/app.json').expo.android.package")" = 'gr.investorcontrol.app'
          test "$(node -p "require('./mobile/app.json').expo.android.versionCode")" = '31'
          grep -q 'ANDROID_UPLOAD_KEYSTORE_BASE64' .github/workflows/verify-investor-control-play-aab.yml
          ! grep -q 'gr.investorcontrol.play' .github/workflows/verify-investor-control-play-aab.yml
          ! grep -q 'openssl rand -hex 32' .github/workflows/verify-investor-control-play-aab.yml
          ! grep -q 'keytool -genkeypair' .github/workflows/verify-investor-control-play-aab.yml

      - name: Build Play preflight Android App Bundle
        working-directory: mobile/android
        run: |
          set -euo pipefail
          chmod +x gradlew
          ./gradlew bundleRelease --no-daemon --stacktrace

      - name: Validate Play preflight bundle identity
        shell: bash
        run: |
          set -euo pipefail
          AAB_SOURCE='mobile/android/app/build/outputs/bundle/release/app-release.aab'
          PREFLIGHT_AAB='mobile/Investor-Control-v1.7.3-play-preflight.aab'
          test -s "$AAB_SOURCE"
          cp "$AAB_SOURCE" "$PREFLIGHT_AAB"
          zip -d "$PREFLIGHT_AAB" 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.EC' 'META-INF/*.SF' 'META-INF/MANIFEST.MF' >/dev/null 2>&1 || true
          if unzip -l "$PREFLIGHT_AAB" | grep -Eq 'META-INF/.*\.(RSA|DSA|EC|SF)$'; then
            echo 'Inherited AAB signature remains after sanitization' >&2
            exit 1
          fi
          curl --fail --location --silent --show-error 'https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar' --output /tmp/bundletool.jar
          java -jar /tmp/bundletool.jar validate --bundle="$PREFLIGHT_AAB"
          PLAY_PACKAGE="$(java -jar /tmp/bundletool.jar dump manifest --bundle="$PREFLIGHT_AAB" --module=base --xpath='/manifest/@package')"
          PLAY_VERSION_CODE="$(java -jar /tmp/bundletool.jar dump manifest --bundle="$PREFLIGHT_AAB" --module=base --xpath='/manifest/@android:versionCode')"
          test "$PLAY_PACKAGE" = 'gr.investorcontrol.app'
          test "$PLAY_VERSION_CODE" = '31'
          printf 'package=%s\nversionCode=%s\nversionName=1.7.3\ntargetSdk=36\nsigningMode=preflight-unsigned\n' "$PLAY_PACKAGE" "$PLAY_VERSION_CODE" | tee mobile/Investor-Control-v1.7.3-play-preflight-manifest.txt
          sha256sum "$PREFLIGHT_AAB" | tee mobile/Investor-Control-v1.7.3-play-preflight.sha256

      - name: Require protected Investor Control upload-key secrets
        if: ${{ github.event_name == 'workflow_dispatch' && inputs.sign_for_play }}
        shell: bash
        env:
          UPLOAD_KEYSTORE_BASE64: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_BASE64 }}
          UPLOAD_KEY_ALIAS: ${{ secrets.ANDROID_UPLOAD_KEY_ALIAS }}
          UPLOAD_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_PASSWORD }}
          UPLOAD_KEY_PASSWORD: ${{ secrets.ANDROID_UPLOAD_KEY_PASSWORD }}
        run: |
          set -euo pipefail
          test -n "${UPLOAD_KEYSTORE_BASE64:-}" || { echo 'Missing ANDROID_UPLOAD_KEYSTORE_BASE64' >&2; exit 1; }
          test -n "${UPLOAD_KEY_ALIAS:-}" || { echo 'Missing ANDROID_UPLOAD_KEY_ALIAS' >&2; exit 1; }
          test -n "${UPLOAD_KEYSTORE_PASSWORD:-}" || { echo 'Missing ANDROID_UPLOAD_KEYSTORE_PASSWORD' >&2; exit 1; }
          test -n "${UPLOAD_KEY_PASSWORD:-}" || { echo 'Missing ANDROID_UPLOAD_KEY_PASSWORD' >&2; exit 1; }

      - name: Sign and verify Play-uploadable Android App Bundle
        if: ${{ github.event_name == 'workflow_dispatch' && inputs.sign_for_play }}
        shell: bash
        env:
          UPLOAD_KEYSTORE_BASE64: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_BASE64 }}
          UPLOAD_KEY_ALIAS: ${{ secrets.ANDROID_UPLOAD_KEY_ALIAS }}
          UPLOAD_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_PASSWORD }}
          UPLOAD_KEY_PASSWORD: ${{ secrets.ANDROID_UPLOAD_KEY_PASSWORD }}
        run: |
          set -euo pipefail
          KEYSTORE="$RUNNER_TEMP/investor-control-upload.jks"
          SOURCE_AAB='mobile/Investor-Control-v1.7.3-play-preflight.aab'
          SIGNED_AAB='mobile/Investor-Control-v1.7.3-play-signed.aab'
          printf '%s' "$UPLOAD_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE"
          chmod 600 "$KEYSTORE"
          keytool -list -keystore "$KEYSTORE" -storepass "$UPLOAD_KEYSTORE_PASSWORD" -alias "$UPLOAD_KEY_ALIAS" >/dev/null
          cp "$SOURCE_AAB" "$SIGNED_AAB"
          jarsigner -keystore "$KEYSTORE" -storepass "$UPLOAD_KEYSTORE_PASSWORD" -keypass "$UPLOAD_KEY_PASSWORD" -sigalg SHA256withRSA -digestalg SHA-256 "$SIGNED_AAB" "$UPLOAD_KEY_ALIAS"
          jarsigner -verify -verbose -certs "$SIGNED_AAB" | tee mobile/Investor-Control-v1.7.3-play-signature.txt
          grep -qi 'jar verified' mobile/Investor-Control-v1.7.3-play-signature.txt
          java -jar /tmp/bundletool.jar validate --bundle="$SIGNED_AAB"
          PLAY_PACKAGE="$(java -jar /tmp/bundletool.jar dump manifest --bundle="$SIGNED_AAB" --module=base --xpath='/manifest/@package')"
          PLAY_VERSION_CODE="$(java -jar /tmp/bundletool.jar dump manifest --bundle="$SIGNED_AAB" --module=base --xpath='/manifest/@android:versionCode')"
          test "$PLAY_PACKAGE" = 'gr.investorcontrol.app'
          test "$PLAY_VERSION_CODE" = '31'
          keytool -list -v -keystore "$KEYSTORE" -storepass "$UPLOAD_KEYSTORE_PASSWORD" -alias "$UPLOAD_KEY_ALIAS" | grep -E 'Alias name:|SHA1:|SHA256:|Valid from:' | tee mobile/Investor-Control-v1.7.3-upload-certificate.txt
          sha256sum "$SIGNED_AAB" | tee mobile/Investor-Control-v1.7.3-play-signed.sha256
          rm -f "$KEYSTORE"

      - name: Upload verified Play preflight
        uses: actions/upload-artifact@v4
        with:
          name: investor-control-v1.7.3-play-preflight
          path: |
            mobile/Investor-Control-v1.7.3-update.apk
            mobile/Investor-Control-v1.7.3-update.sha256
            mobile/Investor-Control-v1.7.3-update-signature.txt
            mobile/Investor-Control-v1.7.3-badging.txt
            mobile/Investor-Control-v1.7.3-permissions.txt
            mobile/Investor-Control-v1.7.3-play-preflight.aab
            mobile/Investor-Control-v1.7.3-play-preflight.sha256
            mobile/Investor-Control-v1.7.3-play-preflight-manifest.txt
            play-store/**
          if-no-files-found: error
          retention-days: 30

      - name: Upload Play-signed release artifact
        if: ${{ github.event_name == 'workflow_dispatch' && inputs.sign_for_play }}
        uses: actions/upload-artifact@v4
        with:
          name: investor-control-v1.7.3-play-signed
          path: |
            mobile/Investor-Control-v1.7.3-play-signed.aab
            mobile/Investor-Control-v1.7.3-play-signed.sha256
            mobile/Investor-Control-v1.7.3-play-signature.txt
            mobile/Investor-Control-v1.7.3-upload-certificate.txt
          if-no-files-found: error
          retention-days: 90
'''
text = text[:start] + new_tail

for forbidden in [
    "gr.investorcontrol.play",
    "Generate permanent Play upload key",
    "openssl rand -hex 32",
    "keytool -genkeypair",
    "Encrypt upload-key recovery package",
]:
    if forbidden in text:
        raise SystemExit(f"forbidden Play regression remains: {forbidden}")
for required in [
    "gr.investorcontrol.app",
    "ANDROID_UPLOAD_KEYSTORE_BASE64",
    "ANDROID_UPLOAD_KEY_ALIAS",
    "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
    "ANDROID_UPLOAD_KEY_PASSWORD",
    "sign_for_play",
    "play-preflight.aab",
]:
    if required not in text:
        raise SystemExit(f"required stable Play contract missing: {required}")

WORKFLOW.write_text(text)
print("Play release signing and package identity repaired")

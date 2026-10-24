# MINBEIS Production Provisioning Contract

Status: code-ready, external credentials not yet provisioned.
This document is operational. It lists the exact external values required before enabling production accounts, remote push and signed Android distribution.

## 1. Account backend activation

### Required GitHub repository variables

- `MINBEIS_ACCOUNT_PRODUCTION_ENABLED=true`
- `MINBEIS_FIREBASE_PROJECT_ID=<firebase project id>`
- `MINBEIS_ACCOUNTS_DB_ID=<Cloudflare D1 database id>`
- `MINBEIS_ACCOUNTS_DB_NAME=minbeis-accounts` (optional override)

### Required GitHub secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `FINNHUB_TOKEN`
- `MINBEIS_TENANT_HMAC_SECRET` — minimum 32 characters, generated randomly and never stored in the repository.

### Activation workflow

`.github/workflows/minbeis-account-backend-activate.yml`

Required manual inputs:
- `confirm_accounts = ENABLE_ACCOUNTS`
- `expected_sha = exact authorized commit SHA`

The workflow:
1. re-runs gateway/account/privacy tests;
2. audits the D1 schema in SQLite;
3. renders a temporary account-enabled Wrangler config;
4. dry-runs the Worker bundle;
5. applies the idempotent D1 migration;
6. deploys encrypted provider/tenant secrets;
7. verifies health;
8. verifies that account endpoints are enabled but reject unauthenticated access;
9. verifies market quotes still work;
10. writes a non-secret activation manifest.

### Anti-downgrade rule

Once `MINBEIS_ACCOUNT_PRODUCTION_ENABLED=true`, the legacy gateway deployment workflow is blocked.

This prevents a later ordinary gateway deploy from silently removing the D1 binding or disabling account routes.

## 2. Firebase mobile configuration

### Required public build variables

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` (recommended)
- `EXPO_PUBLIC_EAS_PROJECT_ID` for Expo push token acquisition.

Firebase web/mobile configuration values are public application identifiers, not server private keys.

### Forbidden in repository/mobile bundle

Never commit or embed:
- Firebase service-account private key;
- Google client secret;
- Cloudflare API token;
- tenant HMAC secret;
- Android upload private key/passwords.

### Authentication policy

Current production contract:
- email/password authentication;
- verification email sent on account creation;
- private backend rejects unverified email identities;
- Firebase subject is converted server-side to an HMAC pseudonymous tenant id;
- email is not stored in the MINBEIS D1 account database;
- cloud account layer does not store portfolio transactions, quantity, cost basis, P/L or notes.

## 3. Remote push

### Current design

- user must explicitly press “Ενεργοποίηση remote ειδοποιήσεων”;
- notification permission is requested only then;
- Expo push token is linked to tenant + installation;
- server stores only push/device metadata and selected alert rules;
- push body is privacy-minimal;
- DeviceNotRegistered responses are handled by the transport contract;
- portfolio holdings are not needed by the account database.

### Backend transport

Initial transport: Expo Push Service over FCM/APNs.

This does not prevent later migration to direct FCM/APNs.

## 4. Android upload signing

### Required GitHub secrets

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_STORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`

### Signed candidate workflow

`.github/workflows/minbeis-production-android.yml`

Required manual inputs:
- `confirm_signing = BUILD_SIGNED`
- `expected_sha = exact authorized commit SHA`

The workflow:
1. runs the full mobile regression suite;
2. verifies the production gateway;
3. performs Expo prebuild;
4. decodes the upload keystore only into `$RUNNER_TEMP`;
5. patches generated Gradle so release no longer uses debug signing;
6. builds both AAB and APK;
7. verifies AAB/APK signatures;
8. fails if “Android Debug” is found;
9. records SHA-256 artifact hashes;
10. uploads only signed app artifacts/audit/manifest;
11. deletes the temporary keystore;
12. does **not** upload or publish to Google Play.

## 5. Google Play

Separate explicit gate after a correctly signed AAB exists:

- enroll/use Play App Signing;
- confirm upload-certificate fingerprint;
- create Internal/Closed Testing release;
- verify clean install/update;
- do not make a Production release without explicit owner approval.

## 6. External checks still required

Before claiming full production readiness:
- second-device isolation test;
- real Firebase account creation + verified email test;
- real D1 tenant/device isolation test;
- push delivery test with app closed;
- push token revocation test;
- account deletion test;
- signed AAB upload test in Play Internal/Closed Testing;
- legal/privacy review of account/push processing;
- load testing with concurrent users and large symbol lists.

## 7. Cost discipline

No external paid tier should be enabled without documenting:
- provider;
- free allowance;
- expected monthly cost;
- why free/self-hosted alternative is insufficient;
- cancellation/rollback path.

Account architecture, D1 schema, Firebase adapter, push transport and signing workflows can remain code-ready before any paid commitment.

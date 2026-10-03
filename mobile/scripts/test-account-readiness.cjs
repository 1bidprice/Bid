'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const authSource = fs.readFileSync(path.join(root, 'src', 'firebase-auth-client.js'), 'utf8');
const accountSource = fs.readFileSync(path.join(root, 'src', 'account-client.js'), 'utf8');
const accountUiSource = fs.readFileSync(path.join(root, 'src', 'AccountAccessCard.js'), 'utf8');
const accountDeviceSource = fs.readFileSync(path.join(root, 'src', 'account-device-sync.js'), 'utf8');
const pushRegistrationSource = fs.readFileSync(path.join(root, 'src', 'push-registration.js'), 'utf8');
const portfolioAppSource = fs.readFileSync(path.join(root, 'PortfolioApp.js'), 'utf8');

assert.equal(pkg.dependencies?.firebase, '12.19.0', 'Firebase client SDK must remain pinned');
assert.match(authSource, /getReactNativePersistence\(AsyncStorage\)/);
assert.match(authSource, /FIREBASE_ACCOUNT_NOT_CONFIGURED/);
assert.match(authSource, /EXPO_PUBLIC_FIREBASE_API_KEY/);
assert.match(authSource, /EXPO_PUBLIC_FIREBASE_PROJECT_ID/);
assert.match(authSource, /EXPO_PUBLIC_FIREBASE_APP_ID/);
assert.match(authSource, /sendEmailVerification/);
assert.match(authSource, /prepareMinbeisAccountDeletion/);
assert.match(authSource, /deleteUser/);
assert.match(authSource, /verificationSent: true/);
assert.doesNotMatch(authSource, /serviceAccount|private_key|client_secret/i, 'mobile auth source must not contain server credentials');

assert.match(accountSource, /Authorization: `Bearer/);
assert.match(accountSource, /X-Investor-Control-Client/);
assert.match(accountSource, /\/v1\/account\/device/);
assert.match(accountSource, /\/v1\/account\/alerts/);
assert.doesNotMatch(accountSource, /quantity|costBasis|pnl/i, 'cloud account client must not transport portfolio holdings or P/L');
assert.match(accountSource, /deleteMinbeisCloudAccount/);

assert.match(accountUiSource, /if \(!configured\) return null;/, 'account UI must stay hidden without Firebase config');
assert.match(accountUiSource, /Το portfolio παραμένει τοπικά και δεν ανεβαίνει στο cloud/);
assert.match(accountUiSource, /δεν ανεβάζει το χαρτοφυλάκιό σου/);
assert.match(portfolioAppSource, /<AccountAccessCard \/>/, 'settings must mount opt-in account UI');
assert.doesNotMatch(accountUiSource, /portfolioPositions|transactions|costBasis|totalPnl/, 'account UI must not receive portfolio contents');
assert.match(accountUiSource, /onPress=\{enableRemotePush\}/, 'remote push must require an explicit user action');
assert.match(accountUiSource, /!account\.emailVerified/, 'remote features must remain gated by verified email');
assert.match(accountUiSource, /Επαναποστολή email επιβεβαίωσης/);
assert.match(accountUiSource, /disabled=\{pushBusy \|\| pushEnabled \|\| !account\.emailVerified\}/);
assert.doesNotMatch(accountUiSource, /useEffect\([\s\S]{0,1200}enableRemotePushForCurrentDevice/, 'remote push must not auto-register from an effect');
assert.match(accountDeviceSource, /portfolioUploaded: false/);
assert.doesNotMatch(accountDeviceSource, /transactions|costBasis|totalPnl|quantity/, 'device sync must never include portfolio contents');
assert.match(pushRegistrationSource, /options\.requestPermission === true/);
assert.match(pushRegistrationSource, /REMOTE_PUSH_NOT_CONFIGURED/);

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const serialized = JSON.stringify(app);
assert.doesNotMatch(serialized, /FIREBASE_API_KEY|private_key|client_secret/i, 'Firebase config must not be hard-coded into app.json');

console.log('Account readiness PASS: pinned Firebase auth adapter is opt-in, React Native persistent, private API authenticated, and portfolio data remains outside cloud account transport.');


assert.match(accountUiSource, /Διαγραφή cloud λογαριασμού/);
assert.match(accountUiSource, /prepareMinbeisAccountDeletion/);
assert.match(accountUiSource, /deleteMinbeisCloudAccount/);
assert.match(accountUiSource, /minbeisDeleteIdentity/);
assert.match(accountUiSource, /τοπικό portfolio/);
assert.match(accountUiSource, /disableRemotePushForCurrentDevice/);
assert.match(deviceSyncSource, /setRemotePushEnabledLocally\(true/);
assert.match(deviceSyncSource, /setRemotePushEnabledLocally\(false/);
assert.match(remoteSyncSource, /REMOTE_PUSH_ENABLED_STORAGE_KEY/);
assert.doesNotMatch(remoteSyncSource, /quantity|costBasis|pnl/i, 'remote alert sync must stay portfolio-minimal');

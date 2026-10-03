'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const authSource = fs.readFileSync(path.join(root, 'src', 'firebase-auth-client.js'), 'utf8');
const accountSource = fs.readFileSync(path.join(root, 'src', 'account-client.js'), 'utf8');

assert.equal(pkg.dependencies?.firebase, '12.19.0', 'Firebase client SDK must remain pinned');
assert.match(authSource, /getReactNativePersistence\(AsyncStorage\)/);
assert.match(authSource, /FIREBASE_ACCOUNT_NOT_CONFIGURED/);
assert.match(authSource, /EXPO_PUBLIC_FIREBASE_API_KEY/);
assert.match(authSource, /EXPO_PUBLIC_FIREBASE_PROJECT_ID/);
assert.match(authSource, /EXPO_PUBLIC_FIREBASE_APP_ID/);
assert.doesNotMatch(authSource, /serviceAccount|private_key|client_secret/i, 'mobile auth source must not contain server credentials');

assert.match(accountSource, /Authorization: `Bearer/);
assert.match(accountSource, /X-Investor-Control-Client/);
assert.match(accountSource, /\/v1\/account\/device/);
assert.match(accountSource, /\/v1\/account\/alerts/);
assert.doesNotMatch(accountSource, /quantity|costBasis|pnl/i, 'cloud account client must not transport portfolio holdings or P/L');

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const serialized = JSON.stringify(app);
assert.doesNotMatch(serialized, /FIREBASE_API_KEY|private_key|client_secret/i, 'Firebase config must not be hard-coded into app.json');

console.log('Account readiness PASS: pinned Firebase auth adapter is opt-in, React Native persistent, private API authenticated, and portfolio data remains outside cloud account transport.');

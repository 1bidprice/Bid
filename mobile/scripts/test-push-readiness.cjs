'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const expo = app.expo || {};
const android = expo.android || {};
const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
const pluginNames = plugins.map((entry) => Array.isArray(entry) ? entry[0] : entry);

assert.ok(pluginNames.includes('expo-notifications'), 'expo-notifications config plugin is required');
assert.ok(pkg.dependencies?.['expo-notifications'], 'expo-notifications runtime dependency is required');
assert.equal(android.allowBackup, false, 'Android backup must remain disabled for portfolio privacy');

const blocked = new Set(android.blockedPermissions || []);
assert.equal(
  blocked.has('com.google.android.c2dm.permission.RECEIVE'),
  false,
  'FCM receive capability must not be explicitly blocked when remote push is planned',
);

assert.equal(
  fs.existsSync(path.join(root, 'google-services.json')),
  false,
  'google-services.json must not be committed to the repository',
);

const source = fs.readFileSync(path.join(root, 'src', 'push-registration.js'), 'utf8');
assert.match(source, /REMOTE_PUSH_NOT_CONFIGURED/);
assert.match(source, /getExpoPushTokenAsync/);
assert.match(source, /projectId/);

console.log('Push readiness contract PASS: notification plugin enabled, FCM receive not blocked, secrets absent, remote registration fails closed until projectId exists.');

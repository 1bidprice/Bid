'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(root, '.github', 'workflows', 'minbeis-production-android.yml');
assert.equal(fs.existsSync(workflowPath), true, 'signed production candidate workflow is missing');

const source = fs.readFileSync(workflowPath, 'utf8');
const lines = source.split(/\r?\n/);

assert.equal(lines.some((line) => /^  workflow_dispatch:\s*$/.test(line)), true, 'workflow must be manual-only via workflow_dispatch');
assert.equal(lines.some((line) => /^  (push|pull_request|schedule):\s*$/.test(line)), false, 'workflow must not auto-trigger from push, PR or schedule');

for (const required of [
  'BUILD_SIGNED',
  'expected_sha',
  'ANDROID_UPLOAD_KEYSTORE_BASE64',
  'ANDROID_UPLOAD_STORE_PASSWORD',
  'ANDROID_UPLOAD_KEY_ALIAS',
  'ANDROID_UPLOAD_KEY_PASSWORD',
  'patch-release-signing.cjs',
  'bundleRelease assembleRelease',
  'debugCertificateRejected',
  'playProductionReleased',
]) {
  assert.equal(source.includes(required), true, `required signed-build guard is missing: ${required}`);
}

for (const forbidden of [
  'r0adkll/upload-google-play',
  'gradle-play-publisher',
  'publishBundle',
  'publishReleaseBundle',
  'service_account_json',
]) {
  assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `Play publication capability must not be present: ${forbidden}`);
}

assert.equal(/track:\s*production/i.test(source), false, 'production Play track must not be configured');
assert.equal(/"playProductionReleased"\s*:\s*false/.test(source), true, 'candidate manifest must explicitly state no Play production release');

console.log('Production workflow safety PASS: manual-only signed AAB/APK candidate, secret-backed upload key, and no Google Play publication capability.');

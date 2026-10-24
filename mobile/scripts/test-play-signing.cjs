'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { auditUploadKey } = require('./verify-play-upload-key.cjs');

// Disposable test credentials only. Never used by release signing or uploaded as artifacts.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-signing-regression-'));
const password = crypto.randomBytes(24).toString('hex');
const env = { ...process.env, TEST_SIGNING_PASSWORD: password };
const verifier = path.join(__dirname, 'VerifyPlaySigning.java');
let passed = 0;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, env, cwd: directory, ...options });
  if (result.error) throw result.error;
  return result;
}
function success(result) { assert.equal(result.status, 0, result.stderr); return result; }
function check(name, callback) { callback(); passed++; console.log(`PASS ${name}`); }
function fixture(name, extra = []) {
  const store = path.join(directory, `${name}.p12`);
  const pem = path.join(directory, `${name}.pem`);
  success(run('keytool', ['-genkeypair', '-alias', 'fixture', '-keyalg', 'RSA', '-keysize', '2048',
    '-sigalg', 'SHA256withRSA', '-dname', `CN=${name}`, '-validity', '3650', '-keystore', store,
    '-storepass:env', 'TEST_SIGNING_PASSWORD', '-keypass:env', 'TEST_SIGNING_PASSWORD', ...extra]));
  success(run('keytool', ['-exportcert', '-rfc', '-alias', 'fixture', '-keystore', store,
    '-storepass:env', 'TEST_SIGNING_PASSWORD', '-file', pem]));
  const fingerprint = new crypto.X509Certificate(fs.readFileSync(pem)).fingerprint256.replace(/:/g, '').toLowerCase();
  return { store, pem, fingerprint };
}
function verify(mode, file, fingerprint) {
  return run('java', [verifier, mode, file, '--expected-sha256', fingerprint]);
}
try {
  const release = fixture('Ephemeral regression fixture');
  const debug = fixture('Android Debug');
  const expired = fixture('Expired regression fixture', ['-startdate', '-10d', '-validity', '1']);
  const weak = fixture('Weak regression fixture', ['-keysize', '1024']);
  const auditEnv = { ...env, UPLOAD_KEYSTORE_BASE64: fs.readFileSync(release.store).toString('base64'),
    UPLOAD_KEY_ALIAS: 'fixture', UPLOAD_KEYSTORE_PASSWORD: password, UPLOAD_KEY_PASSWORD: password,
    EXPECTED_UPLOAD_CERT_SHA256: release.fingerprint };
  check('missing release credentials block readiness', () => {
    const report = auditUploadKey({});
    assert.equal(report.status, 'BLOCKED'); assert.equal(report.missing.length, 5);
  });
  check('valid configured certificate passes without claiming Play acceptance', () => {
    const report = auditUploadKey(auditEnv);
    assert.equal(report.status, 'PASS', JSON.stringify(report));
    assert.equal(report.playConsoleVerified, false); assert.equal(report.signedBundleVerified, false);
    assert.ok(!JSON.stringify(report).includes(password));
  });
  check('wrong keystore password blocks without leaking credentials', () => {
    const report = auditUploadKey({ ...auditEnv, UPLOAD_KEYSTORE_PASSWORD: 'wrong-fixture-password' });
    assert.equal(report.status, 'BLOCKED'); assert.ok(!JSON.stringify(report).includes('wrong-fixture-password'));
  });
  check('mismatched certificate is rejected', () => assert.notEqual(verify('--certificate', release.pem, '0'.repeat(64)).status, 0));
  check('debug certificate is rejected even when its fingerprint is pinned', () => assert.match(verify('--certificate', debug.pem, debug.fingerprint).stderr, /DEBUG_CERTIFICATE_REJECTED/));
  check('expired certificate is rejected', () => assert.notEqual(verify('--certificate', expired.pem, expired.fingerprint).status, 0));
  check('weak RSA certificate is rejected', () => assert.match(verify('--certificate', weak.pem, weak.fingerprint).stderr, /RSA_2048/));
  check('malformed fingerprint is rejected', () => assert.match(verify('--certificate', release.pem, 'unknown').stderr, /SHA256_INVALID/));

  const payload = path.join(directory, 'payload'); fs.mkdirSync(payload);
  fs.writeFileSync(path.join(payload, 'bundle.txt'), 'synthetic signature regression payload');
  const unsigned = path.join(directory, 'unsigned.aab');
  success(run('java', ['-m', 'jdk.jartool/sun.tools.jar.Main', '--create', '--file', unsigned, '-C', payload, '.']));
  check('unsigned archive is rejected', () => assert.match(verify('--bundle', unsigned, release.fingerprint).stderr, /UNSIGNED_OR_MULTIPLE_SIGNER_ENTRY/));
  const signed = path.join(directory, 'signed.aab'); fs.copyFileSync(unsigned, signed);
  success(run('java', ['-m', 'jdk.jartool/sun.security.tools.jarsigner.Main', '-keystore', release.store,
    '-storepass:env', 'TEST_SIGNING_PASSWORD', '-keypass:env', 'TEST_SIGNING_PASSWORD',
    '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', signed, 'fixture']));
  check('strict jarsigner accepts the trusted upload certificate', () => {
    success(run('java', ['-m', 'jdk.jartool/sun.security.tools.jarsigner.Main', '-verify', '-strict',
      '-keystore', release.store, '-storepass:env', 'TEST_SIGNING_PASSWORD', signed]));
  });
  check('fully signed archive passes and records the exact binary hash', () => {
    const report = JSON.parse(success(verify('--bundle', signed, release.fingerprint)).stdout);
    assert.equal(report.payloadEntries, 1);
    assert.equal(report.bundleSha256, crypto.createHash('sha256').update(fs.readFileSync(signed)).digest('hex'));
  });
  const partial = path.join(directory, 'partial.aab'); fs.copyFileSync(signed, partial);
  fs.writeFileSync(path.join(payload, 'unsigned-added.txt'), 'added after signing');
  success(run('java', ['-m', 'jdk.jartool/sun.tools.jar.Main', '--update', '--file', partial, '-C', payload, 'unsigned-added.txt']));
  check('partially signed archive is rejected', () => assert.match(verify('--bundle', partial, release.fingerprint).stderr, /UNSIGNED_OR_MULTIPLE_SIGNER_ENTRY/));
  const tampered = path.join(directory, 'tampered.aab'); fs.copyFileSync(signed, tampered);
  fs.writeFileSync(path.join(payload, 'bundle.txt'), 'modified after signing');
  success(run('java', ['-m', 'jdk.jartool/sun.tools.jar.Main', '--update', '--file', tampered, '-C', payload, 'bundle.txt']));
  check('tampered signed payload is rejected', () => assert.notEqual(verify('--bundle', tampered, release.fingerprint).status, 0));
  console.log(`Play signing regression suite: ${passed} passed`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

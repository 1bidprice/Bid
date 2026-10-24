'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Only a public certificate fingerprint is published. No keystore/password output.
function auditUploadKey(env = process.env) {
  const required = {
    UPLOAD_KEYSTORE_BASE64: 'ANDROID_UPLOAD_KEYSTORE_BASE64',
    UPLOAD_KEY_ALIAS: 'ANDROID_UPLOAD_KEY_ALIAS',
    UPLOAD_KEYSTORE_PASSWORD: 'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
    UPLOAD_KEY_PASSWORD: 'ANDROID_UPLOAD_KEY_PASSWORD',
    EXPECTED_UPLOAD_CERT_SHA256: 'ANDROID_UPLOAD_CERTIFICATE_SHA256 (repository variable)',
  };
  const missing = Object.entries(required).filter(([key]) => !env[key]?.trim()).map(([, name]) => name);
  const report = { schemaVersion: 1, scope: 'upload-key-readiness', sourceCommit: env.GITHUB_SHA || null,
    status: 'BLOCKED', missing, playConsoleVerified: false, signedBundleVerified: false };
  if (missing.length) return report;
  const expected = env.EXPECTED_UPLOAD_CERT_SHA256.replace(/[:\s]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return { ...report, reason: 'EXPECTED_CERTIFICATE_SHA256_INVALID' };
  let directory;
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'investor-control-signing-'));
    fs.chmodSync(directory, 0o700);
    const keystore = path.join(directory, 'upload.jks');
    const certificate = path.join(directory, 'upload.pem');
    const encoded = env.UPLOAD_KEYSTORE_BASE64.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      return { ...report, reason: 'KEYSTORE_BASE64_INVALID' };
    }
    fs.writeFileSync(keystore, Buffer.from(encoded, 'base64'), { mode: 0o600 });
    const run = (command, args) => spawnSync(command, args, { env, encoding: 'utf8', timeout: 30000 });
    const keyArgs = ['-J-Duser.language=en', '-J-Duser.country=US', '-keystore', keystore,
      '-storepass:env', 'UPLOAD_KEYSTORE_PASSWORD', '-alias', env.UPLOAD_KEY_ALIAS];
    const listed = run('keytool', ['-list', '-v', ...keyArgs]);
    if (listed.status !== 0 || !listed.stdout.includes('PrivateKeyEntry')) {
      return { ...report, reason: 'UPLOAD_PRIVATE_KEY_UNREADABLE_OR_MISSING' };
    }
    const exported = run('keytool', ['-exportcert', '-rfc', ...keyArgs, '-file', certificate]);
    if (exported.status !== 0) return { ...report, reason: 'UPLOAD_CERTIFICATE_EXPORT_FAILED' };
    const verified = run('java', [path.join(__dirname, 'VerifyPlaySigning.java'), '--certificate', certificate,
      '--expected-sha256', expected]);
    if (verified.status !== 0) {
      // Verifier diagnostics concern only the public certificate, never the private key or passwords.
      return { ...report, reason: 'UPLOAD_CERTIFICATE_REJECTED', detail: (verified.stderr || '').trim() };
    }
    const result = JSON.parse(verified.stdout);
    return { ...report, status: 'PASS', certificateSha256: result.certificateSha256,
      keyPasswordVerifiedBySigning: false, note: 'Certificate matches the configured pin. Play Console registration and actual AAB signing remain separate gates.' };
  } catch (_) {
    return { ...report, reason: 'UPLOAD_KEY_AUDIT_ERROR' };
  } finally {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--report')) throw new Error('Usage: verify-play-upload-key.cjs [--report path]');
  const report = auditUploadKey();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args[1]) fs.writeFileSync(args[1], json);
  process.stdout.write(json);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

module.exports = { auditUploadKey };

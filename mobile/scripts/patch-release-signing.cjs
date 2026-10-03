'use strict';

const fs = require('node:fs');

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function blockRange(source, label, startAt = 0) {
  const labelIndex = source.indexOf(label, startAt);
  if (labelIndex < 0) throw new Error(`${label}_BLOCK_NOT_FOUND`);
  const open = source.indexOf('{', labelIndex);
  if (open < 0) throw new Error(`${label}_OPEN_BRACE_NOT_FOUND`);
  const close = findMatchingBrace(source, open);
  if (close < 0) throw new Error(`${label}_CLOSE_BRACE_NOT_FOUND`);
  return { labelIndex, open, close };
}

function indentAt(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const match = source.slice(lineStart, index).match(/^\s*/);
  return match ? match[0] : '';
}

function patchReleaseSigning(source) {
  if (source.includes('MINBEIS_SECURE_RELEASE_SIGNING')) {
    throw new Error('RELEASE_SIGNING_ALREADY_PATCHED');
  }

  const signing = blockRange(source, 'signingConfigs');
  const signingIndent = indentAt(source, signing.labelIndex);
  const childIndent = signingIndent + '    ';
  const bodyIndent = childIndent + '    ';

  const releaseConfig = [
    '',
    `${childIndent}// MINBEIS_SECURE_RELEASE_SIGNING`,
    `${childIndent}release {`,
    `${bodyIndent}def minbeisStoreFile = System.getenv("MINBEIS_RELEASE_STORE_FILE")`,
    `${bodyIndent}def minbeisStorePassword = System.getenv("MINBEIS_RELEASE_STORE_PASSWORD")`,
    `${bodyIndent}def minbeisKeyAlias = System.getenv("MINBEIS_RELEASE_KEY_ALIAS")`,
    `${bodyIndent}def minbeisKeyPassword = System.getenv("MINBEIS_RELEASE_KEY_PASSWORD")`,
    `${bodyIndent}if (!minbeisStoreFile || !minbeisStorePassword || !minbeisKeyAlias || !minbeisKeyPassword) {`,
    `${bodyIndent}    throw new GradleException("MINBEIS release signing environment is incomplete")`,
    `${bodyIndent}}`,
    `${bodyIndent}storeFile file(minbeisStoreFile)`,
    `${bodyIndent}storePassword minbeisStorePassword`,
    `${bodyIndent}keyAlias minbeisKeyAlias`,
    `${bodyIndent}keyPassword minbeisKeyPassword`,
    `${childIndent}}`,
  ].join('\n');

  let patched = source.slice(0, signing.close) + releaseConfig + '\n' + source.slice(signing.close);

  const buildTypes = blockRange(patched, 'buildTypes');
  const release = blockRange(patched, 'release', buildTypes.open + 1);
  if (release.close > buildTypes.close) throw new Error('RELEASE_BUILD_TYPE_NOT_FOUND');
  const releaseBody = patched.slice(release.open + 1, release.close);
  if (!/signingConfig\s+signingConfigs\.debug/.test(releaseBody)) {
    throw new Error('EXPECTED_DEBUG_RELEASE_SIGNING_NOT_FOUND');
  }
  const replacedBody = releaseBody.replace(
    /signingConfig\s+signingConfigs\.debug/,
    'signingConfig signingConfigs.release',
  );
  patched = patched.slice(0, release.open + 1) + replacedBody + patched.slice(release.close);

  const finalBuildTypes = blockRange(patched, 'buildTypes');
  const finalRelease = blockRange(patched, 'release', finalBuildTypes.open + 1);
  const finalReleaseBody = patched.slice(finalRelease.open + 1, finalRelease.close);
  if (!/signingConfig\s+signingConfigs\.release/.test(finalReleaseBody)) {
    throw new Error('RELEASE_SIGNING_PATCH_FAILED');
  }
  if (/signingConfig\s+signingConfigs\.debug/.test(finalReleaseBody)) {
    throw new Error('DEBUG_SIGNING_REMAINS_IN_RELEASE');
  }
  return patched;
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('ANDROID_APP_BUILD_GRADLE_PATH_REQUIRED');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchReleaseSigning(source);
  fs.writeFileSync(file, patched);
  console.log(`Patched secure MINBEIS release signing in ${file}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

module.exports = { patchReleaseSigning };

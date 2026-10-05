'use strict';

const assert = require('node:assert/strict');
const { patchReleaseSigning } = require('./patch-release-signing.cjs');

const fixture = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

const patched = patchReleaseSigning(fixture);
assert.match(patched, /MINBEIS_SECURE_RELEASE_SIGNING/);
assert.match(patched, /MINBEIS_RELEASE_STORE_FILE/);
assert.match(patched, /MINBEIS_RELEASE_STORE_PASSWORD/);
assert.match(patched, /MINBEIS_RELEASE_KEY_ALIAS/);
assert.match(patched, /MINBEIS_RELEASE_KEY_PASSWORD/);
assert.match(patched, /release \{[\s\S]*signingConfig signingConfigs\.release[\s\S]*minifyEnabled false/);

const releaseBuildBlock = patched.match(/buildTypes \{[\s\S]*?release \{([\s\S]*?)\n\s*\}\n\s*\}/);
assert.ok(releaseBuildBlock);
assert.doesNotMatch(releaseBuildBlock[1], /signingConfigs\.debug/);

assert.throws(() => patchReleaseSigning(patched), /RELEASE_SIGNING_ALREADY_PATCHED/);
assert.throws(() => patchReleaseSigning('android { buildTypes { release { } } }'), /signingConfigs_BLOCK_NOT_FOUND/);

console.log('Release signing patch PASS: generated Android release is redirected from debug signing to secret-backed upload signing.');

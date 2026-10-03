import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { verifyFirebaseIdToken } from '../src/firebase-token-verifier.js';

const PROJECT='minbeis-test-project';
const NOW=Date.parse('2026-10-03T20:00:00Z');
const NOW_S=Math.floor(NOW/1000);
const ISSUER=`https://securetoken.google.com/${PROJECT}`;

async function fixture(overrides = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const payload = {
    sub:'firebase-user-123',
    aud:PROJECT,
    iss:ISSUER,
    iat:NOW_S-60,
    exp:NOW_S+3600,
    auth_time:NOW_S-120,
    ...overrides,
  };
  const token=await new SignJWT(payload)
    .setProtectedHeader({alg:'RS256',kid:'test-kid'})
    .sign(privateKey);
  return {token,publicKey};
}

test('verifies Firebase-compatible RS256 claims and returns privacy-minimal principal',async()=>{
  const {token,publicKey}=await fixture();
  const principal=await verifyFirebaseIdToken(token,{FIREBASE_PROJECT_ID:PROJECT},{
    now:NOW,
    keyResolver:async(kid)=>{
      assert.equal(kid,'test-kid');
      return publicKey;
    },
  });
  assert.deepEqual(principal,{
    verified:true,
    issuer:ISSUER,
    subject:'firebase-user-123',
    authenticationTime:'2026-10-03T19:58:00.000Z',
  });
  assert.equal(Object.hasOwn(principal,'email'),false);
});

test('rejects wrong audience',async()=>{
  const {token,publicKey}=await fixture({aud:'other-project'});
  await assert.rejects(
    verifyFirebaseIdToken(token,{FIREBASE_PROJECT_ID:PROJECT},{now:NOW,keyResolver:async()=>publicKey}),
    /unexpected "aud" claim value|JWTClaimValidationFailed/i,
  );
});

test('rejects future issued-at and auth-time claims',async()=>{
  const first=await fixture({iat:NOW_S+60});
  await assert.rejects(
    verifyFirebaseIdToken(first.token,{FIREBASE_PROJECT_ID:PROJECT},{now:NOW,keyResolver:async()=>first.publicKey}),
    /FIREBASE_TOKEN_IAT_INVALID/,
  );

  const second=await fixture({auth_time:NOW_S+60});
  await assert.rejects(
    verifyFirebaseIdToken(second.token,{FIREBASE_PROJECT_ID:PROJECT},{now:NOW,keyResolver:async()=>second.publicKey}),
    /FIREBASE_TOKEN_AUTH_TIME_INVALID/,
  );
});

test('fails closed when Firebase project id is absent',async()=>{
  const {token,publicKey}=await fixture();
  await assert.rejects(
    verifyFirebaseIdToken(token,{}, {now:NOW,keyResolver:async()=>publicKey}),
    /FIREBASE_PROJECT_ID_NOT_CONFIGURED/,
  );
});

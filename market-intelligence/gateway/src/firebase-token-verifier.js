import { decodeProtectedHeader, importX509, jwtVerify } from 'jose';

export const MINBEIS_FIREBASE_TOKEN_VERIFIER_VERSION = '2026-10-03.1';
export const FIREBASE_SECURETOKEN_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const certCache = {
  expiresAt: 0,
  keys: new Map(),
};

function clean(value) {
  return String(value || '').trim();
}

function projectIdFromEnv(env = {}) {
  const value = clean(env.FIREBASE_PROJECT_ID);
  return /^[a-z0-9][a-z0-9-]{3,62}[a-z0-9]$/.test(value) ? value : null;
}

function maxAgeSeconds(headers) {
  const value = String(headers?.get?.('cache-control') || '');
  const match = value.match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Math.max(60, Math.min(86_400, Number(match[1]))) : 3_600;
}

async function resolveFirebasePublicKey(kid, options = {}) {
  if (typeof options.keyResolver === 'function') {
    return options.keyResolver(kid);
  }

  const now = Number(options.now ?? Date.now());
  if (certCache.expiresAt > now && certCache.keys.has(kid)) {
    return certCache.keys.get(kid);
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('FIREBASE_CERT_FETCH_UNAVAILABLE');

  const response = await fetchImpl(FIREBASE_SECURETOKEN_CERT_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`FIREBASE_CERT_HTTP_${response.status}`);

  const certificates = await response.json();
  if (!certificates || typeof certificates !== 'object') throw new Error('FIREBASE_CERT_PAYLOAD_INVALID');

  const keys = new Map();
  for (const [certificateKid, certificate] of Object.entries(certificates)) {
    if (!certificateKid || typeof certificate !== 'string' || !certificate.includes('BEGIN CERTIFICATE')) continue;
    keys.set(certificateKid, await importX509(certificate, 'RS256'));
  }

  certCache.keys = keys;
  certCache.expiresAt = now + maxAgeSeconds(response.headers) * 1000;

  const key = keys.get(kid);
  if (!key) throw new Error('FIREBASE_TOKEN_KID_UNKNOWN');
  return key;
}

export async function verifyFirebaseIdToken(idToken, env = {}, options = {}) {
  const token = clean(idToken);
  if (token.length < 20 || token.length > 16_384) throw new Error('FIREBASE_TOKEN_FORMAT_INVALID');

  const projectId = projectIdFromEnv(env);
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID_NOT_CONFIGURED');

  const header = decodeProtectedHeader(token);
  if (header?.alg !== 'RS256') throw new Error('FIREBASE_TOKEN_ALG_INVALID');
  const kid = clean(header?.kid);
  if (!kid) throw new Error('FIREBASE_TOKEN_KID_REQUIRED');

  const key = await resolveFirebasePublicKey(kid, options);
  const now = Number(options.now ?? Date.now());
  const nowSeconds = Math.floor(now / 1000);
  const issuer = `https://securetoken.google.com/${projectId}`;

  const { payload } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer,
    currentDate: new Date(now),
    clockTolerance: 5,
  });

  const subject = clean(payload?.sub);
  if (!subject || subject.length > 128) throw new Error('FIREBASE_TOKEN_SUB_INVALID');

  const issuedAt = Number(payload?.iat);
  if (!Number.isFinite(issuedAt) || issuedAt > nowSeconds + 5) throw new Error('FIREBASE_TOKEN_IAT_INVALID');

  const authTime = Number(payload?.auth_time);
  if (!Number.isFinite(authTime) || authTime > nowSeconds + 5) throw new Error('FIREBASE_TOKEN_AUTH_TIME_INVALID');

  if (payload?.email_verified !== true) throw new Error('FIREBASE_EMAIL_NOT_VERIFIED');

  return {
    verified: true,
    issuer,
    subject,
    authenticationTime: new Date(authTime * 1000).toISOString(),
  };
}

import { deriveTenantId, normalizeInstallationId, normalizeVerifiedPrincipal } from './tenant-contract.js';

export const MINBEIS_AUTH_BOUNDARY_VERSION = '2026-10-03.1';

export function extractBearerToken(request) {
  const header = String(request?.headers?.get?.('Authorization') || '').trim();
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const token = match[1];
  return token.length >= 20 && token.length <= 16_384 ? token : null;
}

export async function authenticatePrivateRequest(request, env = {}, options = {}) {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, status: 401, code: 'AUTH_TOKEN_REQUIRED' };
  }

  const installationId = normalizeInstallationId(
    request.headers.get('X-Investor-Control-Client'),
  );
  if (!installationId) {
    return { ok: false, status: 400, code: 'CLIENT_ID_REQUIRED' };
  }

  const verifier = options.verifyIdentityToken;
  if (typeof verifier !== 'function') {
    return { ok: false, status: 503, code: 'AUTH_PROVIDER_NOT_CONFIGURED' };
  }

  let identity;
  try {
    identity = await verifier(token, env, options);
  } catch {
    return { ok: false, status: 401, code: 'AUTH_TOKEN_INVALID' };
  }
  const principal = normalizeVerifiedPrincipal(identity);
  if (!principal) {
    return { ok: false, status: 401, code: 'AUTH_TOKEN_UNVERIFIED' };
  }

  const tenantSecret = String(env.MINBEIS_TENANT_HMAC_SECRET || '').trim();
  if (tenantSecret.length < 32) {
    return { ok: false, status: 503, code: 'TENANT_SECRET_NOT_CONFIGURED' };
  }

  const tenantId = await deriveTenantId(principal, tenantSecret, options);
  return {
    ok: true,
    tenantId,
    installationId,
    principal: {
      verified: true,
      issuer: principal.issuer,
      subject: principal.subject,
      authenticationTime: principal.authenticationTime,
    },
    subjectStored: false,
    emailStored: false,
  };
}

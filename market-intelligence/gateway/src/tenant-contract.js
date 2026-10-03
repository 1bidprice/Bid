export const MINBEIS_TENANT_CONTRACT_VERSION = '2026-10-03.1';

const ID_PATTERN = /^[A-Za-z0-9:_-]{8,160}$/;
const COLLECTION_PATTERN = /^[a-z][a-z0-9_-]{1,48}$/;

function clean(value) {
  return String(value || '').trim();
}

export function normalizeVerifiedPrincipal(input = {}) {
  const verified = input?.verified === true;
  const issuer = clean(input?.issuer);
  const subject = clean(input?.subject);
  if (!verified || !issuer || !subject) return null;
  if (issuer.length > 240 || subject.length > 240) return null;
  return {
    verified: true,
    issuer,
    subject,
    authenticationTime: input?.authenticationTime || null,
  };
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function deriveTenantId(principalInput, secretInput, options = {}) {
  const principal = normalizeVerifiedPrincipal(principalInput);
  if (!principal) throw new Error('TENANT_VERIFIED_PRINCIPAL_REQUIRED');
  const secret = clean(secretInput);
  if (secret.length < 32) throw new Error('TENANT_HMAC_SECRET_TOO_SHORT');
  const cryptoImpl = options.cryptoImpl || globalThis.crypto;
  if (!cryptoImpl?.subtle) throw new Error('TENANT_CRYPTO_UNAVAILABLE');

  const encoder = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await cryptoImpl.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${principal.issuer}\n${principal.subject}`),
  );
  return `tenant_${bytesToHex(signed).slice(0, 40)}`;
}

export function normalizeInstallationId(value) {
  const id = clean(value);
  return /^[A-Za-z0-9_-]{16,128}$/.test(id) ? id : null;
}

export function tenantResourceKey(tenantIdInput, collectionInput, resourceIdInput) {
  const tenantId = clean(tenantIdInput);
  const collection = clean(collectionInput);
  const resourceId = clean(resourceIdInput);
  if (!/^tenant_[a-f0-9]{40}$/.test(tenantId)) throw new Error('TENANT_ID_INVALID');
  if (!COLLECTION_PATTERN.test(collection)) throw new Error('TENANT_COLLECTION_INVALID');
  if (!ID_PATTERN.test(resourceId)) throw new Error('TENANT_RESOURCE_ID_INVALID');
  return `${tenantId}:${collection}:${resourceId}`;
}

export function assertTenantOwnership(principalTenantId, storedTenantId) {
  const principal = clean(principalTenantId);
  const stored = clean(storedTenantId);
  if (!principal || !stored || principal !== stored) {
    const error = new Error('TENANT_SCOPE_VIOLATION');
    error.code = 'TENANT_SCOPE_VIOLATION';
    throw error;
  }
  return true;
}

export function minimalAccountAudit(principalInput, tenantId, installationId, now = Date.now()) {
  const principal = normalizeVerifiedPrincipal(principalInput);
  const install = normalizeInstallationId(installationId);
  if (!principal || !/^tenant_[a-f0-9]{40}$/.test(String(tenantId || '')) || !install) {
    throw new Error('TENANT_AUDIT_INPUT_INVALID');
  }
  return {
    format: 'minbeis-account-audit',
    version: 1,
    tenantId,
    installationId: install,
    issuer: principal.issuer,
    subjectStored: false,
    emailStored: false,
    portfolioStored: false,
    recordedAt: new Date(now).toISOString(),
  };
}

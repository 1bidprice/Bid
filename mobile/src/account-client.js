import { marketGatewayBaseUrl } from './market-gateway-runtime';
import { minbeisIdToken } from './firebase-auth-client';

export const MINBEIS_ACCOUNT_CLIENT_VERSION = '2026-10-03.1';

function clean(value) {
  return String(value || '').trim();
}

async function accountRequest(path, options = {}) {
  const baseUrl = clean(options.baseUrl || marketGatewayBaseUrl());
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('ACCOUNT_GATEWAY_NOT_CONFIGURED');
  const installationId = clean(options.installationId);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(installationId)) throw new Error('ACCOUNT_INSTALLATION_ID_INVALID');

  const tokenProvider = options.tokenProvider || (() => minbeisIdToken(process.env));
  const token = clean(await tokenProvider());
  if (token.length < 20) throw new Error('ACCOUNT_ID_TOKEN_INVALID');

  const response = await (options.fetchImpl || globalThis.fetch)(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Investor-Control-Client': installationId,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(String(payload?.error?.code || `ACCOUNT_HTTP_${response.status}`));
    error.status = response.status;
    error.gatewayCode = payload?.error?.code || null;
    throw error;
  }
  return payload;
}

export function registerMinbeisDevice(input = {}, options = {}) {
  return accountRequest('/v1/account/device', {
    ...options,
    method: 'POST',
    body: {
      pushToken: input.pushToken,
      platform: input.platform,
      enabled: input.enabled !== false,
      locale: input.locale || null,
    },
  });
}

export function revokeMinbeisDevice(options = {}) {
  return accountRequest('/v1/account/device', { ...options, method: 'DELETE' });
}

export function listMinbeisServerAlerts(options = {}) {
  return accountRequest('/v1/account/alerts', options);
}

export function upsertMinbeisServerAlert(ruleId, input = {}, options = {}) {
  const id = clean(ruleId);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(id)) throw new Error('ACCOUNT_ALERT_RULE_ID_INVALID');
  return accountRequest(`/v1/account/alerts/${encodeURIComponent(id)}`, {
    ...options,
    method: 'PUT',
    body: {
      symbol: input.symbol,
      kind: input.kind,
      threshold: input.threshold,
      enabled: input.enabled !== false,
    },
  });
}

export function deleteMinbeisServerAlert(ruleId, options = {}) {
  const id = clean(ruleId);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(id)) throw new Error('ACCOUNT_ALERT_RULE_ID_INVALID');
  return accountRequest(`/v1/account/alerts/${encodeURIComponent(id)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function deleteMinbeisCloudAccount(options = {}) {
  return accountRequest('/v1/account', { ...options, method: 'DELETE' });
}

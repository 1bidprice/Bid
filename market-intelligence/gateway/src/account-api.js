import {
  accountsDatabase,
  deleteAlertRule,
  deleteTenantData,
  listAlertRules,
  revokeDevice,
  upsertAlertRule,
  upsertDeviceRegistration,
} from './account-repository.js';

export const MINBEIS_ACCOUNT_API_VERSION = '2026-10-03.1';

function response(body, status = 200) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function error(status, code) {
  return response({
    format: 'minbeis-account-api-error',
    version: 1,
    error: { code },
  }, status);
}

async function readJson(request, maxBytes = 16_384) {
  const text = await request.text();
  if (!text || text.length > maxBytes) throw new Error('JSON_BODY_INVALID');
  return JSON.parse(text);
}

function ruleIdFromPath(pathname) {
  const match = pathname.match(/^\/v1\/account\/alerts\/([A-Za-z0-9:_-]{8,160})$/);
  return match ? match[1] : null;
}

export async function handleAccountApiRequest(request, authContext, env = {}, options = {}) {
  if (!authContext?.tenantId || !authContext?.installationId) {
    return error(401, 'AUTH_CONTEXT_REQUIRED');
  }
  const db = options.db || accountsDatabase(env);
  if (!db) return error(503, 'ACCOUNTS_DATABASE_NOT_CONFIGURED');

  const url = new URL(request.url);
  const tenantId = authContext.tenantId;
  const installationId = authContext.installationId;

  if (url.pathname === '/v1/account/device' && request.method === 'POST') {
    let payload;
    try { payload = await readJson(request); } catch { return error(400, 'DEVICE_BODY_INVALID'); }
    const allowed = new Set(['pushToken', 'platform', 'enabled', 'locale']);
    if (Object.keys(payload || {}).some((key) => !allowed.has(key))) {
      return error(400, 'DEVICE_PRIVACY_CONTRACT_INVALID');
    }
    try {
      const result = await upsertDeviceRegistration(db, {
        tenantId,
        installationId,
        pushToken: payload.pushToken,
        platform: payload.platform,
        enabled: payload.enabled,
        locale: payload.locale,
      }, options.now);
      return response({
        format: 'minbeis-device-registration',
        version: 1,
        ...result,
      });
    } catch (cause) {
      return error(400, String(cause?.message || 'DEVICE_REGISTRATION_INVALID'));
    }
  }

  if (url.pathname === '/v1/account/device' && request.method === 'DELETE') {
    await revokeDevice(db, tenantId, installationId);
    return response({
      format: 'minbeis-device-revocation',
      version: 1,
      revoked: true,
    });
  }

  if (url.pathname === '/v1/account/alerts' && request.method === 'GET') {
    const rules = await listAlertRules(db, tenantId);
    return response({
      format: 'minbeis-account-alert-rules',
      version: 1,
      rules,
    });
  }

  const ruleId = ruleIdFromPath(url.pathname);
  if (ruleId && request.method === 'PUT') {
    let payload;
    try { payload = await readJson(request); } catch { return error(400, 'ALERT_BODY_INVALID'); }
    const allowed = new Set(['symbol', 'kind', 'threshold', 'enabled']);
    if (Object.keys(payload || {}).some((key) => !allowed.has(key))) {
      return error(400, 'ALERT_PRIVACY_CONTRACT_INVALID');
    }
    try {
      const rule = await upsertAlertRule(db, {
        tenantId,
        ruleId,
        symbol: payload.symbol,
        kind: payload.kind,
        threshold: payload.threshold,
        enabled: payload.enabled,
      }, options.now);
      return response({
        format: 'minbeis-account-alert-rule',
        version: 1,
        rule: {
          ruleId: rule.ruleId,
          symbol: rule.symbol,
          kind: rule.kind,
          threshold: rule.threshold,
          enabled: rule.enabled,
        },
      });
    } catch (cause) {
      return error(400, String(cause?.message || 'ALERT_RULE_INVALID'));
    }
  }

  if (ruleId && request.method === 'DELETE') {
    await deleteAlertRule(db, tenantId, ruleId);
    return response({
      format: 'minbeis-account-alert-rule-delete',
      version: 1,
      ruleId,
      deleted: true,
    });
  }

  if (url.pathname === '/v1/account' && request.method === 'DELETE') {
    const result = await deleteTenantData(db, tenantId);
    return response({
      format: 'minbeis-account-delete',
      version: 1,
      ...result,
    });
  }

  return error(404, 'ACCOUNT_ROUTE_NOT_FOUND');
}

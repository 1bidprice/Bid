import { normalizePushRegistration, normalizeServerAlertRule } from './push-contract.js';

export const MINBEIS_ACCOUNT_REPOSITORY_VERSION = '2026-10-03.1';

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function accountsDatabase(env = {}) {
  const db = env.MINBEIS_ACCOUNTS_DB;
  return db && typeof db.prepare === 'function' ? db : null;
}

async function run(statement) {
  const result = await statement.run();
  if (result?.success === false) throw new Error('D1_WRITE_FAILED');
  return result;
}

export async function ensureTenant(db, tenantId, now = Date.now()) {
  const at = nowIso(now);
  await run(db.prepare(`
    INSERT INTO tenants (tenant_id, status, created_at, updated_at)
    VALUES (?, 'ACTIVE', ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      status = CASE WHEN tenants.status = 'DELETED' THEN 'DELETED' ELSE 'ACTIVE' END,
      updated_at = excluded.updated_at
  `).bind(tenantId, at, at));
  const row = await db.prepare(
    'SELECT tenant_id, status, created_at, updated_at FROM tenants WHERE tenant_id = ?'
  ).bind(tenantId).first();
  if (!row || row.status !== 'ACTIVE') throw new Error('TENANT_NOT_ACTIVE');
  return row;
}

export async function upsertDeviceRegistration(db, input, now = Date.now()) {
  const registration = normalizePushRegistration(input);
  const at = nowIso(now);
  await ensureTenant(db, registration.tenantId, now);

  if (typeof db.batch === 'function') {
    await db.batch([
      db.prepare('DELETE FROM devices WHERE push_token = ? AND NOT (tenant_id = ? AND installation_id = ?)')
        .bind(registration.pushToken, registration.tenantId, registration.installationId),
      db.prepare(`
        INSERT INTO devices (
          tenant_id, installation_id, push_token, platform, push_enabled, locale, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, installation_id) DO UPDATE SET
          push_token = excluded.push_token,
          platform = excluded.platform,
          push_enabled = excluded.push_enabled,
          locale = excluded.locale,
          updated_at = excluded.updated_at
      `).bind(
        registration.tenantId,
        registration.installationId,
        registration.pushToken,
        registration.platform,
        registration.enabled ? 1 : 0,
        registration.locale,
        at,
        at,
      ),
    ]);
  } else {
    await run(db.prepare('DELETE FROM devices WHERE push_token = ? AND NOT (tenant_id = ? AND installation_id = ?)')
      .bind(registration.pushToken, registration.tenantId, registration.installationId));
    await run(db.prepare(`
      INSERT INTO devices (
        tenant_id, installation_id, push_token, platform, push_enabled, locale, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, installation_id) DO UPDATE SET
        push_token = excluded.push_token,
        platform = excluded.platform,
        push_enabled = excluded.push_enabled,
        locale = excluded.locale,
        updated_at = excluded.updated_at
    `).bind(
      registration.tenantId,
      registration.installationId,
      registration.pushToken,
      registration.platform,
      registration.enabled ? 1 : 0,
      registration.locale,
      at,
      at,
    ));
  }

  return {
    tenantId: registration.tenantId,
    installationId: registration.installationId,
    platform: registration.platform,
    enabled: registration.enabled,
    locale: registration.locale,
    pushTokenStored: true,
    portfolioStored: false,
  };
}

export async function revokeDevice(db, tenantId, installationId) {
  await run(db.prepare(
    'DELETE FROM devices WHERE tenant_id = ? AND installation_id = ?'
  ).bind(tenantId, installationId));
  return { revoked: true };
}

export async function upsertAlertRule(db, input, now = Date.now()) {
  const rule = normalizeServerAlertRule(input);
  const at = nowIso(now);
  await ensureTenant(db, rule.tenantId, now);
  await run(db.prepare(`
    INSERT INTO alert_rules (
      tenant_id, rule_id, symbol, kind, threshold, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, rule_id) DO UPDATE SET
      symbol = excluded.symbol,
      kind = excluded.kind,
      threshold = excluded.threshold,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(
    rule.tenantId,
    rule.ruleId,
    rule.symbol,
    rule.kind,
    rule.threshold,
    rule.enabled ? 1 : 0,
    at,
    at,
  ));
  return rule;
}

export async function listAlertRules(db, tenantId) {
  const result = await db.prepare(`
    SELECT rule_id, symbol, kind, threshold, enabled, created_at, updated_at
    FROM alert_rules
    WHERE tenant_id = ?
    ORDER BY rule_id ASC
  `).bind(tenantId).all();
  return (Array.isArray(result?.results) ? result.results : []).map((row) => ({
    ruleId: row.rule_id,
    symbol: row.symbol,
    kind: row.kind,
    threshold: row.threshold === null || row.threshold === undefined ? null : Number(row.threshold),
    enabled: Number(row.enabled) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function deleteAlertRule(db, tenantId, ruleId) {
  await run(db.prepare(
    'DELETE FROM alert_rules WHERE tenant_id = ? AND rule_id = ?'
  ).bind(tenantId, ruleId));
  return { deleted: true };
}

export async function deleteTenantData(db, tenantId) {
  await run(db.prepare('DELETE FROM tenants WHERE tenant_id = ?').bind(tenantId));
  return {
    deleted: true,
    cascadeExpected: true,
    portfolioDeletedFromCloud: false,
    reason: 'PORTFOLIO_NOT_STORED_IN_ACCOUNT_DATABASE',
  };
}

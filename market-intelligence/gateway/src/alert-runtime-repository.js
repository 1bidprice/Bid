export const MINBEIS_ALERT_RUNTIME_REPOSITORY_VERSION = '2026-10-04.1';

function iso(now = Date.now()) {
  return new Date(now).toISOString();
}

function boundedLimit(value, fallback = 500, max = 2000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

async function run(statement) {
  const result = await statement.run();
  if (result?.success === false) throw new Error('D1_WRITE_FAILED');
  return result;
}

export async function listEnabledAlertEvaluationRows(db, limit = 500) {
  const safeLimit = boundedLimit(limit, 500, 2000);
  const result = await db.prepare(`
    SELECT
      r.tenant_id,
      r.rule_id,
      r.symbol,
      r.kind,
      r.threshold,
      s.last_condition,
      s.last_observed_value,
      s.last_evaluated_at,
      s.last_triggered_at
    FROM alert_rules r
    INNER JOIN tenants t
      ON t.tenant_id = r.tenant_id
    LEFT JOIN alert_state s
      ON s.tenant_id = r.tenant_id
      AND s.rule_id = r.rule_id
    WHERE r.enabled = 1
      AND t.status = 'ACTIVE'
    ORDER BY r.tenant_id ASC, r.rule_id ASC
    LIMIT ${safeLimit}
  `).all();

  return (Array.isArray(result?.results) ? result.results : []).map((row) => ({
    tenantId: row.tenant_id,
    ruleId: row.rule_id,
    symbol: row.symbol,
    kind: row.kind,
    threshold: row.threshold === null || row.threshold === undefined ? null : Number(row.threshold),
    lastCondition: row.last_condition === null || row.last_condition === undefined ? null : Number(row.last_condition) === 1,
    lastObservedValue: row.last_observed_value === null || row.last_observed_value === undefined ? null : Number(row.last_observed_value),
    lastEvaluatedAt: row.last_evaluated_at || null,
    lastTriggeredAt: row.last_triggered_at || null,
  }));
}

export async function listEnabledPushDevices(db, tenantIds = []) {
  const clean = [...new Set((Array.isArray(tenantIds) ? tenantIds : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^tenant_[a-f0-9]{40}$/.test(value)))];
  if (!clean.length) return [];
  const placeholders = clean.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT tenant_id, installation_id, push_token, platform, locale
    FROM devices
    WHERE push_enabled = 1
      AND push_token IS NOT NULL
      AND tenant_id IN (${placeholders})
    ORDER BY tenant_id ASC, installation_id ASC
  `).bind(...clean).all();

  return (Array.isArray(result?.results) ? result.results : []).map((row) => ({
    tenantId: row.tenant_id,
    installationId: row.installation_id,
    pushToken: row.push_token,
    platform: row.platform,
    locale: row.locale || null,
  }));
}

export async function saveAlertEvaluationState(db, input = {}, now = Date.now()) {
  const tenantId = String(input.tenantId || '').trim();
  const ruleId = String(input.ruleId || '').trim();
  if (!/^tenant_[a-f0-9]{40}$/.test(tenantId)) throw new Error('ALERT_STATE_TENANT_INVALID');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(ruleId)) throw new Error('ALERT_STATE_RULE_INVALID');
  const lastCondition = input.lastCondition === null || input.lastCondition === undefined
    ? null
    : input.lastCondition === true ? 1 : 0;
  const lastObservedValue = input.lastObservedValue === null || input.lastObservedValue === undefined
    ? null
    : Number(input.lastObservedValue);
  if (lastObservedValue !== null && !Number.isFinite(lastObservedValue)) throw new Error('ALERT_STATE_VALUE_INVALID');
  const evaluatedAt = input.lastEvaluatedAt || iso(now);
  const triggeredAt = input.lastTriggeredAt || null;

  await run(db.prepare(`
    INSERT INTO alert_state (
      tenant_id, rule_id, last_condition, last_observed_value, last_evaluated_at, last_triggered_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, rule_id) DO UPDATE SET
      last_condition = excluded.last_condition,
      last_observed_value = excluded.last_observed_value,
      last_evaluated_at = excluded.last_evaluated_at,
      last_triggered_at = excluded.last_triggered_at
  `).bind(
    tenantId,
    ruleId,
    lastCondition,
    lastObservedValue,
    evaluatedAt,
    triggeredAt,
  ));
}

export async function revokePushDevice(db, tenantId, installationId) {
  await run(db.prepare(`
    UPDATE devices
    SET push_enabled = 0, push_token = NULL, updated_at = ?
    WHERE tenant_id = ? AND installation_id = ?
  `).bind(iso(), tenantId, installationId));
  return { revoked: true };
}

export async function recordPushDeliveries(db, deliveries = [], now = Date.now()) {
  const at = iso(now);
  const valid = (Array.isArray(deliveries) ? deliveries : []).filter((item) => (
    /^[A-Za-z0-9-]{8,128}$/.test(String(item?.ticketId || ''))
    && /^tenant_[a-f0-9]{40}$/.test(String(item?.tenantId || ''))
    && /^[A-Za-z0-9_-]{16,128}$/.test(String(item?.installationId || ''))
    && /^[A-Za-z0-9:_-]{8,160}$/.test(String(item?.ruleId || ''))
    && /^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(String(item?.symbol || '').toUpperCase())
    && ['PRICE_ABOVE','PRICE_BELOW','DAILY_PCT','MINBEIS_DECISION_CHANGE'].includes(String(item?.kind || '').toUpperCase())
  ));
  if (!valid.length) return { recorded: 0 };

  const statements = valid.map((item) => db.prepare(`
    INSERT INTO push_deliveries (
      ticket_id, tenant_id, installation_id, rule_id, symbol, kind, status, error_code, created_at, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, NULL)
    ON CONFLICT(ticket_id) DO NOTHING
  `).bind(
    String(item.ticketId),
    String(item.tenantId),
    String(item.installationId),
    String(item.ruleId),
    String(item.symbol).toUpperCase(),
    String(item.kind).toUpperCase(),
    at,
  ));

  if (typeof db.batch === 'function') {
    const results = await db.batch(statements);
    if (results?.some((result) => result?.success === false)) throw new Error('D1_WRITE_FAILED');
  } else {
    for (const statement of statements) await run(statement);
  }
  return { recorded: valid.length };
}

export async function listPendingPushDeliveries(db, limit = 1000) {
  const safeLimit = boundedLimit(limit, 1000, 1000);
  const result = await db.prepare(`
    SELECT ticket_id, tenant_id, installation_id, rule_id, symbol, kind, created_at
    FROM push_deliveries
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT ${safeLimit}
  `).all();
  return (Array.isArray(result?.results) ? result.results : []).map((row) => ({
    ticketId: row.ticket_id,
    tenantId: row.tenant_id,
    installationId: row.installation_id,
    ruleId: row.rule_id,
    symbol: row.symbol,
    kind: row.kind,
    createdAt: row.created_at,
  }));
}

export async function resolvePushDelivery(db, ticketId, status, errorCode = null, now = Date.now()) {
  const id = String(ticketId || '').trim();
  const normalized = String(status || '').trim().toUpperCase();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new Error('PUSH_DELIVERY_TICKET_INVALID');
  if (!['OK','ERROR'].includes(normalized)) throw new Error('PUSH_DELIVERY_STATUS_INVALID');
  await run(db.prepare(`
    UPDATE push_deliveries
    SET status = ?, error_code = ?, checked_at = ?
    WHERE ticket_id = ?
  `).bind(normalized, errorCode ? String(errorCode).slice(0, 80) : null, iso(now), id));
}

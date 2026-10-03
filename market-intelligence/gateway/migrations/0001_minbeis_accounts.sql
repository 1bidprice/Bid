-- MINBEIS account/device/alert metadata only.
-- Portfolio quantities, cost basis, P/L and notes are intentionally excluded.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','DELETED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  tenant_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  push_token TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios')),
  push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (push_enabled IN (0,1)),
  locale TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, installation_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_push_token
  ON devices(push_token)
  WHERE push_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS alert_rules (
  tenant_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PRICE_ABOVE','PRICE_BELOW','DAILY_PCT','MINBEIS_DECISION_CHANGE')),
  threshold REAL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, rule_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  CHECK (
    (kind = 'MINBEIS_DECISION_CHANGE' AND threshold IS NULL)
    OR
    (kind != 'MINBEIS_DECISION_CHANGE' AND threshold > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_symbol_enabled
  ON alert_rules(symbol, enabled);

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_enabled
  ON alert_rules(tenant_id, enabled);

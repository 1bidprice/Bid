-- MINBEIS remote-alert runtime metadata only.
-- No portfolio quantities, cost basis, P/L or notes are stored.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS alert_state (
  tenant_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  last_condition INTEGER CHECK (last_condition IN (0,1) OR last_condition IS NULL),
  last_observed_value REAL,
  last_evaluated_at TEXT,
  last_triggered_at TEXT,
  last_trigger_signature TEXT,
  PRIMARY KEY (tenant_id, rule_id),
  FOREIGN KEY (tenant_id, rule_id)
    REFERENCES alert_rules(tenant_id, rule_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_deliveries (
  ticket_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','OK','ERROR')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  checked_at TEXT,
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES devices(tenant_id, installation_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, rule_id)
    REFERENCES alert_rules(tenant_id, rule_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alert_state_evaluated
  ON alert_state(last_evaluated_at);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_pending
  ON push_deliveries(status, created_at);

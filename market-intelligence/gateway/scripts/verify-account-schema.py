#!/usr/bin/env python3
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "migrations" / "0001_minbeis_accounts.sql"

sql = SCHEMA.read_text(encoding="utf-8")
for forbidden in (
    "portfolio_quantity",
    "cost_basis",
    "total_pnl",
    "transaction_notes",
    "broker_credentials",
):
    if forbidden in sql.lower():
        raise SystemExit(f"Forbidden cloud portfolio field found in schema: {forbidden}")

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(sql)

tables = {
    row[0]
    for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
}
required = {"tenants", "devices", "alert_rules"}
missing = required - tables
if missing:
    raise SystemExit(f"Missing account schema tables: {sorted(missing)}")

columns = {}
for table in required:
    columns[table] = {
        row[1]
        for row in db.execute(f"PRAGMA table_info({table})")
    }

if "tenant_id" not in columns["devices"] or "tenant_id" not in columns["alert_rules"]:
    raise SystemExit("Tenant isolation key missing from private child tables")

if {"quantity", "cost_basis", "pnl", "notes"} & columns["devices"]:
    raise SystemExit("Portfolio fields must not exist in devices")
if {"quantity", "cost_basis", "pnl", "notes"} & columns["alert_rules"]:
    raise SystemExit("Portfolio fields must not exist in alert_rules")

db.execute(
    "INSERT INTO tenants (tenant_id,status,created_at,updated_at) VALUES (?,?,?,?)",
    ("tenant_" + "a"*40, "ACTIVE", "2026-10-03T00:00:00Z", "2026-10-03T00:00:00Z"),
)
db.execute(
    "INSERT INTO devices (tenant_id,installation_id,push_token,platform,push_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ("tenant_" + "a"*40, "install_0123456789abcdef", "ExpoPushToken[" + "A"*24 + "]", "android", 1, "x", "x"),
)
db.execute(
    "INSERT INTO alert_rules (tenant_id,rule_id,symbol,kind,threshold,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ("tenant_" + "a"*40, "rule_01234567", "SPCE.US", "PRICE_BELOW", 2.5, 1, "x", "x"),
)

try:
    db.execute(
        "INSERT INTO alert_rules (tenant_id,rule_id,symbol,kind,threshold,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ("tenant_" + "b"*40, "rule_99999999", "SPCE.US", "PRICE_BELOW", 2.5, 1, "x", "x"),
    )
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Foreign-key tenant isolation failed: orphan alert was accepted")

db.execute("DELETE FROM tenants WHERE tenant_id = ?", ("tenant_" + "a"*40,))
device_count = db.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
alert_count = db.execute("SELECT COUNT(*) FROM alert_rules").fetchone()[0]
if device_count or alert_count:
    raise SystemExit("Tenant cascade deletion failed")

print("Account schema PASS: tenant foreign keys, cascade deletion, alert constraints, and no portfolio holdings/P&L fields.")

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const positive = (value) => finite(value) && Number(value) > 0;

export const ACCOUNTING_VERSION = 2;

export const roundMoney = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function rawExecutionPrice(transaction) {
  if (positive(transaction?.executionPrice)) return Number(transaction.executionPrice);
  if (positive(transaction?.price)) return Number(transaction.price);
  return 0;
}

function providedTotal(transaction) {
  if (!finite(transaction?.total) || Number(transaction.total) < 0) return null;
  return roundMoney(transaction.total);
}

function grossFromTotal(type, total, fees) {
  if (total === null) return null;
  if (type === 'sell') return roundMoney(total + fees);
  const gross = roundMoney(total - fees);
  return gross >= 0 ? gross : null;
}

function safeText(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function canonicalType(value) {
  return value === 'sell' ? 'sell' : 'buy';
}

function canonicalCurrency(value) {
  const explicit = safeText(value).toUpperCase();
  return explicit === 'USD' || explicit === 'EUR' ? explicit : null;
}

export function normalizeFeeBreakdown(input, legacyFees = 0) {
  const source =
    input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const breakdown = {
    commission: positive(source.commission) ? Number(source.commission) : 0,
    transfer: positive(source.transfer) ? Number(source.transfer) : 0,
    clearing: positive(source.clearing) ? Number(source.clearing) : 0,
    exchange: positive(source.exchange) ? Number(source.exchange) : 0,
    taxes: positive(source.taxes) ? Number(source.taxes) : 0,
    other: positive(source.other) ? Number(source.other) : 0,
  };
  const detailedTotal = Object.values(breakdown).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (detailedTotal <= 0 && positive(legacyFees)) breakdown.other = Number(legacyFees);
  return breakdown;
}

export function transactionFees(transaction) {
  const breakdown = normalizeFeeBreakdown(
    transaction?.feeBreakdown,
    transaction?.fees,
  );
  return roundMoney(
    Object.values(breakdown).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    ),
  );
}

/**
 * Canonical cash invariant:
 * - broker/settlement total is authoritative when it exists;
 * - fees reconcile that total back to gross consideration;
 * - explicit gross is the next source of truth;
 * - execution price is used only when no authoritative cash amount exists.
 */
export function transactionGross(transaction) {
  const fees = transactionFees(transaction);
  const total = providedTotal(transaction);
  const fromTotal = grossFromTotal(canonicalType(transaction?.type), total, fees);
  if (fromTotal !== null) return fromTotal;
  if (positive(transaction?.grossAmount)) return roundMoney(transaction.grossAmount);
  const quantity = Number(transaction?.quantity || 0);
  return roundMoney(quantity * rawExecutionPrice(transaction));
}

/**
 * Execution price is a derived value whenever the stored price cannot
 * reproduce the authoritative gross amount to currency-cent precision.
 * This preserves a broker-provided price when it is already consistent
 * with the authoritative gross amount, while repairing rounded legacy
 * prices that no longer reconcile to the stored settlement cash amount.
 */
export function transactionExecutionPrice(transaction) {
  const quantity = Number(transaction?.quantity || 0);
  if (!positive(quantity)) return 0;
  const gross = transactionGross(transaction);
  const candidate = rawExecutionPrice(transaction);
  if (positive(candidate) && roundMoney(quantity * candidate) === gross) return candidate;
  return gross > 0 ? gross / quantity : candidate;
}

export function transactionOrderPrice(transaction) {
  if (positive(transaction?.orderPrice)) return Number(transaction.orderPrice);
  return null;
}

export function transactionTotal(transaction) {
  const total = providedTotal(transaction);
  if (total !== null) return total;
  const gross = transactionGross(transaction);
  const fees = transactionFees(transaction);
  return canonicalType(transaction?.type) === 'sell'
    ? roundMoney(Math.max(0, gross - fees))
    : roundMoney(gross + fees);
}

export function allInPrice(transaction) {
  const quantity = Number(transaction?.quantity || 0);
  return quantity > 0 ? transactionTotal(transaction) / quantity : 0;
}

export function accountingInvariantReport(transaction) {
  const quantity = Number(transaction?.quantity || 0);
  const executionPrice = transactionExecutionPrice(transaction);
  const gross = transactionGross(transaction);
  const fees = transactionFees(transaction);
  const total = transactionTotal(transaction);
  const grossFromPrice = positive(quantity) && positive(executionPrice)
    ? roundMoney(quantity * executionPrice)
    : null;
  const totalFromGross = canonicalType(transaction?.type) === 'sell'
    ? roundMoney(Math.max(0, gross - fees))
    : roundMoney(gross + fees);
  const grossMatchesPrice = grossFromPrice !== null && grossFromPrice === gross;
  const totalMatchesGrossFees = totalFromGross === total;
  return {
    ok: grossMatchesPrice && totalMatchesGrossFees,
    quantity,
    executionPrice,
    gross,
    fees,
    total,
    allInPrice: positive(quantity) ? total / quantity : 0,
    grossFromPrice,
    totalFromGross,
    grossMatchesPrice,
    totalMatchesGrossFees,
  };
}

export function normalizeTransaction(transaction) {
  const initial = transaction && typeof transaction === 'object' && !Array.isArray(transaction) ? transaction : {};
  const migrated = initial;
  const symbol = safeText(migrated.symbol).toUpperCase();
  const type = canonicalType(migrated.type);
  const quantity = positive(migrated.quantity) ? Number(migrated.quantity) : 0;
  const currency = canonicalCurrency(migrated.currency);
  const company = safeText(migrated.company, symbol) || symbol;
  const date = safeText(migrated.date);
  const broker = safeText(migrated.broker);
  const orderReference = safeText(migrated.orderReference);
  const settlementReference = safeText(migrated.settlementReference);
  const notes = safeText(migrated.notes);
  const migrationNote = safeText(migrated.migrationNote);
  const createdAt = safeText(migrated.createdAt);
  const updatedAt = safeText(migrated.updatedAt);

  const sanitized = {
    ...migrated,
    type,
    symbol,
    company,
    date,
    quantity,
    currency,
    broker,
    orderReference,
    settlementReference,
    notes,
    migrationNote,
    createdAt,
    updatedAt,
  };

  const feeBreakdown = normalizeFeeBreakdown(sanitized.feeBreakdown, sanitized.fees);
  const fees = roundMoney(
    Object.values(feeBreakdown).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    ),
  );
  const working = { ...sanitized, feeBreakdown, fees };
  const grossAmount = transactionGross(working);
  const total = transactionTotal({ ...working, grossAmount });
  const executionPrice = transactionExecutionPrice({ ...working, grossAmount, total });
  const id = safeText(sanitized.id)
    || `legacy-${symbol || 'UNKNOWN'}-${date || 'NO_DATE'}-${type}-${quantity}-${total}-${orderReference || createdAt || '0'}`;

  return {
    ...sanitized,
    id,
    accountingVersion: ACCOUNTING_VERSION,
    executionPrice,
    price: executionPrice,
    orderPrice: positive(sanitized.orderPrice) ? Number(sanitized.orderPrice) : null,
    grossAmount,
    feeBreakdown,
    fees,
    total,
  };
}

export function normalizeTransactions(transactions) {
  return (Array.isArray(transactions) ? transactions : [])
    .map(normalizeTransaction)
    .filter(
      (transaction) => transaction.symbol && positive(transaction.quantity),
    );
}

export function buildTransaction(form, existing = null) {
  const quantity = Number(form.quantity || 0);
  const executionPrice = Number(form.executionPrice || 0);
  const orderPrice = positive(form.orderPrice) ? Number(form.orderPrice) : null;
  const feeBreakdown = normalizeFeeBreakdown(form.feeBreakdown);
  const fees = roundMoney(
    Object.values(feeBreakdown).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    ),
  );
  const calculatedGross = roundMoney(quantity * executionPrice);
  const grossAmount = positive(form.grossAmount)
    ? roundMoney(form.grossAmount)
    : calculatedGross;
  const type = form.type === 'sell' ? 'sell' : 'buy';
  const total =
    type === 'sell'
      ? roundMoney(Math.max(0, grossAmount - fees))
      : roundMoney(grossAmount + fees);

  return normalizeTransaction({
    ...(existing || {}),
    id:
      existing?.id ||
      `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    symbol: String(form.symbol || '')
      .trim()
      .toUpperCase(),
    company:
      String(form.company || '').trim() ||
      String(form.symbol || '')
        .trim()
        .toUpperCase(),
    date: String(form.date || ''),
    quantity,
    currency: form.currency === 'USD' ? 'USD' : 'EUR',
    orderPrice,
    executionPrice,
    price: executionPrice,
    grossAmount,
    feeBreakdown,
    fees,
    total,
    broker: String(form.broker || '').trim(),
    orderReference: String(form.orderReference || '').trim(),
    notes: String(form.notes || '').trim(),
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
}

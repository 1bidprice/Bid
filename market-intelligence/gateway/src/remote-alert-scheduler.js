import { accountsDatabase } from './account-repository.js';
import {
  listEnabledAlertEvaluationRows,
  listEnabledPushDevices,
  listPendingPushDeliveries,
  recordPushDeliveries,
  resolvePushDelivery,
  revokePushDevice,
  saveAlertEvaluationState,
} from './alert-runtime-repository.js';
import { buildPrivacySafePushMessage } from './push-contract.js';
import { fetchExpoPushReceipts, sendExpoPushMessages } from './expo-push-transport.js';
import { resolveCanonicalGatewayQuote, resolveDynamicAthensCompanies } from './core.js';

export const MINBEIS_REMOTE_ALERT_SCHEDULER_VERSION = '2026-10-04.1';

const finite = (value) => Number.isFinite(Number(value));
const positive = (value) => finite(value) && Number(value) > 0;

function nowMs(value = Date.now()) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Date.now();
}

function ageMinutes(value, now) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? Math.max(0, (now - time) / 60_000) : null;
}

function bounded(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

export function evaluateRemoteAlertRule(rule = {}, quote = {}) {
  const kind = String(rule.kind || '').trim().toUpperCase();
  const threshold = Number(rule.threshold);
  const price = Number(quote?.price);
  if (quote?.quoteContract?.valuationEligible !== true || !positive(price)) {
    return { supported: false, code: 'QUOTE_NOT_VALUATION_ELIGIBLE' };
  }

  if (kind === 'PRICE_ABOVE') {
    if (!positive(threshold)) return { supported: false, code: 'ALERT_THRESHOLD_INVALID' };
    return { supported: true, value: price, condition: price >= threshold, triggerSignature: null };
  }

  if (kind === 'PRICE_BELOW') {
    if (!positive(threshold)) return { supported: false, code: 'ALERT_THRESHOLD_INVALID' };
    return { supported: true, value: price, condition: price <= threshold, triggerSignature: null };
  }

  if (kind === 'DAILY_PCT') {
    const previousClose = Number(quote?.previousClose);
    if (
      !positive(threshold)
      || !positive(previousClose)
      || quote?.quoteContract?.dayChangeEligible !== true
    ) {
      return { supported: false, code: 'DAILY_CHANGE_NOT_ELIGIBLE' };
    }
    const changePct = ((price - previousClose) / previousClose) * 100;
    const day = String(quote?.quoteAt || quote?.checkedAt || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return { supported: false, code: 'DAILY_CHANGE_DATE_UNAVAILABLE' };
    }
    return {
      supported: true,
      value: changePct,
      condition: Math.abs(changePct) >= threshold,
      triggerSignature: `DAILY_PCT:${day}`,
    };
  }

  return { supported: false, code: kind === 'MINBEIS_DECISION_CHANGE' ? 'DECISION_CHANGE_SOURCE_NOT_WIRED' : 'ALERT_KIND_UNSUPPORTED' };
}

export function shouldTriggerRemoteAlert(rule = {}, evaluation = {}, now = Date.now(), cooldownMinutes = 30) {
  if (!evaluation?.supported || evaluation.condition !== true) return false;
  const cooldown = Math.max(0, Number(cooldownMinutes || 0));
  const lastTriggeredAge = ageMinutes(rule.lastTriggeredAt, now);
  if (lastTriggeredAge !== null && lastTriggeredAge < cooldown) return false;

  if (String(rule.kind || '').toUpperCase() === 'DAILY_PCT') {
    return Boolean(evaluation.triggerSignature)
      && evaluation.triggerSignature !== rule.lastTriggerSignature;
  }

  // Price alerts establish a baseline first and only trigger on a false -> true crossing.
  return rule.lastCondition === false;
}

async function processPendingReceipts(db, options, now) {
  const pending = await listPendingPushDeliveries(db, options.receiptLimit || 1000);
  if (!pending.length) return { pending: 0, resolved: 0, invalidatedDevices: 0 };

  const ids = pending.map((item) => item.ticketId);
  const receiptsResult = await fetchExpoPushReceipts(ids, {
    fetchImpl: options.fetchImpl,
    accessToken: options.expoAccessToken,
    maxAttempts: options.pushMaxAttempts,
    sleep: options.sleep,
  });
  const byId = new Map(pending.map((item) => [item.ticketId, item]));
  let resolved = 0;
  let invalidatedDevices = 0;

  for (const [ticketId, receipt] of Object.entries(receiptsResult.receipts || {})) {
    const delivery = byId.get(ticketId);
    if (!delivery) continue;
    if (receipt?.status === 'ok') {
      await resolvePushDelivery(db, ticketId, 'OK', null, now);
      resolved += 1;
      continue;
    }
    if (receipt?.status === 'error') {
      const code = String(receipt?.details?.error || receipt?.message || 'PUSH_RECEIPT_ERROR');
      await resolvePushDelivery(db, ticketId, 'ERROR', code, now);
      resolved += 1;
      if (code === 'DeviceNotRegistered') {
        await revokePushDevice(db, delivery.tenantId, delivery.installationId);
        invalidatedDevices += 1;
      }
    }
  }

  for (const delivery of pending) {
    if ((receiptsResult.receipts || {})[delivery.ticketId]) continue;
    const age = ageMinutes(delivery.createdAt, now);
    if (age !== null && age >= 24 * 60) {
      await resolvePushDelivery(db, delivery.ticketId, 'ERROR', 'PUSH_RECEIPT_TIMEOUT', now);
      resolved += 1;
    }
  }

  return { pending: pending.length, resolved, invalidatedDevices };
}

export async function runRemoteAlertCycle(env = {}, options = {}) {
  if (String(env.MINBEIS_REMOTE_ALERTS_ENABLED || '').toLowerCase() !== 'true') {
    return { status: 'DISABLED', version: MINBEIS_REMOTE_ALERT_SCHEDULER_VERSION };
  }

  const db = options.db || accountsDatabase(env);
  if (!db) return { status: 'BLOCKED', code: 'ACCOUNTS_DATABASE_NOT_CONFIGURED' };

  const now = nowMs(options.now ?? Date.now());
  const nowIso = new Date(now).toISOString();
  const cooldownMinutes = bounded(env.MINBEIS_ALERT_COOLDOWN_MINUTES, 30, 0, 24 * 60);
  const ruleLimit = bounded(env.MINBEIS_ALERT_RULES_PER_CYCLE, 500, 1, 2000);
  const concurrency = bounded(env.MINBEIS_ALERT_QUOTE_CONCURRENCY, 6, 1, 10);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const receiptSummary = await processPendingReceipts(db, {
    ...options,
    expoAccessToken: options.expoAccessToken || env.EXPO_ACCESS_TOKEN,
  }, now).catch((error) => ({
    pending: 0,
    resolved: 0,
    invalidatedDevices: 0,
    error: String(error?.message || error),
  }));

  const rules = await listEnabledAlertEvaluationRows(db, ruleLimit);
  if (!rules.length) {
    return {
      status: 'OK',
      evaluatedRules: 0,
      triggeredRules: 0,
      sentMessages: 0,
      receiptSummary,
    };
  }

  const symbols = [...new Set(rules.map((rule) => String(rule.symbol || '').toUpperCase()).filter(Boolean))];
  const greekSymbols = symbols.filter((symbol) => symbol.endsWith('.GR')).map((symbol) => symbol.slice(0, -3));
  let athensCompanies = new Map();
  if (greekSymbols.length) {
    const identity = await resolveDynamicAthensCompanies(greekSymbols, {
      fetchImpl,
      now: nowIso,
      identityNow: now,
      athensIdentityCache: options.athensIdentityCache,
      athensDiscoveryOptions: options.athensDiscoveryOptions,
    });
    athensCompanies = identity.companies;
  }

  const quotePairs = await mapWithConcurrency(symbols, concurrency, async (symbol) => {
    const parsedMarket = symbol.endsWith('.GR') ? 'GR' : symbol.endsWith('.US') ? 'US' : null;
    if (!parsedMarket) return [symbol, null];
    const result = await resolveCanonicalGatewayQuote(symbol, env, {
      fetchImpl,
      now: nowIso,
      ...(parsedMarket === 'GR' ? {
        dynamicAthensCompanies: athensCompanies,
        athensIdentityResolutionComplete: true,
        athensIdentityCache: options.athensIdentityCache,
      } : {}),
    });
    return [symbol, result?.status === 200 ? result.body.quote : null];
  });
  const quotes = new Map(quotePairs);

  const triggerCandidates = [];
  let evaluatedRules = 0;

  for (const rule of rules) {
    const quote = quotes.get(rule.symbol) || null;
    const evaluation = evaluateRemoteAlertRule(rule, quote);
    if (!evaluation.supported) continue;
    evaluatedRules += 1;
    const trigger = shouldTriggerRemoteAlert(rule, evaluation, now, cooldownMinutes);

    if (!trigger) {
      await saveAlertEvaluationState(db, {
        tenantId: rule.tenantId,
        ruleId: rule.ruleId,
        lastCondition: evaluation.condition,
        lastObservedValue: evaluation.value,
        lastEvaluatedAt: nowIso,
        lastTriggeredAt: rule.lastTriggeredAt,
        lastTriggerSignature: rule.lastTriggerSignature,
      }, now);
      continue;
    }

    triggerCandidates.push({ rule, evaluation });
  }

  if (!triggerCandidates.length) {
    return {
      status: 'OK',
      evaluatedRules,
      triggeredRules: 0,
      sentMessages: 0,
      receiptSummary,
    };
  }

  const tenantIds = [...new Set(triggerCandidates.map((item) => item.rule.tenantId))];
  const devices = await listEnabledPushDevices(db, tenantIds);
  const devicesByTenant = new Map();
  for (const device of devices) {
    if (!devicesByTenant.has(device.tenantId)) devicesByTenant.set(device.tenantId, []);
    devicesByTenant.get(device.tenantId).push(device);
  }

  const envelopes = [];
  const candidatesWithoutDevices = [];
  for (const candidate of triggerCandidates) {
    const tenantDevices = devicesByTenant.get(candidate.rule.tenantId) || [];
    if (!tenantDevices.length) {
      candidatesWithoutDevices.push(candidate);
      continue;
    }
    const content = buildPrivacySafePushMessage({
      symbol: candidate.rule.symbol,
      kind: candidate.rule.kind,
    });
    for (const device of tenantDevices) {
      envelopes.push({
        tenantId: candidate.rule.tenantId,
        installationId: device.installationId,
        ruleId: candidate.rule.ruleId,
        symbol: candidate.rule.symbol,
        kind: candidate.rule.kind,
        token: device.pushToken,
        message: {
          to: device.pushToken,
          title: content.title,
          body: content.body,
          data: content.data,
          channelId: 'price-alerts',
        },
      });
    }
  }

  for (const candidate of candidatesWithoutDevices) {
    await saveAlertEvaluationState(db, {
      tenantId: candidate.rule.tenantId,
      ruleId: candidate.rule.ruleId,
      lastCondition: candidate.evaluation.condition,
      lastObservedValue: candidate.evaluation.value,
      lastEvaluatedAt: nowIso,
      lastTriggeredAt: candidate.rule.lastTriggeredAt,
      lastTriggerSignature: candidate.rule.lastTriggerSignature,
    }, now);
  }

  if (!envelopes.length) {
    return {
      status: 'OK',
      evaluatedRules,
      triggeredRules: triggerCandidates.length,
      sentMessages: 0,
      receiptSummary,
    };
  }

  let sendResult;
  try {
    sendResult = await sendExpoPushMessages(envelopes.map((item) => item.message), {
      fetchImpl,
      accessToken: options.expoAccessToken || env.EXPO_ACCESS_TOKEN,
      maxAttempts: options.pushMaxAttempts,
      sleep: options.sleep,
    });
  } catch (error) {
    // Leave crossing rules in their previous state so a transient transport failure can retry.
    return {
      status: 'RETRYABLE_PUSH_FAILURE',
      code: String(error?.message || 'PUSH_SEND_FAILED'),
      evaluatedRules,
      triggeredRules: triggerCandidates.length,
      sentMessages: 0,
      receiptSummary,
    };
  }

  const acceptedRuleKeys = new Set();
  const deliveries = [];
  for (let index = 0; index < (sendResult.tickets || []).length; index += 1) {
    const ticket = sendResult.tickets[index] || {};
    const envelope = envelopes[index];
    if (!envelope) continue;
    if (ticket.status === 'ok' && /^[A-Za-z0-9-]{8,128}$/.test(String(ticket.id || ''))) {
      acceptedRuleKeys.add(`${envelope.tenantId}|${envelope.ruleId}`);
      deliveries.push({
        ticketId: ticket.id,
        tenantId: envelope.tenantId,
        installationId: envelope.installationId,
        ruleId: envelope.ruleId,
        symbol: envelope.symbol,
        kind: envelope.kind,
      });
    }
  }
  await recordPushDeliveries(db, deliveries, now);

  for (const invalidToken of sendResult.invalidTokens || []) {
    for (const envelope of envelopes.filter((item) => item.token === invalidToken)) {
      await revokePushDevice(db, envelope.tenantId, envelope.installationId);
    }
  }

  for (const candidate of triggerCandidates) {
    const accepted = acceptedRuleKeys.has(`${candidate.rule.tenantId}|${candidate.rule.ruleId}`);
    await saveAlertEvaluationState(db, {
      tenantId: candidate.rule.tenantId,
      ruleId: candidate.rule.ruleId,
      lastCondition: accepted ? candidate.evaluation.condition : candidate.rule.lastCondition,
      lastObservedValue: accepted ? candidate.evaluation.value : candidate.rule.lastObservedValue,
      lastEvaluatedAt: nowIso,
      lastTriggeredAt: accepted ? nowIso : candidate.rule.lastTriggeredAt,
      lastTriggerSignature: accepted
        ? (candidate.evaluation.triggerSignature || candidate.rule.lastTriggerSignature)
        : candidate.rule.lastTriggerSignature,
    }, now);
  }

  return {
    status: 'OK',
    evaluatedRules,
    triggeredRules: triggerCandidates.length,
    acceptedTriggeredRules: acceptedRuleKeys.size,
    sentMessages: Number(sendResult.sentMessageCount || 0),
    deliveryTicketsRecorded: deliveries.length,
    invalidTokens: (sendResult.invalidTokens || []).length,
    receiptSummary,
  };
}

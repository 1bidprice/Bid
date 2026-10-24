import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRemoteAlertRule,
  runRemoteAlertCycle,
  shouldTriggerRemoteAlert,
} from '../gateway/src/remote-alert-scheduler.js';

function quote(price, previousClose = 100, extra = {}) {
  return {
    appSymbol: 'TEST.US',
    price,
    previousClose,
    quoteAt: '2026-10-04T14:30:00.000Z',
    quoteContract: {
      valuationEligible: true,
      dayChangeEligible: true,
    },
    ...extra,
  };
}

test('price alert establishes baseline then triggers only on false-to-true crossing', () => {
  const below = evaluateRemoteAlertRule({ kind: 'PRICE_ABOVE', threshold: 105 }, quote(100));
  assert.equal(below.supported, true);
  assert.equal(below.condition, false);
  assert.equal(shouldTriggerRemoteAlert({ kind: 'PRICE_ABOVE', lastCondition: null }, below, Date.parse('2026-10-04T14:30:00Z'), 30), false);

  const crossed = evaluateRemoteAlertRule({ kind: 'PRICE_ABOVE', threshold: 105 }, quote(106));
  assert.equal(crossed.condition, true);
  assert.equal(shouldTriggerRemoteAlert({ kind: 'PRICE_ABOVE', lastCondition: false, lastTriggeredAt: null }, crossed, Date.parse('2026-10-04T14:31:00Z'), 30), true);
  assert.equal(shouldTriggerRemoteAlert({ kind: 'PRICE_ABOVE', lastCondition: true, lastTriggeredAt: null }, crossed, Date.parse('2026-10-04T14:31:00Z'), 30), false);
});

test('cooldown suppresses rapid repeated crossings', () => {
  const evaluation = evaluateRemoteAlertRule({ kind: 'PRICE_BELOW', threshold: 95 }, quote(94));
  const now = Date.parse('2026-10-04T14:30:00Z');
  assert.equal(shouldTriggerRemoteAlert({
    kind: 'PRICE_BELOW',
    lastCondition: false,
    lastTriggeredAt: '2026-10-04T14:15:00.000Z',
  }, evaluation, now, 30), false);
  assert.equal(shouldTriggerRemoteAlert({
    kind: 'PRICE_BELOW',
    lastCondition: false,
    lastTriggeredAt: '2026-10-04T13:30:00.000Z',
  }, evaluation, now, 30), true);
});

test('daily percent alert deduplicates by market day signature', () => {
  const evaluation = evaluateRemoteAlertRule({ kind: 'DAILY_PCT', threshold: 5 }, quote(106, 100));
  assert.equal(evaluation.supported, true);
  assert.equal(evaluation.condition, true);
  assert.equal(evaluation.triggerSignature, 'DAILY_PCT:2026-10-04');
  assert.equal(shouldTriggerRemoteAlert({
    kind: 'DAILY_PCT',
    lastCondition: true,
    lastTriggerSignature: 'DAILY_PCT:2026-10-03',
    lastTriggeredAt: '2026-10-03T15:00:00.000Z',
  }, evaluation, Date.parse('2026-10-04T14:30:00Z'), 30), true);
  assert.equal(shouldTriggerRemoteAlert({
    kind: 'DAILY_PCT',
    lastCondition: false,
    lastTriggerSignature: 'DAILY_PCT:2026-10-04',
  }, evaluation, Date.parse('2026-10-04T14:30:00Z'), 30), false);
});

test('daily percent refuses unverified daily-change data', () => {
  const evaluation = evaluateRemoteAlertRule({ kind: 'DAILY_PCT', threshold: 5 }, quote(106, 100, {
    quoteContract: { valuationEligible: true, dayChangeEligible: false },
  }));
  assert.equal(evaluation.supported, false);
  assert.equal(evaluation.code, 'DAILY_CHANGE_NOT_ELIGIBLE');
});

test('decision-change alerts remain fail-closed until a canonical decision-change source is wired', () => {
  const evaluation = evaluateRemoteAlertRule({ kind: 'MINBEIS_DECISION_CHANGE', threshold: null }, quote(106));
  assert.equal(evaluation.supported, false);
  assert.equal(evaluation.code, 'DECISION_CHANGE_SOURCE_NOT_WIRED');
});

test('scheduler is disabled by default without touching a database or provider', async () => {
  const result = await runRemoteAlertCycle({}, {
    db: {
      prepare() { throw new Error('must not touch database'); },
    },
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(result.status, 'DISABLED');
});

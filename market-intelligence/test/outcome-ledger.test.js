import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomeRecord, evaluateOutcomeRecord, summarizeOutcomeLedger } from '../src/outcome-ledger.js';

const DOSSIER = {
  dossierId: 'dossier:company:test:1234567890',
  status: 'PUBLISHED',
  companyId: 'company:test',
  companyName: 'Test Company',
  listing: { exchange: 'Test Exchange', symbol: 'TEST' },
  category: 'EVENT_DRIVEN',
  proposedAction: 'CONSIDER_BUY',
  generatedAt: '2026-01-01T00:00:00.000Z',
  referencePrice: {
    value: 10,
    currency: 'EUR',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'Historical market series',
  },
};

function timestamp(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

test('published dossier creates an open outcome record and evaluates fixed horizons', () => {
  const record = createOutcomeRecord(DOSSIER);
  const series = {
    candles: [
      { timestamp: timestamp('2026-01-02T00:00:00.000Z'), close: 10.5 },
      { timestamp: timestamp('2026-01-08T00:00:00.000Z'), close: 11 },
      { timestamp: timestamp('2026-02-01T00:00:00.000Z'), close: 9 },
      { timestamp: timestamp('2026-04-01T00:00:00.000Z'), close: 12 },
    ],
  };
  const evaluated = evaluateOutcomeRecord(record, series, { asOf: '2026-04-02T00:00:00.000Z' });
  assert.equal(evaluated.checkpoints.day1.rawReturnPct, 5);
  assert.equal(evaluated.checkpoints.week1.actionAlignedReturnPct, 10);
  assert.equal(evaluated.checkpoints.month1.rawReturnPct, -10);
  assert.equal(evaluated.checkpoints.month3.rawReturnPct, 20);
  assert.equal(evaluated.closeBasedExcursions.maximumFavourablePct, 20);
  assert.equal(evaluated.closeBasedExcursions.maximumAdversePct, -10);
  assert.equal(evaluated.status, 'OPEN');

  const summary = summarizeOutcomeLedger([evaluated]);
  assert.equal(summary.threeMonthScoredCount, 1);
  assert.equal(summary.threeMonthHitRatePct, 100);
});

test('outcome records cannot be created from unpublished research', () => {
  assert.throws(() => createOutcomeRecord({ ...DOSSIER, status: 'REVIEW_READY' }), /published dossier/);
});

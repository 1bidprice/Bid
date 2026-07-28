const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPositionLots } = require('../src/position-lots');

function buy(id, date, quantity, executionPrice, fees = 0) {
  return {
    id,
    type: 'buy',
    symbol: 'SPCE.US',
    company: 'Virgin Galactic Holdings',
    currency: 'USD',
    date,
    quantity,
    executionPrice,
    grossAmount: quantity * executionPrice,
    feeBreakdown: { commission: fees },
    total: (quantity * executionPrice) + fees,
  };
}

test('keeps two purchases of the same share as separate lots with separate return signs', () => {
  const result = buildPositionLots([
    buy('first', '2026-01-10', 100, 3, 0),
    buy('second', '2026-02-10', 50, 2, 0),
  ], 'SPCE.US', 2.5);

  assert.equal(result.openLotCount, 2);
  assert.equal(result.openLots[0].purchaseNumber, 1);
  assert.equal(result.openLots[1].purchaseNumber, 2);
  assert.equal(result.openLots[0].performancePct.toFixed(2), '-16.67');
  assert.equal(result.openLots[1].performancePct.toFixed(2), '25.00');
});

test('uses each transaction all-in price including its own fees', () => {
  const result = buildPositionLots([
    buy('with-fees', '2026-01-10', 10, 10, 5),
  ], 'SPCE.US', 10.5);

  assert.equal(result.openLots[0].allInPrice, 10.5);
  assert.equal(result.openLots[0].performancePct.toFixed(2), '0.00');
});

test('allocates a later sale FIFO for analytical lot display without merging purchases', () => {
  const transactions = [
    buy('first', '2026-01-10', 100, 3),
    buy('second', '2026-02-10', 50, 2),
    {
      id: 'sell',
      type: 'sell',
      symbol: 'SPCE.US',
      date: '2026-03-10',
      quantity: 110,
      executionPrice: 2.4,
      grossAmount: 264,
      total: 264,
    },
  ];

  const result = buildPositionLots(transactions, 'SPCE.US', 2.5);
  assert.equal(result.openLotCount, 1);
  assert.equal(result.openLots[0].transactionId, 'second');
  assert.equal(result.openLots[0].remainingQuantity, 40);
  assert.equal(result.openLots[0].performancePct.toFixed(2), '25.00');
});

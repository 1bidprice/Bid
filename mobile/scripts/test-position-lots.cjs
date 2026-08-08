const assert = require('node:assert/strict');
const { buildPositionLots } = require('../src/position-lots');

function close(actual, expected, tolerance = 0.0001) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${actual} != ${expected}`);
}

const transactions = [
  {
    id: 'buy-1', type: 'buy', symbol: 'TEST.US', company: 'Test', currency: 'USD',
    date: '2026-01-01', createdAt: '2026-01-01T09:00:00Z', quantity: 100,
    executionPrice: 10, grossAmount: 1000, feeBreakdown: { commission: 10 }, total: 1010,
  },
  {
    id: 'buy-2', type: 'buy', symbol: 'TEST.US', company: 'Test', currency: 'USD',
    date: '2026-02-01', createdAt: '2026-02-01T09:00:00Z', quantity: 50,
    executionPrice: 8, grossAmount: 400, feeBreakdown: { commission: 5 }, total: 405,
  },
];

const twoLots = buildPositionLots(transactions, 'TEST.US', 9);
assert.equal(twoLots.method, 'FIFO');
assert.equal(twoLots.purchaseCount, 2);
assert.equal(twoLots.openLotCount, 2);
assert.equal(twoLots.openLots[0].purchaseNumber, 1);
assert.equal(twoLots.openLots[1].purchaseNumber, 2);
close(twoLots.openLots[0].allInPrice, 10.1);
close(twoLots.openLots[0].performancePct, (9 / 10.1 - 1) * 100);
close(twoLots.openLots[1].allInPrice, 8.1);
close(twoLots.openLots[1].performancePct, (9 / 8.1 - 1) * 100);
close(twoLots.openQuantity, 150);
close(twoLots.openCost, 1415);

const afterSale = buildPositionLots([
  ...transactions,
  {
    id: 'sell-1', type: 'sell', symbol: 'TEST.US', company: 'Test', currency: 'USD',
    date: '2026-03-01', createdAt: '2026-03-01T09:00:00Z', quantity: 120,
    executionPrice: 9.5, total: 1135,
  },
], 'TEST.US', 9);
assert.equal(afterSale.hadSales, true);
assert.equal(afterSale.openLotCount, 1);
assert.equal(afterSale.openLots[0].transactionId, 'buy-2');
assert.equal(afterSale.openLots[0].purchaseNumber, 2);
close(afterSale.openLots[0].remainingQuantity, 30);
close(afterSale.openLots[0].soldQuantity, 20);
assert.equal(afterSale.openLots[0].partiallySold, true);

const unrelatedIgnored = buildPositionLots([
  ...transactions,
  { id: 'other', type: 'buy', symbol: 'OTHER.US', quantity: 999, executionPrice: 1, total: 999 },
], 'TEST.US', 9);
assert.equal(unrelatedIgnored.purchaseCount, 2);

const unavailablePrice = buildPositionLots(transactions, 'TEST.US', null);
assert.equal(unavailablePrice.openLots[0].performancePct, null);
assert.equal(unavailablePrice.currentValue, null);

console.log('PASS position lots: separate buys, all-in performance, FIFO sales, symbol isolation, stale-price handling');

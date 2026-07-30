const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDailyLossProfitResult,
  findEffectiveProductActualCost,
} = require('../src/modules/analytics/daily-loss-profit.helper');

test('daily loss helper excludes unconfirmed statuses and merges the configured dimensions', () => {
  const result = buildDailyLossProfitResult({
    travelGroups: [
      group('2026-07-12', 'RECORDED', [
        item('product-a', '飞天', 2),
      ]),
      group('2026-07-12', 'RECORDED', [
        item('product-a', '飞天', 3),
      ]),
      group('2026-07-12', 'PENDING', [
        item('product-a', '飞天', 90),
      ]),
      group('2026-07-12', 'NO_LOSS', [
        item('product-a', '飞天', 80),
      ]),
      {
        ...group('2026-07-12', 'RECORDED', [
          item('product-a', '飞天', 4),
        ]),
        lossConfirmedById: 'operator-2',
        lossConfirmedBy: { id: 'operator-2', name: '操作员乙' },
      },
    ],
    productActualCosts: [
      cost('old', 'product-a', 1000, '2026-01-01', '2026-07-12'),
      cost('latest', 'product-a', 1200, '2026-07-01', null),
    ],
  });

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((row) => ({
      operator: row.operatorName,
      quantity: row.lossQuantity,
      loss: row.estimatedProfitLossCents,
    })),
    [
      { operator: '操作员甲', quantity: 5, loss: 6000 },
      { operator: '操作员乙', quantity: 4, loss: 4800 },
    ],
  );
  assert.deepEqual(result.summary, {
    rowCount: 2,
    totalLossQuantity: 9,
    calculableLossQuantity: 9,
    unpricedLossQuantity: 0,
    estimatedProfitLossCents: 10800,
    knownEstimatedProfitLossCents: 10800,
    incompleteRowCount: 0,
    costCoverageStatus: 'complete',
  });
});

test('daily loss helper matches inclusive cost boundaries and selects the latest effectiveFrom', () => {
  const costs = [
    cost('older', 'product-a', 800, '2026-07-01', '2026-07-10'),
    cost('newer', 'product-a', 900, '2026-07-10', '2026-07-20'),
    {
      ...cost('inactive', 'product-a', 1, '2026-07-11', null),
      isActive: false,
    },
  ];

  assert.equal(
    findEffectiveProductActualCost(
      costs,
      'product-a',
      '2026-07-10',
    ).id,
    'newer',
  );
  assert.equal(
    findEffectiveProductActualCost(
      costs,
      'product-a',
      '2026-07-20',
    ).id,
    'newer',
  );
  assert.equal(
    findEffectiveProductActualCost(
      costs,
      'product-a',
      '2026-07-21',
    ),
    null,
  );
});

test('daily loss helper never prices missing products or missing effective costs as zero', () => {
  const result = buildDailyLossProfitResult({
    travelGroups: [
      group('2026-07-11', 'RECORDED', [
        item('product-a', '飞天', 2),
        item('product-without-cost', '珍品', 3),
        item(null, '罐装酒', 4),
      ]),
    ],
    productActualCosts: [
      cost('priced', 'product-a', 500, '2026-01-01', null),
    ],
  });

  assert.equal(result.items.length, 3);
  const priced = result.items.find(
    (row) => row.productId === 'product-a',
  );
  assert.equal(priced.estimatedProfitLossCents, 1000);
  assert.equal(priced.costCoverageStatus, 'available');

  const unpriced = result.items.filter(
    (row) => row.estimatedProfitLossCents === null,
  );
  assert.equal(unpriced.length, 2);
  for (const row of unpriced) {
    assert.equal(row.costCoverageStatus, 'unavailable');
    assert.ok(
      row.warnings.some(
        (warning) =>
          warning.code === 'PRODUCT_ACTUAL_COST_UNAVAILABLE',
      ),
    );
  }
  assert.deepEqual(result.summary, {
    rowCount: 3,
    totalLossQuantity: 9,
    calculableLossQuantity: 2,
    unpricedLossQuantity: 7,
    estimatedProfitLossCents: null,
    knownEstimatedProfitLossCents: 1000,
    incompleteRowCount: 2,
    costCoverageStatus: 'incomplete',
  });
});

function group(visitDate, lossStatus, tastingItems) {
  return {
    visitDate,
    lossStatus,
    tastingRoomNo: 'A1',
    lossConfirmedById: 'operator-1',
    lossConfirmedBy: { id: 'operator-1', name: '操作员甲' },
    tastingItems,
  };
}

function item(productId, productName, quantity) {
  return {
    productId,
    productName,
    quantity,
    unit: '瓶',
  };
}

function cost(
  id,
  productId,
  costCents,
  effectiveFrom,
  effectiveTo,
) {
  return {
    id,
    productId,
    costCents,
    effectiveFrom,
    effectiveTo,
    isActive: true,
  };
}

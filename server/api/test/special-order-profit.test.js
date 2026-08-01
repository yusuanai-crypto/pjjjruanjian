const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateOrderProductProfit,
  calculateProductProfitSummary,
} = require('../src/modules/products/product-profit.helper');

test('effective manual order commissions are included once in product profit cost', () => {
  const order = {
    id: 'special-order-1',
    orderNo: 'SOI20260801001',
    status: 'VALID',
    totalAmountCents: 10_000,
    items: [
      {
        id: 'line-1',
        productId: 'product-1',
        productName: '商品一',
        quantity: 1,
        subtotalCents: 10_000,
        actualCostSubtotalCents: 6_000,
      },
    ],
    commissionRecords: [
      {
        targetType: 'ORDER_MANUAL_COMMISSION',
        isActive: true,
        amountCents: 800,
      },
      {
        targetType: 'ORDER_MANUAL_COMMISSION',
        isActive: false,
        amountCents: 900,
      },
      {
        targetType: 'SALES_COMMISSION',
        isActive: true,
        amountCents: 500,
      },
    ],
  };

  const result = calculateOrderProductProfit(order);
  assert.equal(result.manualCommissionCostCents, 800);
  assert.equal(result.grossProfitCents, 3_200);

  const summary = calculateProductProfitSummary([order]);
  assert.equal(summary.manualCommissionCostCents, 800);
  assert.equal(summary.grossProfitCents, 3_200);
});

test('partial refund profit uses the remaining effective commission amount', () => {
  const result = calculateOrderProductProfit({
    id: 'special-order-2',
    status: 'PARTIAL_REFUND',
    totalAmountCents: 10_000,
    items: [
      {
        id: 'line-1',
        quantity: 1,
        subtotalCents: 10_000,
        actualCostSubtotalCents: 6_000,
      },
    ],
    afterSalesOrders: [
      { financeConfirmed: true, refundAmountCents: 2_000 },
    ],
    commissionRecords: [
      {
        targetType: 'ORDER_MANUAL_COMMISSION',
        isActive: true,
        originalAmountCents: 1_000,
        adjustmentAmountCents: 200,
        amountCents: 800,
      },
    ],
  });

  assert.equal(result.effectiveSalesAmountCents, 8_000);
  assert.equal(result.manualCommissionCostCents, 800);
  assert.equal(result.estimatedGrossProfitCents, 1_200);
});

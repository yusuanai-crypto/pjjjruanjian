const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPublicSalesSheetDto,
  buildSalesSheetDto,
  formatCentsAsYuan,
  maskCustomerAddress,
  maskCustomerPhone,
} = require('../src/modules/business-data/sales-sheet.dto.helper');

test('unit: sales sheet DTO builds internal and public views for a normal multi-item order', () => {
  const salesSheet = buildSalesSheetDto(buildOrderFixture(), {
    publicToken: 'token-123',
    publicUrl: 'https://example.test/api/public/sales-sheets/token-123',
  });

  assert.equal(salesSheet.visibility, 'internal');
  assert.equal(salesSheet.companyName, '贵州酱酒馆');
  assert.equal(salesSheet.venueName, '茅台集团茅乡酱酒体验馆');
  assert.equal(salesSheet.afterSalesPhone, '177-8530-5984');
  assert.equal(salesSheet.order.id, 'order-1');
  assert.equal(salesSheet.order.orderNo, 'SO20260701001');
  assert.equal(salesSheet.order.orderType, 'travel_group');
  assert.equal(salesSheet.order.orderTypeLabel, '旅行团订单');
  assert.equal(salesSheet.order.shippingDateMode, 'scheduled');
  assert.equal(salesSheet.order.shippingDate, '2026-07-02');
  assert.equal(salesSheet.customer.phone, '13812340000');
  assert.equal(salesSheet.customer.phoneMasked, '138****0000');
  assert.equal(salesSheet.customer.fullAddress, '贵州省贵阳市观山湖区测试路 1 号');
  assert.equal(salesSheet.travelGroup.groupNo, 'TG20260701001');
  assert.equal(salesSheet.salesUser.name, '销售小王');
  assert.equal(salesSheet.items.length, 2);
  assert.deepEqual(
    salesSheet.items.map((item) => item.productName),
    ['酱香酒 B', '酱香酒 A'],
  );
  assert.equal(salesSheet.items[0].deliveryTypeLabel, '自提');
  assert.equal(salesSheet.items[1].deliveryTypeLabel, '邮寄');
  assert.equal(salesSheet.amounts.totalAmountCents, 59800);
  assert.equal(salesSheet.amounts.totalAmountYuan, '598.00');
  assert.equal(salesSheet.amounts.cashOnDeliveryAmountYuan, '100.00');
  assert.equal(salesSheet.amounts.logisticsFeeYuan, '12.00');
  assert.equal(salesSheet.paymentDetails.length, 2);
  assert.equal(
    salesSheet.paymentDetails[0].paymentMethodNameSnapshot,
    '收钱吧',
  );
  assert.equal(
    salesSheet.paymentDetails[0].paymentMethodCategoryLabel,
    '即时收款',
  );
  assert.equal(
    salesSheet.paymentDetails[0].confirmationStatusLabel,
    '无需确认',
  );
  assert.equal(
    salesSheet.paymentDetails[1].paymentMethodNameSnapshot,
    '货到付款',
  );
  assert.equal(
    salesSheet.paymentDetails[1].paymentMethodCategoryLabel,
    '代收营业款',
  );
  assert.equal(
    salesSheet.paymentDetails[1].confirmationStatusLabel,
    '已确认到账',
  );
  assert.equal(
    salesSheet.paymentDetails[1].agencyCollectionConfirmedByName,
    '财务测试员',
  );
  assert.equal(
    salesSheet.paymentDetails[1].agencyCollectionConfirmedAt,
    '2026-07-01T12:00:00.000Z',
  );
  assert.deepEqual(salesSheet.paymentSummary, {
    directReceiptAmountCents: 49800,
    collectOnDeliveryAmountCents: 10000,
    confirmedCollectOnDeliveryAmountCents: 10000,
    pendingCollectOnDeliveryAmountCents: 0,
    hasPendingCollectOnDelivery: false,
  });
  assert.equal(salesSheet.status.label, '有效');
  assert.equal(salesSheet.delivery.summary, 'mixed');
  assert.equal(salesSheet.delivery.summaryLabel, '混合配送');
  assert.equal(salesSheet.logistics.packingStatusLabel, '待打包');
  assert.equal(salesSheet.invoice.requiredLabel, '需要开票');
  assert.equal(salesSheet.invoice.issuedLabel, '未开票');
  assert.equal(salesSheet.qrCode.token, 'token-123');
  assert.equal(
    salesSheet.qrCode.url,
    'https://example.test/api/public/sales-sheets/token-123',
  );

  assert.equal(salesSheet.public.visibility, 'public');
  assert.equal(salesSheet.public.order.orderNo, salesSheet.order.orderNo);
  assert.deepEqual(salesSheet.public.customer, {
    name: '测试客户',
    phone: '13812340000',
    fullAddress: '贵州省贵阳市观山湖区测试路 1 号',
  });
  assert.equal(salesSheet.public.logistics.providerCode, 'shunfeng');
  assert.equal(salesSheet.public.logistics.providerName, '顺丰速运');
  assert.equal(salesSheet.public.logistics.logisticsNo, 'SF123456');
  assert.equal(salesSheet.public.logistics.trackingState, 'in_transit');
  assert.equal(salesSheet.public.logistics.trackingStateLabel, '运输中');
  assert.deepEqual(salesSheet.public.items[0], {
    productName: '酱香酒 B',
    quantity: 1,
    deliveryType: 'self_pickup',
    deliveryTypeLabel: '自提',
  });
  assert.equal(salesSheet.public.paymentDetails.length, 2);
  assert.equal(
    salesSheet.public.paymentDetails[1].confirmationStatusLabel,
    '已确认到账',
  );
  assert.deepEqual(
    salesSheet.public.paymentSummary,
    salesSheet.paymentSummary,
  );
  assert.equal(
    'agencyCollectionConfirmedByName' in
      salesSheet.public.paymentDetails[1],
    false,
  );
});

test('unit: sales sheet DTO supports orders without a travel group', () => {
  const order = buildOrderFixture({
    orderType: 'EXTERNAL',
    travelGroupId: null,
    travelGroup: null,
    qrCodeTokenHash: null,
    qrCodeGeneratedAt: null,
    qrCodeExpiresAt: null,
    qrCodeRevokedAt: null,
  });

  const salesSheet = buildSalesSheetDto(order);

  assert.equal(salesSheet.order.orderType, 'external');
  assert.equal(salesSheet.order.orderTypeLabel, '外部销售');
  assert.equal(salesSheet.travelGroup, null);
  assert.equal('travelGroup' in salesSheet.public, false);
  assert.equal(salesSheet.qrCode, null);
  assert.equal(salesSheet.public.qrCode, null);
  assert.equal(salesSheet.paymentDetails.length, 2);
});

test('unit: pending customer notice is preserved in internal and public sales sheets', () => {
  const salesSheet = buildSalesSheetDto(
    buildOrderFixture({
      shippingDateMode: 'PENDING_CUSTOMER_NOTICE',
      shippingDate: null,
    }),
  );

  assert.equal(
    salesSheet.order.shippingDateMode,
    'pending_customer_notice',
  );
  assert.equal(salesSheet.order.shippingDate, null);
  assert.equal(
    salesSheet.public.order.shippingDateMode,
    'pending_customer_notice',
  );
  assert.equal(salesSheet.public.order.shippingDate, null);
});

test('unit: sales sheet payment summary falls back to compatibility amounts', () => {
  const salesSheet = buildSalesSheetDto(
    buildOrderFixture({
      paymentDetails: [],
      totalAmountCents: 10000,
      cashOnDeliveryAmountCents: 3000,
    }),
  );

  assert.deepEqual(salesSheet.paymentSummary, {
    directReceiptAmountCents: 7000,
    collectOnDeliveryAmountCents: 3000,
    confirmedCollectOnDeliveryAmountCents: 0,
    pendingCollectOnDeliveryAmountCents: 3000,
    hasPendingCollectOnDelivery: true,
  });
});

test('unit: sales sheet public view exposes only approved customer and logistics fields', () => {
  const salesSheet = buildSalesSheetDto(buildOrderFixture());
  const publicSalesSheet = buildPublicSalesSheetDto(salesSheet);
  const serialized = JSON.stringify(publicSalesSheet);

  assert.equal(publicSalesSheet.customer.phone, '13812340000');
  assert.equal(
    publicSalesSheet.customer.fullAddress,
    '贵州省贵阳市观山湖区测试路 1 号',
  );
  assert.deepEqual(Object.keys(publicSalesSheet.customer).sort(), [
    'fullAddress',
    'name',
    'phone',
  ]);
  assert.equal('phoneMasked' in publicSalesSheet.customer, false);
  assert.equal('addressMasked' in publicSalesSheet.customer, false);

  for (const forbidden of [
    'amounts',
    'totalAmountCents',
    'cashOnDeliveryAmountCents',
    'travelGroup',
    '测试旅行社',
    'invoice',
    'remark',
    '客户可见备注',
    'salesFormNo',
    'financeRemark',
    'warehouseRemark',
    'financeMark',
    'operationLogs',
    'internalFields',
    'sales-user-1',
    'customer-1',
    'travel-group-1',
    'item-1',
    'item-2',
    'internal-user-1',
    '财务内部备注',
    '库管内部备注',
    'serialized-unit-secret',
    '000000999',
    'purchaseCostCents',
    'warehouse-internal-secret',
    'inventory-cost-secret',
    'inventory-line-secret',
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `public sales sheet should not leak ${forbidden}`,
    );
  }
});

test('unit: sales sheet helpers mask phones and format cents', () => {
  assert.equal(maskCustomerPhone('13812340000'), '138****0000');
  assert.equal(maskCustomerPhone(' 0851-1234567 '), '085****67');
  assert.equal(maskCustomerPhone('12345'), '1***5');
  assert.equal(maskCustomerPhone(null), null);
  assert.equal(
    maskCustomerAddress({
      province: '贵州省',
      city: '贵阳市',
      district: '观山湖区',
      address: '测试路 1 号',
    }),
    '贵** 贵** 观*** 测***',
  );
  assert.equal(formatCentsAsYuan(0), '0.00');
  assert.equal(formatCentsAsYuan(199), '1.99');
  assert.equal(formatCentsAsYuan(-105), '-1.05');
});

function buildOrderFixture(overrides = {}) {
  return {
    id: 'order-1',
    orderNo: 'SO20260701001',
    orderType: 'TRAVEL_GROUP',
    travelGroupId: 'travel-group-1',
    customerId: 'customer-1',
    customerName: '测试客户',
    customerPhone: '13812340000',
    province: '贵州省',
    city: '贵阳市',
    district: '观山湖区',
    address: '测试路 1 号',
    orderDate: new Date('2026-07-01T00:00:00.000Z'),
    shippingDateMode: 'SCHEDULED',
    shippingDate: new Date('2026-07-02T00:00:00.000Z'),
    salesFormNo: 'XS-001',
    totalAmountCents: 59800,
    cashOnDeliveryAmountCents: 10000,
    logisticsMethod: '顺丰',
    logisticsProviderCode: 'shunfeng',
    packingStatus: 'PENDING',
    packageCount: 2,
    warehouseRemark: '库管内部备注',
    fulfillmentWarehouseId: 'warehouse-internal-secret',
    inventoryAppliedAt: new Date('2026-07-01T10:00:00.000Z'),
    inventoryPolicyVersion: 99,
    inventoryVersion: 99,
    warehouseProductStock: {
      onHandQty: 999,
      availableQty: 998,
      inventoryCost: 'inventory-cost-secret',
    },
    logisticsNo: 'SF123456',
    trackingState: 'in_transit',
    trackingStateLabel: '运输中',
    trackingLatestLocation: '贵州省遵义市',
    trackingLatestDescription: '快件已发往贵阳市',
    trackingEventAt: new Date('2026-07-01T11:00:00.000Z'),
    trackingCheckedAt: new Date('2026-07-01T11:05:00.000Z'),
    logisticsFeeCents: 1200,
    invoiceRequired: true,
    invoiceIssued: false,
    financeRemark: '财务内部备注',
    remark: '客户可见备注',
    status: 'VALID',
    financeMark: true,
    markedById: 'internal-user-1',
    markedAt: new Date('2026-07-01T10:00:00.000Z'),
    salesUserId: 'sales-user-1',
    createdAt: new Date('2026-07-01T08:00:00.000Z'),
    updatedAt: new Date('2026-07-01T09:00:00.000Z'),
    qrCodeTokenHash:
      '8'.repeat(64),
    qrCodeGeneratedAt: new Date('2026-07-01T10:30:00.000Z'),
    qrCodeExpiresAt: new Date('2099-07-01T10:30:00.000Z'),
    qrCodeRevokedAt: null,
    customer: {
      id: 'customer-1',
      name: '当前客户名',
      phone: '13999990000',
      financeMark: true,
    },
    travelGroup: {
      id: 'travel-group-1',
      groupNo: 'TG20260701001',
      visitDate: new Date('2026-07-01T00:00:00.000Z'),
      travelAgency: '测试旅行社',
      guideName: '测试导游',
      guidePhone: '13911112222',
      tasterName: '测试品鉴师',
      tastingRoomNo: 'A101',
      financeMark: true,
    },
    salesUser: {
      id: 'sales-user-1',
      name: '销售小王',
      username: 'sales-wang',
    },
    items: [
      {
        id: 'item-1',
        productName: '酱香酒 A',
        quantity: 2,
        unitPriceCents: 19950,
        subtotalCents: 39900,
        deliveryType: 'SHIPPING',
        notes: '内部明细备注 A',
        sortOrder: 2,
        inventoryLineKey: 'inventory-line-secret',
        serializedInventoryUnits: [
          {
            id: 'serialized-unit-secret',
            logisticsCode: '000000999',
            purchaseCostCents: 999999,
            status: 'ALLOCATED',
          },
        ],
      },
      {
        id: 'item-2',
        productName: '酱香酒 B',
        quantity: 1,
        unitPriceCents: 19900,
        subtotalCents: 19900,
        deliveryType: 'SELF_PICKUP',
        notes: '内部明细备注 B',
        sortOrder: 1,
      },
    ],
    paymentDetails: [
      {
        id: 'payment-direct',
        paymentMethodId: 'method-direct',
        paymentMethodNameSnapshot: '收钱吧',
        paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
        amountCents: 49800,
        sortOrder: 0,
      },
      {
        id: 'payment-cod',
        paymentMethodId: 'method-cod',
        paymentMethodNameSnapshot: '货到付款',
        paymentMethodCategorySnapshot: 'COLLECT_ON_DELIVERY',
        amountCents: 10000,
        sortOrder: 1,
        collectionConfirmed: true,
        collectionConfirmedAt: new Date('2026-07-01T12:00:00.000Z'),
        collectionConfirmedById: 'finance-user-1',
        collectionConfirmedBy: {
          id: 'finance-user-1',
          name: '财务测试员',
        },
      },
    ],
    operationLogs: [
      {
        id: 'log-1',
        action: 'secret',
      },
    ],
    ...overrides,
  };
}

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  login,
  requestJson,
  withNestApiServer,
} = require('./helpers/phase1-api');
const {
  calculateAfterSalesReceiptRequestHash,
} = require('../src/modules/inventory/after-sales-inventory.service');

const PASSWORD = 'Password123';

test('after-sales receipts: refund and legacy warehouse confirmation never return stock; actual POSTED receipt does', async () => {
  await withReceiptServer(async (baseUrl, context) => {
    const warehouse = await login(baseUrl, 'receipt_warehouse', PASSWORD);
    const afterSales = await login(baseUrl, 'receipt_after_sales', PASSWORD);
    const boss = await login(baseUrl, 'receipt_boss', PASSWORD);
    const sales = await login(baseUrl, 'receipt_sales', PASSWORD);

    const legacy = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_receipt/warehouse-confirm',
      {
        method: 'PATCH',
        token: warehouse.token,
        body: { warehouseConfirmNote: 'legacy workflow only' },
      },
    );
    assert.equal(legacy.response.status, 200);
    assert.equal(context.prisma.__store.inventoryMovements.length, 0);
    assert.equal(context.prisma.__store.warehouseProductStocks.length, 0);

    const draft = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'saleable-one',
      warehouseId: 'wh_receipt_a',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt',
          lineNo: 1,
          receivedQty: 1,
          condition: 'SALEABLE',
        },
      ],
    });
    assert.equal(draft.response.status, 201);
    assert.equal(draft.body.data.afterSalesReceipt.status, 'draft');
    assert.equal(context.prisma.__store.inventoryMovements.length, 0);

    const receiptId = draft.body.data.afterSalesReceipt.id;
    const posted = await postReceipt(
      baseUrl,
      warehouse.token,
      receiptId,
      'saleable-one',
    );
    assert.equal(posted.response.status, 201);
    assert.equal(posted.body.data.afterSalesReceipt.status, 'posted');
    assert.equal(context.prisma.__store.inventoryMovements.length, 1);
    const stock = context.prisma.__store.warehouseProductStocks.find(
      (row) =>
        row.warehouseId === 'wh_receipt_a' &&
        row.productId === 'prod_receipt_quantity',
    );
    assert.equal(stock.onHandQty, 1);
    assert.equal(stock.unavailableQty, 0);
    const item = context.prisma.__store.afterSalesOrderItems.find(
      (row) => row.id === 'asi_receipt',
    );
    assert.equal(item.postedReceivedQty, 1);

    const replay = await postReceipt(
      baseUrl,
      warehouse.token,
      receiptId,
      'saleable-one',
    );
    assert.equal(replay.response.status, 201);
    assert.equal(replay.body.data.replayed, true);
    assert.equal(context.prisma.__store.inventoryMovements.length, 1);

    const conflictBody = lifecycleBody(
      'POST',
      receiptId,
      'post-saleable-one',
      'post-idem-saleable-one',
      { reason: 'different content' },
    );
    const hashConflict = await requestJson(
      baseUrl,
      `/api/after-sales-orders/receipts/${receiptId}/post`,
      {
        method: 'POST',
        token: warehouse.token,
        body: conflictBody,
      },
    );
    assert.equal(hashConflict.response.status, 409);
    assert.equal(
      hashConflict.body.error.code,
      'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
    );

    const progress = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_receipt/receipts',
      { token: afterSales.token },
    );
    assert.equal(progress.response.status, 200);
    assert.equal(progress.body.data.afterSalesReceipts.length, 1);
    assert.equal(
      Object.hasOwn(
        progress.body.data.afterSalesReceipts[0].lines[0],
        'serializedUnits',
      ),
      false,
    );
    const bossProgress = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_receipt/receipts',
      { token: boss.token },
    );
    assert.equal(bossProgress.response.status, 200);
    assert.doesNotMatch(
      JSON.stringify(bossProgress.body.data.afterSalesReceipts),
      /purchaseCostCents|inventoryCost|onHandQty|reservedQty|unavailableQty|shortageQty/,
    );
    const forbidden = await requestJson(
      baseUrl,
      '/api/after-sales-orders/as_receipt/receipts',
      { token: sales.token },
    );
    assert.equal(forbidden.response.status, 403);
  });
});

test('after-sales receipts: partial multi-warehouse, unavailable and reversal preserve cumulative and stock facts', async () => {
  await withReceiptServer(async (baseUrl, context) => {
    const warehouse = await login(baseUrl, 'receipt_warehouse', PASSWORD);
    const first = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'partial-a',
      warehouseId: 'wh_receipt_a',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt',
          lineNo: 1,
          receivedQty: 1,
          condition: 'SALEABLE',
        },
      ],
    });
    const firstId = first.body.data.afterSalesReceipt.id;
    assert.equal(
      (
        await postReceipt(
          baseUrl,
          warehouse.token,
          firstId,
          'partial-a',
        )
      ).response.status,
      201,
    );

    const second = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'partial-b',
      warehouseId: 'wh_receipt_b',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt',
          lineNo: 1,
          receivedQty: 1,
          condition: 'UNAVAILABLE',
        },
      ],
    });
    const secondId = second.body.data.afterSalesReceipt.id;
    assert.equal(
      (
        await postReceipt(
          baseUrl,
          warehouse.token,
          secondId,
          'partial-b',
        )
      ).response.status,
      201,
    );
    const item = context.prisma.__store.afterSalesOrderItems.find(
      (row) => row.id === 'asi_receipt',
    );
    assert.equal(item.postedReceivedQty, 2);
    const targetStock = context.prisma.__store.warehouseProductStocks.find(
      (row) => row.warehouseId === 'wh_receipt_b',
    );
    assert.equal(targetStock.onHandQty, 1);
    assert.equal(targetStock.unavailableQty, 1);

    const reverseBody = lifecycleBody(
      'REVERSE',
      secondId,
      'reverse-partial-b',
      'reverse-idem-partial-b',
      { reason: 'physical receipt entered for the wrong warehouse' },
    );
    const reversed = await requestJson(
      baseUrl,
      `/api/after-sales-orders/receipts/${secondId}/reverse`,
      {
        method: 'POST',
        token: warehouse.token,
        body: reverseBody,
      },
    );
    assert.equal(reversed.response.status, 201);
    assert.equal(reversed.body.data.afterSalesReceipt.status, 'reversed');
    assert.equal(
      context.prisma.__store.afterSalesOrderItems.find(
        (row) => row.id === 'asi_receipt',
      ).postedReceivedQty,
      1,
    );
    const reversedTargetStock =
      context.prisma.__store.warehouseProductStocks.find(
        (row) => row.warehouseId === 'wh_receipt_b',
      );
    assert.equal(reversedTargetStock.onHandQty, 0);
    assert.equal(reversedTargetStock.unavailableQty, 0);
    assert.equal(
      context.prisma.__store.inventoryMovements.filter(
        (row) => row.movementType === 'REVERSAL',
      ).length,
      1,
    );
  });
});

test('after-sales receipts: concurrent POST cannot exceed expectedReturnQty and rolls back the losing inventory facts', async () => {
  await withReceiptServer(async (baseUrl, context) => {
    const warehouse = await login(baseUrl, 'receipt_warehouse', PASSWORD);
    const draftA = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'race-a',
      warehouseId: 'wh_receipt_a',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt',
          lineNo: 1,
          receivedQty: 2,
          condition: 'SALEABLE',
        },
      ],
    });
    const draftB = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'race-b',
      warehouseId: 'wh_receipt_b',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt',
          lineNo: 1,
          receivedQty: 2,
          condition: 'SALEABLE',
        },
      ],
    });
    const [left, right] = await Promise.all([
      postReceipt(
        baseUrl,
        warehouse.token,
        draftA.body.data.afterSalesReceipt.id,
        'race-a',
      ),
      postReceipt(
        baseUrl,
        warehouse.token,
        draftB.body.data.afterSalesReceipt.id,
        'race-b',
      ),
    ]);
    assert.deepEqual(
      [left.response.status, right.response.status].sort(),
      [201, 409],
    );
    const failure = left.response.status === 409 ? left : right;
    assert.equal(
      failure.body.error.code,
      'AFTER_SALES_RECEIPT_QUANTITY_EXCEEDED',
    );
    const item = context.prisma.__store.afterSalesOrderItems.find(
      (row) => row.id === 'asi_receipt',
    );
    assert.equal(item.postedReceivedQty, 2);
    assert.equal(
      context.prisma.__store.inventoryMovements.filter(
        (row) => row.movementType === 'CUSTOMER_RETURN',
      ).length,
      1,
    );
  });
});

test('after-sales serialized receipts: only the original outbound bottle returns to stock; unknown code stays exception-only', async () => {
  await withSerializedReceiptServer(async (baseUrl, context) => {
    const warehouse = await login(baseUrl, 'receipt_warehouse', PASSWORD);
    const matched = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'serialized-matched',
      warehouseId: 'wh_receipt_b',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt',
          lineNo: 1,
          receivedQty: 1,
          condition: 'SALEABLE',
          serializedUnits: [
            {
              originalSerializedUnitId: 'unit_receipt_original',
              scannedLogisticsCode: '000012340001',
            },
          ],
        },
      ],
    });
    assert.equal(matched.response.status, 201);
    const matchedId = matched.body.data.afterSalesReceipt.id;
    const posted = await postReceipt(
      baseUrl,
      warehouse.token,
      matchedId,
      'serialized-matched',
    );
    assert.equal(posted.response.status, 201);
    const unit = context.prisma.__store.serializedInventoryUnits.find(
      (row) => row.id === 'unit_receipt_original',
    );
    assert.equal(unit.status, 'AVAILABLE');
    assert.equal(unit.warehouseId, 'wh_receipt_b');
    const matchedFact =
      context.prisma.__store.afterSalesReceiptSerializedUnits.find(
        (row) => row.receiptLineId === posted.body.data.afterSalesReceipt.lines[0].id,
      );
    assert.equal(matchedFact.matchStatus, 'MATCHED');
    assert.equal(
      matchedFact.activeOriginalUnitKey,
      'unit_receipt_original',
    );
    const serializedReverseBody = lifecycleBody(
      'REVERSE',
      matchedId,
      'reverse-serialized-matched',
      'reverse-idem-serialized-matched',
      { reason: 'serialized receipt correction' },
    );
    const serializedReversed = await requestJson(
      baseUrl,
      `/api/after-sales-orders/receipts/${matchedId}/reverse`,
      {
        method: 'POST',
        token: warehouse.token,
        body: serializedReverseBody,
      },
    );
    assert.equal(serializedReversed.response.status, 201);
    const restoredUnit =
      context.prisma.__store.serializedInventoryUnits.find(
        (row) => row.id === 'unit_receipt_original',
      );
    assert.equal(restoredUnit.status, 'OUTBOUND');
    assert.equal(restoredUnit.warehouseId, 'wh_receipt_a');
    assert.equal(
      context.prisma.__store.afterSalesReceiptSerializedUnits.find(
        (row) => row.id === matchedFact.id,
      ).activeOriginalUnitKey,
      null,
    );

    const wrongBottle = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'serialized-wrong-bottle',
      warehouseId: 'wh_receipt_a',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt_unknown',
          lineNo: 1,
          receivedQty: 1,
          condition: 'SALEABLE',
          serializedUnits: [
            {
              originalSerializedUnitId: 'unit_receipt_original',
              scannedLogisticsCode: '000099990001',
            },
          ],
        },
      ],
    });
    assert.equal(wrongBottle.response.status, 201);
    const wrongBottlePosted = await postReceipt(
      baseUrl,
      warehouse.token,
      wrongBottle.body.data.afterSalesReceipt.id,
      'serialized-wrong-bottle',
    );
    assert.equal(wrongBottlePosted.response.status, 409);
    assert.equal(
      wrongBottlePosted.body.error.code,
      'AFTER_SALES_SERIALIZED_MATCH_REQUIRED',
    );
    assert.equal(
      context.prisma.__store.inventoryMovements.filter(
        (row) =>
          row.productId === 'prod_receipt_serialized' &&
          row.movementType === 'CUSTOMER_RETURN',
      ).length,
      1,
      'a conflicting bottle scan never creates another return fact',
    );

    const unknown = await createReceipt(baseUrl, warehouse.token, {
      suffix: 'serialized-unknown',
      warehouseId: 'wh_receipt_a',
      lines: [
        {
          afterSalesOrderItemId: 'asi_receipt_unknown',
          lineNo: 1,
          receivedQty: 1,
          condition: 'EXCEPTION',
          exceptionReason: 'Scanned bottle is not linked to the original order.',
          serializedUnits: [
            { scannedLogisticsCode: '000099990001' },
          ],
        },
      ],
    });
    assert.equal(unknown.response.status, 201);
    const unknownPosted = await postReceipt(
      baseUrl,
      warehouse.token,
      unknown.body.data.afterSalesReceipt.id,
      'serialized-unknown',
    );
    assert.equal(unknownPosted.response.status, 201);
    assert.equal(
      unknownPosted.body.data.afterSalesReceipt.lines[0].serializedUnits[0]
        .matchStatus,
      'unknown',
    );
    assert.equal(
      context.prisma.__store.inventoryMovements.filter(
        (row) =>
          row.productId === 'prod_receipt_serialized' &&
          row.movementType === 'CUSTOMER_RETURN',
      ).length,
      1,
    );
    assert.equal(
      context.prisma.__store.serializedInventoryUnits.length,
      1,
      'unknown logistics codes never create a fake bottle',
    );
  });
});

test('after-sales RESEND fulfillment uses the source order inventory context and never the financial AFTER_SALES order', async () => {
  await withFulfillmentServer(async (baseUrl, context) => {
    const warehouse = await login(baseUrl, 'receipt_warehouse', PASSWORD);
    const reserved = await fulfillReplacement(
      baseUrl,
      warehouse.token,
      'RESERVE',
      'fulfillment-reserve',
    );
    assert.equal(reserved.response.status, 201);
    assert.equal(reserved.body.data.sourceSalesOrderId, 'so_receipt_source');
    const reservation =
      context.prisma.__store.inventoryReservations.find(
        (row) =>
          row.inventoryLineKey.startsWith(
            'after-sales-fulfillment:',
          ),
      );
    assert.equal(reservation.salesOrderId, 'so_receipt_source');
    assert.equal(reservation.requestedQty, 2);
    assert.equal(reservation.reservedQty, 2);
    assert.equal(
      context.prisma.__store.inventoryReservations.some(
        (row) => row.salesOrderId === 'so_receipt_financial',
      ),
      false,
    );

    const outbound = await fulfillReplacement(
      baseUrl,
      warehouse.token,
      'OUTBOUND',
      'fulfillment-outbound',
    );
    assert.equal(outbound.response.status, 201);
    const currentReservation =
      context.prisma.__store.inventoryReservations.find(
        (row) => row.id === reservation.id,
      );
    assert.equal(currentReservation.reservedQty, 0);
    assert.equal(currentReservation.outboundQty, 2);
    const stock = context.prisma.__store.warehouseProductStocks.find(
      (row) => row.warehouseId === 'wh_receipt_a',
    );
    assert.equal(stock.onHandQty, -2);
    assert.equal(stock.reservedQty, 0);
    assert.equal(
      context.prisma.__store.inventoryMovements.filter(
        (row) =>
          row.movementType === 'SALES_OUT' &&
          row.productId === 'prod_receipt_quantity',
      ).length,
      1,
    );
    assert.equal(
      context.prisma.__store.inventoryDocuments.some(
        (row) => row.sourceId === 'so_receipt_financial',
      ),
      false,
    );
  });
});

async function withReceiptServer(run) {
  await withNestApiServer(
    async (baseUrl, context) => {
      const product = await context.prisma.product.create({
        data: {
          id: 'prod_receipt_quantity',
          name: 'Receipt Quantity Product',
          normalizedName: 'receipt quantity product',
          unit: '瓶',
          inventoryTrackingMode: 'QUANTITY',
          isActive: true,
        },
      });
      assert.equal(product.inventoryTrackingMode, 'QUANTITY');
      await run(baseUrl, context);
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_receipt_warehouse',
            name: 'Receipt Warehouse',
            username: 'receipt_warehouse',
            password: PASSWORD,
            role: 'warehouse',
          },
          {
            id: 'usr_receipt_after_sales',
            name: 'Receipt After Sales',
            username: 'receipt_after_sales',
            password: PASSWORD,
            role: 'after_sales',
          },
          {
            id: 'usr_receipt_boss',
            name: 'Receipt Boss',
            username: 'receipt_boss',
            password: PASSWORD,
            role: 'boss',
          },
          {
            id: 'usr_receipt_sales',
            name: 'Receipt Sales',
            username: 'receipt_sales',
            password: PASSWORD,
            role: 'sales',
          },
        ],
        warehouses: [
          warehouseRow('wh_receipt_a', 'A'),
          warehouseRow('wh_receipt_b', 'B'),
        ],
        salesOrders: [
          {
            id: 'so_receipt_source',
            orderNo: 'SO-RECEIPT-SOURCE',
            orderType: 'DIRECT',
            customerName: 'Receipt Customer',
            orderDate: '2026-07-27',
            totalAmountCents: 2000,
            status: 'VALID',
            packingStatus: 'PACKED',
            salesUserId: 'usr_receipt_sales',
          },
          {
            id: 'so_receipt_financial',
            orderNo: 'AS-RECEIPT',
            orderType: 'AFTER_SALES',
            sourceSalesOrderId: 'so_receipt_source',
            customerName: 'Receipt Customer',
            orderDate: '2026-07-27',
            totalAmountCents: 2000,
            status: 'VALID',
            packingStatus: 'PACKED',
          },
        ],
        afterSalesOrders: [
          {
            id: 'as_receipt',
            afterSalesNo: 'AS-RECEIPT',
            salesOrderId: 'so_receipt_source',
            afterSalesSalesOrderId: 'so_receipt_financial',
            issueType: 'CUSTOMER_RETURN',
            actionType: 'RETURN_REFUND',
            description: 'physical return test',
            refundAmountCents: 2000,
            status: 'WAITING_RECEIVE',
          },
        ],
        afterSalesOrderItems: [
          {
            id: 'asi_receipt',
            afterSalesOrderId: 'as_receipt',
            productId: 'prod_receipt_quantity',
            productName: 'Receipt Quantity Product',
            unit: '瓶',
            quantity: 2,
            originalUnitPriceCents: 1000,
            subtotalCents: 2000,
            returnRequired: true,
            expectedReturnQty: 2,
          },
        ],
      },
    },
  );
}

async function withFulfillmentServer(run) {
  await withNestApiServer(
    async (baseUrl, context) => {
      await context.prisma.product.create({
        data: {
          id: 'prod_receipt_quantity',
          name: 'Replacement Quantity Product',
          normalizedName: 'replacement quantity product',
          unit: '瓶',
          inventoryTrackingMode: 'QUANTITY',
          isActive: true,
        },
      });
      await run(baseUrl, context);
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_receipt_warehouse',
            name: 'Receipt Warehouse',
            username: 'receipt_warehouse',
            password: PASSWORD,
            role: 'warehouse',
          },
        ],
        warehouses: [warehouseRow('wh_receipt_a', 'A')],
        salesOrders: [
          {
            id: 'so_receipt_source',
            orderNo: 'SO-REPLACEMENT-SOURCE',
            orderType: 'DIRECT',
            customerName: 'Replacement Customer',
            orderDate: '2026-07-27',
            totalAmountCents: 2000,
            status: 'VALID',
            packingStatus: 'PACKED',
          },
          {
            id: 'so_receipt_financial',
            orderNo: 'AS-REPLACEMENT-FINANCE',
            orderType: 'AFTER_SALES',
            sourceSalesOrderId: 'so_receipt_source',
            customerName: 'Replacement Customer',
            orderDate: '2026-07-27',
            totalAmountCents: 2000,
            status: 'VALID',
            packingStatus: 'PACKED',
          },
        ],
        afterSalesOrders: [
          {
            id: 'as_fulfillment',
            afterSalesNo: 'AS-REPLACEMENT-FINANCE',
            salesOrderId: 'so_receipt_source',
            afterSalesSalesOrderId: 'so_receipt_financial',
            issueType: 'LOGISTICS_DAMAGE',
            actionType: 'RESEND',
            description: 'replacement fulfillment test',
            refundAmountCents: 0,
            status: 'WAITING_RESEND',
          },
        ],
        afterSalesOrderItems: [
          {
            id: 'asi_fulfillment',
            afterSalesOrderId: 'as_fulfillment',
            productId: 'prod_receipt_quantity',
            productName: 'Replacement Quantity Product',
            unit: '瓶',
            quantity: 2,
            originalUnitPriceCents: 1000,
            subtotalCents: 0,
            returnRequired: false,
            expectedReturnQty: 0,
          },
        ],
      },
    },
  );
}

async function withSerializedReceiptServer(run) {
  await withNestApiServer(
    async (baseUrl, context) => {
      await context.prisma.product.create({
        data: {
          id: 'prod_receipt_serialized',
          name: 'Serialized Receipt Product',
          normalizedName: 'serialized receipt product',
          unit: '瓶',
          inventoryTrackingMode: 'SERIALIZED',
          isActive: true,
        },
      });
      await run(baseUrl, context);
    },
    {
      prisma: {
        users: [
          {
            id: 'usr_receipt_warehouse',
            name: 'Receipt Warehouse',
            username: 'receipt_warehouse',
            password: PASSWORD,
            role: 'warehouse',
          },
        ],
        warehouses: [
          warehouseRow('wh_receipt_a', 'A'),
          warehouseRow('wh_receipt_b', 'B'),
        ],
        salesOrders: [
          {
            id: 'so_receipt_source',
            orderNo: 'SO-SERIALIZED-RETURN',
            orderType: 'DIRECT',
            customerName: 'Serialized Return Customer',
            orderDate: '2026-07-27',
            totalAmountCents: 4000,
            status: 'VALID',
            packingStatus: 'PACKED',
          },
          {
            id: 'so_receipt_financial',
            orderNo: 'AS-SERIALIZED-RETURN',
            orderType: 'AFTER_SALES',
            sourceSalesOrderId: 'so_receipt_source',
            customerName: 'Serialized Return Customer',
            orderDate: '2026-07-27',
            totalAmountCents: 4000,
            status: 'VALID',
            packingStatus: 'PACKED',
          },
        ],
        afterSalesOrders: [
          {
            id: 'as_receipt',
            afterSalesNo: 'AS-SERIALIZED-RETURN',
            salesOrderId: 'so_receipt_source',
            afterSalesSalesOrderId: 'so_receipt_financial',
            issueType: 'CUSTOMER_RETURN',
            actionType: 'RETURN_REFUND',
            description: 'serialized physical return test',
            refundAmountCents: 4000,
            status: 'WAITING_RECEIVE',
          },
        ],
        afterSalesOrderItems: [
          {
            id: 'asi_receipt',
            afterSalesOrderId: 'as_receipt',
            productId: 'prod_receipt_serialized',
            productName: 'Serialized Receipt Product',
            unit: '瓶',
            quantity: 1,
            originalUnitPriceCents: 2000,
            subtotalCents: 2000,
            returnRequired: true,
            expectedReturnQty: 1,
          },
          {
            id: 'asi_receipt_unknown',
            afterSalesOrderId: 'as_receipt',
            productId: 'prod_receipt_serialized',
            productName: 'Serialized Receipt Product',
            unit: '瓶',
            quantity: 1,
            originalUnitPriceCents: 2000,
            subtotalCents: 2000,
            returnRequired: true,
            expectedReturnQty: 1,
          },
        ],
        inventoryReservations: [
          {
            id: 'reservation_receipt_original',
            sourceKey: 'reservation:serialized-return',
            salesOrderId: 'so_receipt_source',
            salesOrderItemId: null,
            inventoryLineKey: 'serialized-return-line',
            warehouseId: 'wh_receipt_a',
            productId: 'prod_receipt_serialized',
            requestedQty: 1,
            reservedQty: 0,
            assignedQty: 0,
            outboundQty: 1,
            status: 'CONSUMED',
            version: 0,
          },
        ],
        serializedInventoryUnits: [
          {
            id: 'unit_receipt_original',
            productId: 'prod_receipt_serialized',
            warehouseId: 'wh_receipt_a',
            inventoryBatchId: null,
            logisticsCode: '000012340001',
            normalizedLogisticsCode: '000012340001',
            purchaseCostCents: 1200,
            status: 'OUTBOUND',
            version: 0,
          },
        ],
        serializedInventoryAssignments: [
          {
            id: 'assignment_receipt_original',
            reservationId: 'reservation_receipt_original',
            serializedUnitId: 'unit_receipt_original',
            status: 'OUTBOUND',
            sourceKey: 'assignment:serialized-return',
            activeUnitKey: null,
            purchaseCostSnapshotCents: 1200,
            version: 1,
          },
        ],
      },
    },
  );
}

async function createReceipt(baseUrl, token, options) {
  const sourceKey = `after-sales-receipt:${options.suffix}`;
  const idempotencyKey = `idem:after-sales-receipt:${options.suffix}`;
  const normalized = {
    afterSalesOrderId: 'as_receipt',
    warehouseId: options.warehouseId,
    notes: null,
    lines: options.lines.map((line) => ({
      afterSalesOrderItemId: line.afterSalesOrderItemId,
      lineNo: line.lineNo,
      receivedQty: line.receivedQty,
      condition: line.condition,
      inventoryBatchId: line.inventoryBatchId ?? null,
      exceptionReason: line.exceptionReason ?? null,
      notes: null,
      serializedUnits: (line.serializedUnits || []).map((scan) => ({
        originalSerializedUnitId:
          scan.originalSerializedUnitId ?? null,
        scannedLogisticsCode: scan.scannedLogisticsCode,
        normalizedScannedLogisticsCode:
          scan.scannedLogisticsCode.trim().toLowerCase(),
      })),
    })),
    sourceKey,
    idempotencyKey,
  };
  const body = {
    sourceKey,
    idempotencyKey,
    requestHash: calculateAfterSalesReceiptRequestHash(
      'CREATE',
      normalized,
    ),
    warehouseId: options.warehouseId,
    lines: options.lines,
  };
  return await requestJson(
    baseUrl,
    '/api/after-sales-orders/as_receipt/receipts',
    {
      method: 'POST',
      token,
      body,
    },
  );
}

async function postReceipt(baseUrl, token, receiptId, suffix) {
  const body = lifecycleBody(
    'POST',
    receiptId,
    `post-${suffix}`,
    `post-idem-${suffix}`,
  );
  return await requestJson(
    baseUrl,
    `/api/after-sales-orders/receipts/${receiptId}/post`,
    {
      method: 'POST',
      token,
      body,
    },
  );
}

function lifecycleBody(
  action,
  receiptId,
  sourceKey,
  idempotencyKey,
  overrides = {},
) {
  const normalized = {
    receiptId,
    businessAt: null,
    reason: overrides.reason ?? null,
    sourceKey,
    idempotencyKey,
  };
  return {
    sourceKey,
    idempotencyKey,
    ...(overrides.reason ? { reason: overrides.reason } : {}),
    requestHash: calculateAfterSalesReceiptRequestHash(
      action,
      normalized,
    ),
  };
}

async function fulfillReplacement(
  baseUrl,
  token,
  action,
  suffix,
) {
  const sourceKey = `after-sales-fulfillment:${suffix}`;
  const idempotencyKey = `idem:after-sales-fulfillment:${suffix}`;
  const normalized = {
    afterSalesOrderId: 'as_fulfillment',
    warehouseId: 'wh_receipt_a',
    action,
    lines: [
      {
        afterSalesOrderItemId: 'asi_fulfillment',
        quantity: 2,
      },
    ],
    sourceKey,
    idempotencyKey,
  };
  return await requestJson(
    baseUrl,
    '/api/after-sales-orders/as_fulfillment/fulfillment',
    {
      method: 'POST',
      token,
      body: {
        sourceKey,
        idempotencyKey,
        requestHash: calculateAfterSalesReceiptRequestHash(
          'FULFILL',
          normalized,
        ),
        warehouseId: 'wh_receipt_a',
        action,
        lines: normalized.lines,
      },
    },
  );
}

function warehouseRow(id, suffix) {
  return {
    id,
    code: `WH-${suffix}`,
    normalizedCode: `wh-${suffix.toLowerCase()}`,
    name: `Receipt Warehouse ${suffix}`,
    normalizedName: `receipt warehouse ${suffix.toLowerCase()}`,
    isActive: true,
    isDefault: false,
    activeDefaultKey: null,
  };
}

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const PASSWORD = 'Password123';

test('quantity sales orders: all seven write paths share stable reservation/outbound facts without leaking inventory', async () => {
  await withPhase1Server(
    async (baseUrl, { prisma }) => {
      const admin = await login(baseUrl);
      const sales = await createRoleSession(
        baseUrl,
        admin.token,
        'sales',
      );
      const warehouse = await createRoleSession(
        baseUrl,
        admin.token,
        'warehouse',
      );
      const finance = await createRoleSession(
        baseUrl,
        admin.token,
        'finance',
      );
      const product = await createQuantityProduct(
        baseUrl,
        admin.token,
        prisma,
        'Quantity Integration Wine',
      );

      const serverOwned = await requestJson(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: sales.token,
          body: orderBody(product.id, [
            line(product.id, 1, 'shipping', {
              inventoryLineKey: 'client-key',
            }),
          ]),
        },
      );
      assertErrorContract(
        serverOwned,
        403,
        'INVENTORY_FIELD_SERVER_OWNED',
      );

      const ordersBeforeCreateRollback =
        prisma.__store.salesOrders.length;
      const movementsBeforeCreateRollback =
        prisma.__store.inventoryMovements.length;
      const commissionsBeforeCreateRollback =
        prisma.__store.commissionRecords.length;
      const operationLogCreateBeforeRollback =
        prisma.operationLog.create;
      let failCreateInventoryLog = true;
      prisma.operationLog.create = async (args) => {
        if (
          failCreateInventoryLog &&
          args?.data?.action === 'inventory.outbound.posted'
        ) {
          failCreateInventoryLog = false;
          throw new Error('TEST_CREATE_INVENTORY_FAILURE');
        }
        return operationLogCreateBeforeRollback(args);
      };
      const createRolledBack = await requestJson(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: sales.token,
          body: orderBody(product.id, [
            line(product.id, 1, 'self_pickup'),
          ]),
        },
      );
      prisma.operationLog.create =
        operationLogCreateBeforeRollback;
      assert.equal(createRolledBack.response.status, 500);
      assert.equal(
        prisma.__store.salesOrders.length,
        ordersBeforeCreateRollback,
      );
      assert.equal(
        prisma.__store.inventoryMovements.length,
        movementsBeforeCreateRollback,
      );
      assert.equal(
        prisma.__store.commissionRecords.length,
        commissionsBeforeCreateRollback,
      );

      const created = await requestJson(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: sales.token,
          body: orderBody(product.id, [
            line(product.id, 2, 'shipping'),
            line(product.id, 1, 'self_pickup'),
          ]),
        },
      );
      assert.equal(
        created.response.status,
        201,
        JSON.stringify(created.body),
      );
      let order = created.body.data.salesOrder;
      assertNoInventoryLeak(order);

      const storedOrder = prisma.__store.salesOrders.find(
        (item) => item.id === order.id,
      );
      assert.equal(storedOrder.fulfillmentWarehouseId, 'wh-a');
      assert.equal(storedOrder.inventoryPolicyVersion, 7);
      assert.ok(storedOrder.inventoryAppliedAt);
      assert.equal(storedOrder.inventoryVersion, 1);

      let storedItems = orderItems(prisma, order.id);
      assert.equal(storedItems.length, 2);
      assert.equal(
        storedItems.every(
          (item) =>
            typeof item.inventoryLineKey === 'string' &&
            item.inventoryLineKey.startsWith('inventory-line:'),
        ),
        true,
      );
      const shippingLineKey = storedItems.find(
        (item) => item.deliveryType === 'SHIPPING',
      ).inventoryLineKey;
      const pickupLineKey = storedItems.find(
        (item) => item.deliveryType === 'SELF_PICKUP',
      ).inventoryLineKey;
      assert.notEqual(shippingLineKey, pickupLineKey);

      assertReservation(prisma, order.id, shippingLineKey, {
        warehouseId: 'wh-a',
        requestedQty: 2,
        reservedQty: 2,
        outboundQty: 0,
      });
      assertReservation(prisma, order.id, pickupLineKey, {
        warehouseId: 'wh-a',
        requestedQty: 1,
        reservedQty: 0,
        outboundQty: 1,
      });
      assertStock(prisma, 'wh-a', product.id, {
        onHandQty: -1,
        reservedQty: 2,
        availableQty: -3,
      });
      assert.equal(prisma.__store.inventoryMovements.length, 3);
      assert.equal(
        prisma.__store.inventoryPostCommitTasks.every(
          (task) => task.status === 'SUCCEEDED',
        ),
        true,
      );
      const activeOrderShortageAlerts =
        prisma.__store.inventoryAlerts.filter(
          (alert) =>
            alert.status === 'ACTIVE' &&
            alert.type === 'ORDER_SHORTAGE',
        );
      assert.equal(
        activeOrderShortageAlerts.length,
        1,
      );
      const shortageAlert = prisma.__store.inventoryAlerts.find(
        (alert) =>
          alert.status === 'ACTIVE' &&
          alert.type === 'ORDER_SHORTAGE',
      );
      assert.equal(shortageAlert.salesOrderId, null);
      const shortageTodos = prisma.__store.businessTodos.filter(
        (todo) =>
          todo.sourceId === shortageAlert.id &&
          todo.ruleCode.startsWith('INVENTORY_ORDER_SHORTAGE_'),
      );
      assert.deepEqual(
        new Set(shortageTodos.map((todo) => todo.targetRole)),
        new Set(['WAREHOUSE', 'BOSS', 'ADMIN', 'SUPER_ADMIN']),
      );
      assert.equal(
        shortageTodos.some(
          (todo) =>
            /onHand|reserved|available|shortage|采购|成本|瓶码/i.test(
              JSON.stringify({
                title: todo.title,
                content: todo.content,
                sourceSnapshot: todo.sourceSnapshot,
              }),
            ),
        ),
        false,
      );
      const shortageTodoIds = new Set(
        shortageTodos.map((todo) => todo.id),
      );
      const shortageRecipientRoles =
        prisma.__store.todoRecipients
          .filter((recipient) =>
            shortageTodoIds.has(recipient.todoId),
          )
          .map((recipient) =>
            prisma.__store.users.find(
              (user) => user.id === recipient.userId,
            )?.role,
          );
      assert.equal(shortageRecipientRoles.includes('SALES'), false);
      assert.equal(shortageRecipientRoles.includes('WAREHOUSE'), true);
      assert.equal(
        shortageRecipientRoles.includes('SUPER_ADMIN'),
        true,
      );

      const movementsBeforeSalesEdit =
        prisma.__store.inventoryMovements.length;
      const salesEdited = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/sales-edit`,
        {
          method: 'PATCH',
          token: sales.token,
          body: {
            status: 'valid',
            financeRemark: 'combined finance field',
            warehouseRemark: 'combined packing field',
            packingStatus: 'packing',
            items: order.items.map((item) => ({
              id: item.id,
              productId: item.productId,
              quantity:
                item.deliveryType === 'shipping' ? 3 : item.quantity,
              unitPriceCents: item.unitPriceCents,
              subtotalCents:
                (item.deliveryType === 'shipping'
                  ? 3
                  : item.quantity) * item.unitPriceCents,
              deliveryType: item.deliveryType,
              notes: item.notes,
              sortOrder: item.sortOrder,
            })),
          },
        },
      );
      assert.equal(salesEdited.response.status, 200);
      order = salesEdited.body.data.salesOrder;
      assertNoInventoryLeak(order);
      storedItems = orderItems(prisma, order.id);
      assert.equal(
        storedItems.find(
          (item) => item.deliveryType === 'SHIPPING',
        ).inventoryLineKey,
        shippingLineKey,
      );
      assertReservation(prisma, order.id, shippingLineKey, {
        reservedQty: 3,
        outboundQty: 0,
      });
      assert.equal(
        prisma.__store.inventoryMovements.length,
        movementsBeforeSalesEdit + 1,
      );

      const generalPatched = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}`,
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            items: order.items.map((item) => ({
              id: item.id,
              productId: item.productId,
              quantity:
                item.deliveryType === 'shipping' ? 2 : item.quantity,
              unitPriceCents: item.unitPriceCents,
              subtotalCents:
                (item.deliveryType === 'shipping'
                  ? 2
                  : item.quantity) * item.unitPriceCents,
              deliveryType: item.deliveryType,
              notes: item.notes,
              sortOrder: item.sortOrder,
            })),
          },
        },
      );
      assert.equal(generalPatched.response.status, 200);
      order = generalPatched.body.data.salesOrder;
      assertReservation(prisma, order.id, shippingLineKey, {
        reservedQty: 2,
        outboundQty: 0,
      });

      const financeCancelled = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/finance`,
        {
          method: 'PATCH',
          token: finance.token,
          body: { status: 'cancelled' },
        },
      );
      assert.equal(financeCancelled.response.status, 200);
      order = financeCancelled.body.data.salesOrder;
      assertReservation(prisma, order.id, shippingLineKey, {
        reservedQty: 0,
        outboundQty: 0,
      });
      assertReservation(prisma, order.id, pickupLineKey, {
        reservedQty: 0,
        outboundQty: 1,
      });
      assertStock(prisma, 'wh-a', product.id, {
        onHandQty: -1,
        reservedQty: 0,
        availableQty: -1,
      });
      assert.equal(
        prisma.__store.inventoryAlerts.filter(
          (alert) =>
            alert.status === 'ACTIVE' &&
            alert.type === 'ORDER_SHORTAGE',
        ).length,
        0,
      );

      const restored = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/status`,
        {
          method: 'PATCH',
          token: admin.token,
          body: { status: 'valid' },
        },
      );
      assert.equal(restored.response.status, 200);
      order = restored.body.data.salesOrder;
      assertReservation(prisma, order.id, shippingLineKey, {
        reservedQty: 2,
        outboundQty: 0,
      });

      const beforePackMovements =
        prisma.__store.inventoryMovements.length;
      const packed = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/packing`,
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            logisticsProviderCode: 'shunfeng',
            packingStatus: 'packed',
          },
        },
      );
      assert.equal(
        packed.response.status,
        200,
        JSON.stringify(packed.body),
      );
      order = packed.body.data.salesOrder;
      assertReservation(prisma, order.id, shippingLineKey, {
        reservedQty: 0,
        outboundQty: 2,
      });
      assertStock(prisma, 'wh-a', product.id, {
        onHandQty: -3,
        reservedQty: 0,
        availableQty: -3,
      });
      assert.equal(
        prisma.__store.inventoryMovements.length,
        beforePackMovements + 1,
      );

      const repeatedPacked = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/packing`,
        {
          method: 'PATCH',
          token: warehouse.token,
          body: { packingStatus: 'packed' },
        },
      );
      assert.equal(repeatedPacked.response.status, 200);
      assert.equal(
        prisma.__store.inventoryMovements.length,
        beforePackMovements + 1,
      );

      const warehouseAlias = await requestJson(
        baseUrl,
        `/api/warehouse/orders/${order.id}/packing`,
        {
          method: 'PATCH',
          token: warehouse.token,
          body: { warehouseRemark: 'alias does not replay outbound' },
        },
      );
      assert.equal(warehouseAlias.response.status, 200);
      assert.equal(
        prisma.__store.inventoryMovements.length,
        beforePackMovements + 1,
      );

      const financeOnly = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/finance`,
        {
          method: 'PATCH',
          token: finance.token,
          body: { financeRemark: 'does not replay outbound' },
        },
      );
      assert.equal(financeOnly.response.status, 200);
      assert.equal(
        prisma.__store.inventoryMovements.length,
        beforePackMovements + 1,
      );

      const afterOutboundEdit = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}`,
        {
          method: 'PATCH',
          token: admin.token,
          body: {
            items: order.items.map((item) => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity + 1,
              unitPriceCents: item.unitPriceCents,
              subtotalCents:
                (item.quantity + 1) * item.unitPriceCents,
              deliveryType: item.deliveryType,
              notes: item.notes,
              sortOrder: item.sortOrder,
            })),
          },
        },
      );
      assertErrorContract(
        afterOutboundEdit,
        409,
        'INVENTORY_OUTBOUND_ITEM_IMMUTABLE',
      );

      const beforeRefundStock = stockRow(prisma, 'wh-a', product.id);
      const refunded = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}/status`,
        {
          method: 'PATCH',
          token: admin.token,
          body: { status: 'refunded' },
        },
      );
      assert.equal(refunded.response.status, 200);
      assert.deepEqual(
        pickStock(stockRow(prisma, 'wh-a', product.id)),
        pickStock(beforeRefundStock),
      );
      assert.equal(
        prisma.__store.inventoryMovements.length,
        beforePackMovements + 1,
      );

      const shippingOnly = await createShippingOrder(
        baseUrl,
        sales.token,
        product.id,
        'Warehouse Switch Customer',
      );
      const switchStoredItem = orderItems(
        prisma,
        shippingOnly.id,
      )[0];
      assertReservation(
        prisma,
        shippingOnly.id,
        switchStoredItem.inventoryLineKey,
        {
          warehouseId: 'wh-a',
          reservedQty: 2,
          outboundQty: 0,
        },
      );
      const switched = await requestJson(
        baseUrl,
        `/api/warehouse/orders/${shippingOnly.id}/packing`,
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            fulfillmentWarehouseId: 'wh-b',
            packingStatus: 'packing',
          },
        },
      );
      assert.equal(switched.response.status, 200);
      assertReservation(
        prisma,
        shippingOnly.id,
        switchStoredItem.inventoryLineKey,
        {
          warehouseId: 'wh-b',
          reservedQty: 2,
          outboundQty: 0,
        },
      );
      assertStock(prisma, 'wh-a', product.id, {
        reservedQty: 0,
      });
      assertStock(prisma, 'wh-b', product.id, {
        reservedQty: 2,
      });

      const afterSalesMovementCount =
        prisma.__store.inventoryMovements.length;
      const afterSalesFinancial = await requestJson(
        baseUrl,
        '/api/sales-orders',
        {
          method: 'POST',
          token: admin.token,
          body: {
            ...orderBody(product.id, [
              line(product.id, 2, 'self_pickup'),
            ]),
            orderType: 'after_sales',
            customerId: 'customer-after-sales',
          },
        },
      );
      assert.equal(afterSalesFinancial.response.status, 201);
      const afterSalesStored = prisma.__store.salesOrders.find(
        (item) =>
          item.id === afterSalesFinancial.body.data.salesOrder.id,
      );
      assert.equal(afterSalesStored.inventoryAppliedAt, null);
      assert.equal(
        prisma.__store.inventoryMovements.length,
        afterSalesMovementCount,
      );

      const historicalId = 'historical-order-before-inventory-go-live';
      const historicalSource = prisma.__store.salesOrders.find(
        (item) => item.id === shippingOnly.id,
      );
      const historicalSourceItem = orderItems(
        prisma,
        shippingOnly.id,
      )[0];
      prisma.__store.salesOrders.push({
        ...historicalSource,
        id: historicalId,
        orderNo: 'HISTORICAL-ORDER-001',
        customerId: 'customer-historical',
        status: 'VALID',
        packingStatus: 'PENDING',
        fulfillmentWarehouseId: null,
        inventoryAppliedAt: null,
        inventoryPolicyVersion: null,
        inventoryVersion: 0,
      });
      prisma.__store.salesOrderItems.push({
        ...historicalSourceItem,
        id: 'historical-order-item-before-inventory-go-live',
        salesOrderId: historicalId,
        quantity: 1,
        subtotalCents: historicalSourceItem.unitPriceCents,
        inventoryLineKey: null,
      });
      const movementsBeforeHistoricalEdit =
        prisma.__store.inventoryMovements.length;
      const historicalEdit = await requestJson(
        baseUrl,
        `/api/sales-orders/${historicalId}/finance`,
        {
          method: 'PATCH',
          token: finance.token,
          body: { financeRemark: 'historical non-inventory edit' },
        },
      );
      assert.equal(historicalEdit.response.status, 200);
      assert.equal(
        prisma.__store.inventoryMovements.length,
        movementsBeforeHistoricalEdit,
      );
      assert.equal(
        orderItems(prisma, historicalId)[0].inventoryLineKey,
        null,
      );

      const concurrentOrder = await createShippingOrder(
        baseUrl,
        sales.token,
        product.id,
        'Concurrent Customer',
      );
      const concurrentLine = orderItems(
        prisma,
        concurrentOrder.id,
      )[0];
      const movementsBeforeConcurrentPack =
        prisma.__store.inventoryMovements.length;
      const concurrentPackResults = await Promise.all([
        requestJson(
          baseUrl,
          `/api/sales-orders/${concurrentOrder.id}/packing`,
          {
            method: 'PATCH',
            token: warehouse.token,
            body: {
              logisticsProviderCode: 'shunfeng',
              packingStatus: 'packed',
            },
          },
        ),
        requestJson(
          baseUrl,
          `/api/warehouse/orders/${concurrentOrder.id}/packing`,
          {
            method: 'PATCH',
            token: warehouse.token,
            body: { packingStatus: 'packed' },
          },
        ),
      ]);
      assert.equal(
        concurrentPackResults.some(
          (result) => result.response.status === 200,
        ),
        true,
      );
      assert.equal(
        concurrentPackResults.every((result) =>
          [200, 409].includes(result.response.status),
        ),
        true,
      );
      assert.equal(
        prisma.__store.inventoryMovements.length,
        movementsBeforeConcurrentPack + 1,
      );
      assertReservation(
        prisma,
        concurrentOrder.id,
        concurrentLine.inventoryLineKey,
        { reservedQty: 0, outboundQty: 2 },
      );

      const rollbackOrder = await createShippingOrder(
        baseUrl,
        sales.token,
        product.id,
        'Rollback Customer',
      );
      const movementsBeforeRollback =
        prisma.__store.inventoryMovements.length;
      const originalCreate = prisma.operationLog.create;
      let failInventoryOutboundLog = true;
      prisma.operationLog.create = async (args) => {
        if (
          failInventoryOutboundLog &&
          args?.data?.action === 'inventory.outbound.posted'
        ) {
          failInventoryOutboundLog = false;
          throw new Error('TEST_INVENTORY_AUDIT_FAILURE');
        }
        return originalCreate(args);
      };
      const rolledBack = await requestJson(
        baseUrl,
        `/api/sales-orders/${rollbackOrder.id}/packing`,
        {
          method: 'PATCH',
          token: warehouse.token,
          body: {
            logisticsProviderCode: 'shunfeng',
            packingStatus: 'packed',
          },
        },
      );
      assert.equal(
        rolledBack.response.status,
        500,
        JSON.stringify(rolledBack.body),
      );
      prisma.operationLog.create = originalCreate;
      assert.equal(
        prisma.__store.inventoryMovements.length,
        movementsBeforeRollback,
      );
      const rollbackStored = prisma.__store.salesOrders.find(
        (item) => item.id === rollbackOrder.id,
      );
      assert.equal(rollbackStored.packingStatus, 'PENDING');

      const apiDetail = await requestJson(
        baseUrl,
        `/api/sales-orders/${order.id}`,
        { token: sales.token },
      );
      assert.equal(apiDetail.response.status, 200);
      assertNoInventoryLeak(apiDetail.body.data.salesOrder);
      const listed = await requestJson(
        baseUrl,
        '/api/sales-orders',
        { token: sales.token },
      );
      assert.equal(listed.response.status, 200);
      assert.equal(
        JSON.stringify(listed.body.data.salesOrders).includes(
          'inventoryLineKey',
        ),
        false,
      );
    },
    {
      prisma: {
        customers: [
          customer('customer-quantity'),
          customer('customer-switch'),
          customer('customer-after-sales'),
          customer('customer-rollback'),
          customer('customer-concurrent'),
          customer('customer-historical'),
        ],
        inventoryConfigurations: [
          {
            id: 'inventory-config',
            singletonKey: 'INVENTORY',
            goLiveAt: new Date('2020-01-01T00:00:00.000Z'),
            policyVersion: 7,
            maintenanceMode: false,
          },
        ],
        warehouses: [
          {
            id: 'wh-a',
            code: 'WH-A',
            normalizedCode: 'wh-a',
            name: 'Test Warehouse A',
            normalizedName: 'testwarehousea',
            isActive: true,
            isDefault: true,
            activeDefaultKey: 'ACTIVE_DEFAULT',
          },
          {
            id: 'wh-b',
            code: 'WH-B',
            normalizedCode: 'wh-b',
            name: 'Test Warehouse B',
            normalizedName: 'testwarehouseb',
            isActive: true,
            isDefault: false,
            activeDefaultKey: null,
          },
        ],
      },
    },
  );
});

test('quantity sales order hook contract covers every controller write route and keeps server-owned fields out of DTOs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const serviceSource = fs.readFileSync(
    path.join(
      __dirname,
      '../src/modules/business-data/business-data.nest.service.ts',
    ),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    path.join(
      __dirname,
      '../src/modules/business-data/sales-orders.nest.controller.ts',
    ),
    'utf8',
  );
  const warehouseControllerSource = fs.readFileSync(
    path.join(
      __dirname,
      '../src/modules/business-data/warehouse-orders.nest.controller.ts',
    ),
    'utf8',
  );

  for (const route of [
    "@Post()",
    "@Patch(':id/sales-edit')",
    "@Patch(':id')",
    "@Patch(':id/finance')",
    "@Patch(':id/status')",
    "@Patch(':id/packing')",
  ]) {
    assert.equal(controllerSource.includes(route), true, route);
  }
  assert.equal(
    warehouseControllerSource.includes("@Patch(':id/packing')"),
    true,
  );
  for (const method of [
    'createSalesOrder',
    'salesEditSalesOrder',
    'updateSalesOrder',
    'updateSalesOrderFinance',
    'updateSalesOrderPacking',
    'updateSalesOrderStatus',
  ]) {
    const section = methodSection(serviceSource, method);
    assert.equal(
      section.includes('salesOrderInventoryService'),
      true,
      `${method} must call the inventory domain integration`,
    );
  }
  const aliasSection = methodSection(
    serviceSource,
    'updateWarehouseOrderPacking',
  );
  assert.equal(
    aliasSection.includes('return this.updateSalesOrderPacking'),
    true,
  );
  const dtoSection = methodSection(serviceSource, 'toSalesOrderDto');
  for (const forbidden of [
    'fulfillmentWarehouseId:',
    'inventoryAppliedAt:',
    'inventoryPolicyVersion:',
    'inventoryVersion:',
    'inventoryLineKey:',
    'onHandQty:',
    'reservedQty:',
    'availableQty:',
    'shortageQty:',
  ]) {
    assert.equal(dtoSection.includes(forbidden), false, forbidden);
  }
});

async function createQuantityProduct(
  baseUrl,
  adminToken,
  prisma,
  name,
) {
  const created = await requestJson(baseUrl, '/api/products', {
    method: 'POST',
    token: adminToken,
    body: { name, unit: 'bottle' },
  });
  assert.equal(created.response.status, 201);
  const product = created.body.data.product;
  const stored = prisma.__store.products.find(
    (item) => item.id === product.id,
  );
  stored.inventoryTrackingMode = 'QUANTITY';
  const cost = await requestJson(
    baseUrl,
    `/api/products/${product.id}/actual-costs`,
    {
      method: 'POST',
      token: adminToken,
      body: {
        costCents: 100,
        effectiveFrom: '2000-01-01',
      },
    },
  );
  assert.equal(cost.response.status, 201);
  return product;
}

async function createRoleSession(baseUrl, adminToken, role) {
  const username = `inventory-${role.replace(/_/g, '-')}`;
  await createUser(baseUrl, adminToken, {
    name: `Inventory ${role}`,
    username,
    role,
    password: PASSWORD,
  });
  return login(baseUrl, username, PASSWORD);
}

async function createShippingOrder(
  baseUrl,
  salesToken,
  productId,
  customerName,
) {
  const customerId = customerName.includes('Switch')
    ? 'customer-switch'
    : customerName.includes('Concurrent')
      ? 'customer-concurrent'
    : 'customer-rollback';
  const result = await requestJson(baseUrl, '/api/sales-orders', {
    method: 'POST',
    token: salesToken,
    body: {
      ...orderBody(productId, [line(productId, 2, 'shipping')]),
      customerId,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.salesOrder;
}

function orderBody(productId, items) {
  return {
    orderType: 'external',
    customerId: 'customer-quantity',
    orderDate: new Date().toISOString().slice(0, 10),
    items,
  };
}

function line(productId, quantity, deliveryType, extra = {}) {
  return {
    productId,
    quantity,
    unitPriceCents: 1000,
    subtotalCents: quantity * 1000,
    deliveryType,
    sortOrder: deliveryType === 'shipping' ? 1 : 2,
    ...extra,
  };
}

function customer(id) {
  return {
    id,
    name: id,
    phone: `138${String(id.length).padStart(8, '0')}`,
    isActive: true,
  };
}

function orderItems(prisma, orderId) {
  return prisma.__store.salesOrderItems.filter(
    (item) => item.salesOrderId === orderId,
  );
}

function assertReservation(
  prisma,
  salesOrderId,
  inventoryLineKey,
  expected,
) {
  const reservation = prisma.__store.inventoryReservations.find(
    (item) =>
      item.salesOrderId === salesOrderId &&
      item.inventoryLineKey === inventoryLineKey,
  );
  assert.ok(reservation);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(reservation[key], value, key);
  }
}

function stockRow(prisma, warehouseId, productId) {
  return prisma.__store.warehouseProductStocks.find(
    (item) =>
      item.warehouseId === warehouseId &&
      item.productId === productId,
  );
}

function assertStock(prisma, warehouseId, productId, expected) {
  const stock = stockRow(prisma, warehouseId, productId);
  assert.ok(stock);
  const availableQty =
    Number(stock.onHandQty) -
    Number(stock.reservedQty) -
    Number(stock.unavailableQty);
  const actual = { ...stock, availableQty };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, key);
  }
}

function pickStock(stock) {
  return {
    onHandQty: stock.onHandQty,
    reservedQty: stock.reservedQty,
    unavailableQty: stock.unavailableQty,
    inTransitQty: stock.inTransitQty,
  };
}

function assertNoInventoryLeak(order) {
  const serialized = JSON.stringify(order);
  for (const field of [
    'fulfillmentWarehouseId',
    'inventoryAppliedAt',
    'inventoryPolicyVersion',
    'inventoryVersion',
    'inventoryLineKey',
    'onHandQty',
    'reservedQty',
    'availableQty',
    'shortageQty',
    'movement',
    'reservation',
  ]) {
    assert.equal(serialized.includes(field), false, field);
  }
}

function methodSection(source, methodName) {
  const start = source.indexOf(` ${methodName}(`);
  assert.notEqual(start, -1, methodName);
  const next = source.indexOf('\n  async ', start + methodName.length);
  const nextFunction = source.indexOf('\nfunction ', start + methodName.length);
  const candidates = [next, nextFunction].filter((value) => value > start);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

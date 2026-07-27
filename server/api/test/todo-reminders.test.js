const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TodoRuleEngine,
} = require('../src/modules/todo-reminders/todo-rule.engine');
const {
  TodoRemindersService,
} = require('../src/modules/todo-reminders/todo-reminders.service');
const {
  InventoryPostCommitProjector,
} = require('../src/modules/inventory/inventory-post-commit.service');
const {
  USER_ROLES,
  getRoleMenus,
  getRolePermissions,
} = require('../src/modules/auth/roles');

test('all nine roles expose the todo menu and authenticated permissions', () => {
  assert.equal(USER_ROLES.length, 9);
  for (const role of USER_ROLES) {
    assert.ok(getRoleMenus(role).some((menu) => menu.id === 'todo_reminders'));
    const permissions = getRolePermissions(role);
    for (const permission of [
      'todo_reminders:list',
      'todo_reminders:read',
      'todo_reminders:update',
      'todo_reminders:verify',
      'todo_reminders:archive',
    ]) {
      assert.ok(permissions.includes(permission), `${role}: ${permission}`);
    }
  }
});

test('rule engine reuses business findings and applies the 24/8/2 hour SLAs', () => {
  const engine = new TodoRuleEngine();
  const now = new Date('2026-07-26T02:00:00.000Z');
  const travelRules = engine.evaluate(
    'TRAVEL_GROUP',
    {
      id: 'group-1',
      groupNo: 'TG-001',
      visitDate: new Date('2026-07-25T00:00:00.000Z'),
      expectedArrivalTime: '09:00',
      guideName: null,
      guidePhone: null,
      travelAgency: null,
      cigaretteFeeCents: null,
      guestCount: 2,
      tasterSummary: null,
      financeMark: false,
      salesOrders: [],
    },
    now,
  );
  assert.deepEqual(
    new Set(travelRules.map((rule) => rule.ruleCode)),
    new Set([
      'TRAVEL_GROUP_FRONT_DESK_DETAILS',
      'TRAVEL_GROUP_TASTER_SUMMARY',
      'TRAVEL_GROUP_FINANCE_MARK',
    ]),
  );

  const orderRules = engine.evaluate('SALES_ORDER', {
    id: 'order-1',
    orderNo: 'SO-001',
    status: 'VALID',
    packingStatus: 'ABNORMAL',
    logisticsNo: null,
    logisticsFeeCents: 0,
    invoiceRequired: true,
    invoiceIssued: false,
    items: [{ deliveryType: 'SHIPPING' }],
  });
  assert.deepEqual(
    new Set(orderRules.map((rule) => rule.ruleCode)),
    new Set([
      'SALES_ORDER_WAREHOUSE_FULFILLMENT',
      'SALES_ORDER_SALES_FULFILLMENT_ABNORMAL',
      'SALES_ORDER_FINANCE_LOGISTICS_NO',
      'SALES_ORDER_FINANCE_LOGISTICS_FEE',
      'SALES_ORDER_FINANCE_INVOICE',
    ]),
  );
  assert.equal(
    engine.dueAt('NORMAL', now).getTime() - now.getTime(),
    24 * 60 * 60 * 1000,
  );
  assert.equal(
    engine.dueAt('IMPORTANT', now).getTime() - now.getTime(),
    8 * 60 * 60 * 1000,
  );
  assert.equal(
    engine.dueAt('URGENT', now).getTime() - now.getTime(),
    2 * 60 * 60 * 1000,
  );
});

test('reconcile is idempotent, copies to every active role account and backfills newly enabled users', async () => {
  const store = createTodoStore({
    users: [
      user('front-1', 'FRONT_DESK', true),
      user('front-2', 'FRONT_DESK', true),
      user('front-3', 'FRONT_DESK', false),
    ],
    travelGroups: [pendingFrontDeskGroup()],
  });
  const service = createService(store);
  const now = new Date('2026-07-26T01:00:00.000Z');

  await service.reconcileSource('TRAVEL_GROUP', 'group-1', now);
  await service.reconcileSource('TRAVEL_GROUP', 'group-1', now);
  assert.equal(store.businessTodos.length, 1);
  assert.equal(store.todoRecipients.length, 2);

  store.users.find((item) => item.id === 'front-3').isActive = true;
  await service.runMaintenanceCycle(now);
  assert.equal(store.todoRecipients.length, 3);

  Object.assign(store.travelGroups[0], {
    licensePlate: '贵A12345',
    guestCount: 2,
    cigaretteFeeCents: 100,
    tastingRoomNo: 'A01',
    tasterId: 'taster-1',
    arrivalTime: '09:00',
    groupType: '其他',
  });
  await service.reconcileSource('TRAVEL_GROUP', 'group-1', now);
  assert.equal(store.businessTodos[0].status, 'RESOLVED');
  assert.ok(store.businessTodos[0].resolvedAt instanceof Date);
});

test('overdue reminders escalate once to all enabled manager roles', async () => {
  const store = createTodoStore({
    users: [
      user('warehouse-1', 'WAREHOUSE', true),
      user('boss-1', 'BOSS', true),
      user('admin-1', 'ADMIN', true),
      user('super-1', 'SUPER_ADMIN', true),
    ],
    salesOrders: [pendingWarehouseOrder()],
  });
  const service = createService(store);
  const detectedAt = new Date('2026-07-25T00:00:00.000Z');
  await service.reconcileSource('SALES_ORDER', 'order-1', detectedAt);
  await service.runMaintenanceCycle(
    new Date('2026-07-25T09:00:00.000Z'),
  );
  await service.runMaintenanceCycle(
    new Date('2026-07-25T09:01:00.000Z'),
  );

  const todo = store.businessTodos.find(
    (item) => item.ruleCode === 'SALES_ORDER_WAREHOUSE_FULFILLMENT',
  );
  const recipients = store.todoRecipients.filter(
    (item) => item.todoId === todo.id,
  );
  assert.equal(recipients.length, 4);
  assert.equal(
    recipients.filter((item) => item.recipientReason === 'ESCALATION').length,
    3,
  );
});

test('recipient APIs isolate users, reject fake completion and active archive, and hide snapshots', async () => {
  const store = createTodoStore({
    users: [
      user('front-1', 'FRONT_DESK', true),
      user('front-2', 'FRONT_DESK', true),
    ],
    travelGroups: [pendingFrontDeskGroup()],
  });
  const service = createService(store);
  await service.reconcileSource(
    'TRAVEL_GROUP',
    'group-1',
    new Date('2026-07-26T01:00:00.000Z'),
  );
  const recipient = store.todoRecipients[0];
  const own = await service.getForUser({ id: recipient.userId }, recipient.id);
  assert.equal(own.sourceNumber, 'TG-001');
  assert.equal(Object.hasOwn(own, 'sourceSnapshot'), false);

  await assert.rejects(
    service.getForUser({ id: 'another-user' }, recipient.id),
    (error) => error.code === 'TODO_REMINDER_NOT_FOUND',
  );
  await assert.rejects(
    service.verifyCompletion({ id: recipient.userId }, recipient.id),
    (error) => error.code === 'TODO_SOURCE_STILL_ACTIVE',
  );
  await assert.rejects(
    service.archive({ id: recipient.userId }, recipient.id),
    (error) => error.code === 'ACTIVE_TODO_CANNOT_BE_ARCHIVED',
  );
});

test('recipient list, summary and personal actions stay scoped and paginate correctly', async () => {
  const store = createTodoStore({
    users: [user('warehouse-1', 'WAREHOUSE', true)],
    salesOrders: [
      pendingWarehouseOrder(),
      {
        ...pendingWarehouseOrder(),
        id: 'order-2',
        orderNo: 'SO-002',
        packingStatus: 'ABNORMAL',
      },
    ],
  });
  const service = createService(store);
  const actor = { id: 'warehouse-1' };
  const detectedAt = new Date();

  await service.reconcileSource('SALES_ORDER', 'order-1', detectedAt);
  await service.reconcileSource('SALES_ORDER', 'order-2', detectedAt);
  assert.deepEqual(store.businessTodos[0].sourceSnapshot, {
    sourceNumber: 'SO-001',
  });

  const firstTodo = store.businessTodos.find(
    (item) => item.sourceId === 'order-1',
  );
  const secondTodo = store.businessTodos.find(
    (item) => item.sourceId === 'order-2',
  );
  firstTodo.dueAt = new Date();
  secondTodo.dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const secondRecipient = store.todoRecipients.find(
    (item) => item.todoId === secondTodo.id,
  );
  secondRecipient.readAt = new Date();

  const page = await service.listForUser(actor, {
    page: '1',
    pageSize: '1',
    sourceType: 'SALES_ORDER',
  });
  assert.equal(page.total, 2);
  assert.equal(page.totalPages, 2);
  assert.equal(page.reminders.length, 1);

  const urgent = await service.listForUser(actor, {
    priority: 'URGENT',
    keyword: 'SO-002',
  });
  assert.equal(urgent.total, 1);
  assert.equal(urgent.reminders[0].sourceNumber, 'SO-002');

  const summary = await service.summaryForUser(actor);
  assert.deepEqual(summary, {
    unfinished: 2,
    unread: 1,
    todayDue: 1,
    overdue: 1,
    urgent: 1,
  });

  const firstRecipient = store.todoRecipients.find(
    (item) => item.todoId === firstTodo.id,
  );
  const read = await service.markRead(actor, firstRecipient.id);
  assert.ok(read.readAt);
  const remindAt = new Date(Date.now() + 60 * 60 * 1000);
  const preferences = await service.updatePreferences(
    actor,
    firstRecipient.id,
    {
      personalNote: '跟进物流',
      personalRemindAt: remindAt.toISOString(),
    },
  );
  assert.equal(preferences.personalNote, '跟进物流');
  assert.equal(preferences.personalRemindAt, remindAt.toISOString());

  const snoozedUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const snoozed = await service.snooze(actor, firstRecipient.id, {
    until: snoozedUntil.toISOString(),
  });
  assert.equal(snoozed.snoozedUntil, snoozedUntil.toISOString());

  store.salesOrders[0].packingStatus = 'SHIPPED';
  await service.reconcileSource('SALES_ORDER', 'order-1', new Date());
  const archived = await service.archive(actor, firstRecipient.id);
  assert.ok(archived.archivedAt);
  assert.deepEqual(
    store.logs.map((item) => item.action),
    [
      'todo_reminders.preferences.update',
      'todo_reminders.snooze',
      'todo_reminders.archive',
    ],
  );
});

test('inventory alerts trigger once per warehouse-product-type, recover, and reopen without leaking facts', async () => {
  const now = new Date('2026-07-27T12:00:00.000Z');
  const store = createTodoStore({
    users: [
      user('warehouse-1', 'WAREHOUSE', true),
      user('finance-1', 'FINANCE', true),
      user('boss-1', 'BOSS', true),
      user('admin-1', 'ADMIN', true),
      user('super-1', 'SUPER_ADMIN', true),
      user('sales-1', 'SALES', true),
    ],
    warehouses: [
      { id: 'warehouse-1', code: 'WH-001', name: 'Main warehouse' },
    ],
    products: [
      {
        id: 'product-1',
        name: 'Ordinary product',
        inventoryTrackingMode: 'QUANTITY',
      },
    ],
    warehouseProductStocks: [
      {
        id: 'stock-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        onHandQty: 0,
        reservedQty: 1,
        unavailableQty: 0,
      },
    ],
    stockAlertConfigs: [
      {
        id: 'alert-config-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        minimumAvailableQty: 0,
        enabled: true,
      },
    ],
    inventoryConfigurations: [
      { singletonKey: 'INVENTORY', transferOverdueHours: 24 },
    ],
    inventoryBatches: [
      {
        id: 'batch-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        costStatus: 'PENDING',
        remainingQty: 1,
      },
    ],
    inventoryReservations: [
      {
        id: 'reservation-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        status: 'RESERVED',
        requestedQty: 1,
        reservedQty: 1,
        assignedQty: 0,
        outboundQty: 0,
      },
    ],
    inventoryTransfers: [
      {
        id: 'transfer-1',
        fromWarehouseId: 'warehouse-1',
        status: 'OUTBOUND',
        outboundAt: new Date('2026-07-25T00:00:00.000Z'),
        lines: [
          {
            productId: 'product-1',
            outboundQty: 2,
            receivedQty: 0,
            differenceQty: 0,
          },
        ],
      },
    ],
  });
  const service = createService(store);

  await service.reconcileInventoryPair('warehouse-1', 'product-1', now);
  await service.reconcileInventoryPair('warehouse-1', 'product-1', now);

  assert.deepEqual(
    new Set(store.inventoryAlerts.map((row) => row.type)),
    new Set([
      'LOW_STOCK',
      'NEGATIVE_AVAILABLE',
      'PENDING_COST',
      'ORDER_SHORTAGE',
      'TRANSFER_OVERDUE',
    ]),
  );
  assert.equal(store.inventoryAlerts.length, 5);
  assert.equal(
    new Set(store.inventoryAlerts.map((row) => row.activeKey)).size,
    5,
  );
  assert.equal(store.businessTodos.length, 20);
  assert.equal(
    store.todoRecipients.filter((row) => row.userId === 'warehouse-1').length,
    4,
  );
  assert.equal(
    store.todoRecipients.filter((row) => row.userId === 'finance-1').length,
    1,
  );
  assert.equal(
    store.todoRecipients.filter((row) => row.userId === 'boss-1').length,
    5,
  );
  assert.equal(
    store.todoRecipients.filter((row) => row.userId === 'admin-1').length,
    5,
  );
  assert.equal(
    store.todoRecipients.filter((row) => row.userId === 'super-1').length,
    5,
  );
  assert.equal(
    store.todoRecipients.some((row) => row.userId === 'sales-1'),
    false,
  );

  const persistedText = JSON.stringify(store.businessTodos);
  for (const forbidden of [
    'onHandQty',
    'reservedQty',
    'availableQty',
    'shortage',
    'purchaseCostCents',
    'logisticsCode',
  ]) {
    assert.equal(persistedText.includes(forbidden), false, forbidden);
  }
  const warehouseRecipient = store.todoRecipients.find(
    (row) => row.userId === 'warehouse-1',
  );
  const dto = await service.getForUser(
    { id: 'warehouse-1' },
    warehouseRecipient.id,
  );
  assert.equal(Object.hasOwn(dto, 'sourceSnapshot'), false);
  assert.match(dto.sourceNumber, /WH-001/);

  const alertIds = store.inventoryAlerts.map((row) => row.id);
  const todoIds = store.businessTodos.map((row) => row.id);
  const firstDetectedAt = store.inventoryAlerts[0].firstDetectedAt;
  warehouseRecipient.archivedAt = now;
  warehouseRecipient.readAt = now;
  Object.assign(store.warehouseProductStocks[0], {
    onHandQty: 10,
    reservedQty: 0,
  });
  store.stockAlertConfigs[0].enabled = false;
  store.inventoryBatches[0].costStatus = 'COMPLETE';
  store.inventoryReservations[0].status = 'RELEASED';
  store.inventoryTransfers[0].status = 'COMPLETED';

  await service.reconcileInventoryPair(
    'warehouse-1',
    'product-1',
    new Date('2026-07-27T13:00:00.000Z'),
  );
  assert.ok(store.inventoryAlerts.every((row) => row.status === 'RESOLVED'));
  assert.ok(store.inventoryAlerts.every((row) => row.activeKey === null));
  assert.ok(store.businessTodos.every((row) => row.status === 'RESOLVED'));

  Object.assign(store.warehouseProductStocks[0], {
    onHandQty: 0,
    reservedQty: 1,
  });
  store.stockAlertConfigs[0].enabled = true;
  store.inventoryBatches[0].costStatus = 'PENDING';
  store.inventoryReservations[0].status = 'RESERVED';
  store.inventoryTransfers[0].status = 'OUTBOUND';
  const reopenedAt = new Date('2026-07-27T14:00:00.000Z');
  await service.reconcileInventoryPair(
    'warehouse-1',
    'product-1',
    reopenedAt,
  );

  assert.deepEqual(store.inventoryAlerts.map((row) => row.id), alertIds);
  assert.deepEqual(store.businessTodos.map((row) => row.id), todoIds);
  assert.ok(store.inventoryAlerts.every((row) => row.status === 'ACTIVE'));
  assert.ok(store.businessTodos.every((row) => row.status === 'ACTIVE'));
  assert.ok(store.inventoryAlerts[0].firstDetectedAt > firstDetectedAt);
  assert.equal(warehouseRecipient.archivedAt, null);
  assert.equal(warehouseRecipient.readAt, null);
});

test('stocktake approval reminders target only boss and administrators and resolve with status', async () => {
  const store = createTodoStore({
    users: [
      user('warehouse-1', 'WAREHOUSE', true),
      user('finance-1', 'FINANCE', true),
      user('boss-1', 'BOSS', true),
      user('admin-1', 'ADMIN', true),
      user('super-1', 'SUPER_ADMIN', true),
      user('sales-1', 'SALES', true),
    ],
    stocktakes: [
      {
        id: 'stocktake-1',
        stocktakeNo: 'ST-0001',
        status: 'SUBMITTED',
      },
    ],
  });
  const service = createService(store);

  await service.reconcileSource('STOCKTAKE', 'stocktake-1');
  assert.deepEqual(
    new Set(store.todoRecipients.map((row) => row.userId)),
    new Set(['boss-1', 'admin-1', 'super-1']),
  );
  assert.equal(store.businessTodos.length, 3);

  store.stocktakes[0].status = 'POSTED';
  await service.reconcileSource('STOCKTAKE', 'stocktake-1');
  assert.ok(store.businessTodos.every((row) => row.status === 'RESOLVED'));
});

test('inventory compensation cursor processes more than 200 pairs without starvation or reminder storms', async () => {
  const stockCount = 205;
  const store = createTodoStore({
    users: [user('warehouse-user', 'WAREHOUSE', true)],
    warehouses: [{ id: 'warehouse-1', code: 'WH-001', name: 'Main' }],
    products: Array.from({ length: stockCount }, (_, index) => ({
      id: `product-${String(index + 1).padStart(3, '0')}`,
      name: `Product ${index + 1}`,
      inventoryTrackingMode: 'QUANTITY',
    })),
    warehouseProductStocks: Array.from(
      { length: stockCount },
      (_, index) => ({
        id: `stock-${String(index + 1).padStart(3, '0')}`,
        warehouseId: 'warehouse-1',
        productId: `product-${String(index + 1).padStart(3, '0')}`,
        onHandQty: 0,
        reservedQty: 0,
        unavailableQty: 0,
      }),
    ),
    stockAlertConfigs: Array.from({ length: stockCount }, (_, index) => ({
      id: `config-${String(index + 1).padStart(3, '0')}`,
      warehouseId: 'warehouse-1',
      productId: `product-${String(index + 1).padStart(3, '0')}`,
      minimumAvailableQty: 0,
      enabled: true,
    })),
  });
  const service = createService(store);
  const now = new Date('2026-07-27T12:00:00.000Z');

  await service.runMaintenanceCycle(now);
  assert.equal(store.inventoryAlerts.length, 200);
  await service.runMaintenanceCycle(now);
  assert.equal(store.inventoryAlerts.length, stockCount);
  const todoCount = store.businessTodos.length;
  const recipientCount = store.todoRecipients.length;

  store.warehouseProductStocks[204].onHandQty = 10;
  await service.runMaintenanceCycle(now);
  assert.equal(
    store.inventoryAlerts.find(
      (row) => row.productId === 'product-205',
    ).status,
    'ACTIVE',
  );
  await service.runMaintenanceCycle(now);
  assert.equal(
    store.inventoryAlerts.find(
      (row) => row.productId === 'product-205',
    ).status,
    'RESOLVED',
  );
  assert.equal(store.businessTodos.length, todoCount);
  assert.equal(store.todoRecipients.length, recipientCount);
});

test('inventory post-commit projector deduplicates warehouse-product pairs and never changes stock directly', async () => {
  const calls = [];
  const projector = new InventoryPostCommitProjector({
    safeReconcileInventoryPair: async (...args) => calls.push(args),
  });
  await projector.refresh({
    taskType: 'REFRESH_INVENTORY_DERIVED_STATE',
    commandReceiptId: 'receipt-1',
    payload: {
      warehouseProductPairs: [
        { warehouseId: 'warehouse-1', productId: 'product-1' },
        { warehouseId: 'warehouse-1', productId: 'product-1' },
        { warehouseId: '', productId: 'product-2' },
      ],
    },
  });
  assert.deepEqual(calls, [['warehouse-1', 'product-1']]);
});

function createService(store) {
  return new TodoRemindersService(
    store.prisma,
    { appendLog: async (log) => store.logs.push(log) },
    new TodoRuleEngine(),
  );
}

function user(id, role, isActive) {
  return { id, name: id, username: id, role, isActive };
}

function pendingFrontDeskGroup() {
  return {
    id: 'group-1',
    groupNo: 'TG-001',
    visitDate: new Date('2026-07-26T00:00:00.000Z'),
    expectedArrivalTime: '09:00',
    licensePlate: null,
    tastingRoomNo: null,
    tasterId: null,
    arrivalTime: null,
    groupType: null,
    cigaretteFeeCents: null,
    guestCount: 2,
    tasterSummary: null,
    financeMark: true,
    salesOrders: [{ id: 'effective', status: 'VALID', items: [] }],
    updatedAt: new Date(),
  };
}

function pendingWarehouseOrder() {
  return {
    id: 'order-1',
    orderNo: 'SO-001',
    status: 'VALID',
    packingStatus: 'PENDING',
    logisticsNo: 'SF001',
    logisticsFeeCents: 100,
    invoiceRequired: false,
    invoiceIssued: false,
    items: [{ deliveryType: 'SHIPPING' }],
    updatedAt: new Date(),
  };
}

function createTodoStore(seed = {}) {
  const store = {
    users: seed.users || [],
    travelGroups: seed.travelGroups || [],
    salesOrders: seed.salesOrders || [],
    afterSalesOrders: seed.afterSalesOrders || [],
    warehouses: seed.warehouses || [],
    products: seed.products || [],
    warehouseProductStocks: seed.warehouseProductStocks || [],
    stockAlertConfigs: seed.stockAlertConfigs || [],
    inventoryConfigurations: seed.inventoryConfigurations || [],
    inventoryBatches: seed.inventoryBatches || [],
    serializedInventoryUnits: seed.serializedInventoryUnits || [],
    inventoryReservations: seed.inventoryReservations || [],
    inventoryTransfers: seed.inventoryTransfers || [],
    inventoryAlerts: seed.inventoryAlerts || [],
    stocktakes: seed.stocktakes || [],
    todoReconcileCursors: seed.todoReconcileCursors || [],
    businessTodos: [],
    todoRecipients: [],
    logs: [],
  };
  let nextId = 1;
  const id = (prefix) => `${prefix}-${nextId++}`;
  const sourceDelegate = (rows) => ({
    findUnique: async ({ where }) =>
      rows.find((row) => row.id === where.id) || null,
    findMany: async (args = {}) => queryRows(rows, args),
  });
  store.prisma = {
    user: {
      findMany: async ({ where, select } = {}) => {
        const values = store.users.filter((row) => matches(row, where));
        return select ? values.map((row) => selectRow(row, select)) : values;
      },
    },
    travelGroup: sourceDelegate(store.travelGroups),
    salesOrder: sourceDelegate(store.salesOrders),
    afterSalesOrder: sourceDelegate(store.afterSalesOrders),
    warehouse: sourceDelegate(store.warehouses),
    product: sourceDelegate(store.products),
    warehouseProductStock: {
      findUnique: async ({ where }) => {
        const key = where.warehouseId_productId;
        if (key) {
          return (
            store.warehouseProductStocks.find(
              (row) =>
                row.warehouseId === key.warehouseId &&
                row.productId === key.productId,
            ) || null
          );
        }
        return (
          store.warehouseProductStocks.find((row) => row.id === where.id) ||
          null
        );
      },
      findMany: async (args = {}) =>
        queryRows(store.warehouseProductStocks, args),
    },
    stockAlertConfig: {
      findUnique: async ({ where }) => {
        const key = where.warehouseId_productId;
        return (
          store.stockAlertConfigs.find(
            (row) =>
              row.warehouseId === key?.warehouseId &&
              row.productId === key?.productId,
          ) || null
        );
      },
    },
    inventoryConfiguration: {
      findUnique: async ({ where }) =>
        store.inventoryConfigurations.find(
          (row) => row.singletonKey === where.singletonKey,
        ) || null,
    },
    inventoryBatch: {
      findMany: async (args = {}) =>
        queryRows(store.inventoryBatches, args),
    },
    serializedInventoryUnit: {
      findMany: async (args = {}) =>
        queryRows(store.serializedInventoryUnits, args),
    },
    inventoryReservation: {
      findMany: async (args = {}) =>
        queryRows(store.inventoryReservations, args),
    },
    inventoryTransfer: {
      findMany: async (args = {}) =>
        queryRows(store.inventoryTransfers, args),
    },
    inventoryAlert: {
      findUnique: async ({ where }) =>
        store.inventoryAlerts.find(
          (row) =>
            (where.id && row.id === where.id) ||
            (where.alertKey && row.alertKey === where.alertKey),
        ) || null,
      findFirst: async ({ where } = {}) =>
        store.inventoryAlerts.find((row) => matches(row, where)) || null,
      findMany: async (args = {}) =>
        queryRows(store.inventoryAlerts, args),
      upsert: async ({ where, update, create }) => {
        const existing = store.inventoryAlerts.find(
          (row) => row.alertKey === where.alertKey,
        );
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row = { ...create };
        store.inventoryAlerts.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const rows = store.inventoryAlerts.filter((row) =>
          matches(row, where),
        );
        rows.forEach((row) =>
          Object.assign(row, data, { updatedAt: new Date() }),
        );
        return { count: rows.length };
      },
    },
    stocktake: sourceDelegate(store.stocktakes),
    todoReconcileCursor: {
      findUnique: async ({ where }) =>
        store.todoReconcileCursors.find(
          (row) => row.scanType === where.scanType,
        ) || null,
      upsert: async ({ where, update, create }) => {
        const existing = store.todoReconcileCursors.find(
          (row) => row.scanType === where.scanType,
        );
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row = { ...create, createdAt: new Date(), updatedAt: new Date() };
        store.todoReconcileCursors.push(row);
        return row;
      },
    },
    businessTodo: {
      findUnique: async ({ where }) => {
        const key = where.ruleCode_sourceType_sourceId;
        if (key) {
          return (
            store.businessTodos.find(
              (row) =>
                row.ruleCode === key.ruleCode &&
                row.sourceType === key.sourceType &&
                row.sourceId === key.sourceId,
            ) || null
          );
        }
        return store.businessTodos.find((row) => row.id === where.id) || null;
      },
      findMany: async (args = {}) => queryRows(store.businessTodos, args),
      create: async ({ data }) => {
        const row = { ...data, id: data.id || id('todo') };
        store.businessTodos.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = store.businessTodos.find((item) => item.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    todoRecipient: {
      upsert: async ({ where, update, create }) => {
        const key = where.todoId_userId;
        const existing = store.todoRecipients.find(
          (row) => row.todoId === key.todoId && row.userId === key.userId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = {
          ...create,
          id: create.id || id('recipient'),
          readAt: null,
          personalNote: null,
          personalRemindAt: null,
          snoozedUntil: null,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.todoRecipients.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const values = store.todoRecipients.filter((row) =>
          matches(row, where),
        );
        values.forEach((row) => Object.assign(row, data));
        return { count: values.length };
      },
      findFirst: async ({ where, include }) => {
        const row =
          store.todoRecipients.find((item) => matches(item, where)) || null;
        return row && include?.todo ? withTodo(store, row) : row;
      },
      findMany: async ({ where, include, skip = 0, take } = {}) => {
        let values = store.todoRecipients.filter((row) =>
          matchesRecipient(store, row, where),
        );
        values = values.slice(skip, take ? skip + take : undefined);
        return include?.todo
          ? values.map((row) => withTodo(store, row))
          : values;
      },
      count: async ({ where } = {}) =>
        store.todoRecipients.filter((row) =>
          matchesRecipient(store, row, where),
        ).length,
      update: async ({ where, data, include }) => {
        const row = store.todoRecipients.find(
          (item) => item.id === where.id,
        );
        Object.assign(row, data, { updatedAt: new Date() });
        return include?.todo ? withTodo(store, row) : row;
      },
    },
  };
  return store;
}

function withTodo(store, recipient) {
  return {
    ...recipient,
    todo: store.businessTodos.find((todo) => todo.id === recipient.todoId),
  };
}

function matchesRecipient(store, recipient, where = {}) {
  if (!matches(recipient, without(where, 'todo'))) return false;
  const todoWhere = where?.todo?.is;
  if (!todoWhere) return true;
  const todo = store.businessTodos.find((item) => item.id === recipient.todoId);
  return Boolean(todo && matches(todo, todoWhere));
}

function matches(row, where = {}) {
  if (!where) return true;
  if (where.AND && !where.AND.every((item) => matches(row, item))) return false;
  if (where.OR && !where.OR.some((item) => matches(row, item))) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (['AND', 'OR', 'todo'].includes(key)) return true;
    return matchesValue(row[key], expected);
  });
}

function matchesValue(actual, expected) {
  if (
    expected &&
    typeof expected === 'object' &&
    !(expected instanceof Date)
  ) {
    if ('in' in expected && !expected.in.includes(actual)) return false;
    if ('notIn' in expected && expected.notIn.includes(actual)) return false;
    if ('not' in expected) {
      if (expected.not === null && actual === null) return false;
      if (expected.not !== null && actual === expected.not) return false;
    }
    if ('lt' in expected && !(actual < expected.lt)) return false;
    if ('lte' in expected && !(actual <= expected.lte)) return false;
    if ('gt' in expected && !(actual > expected.gt)) return false;
    if ('gte' in expected && !(actual >= expected.gte)) return false;
    if (
      'contains' in expected &&
      !String(actual || '').includes(expected.contains)
    ) {
      return false;
    }
    return true;
  }
  return actual === expected;
}

function queryRows(rows, { where, select, orderBy, take, cursor, skip = 0 } = {}) {
  let values = rows.filter((row) => matches(row, where));
  if (orderBy) {
    const [field, direction] = Object.entries(orderBy)[0] || [];
    if (field) {
      values = values.slice().sort((left, right) => {
        const result =
          left[field] < right[field] ? -1 : left[field] > right[field] ? 1 : 0;
        return direction === 'desc' ? -result : result;
      });
    }
  }
  if (cursor?.id) {
    const index = values.findIndex((row) => row.id === cursor.id);
    values = index < 0 ? [] : values.slice(index + skip);
  } else if (skip) {
    values = values.slice(skip);
  }
  if (take) values = values.slice(0, take);
  return select ? values.map((row) => selectRow(row, select)) : values;
}

function selectRow(row, select) {
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, row[key]]),
  );
}

function without(value, key) {
  const copy = { ...(value || {}) };
  delete copy[key];
  return copy;
}

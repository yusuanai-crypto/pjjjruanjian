const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TodoRuleEngine,
} = require('../src/modules/todo-reminders/todo-rule.engine');
const {
  TodoRemindersService,
} = require('../src/modules/todo-reminders/todo-reminders.service');
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
    businessTodos: [],
    todoRecipients: [],
    logs: [],
  };
  let nextId = 1;
  const id = (prefix) => `${prefix}-${nextId++}`;
  const sourceDelegate = (rows) => ({
    findUnique: async ({ where }) =>
      rows.find((row) => row.id === where.id) || null,
    findMany: async ({ select, take, cursor, skip = 0 } = {}) => {
      let values = rows.slice().sort((a, b) => a.id.localeCompare(b.id));
      if (cursor) {
        const index = values.findIndex((row) => row.id === cursor.id);
        values = values.slice(Math.max(0, index) + skip);
      }
      values = values.slice(0, take || values.length);
      return select ? values.map((row) => selectRow(row, select)) : values;
    },
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
      findMany: async ({ where, select, take } = {}) => {
        let values = store.businessTodos.filter((row) => matches(row, where));
        if (take) values = values.slice(0, take);
        return select ? values.map((row) => selectRow(row, select)) : values;
      },
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

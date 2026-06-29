const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const { Test } = require('@nestjs/testing');
const { AppModule } = require('../../src/app.module');
const {
  ApiExceptionFilter,
} = require('../../src/common/filters/api-exception.filter');
const {
  ApiResponseInterceptor,
} = require('../../src/common/interceptors/api-response.interceptor');
const {
  RequestValidationPipe,
} = require('../../src/common/pipes/request-validation.pipe');
const { hashPassword } = require('../../src/modules/auth/password');
const {
  BOOTSTRAP_ADMIN_PASSWORD,
} = require('../../src/modules/users/users.repository');
const { PrismaService } = require('../../src/prisma/prisma.service');

function createTestStores() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    phase0StorePath: path.join(os.tmpdir(), `jiangjiu-phase0-${suffix}.json`),
    userStorePath: path.join(os.tmpdir(), `jiangjiu-users-${suffix}.json`),
    settingsStorePath: path.join(
      os.tmpdir(),
      `jiangjiu-settings-${suffix}.json`,
    ),
    operationLogStorePath: path.join(
      os.tmpdir(),
      `jiangjiu-logs-${suffix}.json`,
    ),
    tokenSecret: `test-secret-${suffix}`,
  };
}

async function withPhase1Server(run, options = {}) {
  await withNestApiServer(run, options);
}

async function withNestApiServer(run, options = {}) {
  const stores = createTestStores();
  const previousEnv = {
    PHASE0_CONFIRMATION_STORE: process.env.PHASE0_CONFIRMATION_STORE,
    PHASE1_USER_STORE: process.env.PHASE1_USER_STORE,
    PHASE1_SETTINGS_STORE: process.env.PHASE1_SETTINGS_STORE,
    PHASE1_OPERATION_LOG_STORE: process.env.PHASE1_OPERATION_LOG_STORE,
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    PRISMA_CONNECT_ON_BOOT: process.env.PRISMA_CONNECT_ON_BOOT,
  };

  process.env.PHASE0_CONFIRMATION_STORE = stores.phase0StorePath;
  process.env.PHASE1_USER_STORE = stores.userStorePath;
  process.env.PHASE1_SETTINGS_STORE = stores.settingsStorePath;
  process.env.PHASE1_OPERATION_LOG_STORE = stores.operationLogStorePath;
  process.env.AUTH_TOKEN_SECRET = stores.tokenSecret;
  process.env.PRISMA_CONNECT_ON_BOOT = 'false';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(createInMemoryPrisma(options.prisma || {}))
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalPipes(new RequestValidationPipe());
  await app.listen(0);
  const server = app.getHttpServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await app.close();
    restoreEnv(previousEnv);
  }
}

function createInMemoryPrisma(options = {}) {
  const now = new Date();
  const users = [
    {
      id: 'usr_admin',
      name: '系统管理员',
      username: 'admin',
      passwordHash: hashPassword(BOOTSTRAP_ADMIN_PASSWORD),
      role: 'ADMIN',
      phone: null,
      leaderId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const systemSettings = [
    createSystemSetting('only_show_marked_records', 'false', null, now),
    createSystemSetting('marked_records_restore_required', 'false', null, now),
    createSystemSetting(
      'global_mark_query_updated_at',
      now.toISOString(),
      null,
      now,
    ),
  ];
  const operationLogs = [];
  const travelAgencies = [];
  const guides = [];
  const travelGroups = [];
  const travelGroupTastingItems = [];
  const guideCarriedGroups = [];
  const pendingTravelGroups = [];
  const salesOrders = [];
  const salesOrderItems = [];
  const dailyReconciliations = [];
  const reconciliationPaymentMethods = [];
  const strikeBonusAwards = [];
  seedTravelGroups(travelGroups, options.travelGroups || [], now);
  seedSalesOrders(salesOrders, options.salesOrders || [], now);
  const transactionalRows = [
    users,
    systemSettings,
    operationLogs,
    travelAgencies,
    guides,
    travelGroups,
    travelGroupTastingItems,
    guideCarriedGroups,
    pendingTravelGroups,
    salesOrders,
    salesOrderItems,
    dailyReconciliations,
    reconciliationPaymentMethods,
    strikeBonusAwards,
  ];

  const prisma = {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async (operations) => {
      if (typeof operations === 'function') {
        const snapshot = transactionalRows.map((rows) => rows.map(copyRow));
        try {
          return await operations(prisma);
        } catch (error) {
          restoreRows(transactionalRows, snapshot);
          throw error;
        }
      }
      return Promise.all(operations);
    },
    user: {
      findUnique: async ({ where }) => {
        const row = users.find((user) => matchesUnique(user, where));
        return row ? copyRow(row) : null;
      },
      findMany: async ({ where, orderBy } = {}) => {
        return sortRows(
          users.filter((user) => matchesWhere(user, where)).map(copyRow),
          orderBy,
        );
      },
      create: async ({ data }) => {
        const row = {
          ...data,
          id: data.id || crypto.randomUUID(),
          createdAt: asDate(data.createdAt) || new Date(),
          updatedAt: asDate(data.updatedAt) || new Date(),
        };
        users.push(row);
        return copyRow(row);
      },
      update: async ({ where, data }) => {
        const index = users.findIndex((user) => matchesUnique(user, where));
        if (index < 0) {
          throw new Error('User not found in test Prisma store.');
        }
        users[index] = {
          ...users[index],
          ...data,
          updatedAt: asDate(data.updatedAt) || new Date(),
        };
        return copyRow(users[index]);
      },
    },
    systemSetting: {
      findMany: async ({ where, orderBy } = {}) => {
        return sortRows(
          systemSettings
            .filter((item) => matchesWhere(item, where))
            .map(copyRow),
          orderBy,
        );
      },
      upsert: async ({ where, update, create }) => {
        const index = systemSettings.findIndex((item) =>
          matchesUnique(item, where),
        );
        if (index >= 0) {
          systemSettings[index] = {
            ...systemSettings[index],
            ...update,
            updatedAt: asDate(update.updatedAt) || new Date(),
          };
          return copyRow(systemSettings[index]);
        }

        const row = {
          ...create,
          id: create.id || crypto.randomUUID(),
          updatedAt: asDate(create.updatedAt) || new Date(),
        };
        systemSettings.push(row);
        return copyRow(row);
      },
    },
    operationLog: {
      create: async ({ data }) => {
        const row = {
          ...data,
          id: data.id || crypto.randomUUID(),
          createdAt: asDate(data.createdAt) || new Date(),
        };
        operationLogs.push(row);
        return copyRow(row);
      },
      findMany: async ({ where, orderBy } = {}) => {
        return sortRows(
          operationLogs.filter((log) => matchesWhere(log, where)).map(copyRow),
          orderBy,
        );
      },
    },
    travelAgency: createTravelAgencyDelegate(travelAgencies),
    guide: createGuideDelegate(guides),
    travelGroup: createTravelGroupDelegate(travelGroups, {
      failUpdateOnce: Boolean(options.failTravelGroupUpdateOnce),
      tastingItems: travelGroupTastingItems,
      users,
      salesOrders,
    }),
    guideCarriedGroup: createTravelGroupDelegate(guideCarriedGroups),
    pendingTravelGroup: createTravelGroupDelegate(pendingTravelGroups),
    salesOrder: {
      findUnique: async ({ where, include } = {}) => {
        const row = salesOrders.find((order) => matchesUnique(order, where));
        return row
          ? withSalesOrderIncludes(row, include, salesOrderItems, travelGroups)
          : null;
      },
      findMany: async ({ where, include, orderBy, take } = {}) => {
        const rows = sortRows(
          salesOrders
            .filter((order) => matchesWhere(order, where))
            .map(copyRow),
          orderBy,
        );
        return rows
          .slice(0, take || rows.length)
          .map((order) =>
            withSalesOrderIncludes(
              order,
              include,
              salesOrderItems,
              travelGroups,
            ),
          );
      },
      create: async ({ data, include } = {}) => {
        const nestedItems = data.items?.create || [];
        const row = {
          ...data,
          items: undefined,
          id: data.id || crypto.randomUUID(),
          createdAt: asDate(data.createdAt) || new Date(),
          updatedAt: asDate(data.updatedAt) || new Date(),
        };
        salesOrders.push(row);
        for (const item of nestedItems) {
          salesOrderItems.push({
            ...item,
            id: item.id || crypto.randomUUID(),
            salesOrderId: row.id,
            createdAt: asDate(item.createdAt) || new Date(),
          });
        }
        return withSalesOrderIncludes(
          row,
          include,
          salesOrderItems,
          travelGroups,
        );
      },
      update: async ({ where, data, include } = {}) => {
        const index = salesOrders.findIndex((order) =>
          matchesUnique(order, where),
        );
        if (index < 0) {
          throw new Error('Sales order not found in test Prisma store.');
        }
        salesOrders[index] = {
          ...salesOrders[index],
          ...data,
          updatedAt: asDate(data?.updatedAt) || new Date(),
        };
        return withSalesOrderIncludes(
          salesOrders[index],
          include,
          salesOrderItems,
          travelGroups,
        );
      },
    },
    dailyReconciliation: {
      findUnique: async ({ where, include } = {}) => {
        const row = dailyReconciliations.find((item) =>
          matchesUnique(item, where),
        );
        return row
          ? withReconciliationIncludes(
              row,
              include,
              reconciliationPaymentMethods,
            )
          : null;
      },
      upsert: async ({ where, update, create, include } = {}) => {
        const index = dailyReconciliations.findIndex((item) =>
          matchesUnique(item, where),
        );
        const nestedUpdateMethods = update?.paymentMethods?.create || [];
        const nestedCreateMethods = create?.paymentMethods?.create || [];
        if (index >= 0) {
          dailyReconciliations[index] = {
            ...dailyReconciliations[index],
            ...withoutNested(update, 'paymentMethods'),
            updatedAt: asDate(update.updatedAt) || new Date(),
          };
          removeWhere(
            reconciliationPaymentMethods,
            (method) =>
              method.reconciliationId === dailyReconciliations[index].id,
          );
          for (const method of nestedUpdateMethods) {
            reconciliationPaymentMethods.push({
              ...method,
              id: method.id || crypto.randomUUID(),
              reconciliationId: dailyReconciliations[index].id,
              createdAt: asDate(method.createdAt) || new Date(),
            });
          }
          return withReconciliationIncludes(
            dailyReconciliations[index],
            include,
            reconciliationPaymentMethods,
          );
        }

        const row = {
          ...withoutNested(create, 'paymentMethods'),
          id: create.id || crypto.randomUUID(),
          createdAt: asDate(create.createdAt) || new Date(),
          updatedAt: asDate(create.updatedAt) || new Date(),
        };
        dailyReconciliations.push(row);
        for (const method of nestedCreateMethods) {
          reconciliationPaymentMethods.push({
            ...method,
            id: method.id || crypto.randomUUID(),
            reconciliationId: row.id,
            createdAt: asDate(method.createdAt) || new Date(),
          });
        }
        return withReconciliationIncludes(
          row,
          include,
          reconciliationPaymentMethods,
        );
      },
    },
    strikeBonusAward: {
      findMany: async ({ where, orderBy, take } = {}) => {
        const rows = sortRows(
          strikeBonusAwards
            .filter((award) => matchesWhere(award, where))
            .map(copyRow),
          orderBy,
        );
        return rows.slice(0, take || rows.length);
      },
      create: async ({ data } = {}) => {
        const row = {
          ...data,
          id: data.id || crypto.randomUUID(),
          createdAt: asDate(data.createdAt) || new Date(),
          updatedAt: asDate(data.updatedAt) || new Date(),
        };
        strikeBonusAwards.push(row);
        return copyRow(row);
      },
    },
  };
  return prisma;
}

function createGuideDelegate(rows) {
  return {
    findUnique: async ({ where }) => {
      const row = rows.find((item) => matchesUnique(item, where));
      return row ? copyRow(row) : null;
    },
    findMany: async ({ where, orderBy, take } = {}) => {
      const result = sortRows(
        rows.filter((item) => matchesWhere(item, where)).map(copyRow),
        orderBy,
      );
      return result.slice(0, take || result.length);
    },
    create: async ({ data }) => {
      const row = {
        ...data,
        id: data.id || crypto.randomUUID(),
        createdAt: asDate(data.createdAt) || new Date(),
        updatedAt: asDate(data.updatedAt) || new Date(),
      };
      rows.push(row);
      return copyRow(row);
    },
    update: async ({ where, data }) => {
      const index = rows.findIndex((item) => matchesUnique(item, where));
      if (index < 0) {
        throw new Error('Guide not found in test Prisma store.');
      }
      rows[index] = {
        ...rows[index],
        ...data,
        updatedAt: asDate(data.updatedAt) || new Date(),
      };
      return copyRow(rows[index]);
    },
  };
}

function createTravelAgencyDelegate(rows) {
  return {
    findUnique: async ({ where }) => {
      const row = rows.find((item) => matchesUnique(item, where));
      return row ? copyRow(row) : null;
    },
    findMany: async ({ where, orderBy, take } = {}) => {
      const result = sortRows(
        rows.filter((item) => matchesWhere(item, where)).map(copyRow),
        orderBy,
      );
      return result.slice(0, take || result.length);
    },
    create: async ({ data }) => {
      const row = {
        ...data,
        id: data.id || crypto.randomUUID(),
        createdAt: asDate(data.createdAt) || new Date(),
        updatedAt: asDate(data.updatedAt) || new Date(),
      };
      rows.push(row);
      return copyRow(row);
    },
  };
}

function createTravelGroupDelegate(rows, options = {}) {
  let failUpdateOnce = Boolean(options.failUpdateOnce);
  const tastingItems = options.tastingItems || [];
  const users = options.users || [];
  const salesOrders = options.salesOrders || [];
  return {
    findUnique: async ({ where, include } = {}) => {
      const row = rows.find((item) => matchesUnique(item, where));
      return row
        ? withTravelGroupIncludes(row, include, {
            tastingItems,
            users,
            salesOrders,
          })
        : null;
    },
    findMany: async ({ where, include, orderBy, take } = {}) => {
      const result = sortRows(
        rows.filter((item) => matchesWhere(item, where)).map(copyRow),
        orderBy,
      );
      return result.slice(0, take || result.length).map((row) =>
        withTravelGroupIncludes(row, include, {
          tastingItems,
          users,
          salesOrders,
        }),
      );
    },
    create: async ({ data, include } = {}) => {
      if (data.groupNo && rows.some((item) => item.groupNo === data.groupNo)) {
        const error = new Error('Unique constraint failed on groupNo');
        error.code = 'P2002';
        error.meta = {
          target: ['groupNo'],
        };
        throw error;
      }
      const nestedTastingItems = data.tastingItems?.create || [];
      const row = {
        ...withoutNested(data, 'tastingItems'),
        id: data.id || crypto.randomUUID(),
        createdAt: asDate(data.createdAt) || new Date(),
        updatedAt: asDate(data.updatedAt) || new Date(),
      };
      rows.push(row);
      for (const item of nestedTastingItems) {
        tastingItems.push({
          ...item,
          id: item.id || crypto.randomUUID(),
          travelGroupId: row.id,
          createdAt: asDate(item.createdAt) || new Date(),
          updatedAt: asDate(item.updatedAt) || new Date(),
        });
      }
      return withTravelGroupIncludes(row, include, {
        tastingItems,
        users,
        salesOrders,
      });
    },
    update: async ({ where, data, include } = {}) => {
      if (failUpdateOnce) {
        failUpdateOnce = false;
        throw new Error(
          'Injected travel group update failure in test Prisma store.',
        );
      }
      const index = rows.findIndex((item) => matchesUnique(item, where));
      if (index < 0) {
        throw new Error('Travel group not found in test Prisma store.');
      }
      const nestedTastingItems = data.tastingItems?.create || [];
      if (data.tastingItems?.deleteMany !== undefined) {
        removeWhere(
          tastingItems,
          (item) => item.travelGroupId === rows[index].id,
        );
      }
      rows[index] = {
        ...rows[index],
        ...withoutNested(data, 'tastingItems'),
        updatedAt: asDate(data.updatedAt) || new Date(),
      };
      for (const item of nestedTastingItems) {
        tastingItems.push({
          ...item,
          id: item.id || crypto.randomUUID(),
          travelGroupId: rows[index].id,
          createdAt: asDate(item.createdAt) || new Date(),
          updatedAt: asDate(item.updatedAt) || new Date(),
        });
      }
      return withTravelGroupIncludes(rows[index], include, {
        tastingItems,
        users,
        salesOrders,
      });
    },
  };
}

function seedTravelGroups(rows, seeds, now) {
  for (const seed of seeds) {
    rows.push({
      id: seed.id || crypto.randomUUID(),
      groupNo: seed.groupNo || `SEED-${rows.length + 1}`,
      visitDate: asDate(seed.visitDate) || now,
      travelAgency: seedValue(seed, 'travelAgency', 'Seed Agency'),
      licensePlate: seedValue(seed, 'licensePlate', 'SEED-PLATE'),
      guideName: seedValue(seed, 'guideName', 'Seed Guide'),
      guidePhone: seedValue(seed, 'guidePhone', '13900000000'),
      guestCount: seed.guestCount ?? 10,
      tastingRoomNo: seedValue(seed, 'tastingRoomNo', 'Seed Room'),
      tasterName: seedValue(seed, 'tasterName', 'Seed Taster'),
      arrivalTime: seedValue(seed, 'arrivalTime', null),
      groupType: seedValue(seed, 'groupType', 'seed'),
      wineDetails: seedValue(seed, 'wineDetails', null),
      departureTime: seedValue(seed, 'departureTime', null),
      remarks: seedValue(seed, 'remarks', null),
      status: seed.status || 'UNMARKED',
      salesAmountCents: seed.salesAmountCents ?? 0,
      paidDepositCents: seed.paidDepositCents ?? 0,
      cashOnDeliveryCents: seed.cashOnDeliveryCents ?? 0,
      liquorCostDeductionCents: seed.liquorCostDeductionCents ?? 0,
      orderAmountCents: seed.orderAmountCents ?? 0,
      points: seed.points ?? 0,
      returnedPoints: seed.returnedPoints ?? 0,
      unreturnedPoints: seed.unreturnedPoints ?? 0,
      guideInfoSent: Boolean(seed.guideInfoSent),
      travelAgencyInfoSent: Boolean(seed.travelAgencyInfoSent),
      financeMark: Boolean(seed.financeMark),
      markedById: seed.markedById ?? null,
      markedAt: asDate(seed.markedAt) || null,
      guideId: seed.guideId ?? null,
      tasterId: seed.tasterId ?? null,
      tasterSummary: seed.tasterSummary ?? null,
      tasterSummaryAt: asDate(seed.tasterSummaryAt) || null,
      postMarkEditedAt: asDate(seed.postMarkEditedAt) || null,
      postMarkEditedById: seed.postMarkEditedById ?? null,
      createdById: seed.createdById ?? null,
      updatedById: seed.updatedById ?? null,
      createdAt: asDate(seed.createdAt) || now,
      updatedAt: asDate(seed.updatedAt) || now,
    });
  }
}

function seedValue(seed, key, fallback) {
  return Object.hasOwn(seed, key) ? seed[key] : fallback;
}

function seedSalesOrders(rows, seeds, now) {
  for (const seed of seeds) {
    rows.push({
      id: seed.id || crypto.randomUUID(),
      orderNo: seed.orderNo || `SO-SEED-${rows.length + 1}`,
      orderType: seed.orderType || 'TRAVEL_GROUP',
      travelGroupId: seed.travelGroupId ?? null,
      customerName: seed.customerName || 'Seed Customer',
      customerPhone: seed.customerPhone ?? null,
      province: seed.province ?? null,
      city: seed.city ?? null,
      district: seed.district ?? null,
      address: seed.address ?? null,
      orderDate: asDate(seed.orderDate) || now,
      totalAmountCents: seed.totalAmountCents ?? 0,
      cashOnDeliveryAmountCents: seed.cashOnDeliveryAmountCents ?? 0,
      remark: seed.remark ?? null,
      status: seed.status || 'VALID',
      financeMark: Boolean(seed.financeMark),
      markedById: seed.markedById ?? null,
      markedAt: asDate(seed.markedAt) || null,
      salesUserId: seed.salesUserId ?? null,
      createdById: seed.createdById ?? null,
      updatedById: seed.updatedById ?? null,
      createdAt: asDate(seed.createdAt) || now,
      updatedAt: asDate(seed.updatedAt) || now,
    });
  }
}

function restoreRows(rowGroups, snapshot) {
  for (let index = 0; index < rowGroups.length; index += 1) {
    rowGroups[index].splice(
      0,
      rowGroups[index].length,
      ...snapshot[index].map(copyRow),
    );
  }
}

function createSystemSetting(settingKey, settingValue, updatedBy, updatedAt) {
  return {
    id: crypto.randomUUID(),
    settingKey,
    settingValue,
    updatedBy,
    updatedAt,
  };
}

function matchesUnique(row, where = {}) {
  return Object.entries(where).every(([key, value]) =>
    valuesEqual(row[key], value),
  );
}

function matchesWhere(row, where = {}) {
  return Object.entries(where || {}).every(([key, value]) => {
    if (key === 'AND' && Array.isArray(value)) {
      return value.every((item) => matchesWhere(row, item));
    }
    if (key === 'OR' && Array.isArray(value)) {
      return value.some((item) => matchesWhere(row, item));
    }
    if (value && typeof value === 'object' && Array.isArray(value.in)) {
      return value.in.includes(row[key]);
    }
    if (value && typeof value === 'object' && value.contains !== undefined) {
      return String(row[key] || '').includes(String(value.contains));
    }
    if (value && typeof value === 'object' && value.startsWith !== undefined) {
      return String(row[key] || '').startsWith(String(value.startsWith));
    }
    if (
      value &&
      typeof value === 'object' &&
      (value.gte !== undefined || value.lte !== undefined)
    ) {
      const rowTime = asDate(row[key])?.getTime();
      if (rowTime === undefined || Number.isNaN(rowTime)) {
        return false;
      }
      if (value.gte !== undefined && rowTime < asDate(value.gte).getTime()) {
        return false;
      }
      if (value.lte !== undefined && rowTime > asDate(value.lte).getTime()) {
        return false;
      }
      return true;
    }
    return valuesEqual(row[key], value);
  });
}

function sortRows(rows, orderBy) {
  if (!orderBy) {
    return rows;
  }
  const [key, direction] = Object.entries(orderBy)[0] || [];
  if (!key) {
    return rows;
  }
  return rows.sort((left, right) => {
    const leftValue =
      left[key] instanceof Date ? left[key].getTime() : left[key];
    const rightValue =
      right[key] instanceof Date ? right[key].getTime() : right[key];
    if (leftValue === rightValue) {
      return 0;
    }
    const result = leftValue > rightValue ? 1 : -1;
    return direction === 'desc' ? -result : result;
  });
}

function copyRow(row) {
  return { ...row };
}

function valuesEqual(left, right) {
  if (left instanceof Date || right instanceof Date) {
    const leftDate = asDate(left);
    const rightDate = asDate(right);
    return (
      leftDate?.toISOString().slice(0, 10) ===
      rightDate?.toISOString().slice(0, 10)
    );
  }
  return left === right;
}

function withoutNested(value, key) {
  const copy = { ...(value || {}) };
  delete copy[key];
  return copy;
}

function removeWhere(rows, predicate) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index])) {
      rows.splice(index, 1);
    }
  }
}

function withTravelGroupIncludes(group, include, relations) {
  const row = copyRow(group);
  const tastingItems = relations?.tastingItems || [];
  const users = relations?.users || [];
  const salesOrders = relations?.salesOrders || [];
  if (include?.tastingItems) {
    row.tastingItems = tastingItems
      .filter((item) => item.travelGroupId === group.id)
      .map(copyRow)
      .sort(
        (left, right) =>
          Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
      );
  }
  if (include?.taster) {
    const taster = users.find((user) => user.id === group.tasterId);
    row.taster = taster ? copyRow(taster) : null;
  }
  if (include?.salesOrders) {
    const includeConfig =
      typeof include.salesOrders === 'object' ? include.salesOrders : {};
    row.salesOrders = sortRows(
      salesOrders
        .filter((order) => order.travelGroupId === group.id)
        .map(copyRow),
      includeConfig.orderBy,
    );
  }
  return row;
}

function withSalesOrderIncludes(order, include, salesOrderItems, travelGroups) {
  const row = copyRow(order);
  if (include?.items) {
    row.items = salesOrderItems
      .filter((item) => item.salesOrderId === order.id)
      .map(copyRow);
  }
  if (include?.travelGroup) {
    const group = travelGroups.find((item) => item.id === order.travelGroupId);
    row.travelGroup = group ? copyRow(group) : null;
  }
  return row;
}

function withReconciliationIncludes(row, include, paymentMethods) {
  const copy = copyRow(row);
  if (include?.paymentMethods) {
    copy.paymentMethods = paymentMethods
      .filter((method) => method.reconciliationId === row.id)
      .map(copyRow);
  }
  return copy;
}

function asDate(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const body = await response.json();
  return {
    response,
    body,
  };
}

async function login(
  baseUrl,
  username = 'admin',
  password = BOOTSTRAP_ADMIN_PASSWORD,
) {
  const result = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
    },
  });
  assert.equal(result.response.status, 200);
  assertSessionContract(result.body.data);
  return result.body.data;
}

async function createUser(baseUrl, token, payload) {
  const result = await requestJson(baseUrl, '/api/users', {
    method: 'POST',
    token,
    body: payload,
  });
  assert.equal(result.response.status, 201);
  assert.deepEqual(Object.keys(result.body).sort(), ['data']);
  assertPublicUserContract(result.body.data.user);
  assert.equal(Array.isArray(result.body.data.permissions), true);
  assert.equal(Array.isArray(result.body.data.menus), true);
  return result.body.data.user;
}

function assertSessionContract(session) {
  assert.deepEqual(Object.keys(session).sort(), [
    'dataScope',
    'expiresAt',
    'menus',
    'permissions',
    'token',
    'user',
  ]);
  assert.equal(typeof session.token, 'string');
  assert.match(
    session.token,
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  );
  assert.equal(typeof session.expiresAt, 'string');
  assert.doesNotThrow(() => new Date(session.expiresAt).toISOString());
  assertPublicUserContract(session.user);
  assert.equal(Array.isArray(session.permissions), true);
  assert.equal(Array.isArray(session.menus), true);
  assert.equal(typeof session.dataScope, 'object');
}

function assertCurrentUserContract(data) {
  assert.deepEqual(Object.keys(data).sort(), [
    'dataScope',
    'menus',
    'permissions',
    'user',
  ]);
  assertPublicUserContract(data.user);
  assert.equal(Array.isArray(data.permissions), true);
  assert.equal(Array.isArray(data.menus), true);
  assert.equal(typeof data.dataScope, 'object');
}

function assertPublicUserContract(user) {
  assert.deepEqual(Object.keys(user).sort(), [
    'createdAt',
    'id',
    'isActive',
    'leaderId',
    'name',
    'phone',
    'role',
    'updatedAt',
    'username',
  ]);
  assert.equal(typeof user.id, 'string');
  assert.equal(typeof user.name, 'string');
  assert.equal(typeof user.username, 'string');
  assert.equal(typeof user.role, 'string');
  assert.equal(typeof user.isActive, 'boolean');
  assert.equal(typeof user.createdAt, 'string');
  assert.equal(typeof user.updatedAt, 'string');
  assert.equal('passwordHash' in user, false);
}

function assertSettingsContract(settings) {
  assert.deepEqual(Object.keys(settings).sort(), [
    'onlyShowMarkedRecords',
    'openedAt',
    'openedBy',
    'restoreRequired',
    'restoredAt',
    'restoredBy',
    'updatedAt',
  ]);
  assert.equal(typeof settings.onlyShowMarkedRecords, 'boolean');
  assert.equal(typeof settings.restoreRequired, 'boolean');
}

function assertOperationLogContract(log) {
  assert.deepEqual(Object.keys(log).sort(), [
    'action',
    'afterData',
    'beforeData',
    'createdAt',
    'entityId',
    'entityType',
    'id',
    'ipAddress',
    'userId',
  ]);
  assert.equal(typeof log.id, 'string');
  assert.equal(typeof log.action, 'string');
  assert.equal(typeof log.entityType, 'string');
  assert.equal(typeof log.createdAt, 'string');
}

function assertErrorContract(result, statusCode, code) {
  assert.equal(result.response.status, statusCode);
  assert.deepEqual(Object.keys(result.body).sort(), ['error']);
  assert.deepEqual(Object.keys(result.body.error).sort(), ['code', 'message']);
  assert.equal(result.body.error.code, code);
  assert.equal(typeof result.body.error.message, 'string');
}

module.exports = {
  BOOTSTRAP_ADMIN_PASSWORD,
  assertCurrentUserContract,
  assertErrorContract,
  assertOperationLogContract,
  assertPublicUserContract,
  assertSessionContract,
  assertSettingsContract,
  createUser,
  login,
  requestJson,
  withNestApiServer,
  withPhase1Server,
};

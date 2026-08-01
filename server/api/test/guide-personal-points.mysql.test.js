const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { PrismaClient } = require('@prisma/client');

const {
  CommissionRecordsNestService,
} = require('../src/modules/commissions/commission-records.nest.service');
const {
  GuidePointsSummaryNestService,
} = require('../src/modules/commissions/guide-points-summary.nest.service');
const {
  TravelGroupFinanceSummaryNestService,
} = require('../src/modules/commissions/travel-group-finance-summary.nest.service');
const {
  OperationLogsNestService,
} = require('../src/modules/operation-logs/operation-log.nest.service');

const databaseUrl = process.env.GUIDE_POINTS_TEST_DATABASE_URL;
const enabled =
  process.env.GUIDE_POINTS_ISOLATED_DATABASE_CONFIRMED === '1' &&
  typeof databaseUrl === 'string' &&
  databaseUrl.length > 0;

test(
  'mysql integration: required schema supports personal points splits and atomic rollback',
  { skip: enabled ? false : 'isolated MySQL database was not explicitly confirmed' },
  async () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const actorId = crypto.randomUUID();
    const actor = { id: actorId, name: 'integration-admin', role: 'admin' };
    const operationLogs = new OperationLogsNestService(prisma);
    const commissionRecords = new CommissionRecordsNestService(
      prisma,
      operationLogs,
      undefined,
    );
    const ordinarySummaries = new TravelGroupFinanceSummaryNestService(
      prisma,
      operationLogs,
      undefined,
    );
    const guideSummaries = new GuidePointsSummaryNestService(
      prisma,
      operationLogs,
      commissionRecords,
      ordinarySummaries,
      undefined,
    );

    try {
      await assertMigratedSchema(prisma);

      await prisma.user.create({
        data: {
          id: actorId,
          name: actor.name,
          username: `integration-${actorId}`,
          passwordHash: 'not-a-real-password-hash',
          role: 'ADMIN',
        },
      });
      const agency = await prisma.travelAgency.create({
        data: { id: crypto.randomUUID(), name: 'Integration Agency' },
      });
      await prisma.agencyRebateRule.create({
        data: {
          id: crypto.randomUUID(),
          agencyId: agency.id,
          agencyName: agency.name,
          dailyRebateRate: '0.1000',
          monthlyRebateRate: '0.0500',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          createdById: actorId,
          updatedById: actorId,
        },
      });
      const guideA = await prisma.guide.create({
        data: {
          id: crypto.randomUUID(),
          name: 'Integration Guide A',
          phone: `it-a-${actorId.slice(0, 8)}`,
        },
      });
      const guideB = await prisma.guide.create({
        data: {
          id: crypto.randomUUID(),
          name: 'Integration Guide B',
          phone: `it-b-${actorId.slice(0, 8)}`,
        },
      });

      const primary = await createGroupAndOrder(prisma, {
        suffix: 'primary',
        agencyName: agency.name,
        guide: guideA,
        totalAmountCents: 10000,
      });

      await guideSummaries.updateSalesOrderPointsDestination(
        actor,
        primary.order.id,
        {
          personalAmountCents: 10000,
          guideId: guideA.id,
          dailyRebateRate: '0.5000',
          monthlyRebateRate: '0.0000',
        },
      );
      let order = await prisma.salesOrder.findUnique({
        where: { id: primary.order.id },
      });
      let ordinary = await prisma.travelGroupFinanceSummary.findUnique({
        where: { travelGroupId: primary.group.id },
      });
      let guide = await prisma.guidePointsSummary.findUnique({
        where: {
          travelGroupId_guideId: {
            travelGroupId: primary.group.id,
            guideId: guideA.id,
          },
        },
      });
      assert.equal(order.pointsDestination, 'GUIDE_PERSONAL');
      assert.equal(order.personalAmountCents, 10000);
      assert.equal(ordinary.totalSalesAmountCents, 0);
      assert.equal(guide.totalSalesAmountCents, 10000);

      await guideSummaries.updateSalesOrderPointsDestination(
        actor,
        primary.order.id,
        {
          personalAmountCents: 3000,
          guideId: guideA.id,
          dailyRebateRate: '0.5000',
          monthlyRebateRate: '0.0000',
        },
      );
      ordinary = await prisma.travelGroupFinanceSummary.findUnique({
        where: { travelGroupId: primary.group.id },
      });
      guide = await prisma.guidePointsSummary.findUnique({
        where: {
          travelGroupId_guideId: {
            travelGroupId: primary.group.id,
            guideId: guideA.id,
          },
        },
      });
      assert.equal(ordinary.totalSalesAmountCents, 7000);
      assert.equal(guide.totalSalesAmountCents, 3000);

      await guideSummaries.updateSalesOrderPointsDestination(
        actor,
        primary.order.id,
        {
          personalAmountCents: 4000,
          guideId: guideB.id,
          dailyRebateRate: '0.2500',
          monthlyRebateRate: '0.1000',
        },
      );
      order = await prisma.salesOrder.findUnique({
        where: { id: primary.order.id },
      });
      const guideARow = await prisma.guidePointsSummary.findUnique({
        where: {
          travelGroupId_guideId: {
            travelGroupId: primary.group.id,
            guideId: guideA.id,
          },
        },
      });
      const guideBRow = await prisma.guidePointsSummary.findUnique({
        where: {
          travelGroupId_guideId: {
            travelGroupId: primary.group.id,
            guideId: guideB.id,
          },
        },
      });
      assert.equal(order.personalPointsGuideId, guideB.id);
      assert.equal(order.personalDailyRebateRate.toString(), '0.25');
      assert.equal(order.personalMonthlyRebateRate.toString(), '0.1');
      assert.equal(guideARow.orderCount, 0);
      assert.equal(guideBRow.orderCount, 1);
      assert.equal(guideBRow.totalDailyPointsCents, 1000);
      assert.equal(guideBRow.totalMonthlyPointsCents, 400);

      await guideSummaries.updateSalesOrderPointsDestination(
        actor,
        primary.order.id,
        { personalAmountCents: 0 },
      );
      order = await prisma.salesOrder.findUnique({
        where: { id: primary.order.id },
      });
      ordinary = await prisma.travelGroupFinanceSummary.findUnique({
        where: { travelGroupId: primary.group.id },
      });
      assert.equal(order.pointsDestination, 'TRAVEL_AGENCY');
      assert.equal(order.personalAmountCents, 0);
      assert.equal(order.personalPointsGuideId, null);
      assert.equal(order.personalDailyRebateRate, null);
      assert.equal(order.personalMonthlyRebateRate, null);
      assert.equal(ordinary.totalSalesAmountCents, 10000);

      const withRefund = await createGroupAndOrder(prisma, {
        suffix: 'refund',
        agencyName: agency.name,
        guide: guideA,
        totalAmountCents: 10000,
      });
      const generatedAfterSalesOrder = await prisma.salesOrder.create({
        data: {
          id: crypto.randomUUID(),
          orderNo: `IT-AS-GENERATED-${crypto.randomUUID()}`,
          orderType: 'AFTER_SALES',
          sourceSalesOrderId: withRefund.order.id,
          travelGroupId: withRefund.group.id,
          customerName: 'Integration Customer',
          orderDate: new Date('2026-07-15T00:00:00.000Z'),
          totalAmountCents: 2000,
          status: 'REFUNDED',
          createdById: actorId,
          updatedById: actorId,
        },
      });
      await prisma.afterSalesOrder.create({
        data: {
          id: crypto.randomUUID(),
          afterSalesNo: `IT-AS-${crypto.randomUUID()}`,
          salesOrderId: withRefund.order.id,
          afterSalesSalesOrderId: generatedAfterSalesOrder.id,
          issueType: 'CUSTOMER_RETURN',
          actionType: 'REFUND',
          description: 'isolated integration refund',
          refundAmountCents: 2000,
          personalPointsRefundAmountCents: 1000,
          calculationDate: new Date('2026-07-15T00:00:00.000Z'),
          financialEffectStatus: 'CONFIRMED',
          status: 'COMPLETED',
          financeConfirmed: true,
          financeConfirmedById: actorId,
          financeConfirmedAt: new Date('2026-07-15T00:00:00.000Z'),
          refundOccurredAt: new Date('2026-07-15T00:00:00.000Z'),
          createdById: actorId,
          updatedById: actorId,
        },
      });
      await guideSummaries.updateSalesOrderPointsDestination(
        actor,
        withRefund.order.id,
        {
          personalAmountCents: 4000,
          guideId: guideA.id,
          dailyRebateRate: '0.5000',
          monthlyRebateRate: '0.0000',
        },
      );
      const refundOrdinary =
        await prisma.travelGroupFinanceSummary.findUnique({
          where: { travelGroupId: withRefund.group.id },
        });
      const refundGuide = await prisma.guidePointsSummary.findUnique({
        where: {
          travelGroupId_guideId: {
            travelGroupId: withRefund.group.id,
            guideId: guideA.id,
          },
        },
      });
      assert.equal(refundOrdinary.totalSalesAmountCents, 6000);
      assert.equal(refundOrdinary.confirmedRefundAmountCents, 1000);
      assert.equal(refundOrdinary.effectiveSalesAmountCents, 5000);
      assert.equal(refundGuide.totalSalesAmountCents, 4000);
      assert.equal(refundGuide.confirmedRefundAmountCents, 1000);
      assert.equal(refundGuide.effectiveSalesAmountCents, 3000);

      const beforeRollback = await transactionalSnapshot(
        prisma,
        primary.group.id,
        primary.order.id,
      );
      const realGuideRefresh =
        guideSummaries.refreshGuidePointsSummariesForTravelGroup;
      guideSummaries.refreshGuidePointsSummariesForTravelGroup = async () => {
        throw new Error('injected downstream guide summary failure');
      };
      try {
        await assert.rejects(
          guideSummaries.updateSalesOrderPointsDestination(
            actor,
            primary.order.id,
            {
              personalAmountCents: 5000,
              guideId: guideA.id,
              dailyRebateRate: '0.5000',
              monthlyRebateRate: '0.0000',
            },
          ),
          /injected downstream guide summary failure/,
        );
      } finally {
        guideSummaries.refreshGuidePointsSummariesForTravelGroup =
          realGuideRefresh;
      }
      const afterRollback = await transactionalSnapshot(
        prisma,
        primary.group.id,
        primary.order.id,
      );
      assert.deepEqual(afterRollback, beforeRollback);

      const finalLog = await prisma.operationLog.findFirst({
        where: {
          entityId: withRefund.order.id,
          action: 'sales_orders.points_destination.guide_personal',
        },
        orderBy: { createdAt: 'desc' },
      });
      assert.ok(finalLog, 'the same committed transaction must include its audit log');
    } finally {
      await prisma.$disconnect();
    }
  },
);

async function assertMigratedSchema(prisma) {
  const versionRows = await prisma.$queryRawUnsafe(
    'SELECT VERSION() AS version',
  );
  assert.match(String(versionRows[0].version), /^8\./);

  if (process.env.GUIDE_POINTS_EXPECT_MIGRATION_HISTORY === '1') {
    const migrations = await prisma.$queryRawUnsafe(`
      SELECT migration_name AS migrationName,
             finished_at AS finishedAt,
             rolled_back_at AS rolledBackAt
      FROM _prisma_migrations
      WHERE migration_name IN (
        '20260727000100_guide_personal_points',
        '20260729000400_partial_personal_points_split'
      )
    `);
    assert.equal(migrations.length, 2);
    assert.ok(migrations.every((row) => row.finishedAt && !row.rolledBackAt));
  }

  const columns = await prisma.$queryRawUnsafe(`
    SELECT table_name AS tableName, column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'sales_orders' AND column_name = 'personal_amount_cents')
        OR
        (table_name = 'after_sales_orders'
          AND column_name = 'personal_points_refund_amount_cents')
      )
  `);
  assert.deepEqual(
    new Set(columns.map((row) => `${row.tableName}.${row.columnName}`)),
    new Set([
      'sales_orders.personal_amount_cents',
      'after_sales_orders.personal_points_refund_amount_cents',
    ]),
  );

  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'guide_points_summaries'
  `);
  assert.equal(tables.length, 1);

  const constraints = await prisma.$queryRawUnsafe(`
    SELECT constraint_name AS constraintName
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND constraint_name IN (
        'sales_orders_personal_amount_bounds_chk',
        'sales_orders_points_destination_amount_chk',
        'after_sales_orders_personal_refund_bounds_chk',
        'sales_orders_personal_points_guide_id_fkey',
        'guide_points_summaries_group_guide_key',
        'guide_points_summaries_travel_group_id_fkey',
        'guide_points_summaries_guide_id_fkey'
      )
  `);
  const constraintNames = new Set(
    constraints.map((row) => row.constraintName),
  );
  const runtimeConstraints = [
    'sales_orders_personal_points_guide_id_fkey',
    'guide_points_summaries_group_guide_key',
    'guide_points_summaries_travel_group_id_fkey',
    'guide_points_summaries_guide_id_fkey',
  ];
  for (const constraintName of runtimeConstraints) {
    assert.ok(constraintNames.has(constraintName), constraintName);
  }
  if (process.env.GUIDE_POINTS_EXPECT_MIGRATION_HISTORY === '1') {
    for (const constraintName of [
      'sales_orders_personal_amount_bounds_chk',
      'sales_orders_points_destination_amount_chk',
      'after_sales_orders_personal_refund_bounds_chk',
    ]) {
      assert.ok(constraintNames.has(constraintName), constraintName);
    }
  }

  const indexes = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT index_name AS indexName
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND index_name IN (
        'sales_orders_personal_amount_cents_idx',
        'sales_orders_travel_group_personal_amount_idx',
        'sales_orders_travel_group_id_personal_amount_cents_idx',
        'after_sales_orders_personal_refund_idx'
      )
  `);
  const indexNames = new Set(indexes.map((row) => row.indexName));
  assert.ok(indexNames.has('sales_orders_personal_amount_cents_idx'));
  assert.ok(indexNames.has('after_sales_orders_personal_refund_idx'));
  assert.ok(
    indexNames.has('sales_orders_travel_group_personal_amount_idx') ||
      indexNames.has(
        'sales_orders_travel_group_id_personal_amount_cents_idx',
      ),
  );
}

async function createGroupAndOrder(
  prisma,
  { suffix, agencyName, guide, totalAmountCents },
) {
  const unique = crypto.randomUUID();
  const group = await prisma.travelGroup.create({
    data: {
      id: crypto.randomUUID(),
      groupNo: `IT-${suffix}-${unique}`,
      visitDate: new Date('2026-07-15T00:00:00.000Z'),
      travelAgency: agencyName,
      guideId: guide.id,
      guideName: guide.name,
      guidePhone: guide.phone,
      financeMark: true,
    },
  });
  const order = await prisma.salesOrder.create({
    data: {
      id: crypto.randomUUID(),
      orderNo: `IT-ORDER-${suffix}-${unique}`,
      travelGroupId: group.id,
      customerName: 'Integration Customer',
      orderDate: new Date('2026-07-15T00:00:00.000Z'),
      totalAmountCents,
      status: 'VALID',
      financeMark: true,
    },
  });
  return { group, order };
}

async function transactionalSnapshot(prisma, travelGroupId, salesOrderId) {
  const [order, ordinary, guides, commissions, logs] = await Promise.all([
    prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        pointsDestination: true,
        personalAmountCents: true,
        personalPointsGuideId: true,
        personalDailyRebateRate: true,
        personalMonthlyRebateRate: true,
      },
    }),
    prisma.travelGroupFinanceSummary.findUnique({
      where: { travelGroupId },
      select: {
        totalSalesAmountCents: true,
        confirmedRefundAmountCents: true,
        effectiveSalesAmountCents: true,
        totalDailyRebateCents: true,
        totalMonthlyRebateCents: true,
      },
    }),
    prisma.guidePointsSummary.findMany({
      where: { travelGroupId },
      orderBy: { guideId: 'asc' },
      select: {
        guideId: true,
        orderCount: true,
        totalSalesAmountCents: true,
        confirmedRefundAmountCents: true,
        totalDailyPointsCents: true,
        totalMonthlyPointsCents: true,
      },
    }),
    prisma.commissionRecord.findMany({
      where: { salesOrderId },
      orderBy: { targetType: 'asc' },
      select: {
        targetType: true,
        grossAmountCents: true,
        baseAmountCents: true,
        amountCents: true,
        pointsCents: true,
      },
    }),
    prisma.operationLog.count({
      where: {
        OR: [{ entityId: salesOrderId }, { entityId: travelGroupId }],
      },
    }),
  ]);
  return JSON.parse(JSON.stringify({ order, ordinary, guides, commissions, logs }));
}

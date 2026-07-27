import { PrismaClient } from '@prisma/client';
import {
  buildAfterSalesCommissionAdjustmentRecords,
  isSameAfterSalesCommissionBusinessKey,
} from '../src/modules/business-data/business-data.nest.service';

type BackfillResult = {
  processedAfterSalesOrders: number;
  createdAdjustmentRecords: number;
  updatedAdjustmentRecords: number;
  neutralizedStaleRecords: number;
};

type BackfillOptions = {
  batchSize?: number;
  logger?: Pick<Console, 'log'>;
};

export async function backfillAfterSalesIndependentOrders(
  prisma: any,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const batchSize = normalizeBatchSize(options.batchSize);
  const result: BackfillResult = {
    processedAfterSalesOrders: 0,
    createdAdjustmentRecords: 0,
    updatedAdjustmentRecords: 0,
    neutralizedStaleRecords: 0,
  };
  let cursorId: string | undefined;

  while (true) {
    const batch = await prisma.afterSalesOrder.findMany({
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
      select: { id: true },
    });
    if (batch.length === 0) {
      break;
    }

    for (const summary of batch) {
      const counts = await prisma.$transaction(async (tx: any) => {
        const afterSalesOrder = await tx.afterSalesOrder.findUnique({
          where: { id: summary.id },
          include: {
            salesOrder: {
              include: {
                travelGroup: true,
              },
            },
          },
        });
        if (!afterSalesOrder?.salesOrder) {
          return { created: 0, updated: 0, neutralized: 0 };
        }
        const sourceRecords = await tx.commissionRecord.findMany({
          where: {
            salesOrderId: afterSalesOrder.salesOrderId,
            afterSalesOrderId: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        const expectedRecords = buildAfterSalesCommissionAdjustmentRecords({
          afterSalesOrder,
          sourceSalesOrder: afterSalesOrder.salesOrder,
          sourceRecords,
          actor: {
            id:
              afterSalesOrder.updatedById ||
              afterSalesOrder.createdById ||
              null,
          },
        });
        const existingRecords = await tx.commissionRecord.findMany({
          where: { afterSalesOrderId: afterSalesOrder.id },
        });
        const touchedIds = new Set<string>();
        let created = 0;
        let updated = 0;

        for (const data of expectedRecords) {
          const current = existingRecords.find((record: any) =>
            isSameAfterSalesCommissionBusinessKey(record, data),
          );
          if (current) {
            await tx.commissionRecord.update({
              where: { id: current.id },
              data: {
                ...data,
                updatedById:
                  afterSalesOrder.updatedById ||
                  afterSalesOrder.createdById ||
                  null,
                updatedAt: new Date(),
              },
            });
            touchedIds.add(current.id);
            updated += 1;
          } else {
            const createdRecord = await tx.commissionRecord.create({
              data: {
                ...data,
                createdById:
                  afterSalesOrder.createdById ||
                  afterSalesOrder.updatedById ||
                  null,
                updatedById:
                  afterSalesOrder.updatedById ||
                  afterSalesOrder.createdById ||
                  null,
              },
            });
            touchedIds.add(createdRecord.id);
            created += 1;
          }
        }

        let neutralized = 0;
        for (const staleRecord of existingRecords) {
          if (touchedIds.has(staleRecord.id)) {
            continue;
          }
          await tx.commissionRecord.update({
            where: { id: staleRecord.id },
            data: {
              grossAmountCents: 0,
              confirmedRefundAmountCents: 0,
              baseAmountCents: 0,
              deductionAmountCents: 0,
              amountCents: 0,
              pointsCents: 0,
              isConfirmed: false,
              confirmedById: null,
              confirmedAt: null,
              calculationNote: '售后调整来源已失效，保留记录用于审计。',
              updatedById:
                afterSalesOrder.updatedById ||
                afterSalesOrder.createdById ||
                null,
              updatedAt: new Date(),
            },
          });
          neutralized += 1;
        }
        return { created, updated, neutralized };
      });

      result.processedAfterSalesOrders += 1;
      result.createdAdjustmentRecords += counts.created;
      result.updatedAdjustmentRecords += counts.updated;
      result.neutralizedStaleRecords += counts.neutralized;
    }

    cursorId = batch[batch.length - 1]?.id;
    options.logger?.log(
      `已回填 ${result.processedAfterSalesOrders} 条售后记录。`,
    );
    if (batch.length < batchSize) {
      break;
    }
  }

  return result;
}

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    return 100;
  }
  return Math.min(Number(value), 500);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillAfterSalesIndependentOrders(prisma, {
      logger: console,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { PrismaClient } from '@prisma/client';

import { defaultBackfillShippingDate } from '../src/modules/business-data/sales-order-shipping-date.helper';

export interface ShippingDateBackfillOptions {
  batchId?: string;
  batchSize?: number;
  onProgress?: (result: ShippingDateBackfillResult) => void;
}

export interface ShippingDateBackfillResult {
  batchId: string;
  scanned: number;
  updated: number;
  skipped: number;
  failed: Array<{ id: string; message: string }>;
}

export async function backfillSalesOrderShippingDates(
  prisma: any,
  options: ShippingDateBackfillOptions = {},
): Promise<ShippingDateBackfillResult> {
  const batchSize = normalizeBatchSize(options.batchSize);
  const batchId =
    options.batchId?.trim() ||
    `shipping-date-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const result: ShippingDateBackfillResult = {
    batchId,
    scanned: 0,
    updated: 0,
    skipped: 0,
    failed: [],
  };
  let cursorId: string | undefined;

  while (true) {
    const rows = await prisma.salesOrder.findMany({
      where: {
        shippingDate: null,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) {
      break;
    }
    cursorId = String(rows[rows.length - 1].id);

    for (const row of rows) {
      result.scanned += 1;
      try {
        const shippingDate = defaultBackfillShippingDate(
          new Date(row.createdAt),
        );
        const updateResult = await prisma.salesOrder.updateMany({
          where: {
            id: row.id,
            shippingDate: null,
          },
          data: {
            shippingDate,
            shippingDateSource: 'MIGRATION',
            shippingDateBackfillBatchId: batchId,
          },
        });
        if (updateResult.count === 1) {
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.failed.push({
          id: String(row.id),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    options.onProgress?.({ ...result, failed: [...result.failed] });
    if (rows.length < batchSize) {
      break;
    }
  }

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillSalesOrderShippingDates(prisma, {
      batchId: argumentValue('--batch-id'),
      batchSize: Number(argumentValue('--batch-size') || 500),
      onProgress: (progress) => {
        process.stdout.write(
          `Shipping-date backfill ${progress.batchId}: ` +
            `${progress.updated} updated, ${progress.skipped} skipped, ` +
            `${progress.failed.length} failed.\n`,
        );
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function normalizeBatchSize(value: unknown): number {
  const parsed = Number(value ?? 500);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2000
    ? parsed
    : 500;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (require.main === module) {
  void main();
}

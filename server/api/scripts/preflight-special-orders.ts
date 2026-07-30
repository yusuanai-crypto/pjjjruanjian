import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.salesOrder.findMany({
    where: {
      orderType: { in: ['INTERNAL', 'EXTERNAL', 'BUYBACK'] },
      workflowStatus: null,
    },
    select: {
      id: true,
      orderNo: true,
      orderType: true,
      status: true,
      orderDate: true,
      totalAmountCents: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          items: true,
          paymentDetails: true,
          afterSalesOrders: true,
          commissionRecords: true,
        },
      },
    },
    orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
  });
  const orderIds = orders.map((order) => order.id);
  const inventoryDocuments = orderIds.length
    ? await prisma.inventoryDocument.groupBy({
        by: ['sourceId'],
        where: {
          sourceId: { in: orderIds },
          status: 'POSTED',
        },
        _count: { _all: true },
      })
    : [];
  const documentCountByOrder = new Map(
    inventoryDocuments.map((row) => [
      row.sourceId || '',
      row._count._all,
    ]),
  );

  const report = orders.map((order) => {
    const postedInventoryDocumentCount =
      documentCountByOrder.get(order.id) || 0;
    const downstreamFactCount =
      postedInventoryDocumentCount +
      order._count.paymentDetails +
      order._count.afterSalesOrders +
      order._count.commissionRecords;
    return {
      ...order,
      postedInventoryDocumentCount,
      downstreamFactCount,
      classification:
        String(order.status) === 'CANCELLED'
          ? 'CANCELLED_CANDIDATE'
          : downstreamFactCount > 0
            ? 'MANUAL_REVIEW_EFFECTIVE_OR_REVERSED'
            : 'MANUAL_REVIEW_NO_DOWNSTREAM_FACT_FOUND',
      recommendedAction:
        'Review source documents and business owner evidence; do not infer DRAFT solely from missing downstream rows.',
    };
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: 'READ_ONLY',
        legacySpecialOrderCount: report.length,
        countsByClassification: countBy(
          report,
          (row) => row.classification,
        ),
        orders: report,
      },
      null,
      2,
    )}\n`,
  );
}

function countBy<T>(rows: T[], keyOf: (row: T) => string) {
  return rows.reduce<Record<string, number>>((result, row) => {
    const key = keyOf(row);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

main()
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';

type Candidate = {
  warehouseId: string;
  productId: string;
};

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT DISTINCT facts.warehouse_id AS warehouseId,
                    facts.product_id AS productId
    FROM (
      SELECT warehouse_id, product_id
      FROM warehouse_product_stocks
      UNION
      SELECT warehouse_id, product_id
      FROM inventory_batches
      UNION
      SELECT warehouse_id, product_id
      FROM inventory_movements
      UNION
      SELECT warehouse_id, product_id
      FROM serialized_inventory_units
      WHERE warehouse_id IS NOT NULL
    ) AS facts
    INNER JOIN warehouses AS warehouse
      ON warehouse.id = facts.warehouse_id
    INNER JOIN products AS product
      ON product.id = facts.product_id
    ORDER BY facts.warehouse_id, facts.product_id
  `;

  const existing = await prisma.warehouseProductConfiguration.findMany({
    where: {
      OR: candidates.map((candidate) => ({
        warehouseId: candidate.warehouseId,
        productId: candidate.productId,
      })),
    },
    select: { warehouseId: true, productId: true },
  });
  const existingKeys = new Set(
    existing.map((row) => `${row.warehouseId}\u0000${row.productId}`),
  );
  const missing = candidates.filter(
    (candidate) =>
      !existingKeys.has(
        `${candidate.warehouseId}\u0000${candidate.productId}`,
      ),
  );

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'preview',
        discoveredPairs: candidates.length,
        existingPairs: existing.length,
        missingPairs: missing.length,
        sample: missing.slice(0, 50),
      },
      null,
      2,
    ),
  );

  if (!apply || missing.length === 0) {
    if (!apply) {
      console.log('Preview only. Re-run with --apply after review.');
    }
    return;
  }

  const result = await prisma.warehouseProductConfiguration.createMany({
    data: missing.map((candidate) => ({
      warehouseId: candidate.warehouseId,
      productId: candidate.productId,
      isActive: true,
    })),
    skipDuplicates: true,
  });
  console.log(`Applied ${result.count} warehouse-product configurations.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

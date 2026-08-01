import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  address: true,
  managerUserId: true,
  parentWarehouseId: true,
  isActive: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  manager: {
    select: {
      id: true,
      name: true,
    },
  },
  parentWarehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },
  childWarehouses: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      isDefault: true,
    },
  },
  _count: {
    select: {
      childWarehouses: true,
      stocks: true,
      productConfigurations: true,
      batches: true,
      documents: true,
      outboundDocuments: true,
      inboundDocuments: true,
      movements: true,
      reservations: true,
      outboundTransfers: true,
      inboundTransfers: true,
      transferReceipts: true,
      afterSalesReceipts: true,
      previousAfterSalesReceiptUnits: true,
      stockAlertConfigs: true,
      inventoryAlerts: true,
      stocktakes: true,
      stocktakeExpectedScans: true,
      fulfillmentSalesOrders: true,
      serializedUnits: true,
      specialOrderItems: true,
    },
  },
} as const;

const STOCK_SELECT = {
  id: true,
  warehouseId: true,
  productId: true,
  onHandQty: true,
  reservedQty: true,
  unavailableQty: true,
  inTransitQty: true,
  version: true,
  lastMovementId: true,
  rebuiltAt: true,
  updatedAt: true,
  warehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      isDefault: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
      unit: true,
      isActive: true,
      inventoryTrackingMode: true,
    },
  },
} as const;

@Injectable()
export class InventoryQueryPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  root() {
    return this.prisma;
  }

  async runInTransaction<T>(
    work: (transaction: any) => Promise<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async findInventoryConfiguration(db: any = this.prisma) {
    return await db.inventoryConfiguration.findUnique({
      where: { singletonKey: 'INVENTORY' },
      select: {
        id: true,
        singletonKey: true,
        goLiveAt: true,
        policyVersion: true,
        maintenanceMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async upsertInventoryConfiguration(
    transaction: any,
    create: any,
    update: any,
  ) {
    return await transaction.inventoryConfiguration.upsert({
      where: { singletonKey: 'INVENTORY' },
      create,
      update,
      select: {
        id: true,
        singletonKey: true,
        goLiveAt: true,
        policyVersion: true,
        maintenanceMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listWarehouses(filters: any) {
    const where: any = {};
    if (filters.isActive !== null) {
      where.isActive = filters.isActive;
    }
    if (filters.isDefault !== null) {
      where.isDefault = filters.isDefault;
    }
    if (filters.parentFilterSet) {
      where.parentWarehouseId = filters.parentWarehouseId;
    }
    if (filters.manager) {
      where.OR = [
        { managerUserId: filters.manager },
        { manager: { name: { contains: filters.manager } } },
      ];
    }
    if (filters.query) {
      const queryConditions = [
        { code: { contains: filters.query } },
        { name: { contains: filters.query } },
      ];
      where.AND = [
        ...(where.AND || []),
        { OR: queryConditions },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where,
        select: WAREHOUSE_SELECT,
        orderBy: [
          { isDefault: 'desc' },
          { isActive: 'desc' },
          { code: 'asc' },
          { id: 'asc' },
        ],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.warehouse.count({ where }),
    ]);
    return { rows, total };
  }

  async findWarehouseForMutation(transaction: any, id: string) {
    return await transaction.warehouse.findUnique({
      where: { id },
      select: {
        ...WAREHOUSE_SELECT,
        normalizedCode: true,
        normalizedName: true,
        activeDefaultKey: true,
        createdById: true,
        updatedById: true,
      },
    });
  }

  async findWarehouse(id: string, db: any = this.prisma) {
    return await db.warehouse.findUnique({
      where: { id },
      select: WAREHOUSE_SELECT,
    });
  }

  async findWarehouseByNormalizedCode(
    transaction: any,
    normalizedCode: string,
  ) {
    return await transaction.warehouse.findUnique({
      where: { normalizedCode },
      select: { id: true },
    });
  }

  async findWarehouseByNormalizedName(
    transaction: any,
    normalizedName: string,
  ) {
    return await transaction.warehouse.findUnique({
      where: { normalizedName },
      select: { id: true },
    });
  }

  async findManager(transaction: any, id: string) {
    return await transaction.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });
  }

  async clearOtherDefaults(transaction: any, warehouseId: string) {
    return await transaction.warehouse.updateMany({
      where: {
        id: { not: warehouseId },
        OR: [
          { isDefault: true },
          { activeDefaultKey: 'ACTIVE_DEFAULT' },
        ],
      },
      data: {
        isDefault: false,
        activeDefaultKey: null,
      },
    });
  }

  async createWarehouse(transaction: any, data: any) {
    return await transaction.warehouse.create({
      data,
      select: WAREHOUSE_SELECT,
    });
  }

  async updateWarehouse(transaction: any, id: string, data: any) {
    return await transaction.warehouse.update({
      where: { id },
      data,
      select: WAREHOUSE_SELECT,
    });
  }

  async warehouseBlockers(transaction: any, warehouseId: string) {
    const [
      stock,
      reservation,
      serializedUnit,
      draftDocument,
      unfinishedTransfer,
      activeStocktake,
    ] = await Promise.all([
      transaction.warehouseProductStock.findFirst({
        where: {
          warehouseId,
          OR: [
            { onHandQty: { not: 0 } },
            { reservedQty: { not: 0 } },
            { unavailableQty: { not: 0 } },
            { inTransitQty: { not: 0 } },
          ],
        },
        select: { id: true },
      }),
      transaction.inventoryReservation.findFirst({
        where: {
          warehouseId,
          status: { in: ['OPEN', 'PARTIAL', 'RESERVED'] },
          OR: [
            { requestedQty: { gt: 0 } },
            { reservedQty: { gt: 0 } },
            { assignedQty: { gt: 0 } },
          ],
        },
        select: { id: true },
      }),
      transaction.serializedInventoryUnit.findFirst({
        where: {
          warehouseId,
          status: {
            in: [
              'PENDING_COST',
              'AVAILABLE',
              'ALLOCATED',
              'RESERVED',
              'UNAVAILABLE',
            ],
          },
        },
        select: { id: true },
      }),
      transaction.inventoryDocument.findFirst({
        where: {
          status: 'DRAFT',
          OR: [
            { warehouseId },
            { fromWarehouseId: warehouseId },
            { toWarehouseId: warehouseId },
          ],
        },
        select: { id: true },
      }),
      transaction.inventoryTransfer.findFirst({
        where: {
          status: {
            in: ['DRAFT', 'OUTBOUND', 'PARTIALLY_RECEIVED'],
          },
          OR: [
            { fromWarehouseId: warehouseId },
            { toWarehouseId: warehouseId },
          ],
        },
        select: { id: true },
      }),
      transaction.stocktake?.findFirst
        ? transaction.stocktake.findFirst({
            where: {
              warehouseId,
              status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
              activeKey: { not: null },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      hasStock: Boolean(stock || serializedUnit),
      hasReservation: Boolean(reservation),
      hasDraftDocument: Boolean(draftDocument),
      hasUnfinishedTransfer: Boolean(unfinishedTransfer),
      hasActiveStocktake: Boolean(activeStocktake),
    };
  }

  async warehouseDeleteBlockers(transaction: any, warehouseId: string) {
    const [
      childWarehouses,
      stocks,
      productConfigurations,
      batches,
      documents,
      movements,
      reservations,
      transfers,
      transferReceipts,
      afterSalesReceipts,
      previousAfterSalesUnits,
      stockAlertConfigs,
      inventoryAlerts,
      stocktakes,
      stocktakeExpectedScans,
      fulfillmentOrders,
      serializedUnits,
      specialOrderItems,
    ] = await Promise.all([
      transaction.warehouse.count({
        where: { parentWarehouseId: warehouseId },
      }),
      transaction.warehouseProductStock.count({ where: { warehouseId } }),
      transaction.warehouseProductConfiguration.count({
        where: { warehouseId },
      }),
      transaction.inventoryBatch.count({ where: { warehouseId } }),
      transaction.inventoryDocument.count({
        where: {
          OR: [
            { warehouseId },
            { fromWarehouseId: warehouseId },
            { toWarehouseId: warehouseId },
          ],
        },
      }),
      transaction.inventoryMovement.count({ where: { warehouseId } }),
      transaction.inventoryReservation.count({ where: { warehouseId } }),
      transaction.inventoryTransfer.count({
        where: {
          OR: [
            { fromWarehouseId: warehouseId },
            { toWarehouseId: warehouseId },
          ],
        },
      }),
      transaction.inventoryTransferReceipt.count({ where: { warehouseId } }),
      transaction.afterSalesReceipt.count({ where: { warehouseId } }),
      transaction.afterSalesReceiptSerializedUnit.count({
        where: { previousWarehouseId: warehouseId },
      }),
      transaction.stockAlertConfig.count({ where: { warehouseId } }),
      transaction.inventoryAlert.count({ where: { warehouseId } }),
      transaction.stocktake.count({ where: { warehouseId } }),
      transaction.stocktakeSerializedScan.count({
        where: { expectedWarehouseId: warehouseId },
      }),
      transaction.salesOrder.count({
        where: { fulfillmentWarehouseId: warehouseId },
      }),
      transaction.serializedInventoryUnit.count({ where: { warehouseId } }),
      transaction.salesOrderItem.count({ where: { warehouseId } }),
    ]);
    return {
      childWarehouses,
      stocks,
      productConfigurations,
      batches,
      documents,
      movements,
      reservations,
      transfers,
      transferReceipts,
      afterSalesReceipts,
      previousAfterSalesUnits,
      stockAlertConfigs,
      inventoryAlerts,
      stocktakes,
      stocktakeExpectedScans,
      fulfillmentOrders,
      serializedUnits,
      specialOrderItems,
    };
  }

  async warehouseHasHistory(transaction: any, warehouseId: string) {
    const blockers = await this.warehouseDeleteBlockers(
      transaction,
      warehouseId,
    );
    return Object.entries(blockers).some(
      ([key, value]) => key !== 'childWarehouses' && Number(value) > 0,
    );
  }

  async deleteWarehouse(transaction: any, warehouseId: string) {
    return await transaction.warehouse.delete({ where: { id: warehouseId } });
  }

  async findWarehouseProductConfiguration(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    return await transaction.warehouseProductConfiguration.findUnique({
      where: {
        warehouseId_productId: { warehouseId, productId },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        },
      },
    });
  }

  async createWarehouseProductConfiguration(transaction: any, data: any) {
    return await transaction.warehouseProductConfiguration.create({
      data,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        },
      },
    });
  }

  async updateWarehouseProductConfiguration(
    transaction: any,
    id: string,
    data: any,
  ) {
    return await transaction.warehouseProductConfiguration.update({
      where: { id },
      data,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        },
      },
    });
  }

  async listWarehouseProductConfigurations(
    warehouseId: string,
    filters: any,
  ) {
    const where: any = { warehouseId };
    if (filters.isActive !== null) {
      where.isActive = filters.isActive;
    }
    if (filters.query || filters.inventoryTrackingMode) {
      where.product = {};
      if (filters.query) {
        where.product.OR = [
          { id: { contains: filters.query } },
          { name: { contains: filters.query } },
        ];
      }
      if (filters.inventoryTrackingMode) {
        where.product.inventoryTrackingMode =
          filters.inventoryTrackingMode;
      }
    }
    return await this.prisma.warehouseProductConfiguration.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        },
      },
      orderBy: [
        { isActive: 'desc' },
        { product: { name: 'asc' } },
        { id: 'asc' },
      ],
    });
  }

  async aggregateWarehouseProductStocks(
    warehouseIds: string[],
    productIds: string[],
  ) {
    if (warehouseIds.length === 0 || productIds.length === 0) return [];
    return await this.prisma.warehouseProductStock.groupBy({
      by: ['warehouseId', 'productId'],
      where: {
        warehouseId: { in: warehouseIds },
        productId: { in: productIds },
      },
      _sum: {
        onHandQty: true,
        reservedQty: true,
        unavailableQty: true,
        inTransitQty: true,
      },
    });
  }

  async aggregateSerializedWarehouseProductUnits(
    warehouseIds: string[],
    productIds: string[],
  ) {
    if (warehouseIds.length === 0 || productIds.length === 0) return [];
    return await this.prisma.serializedInventoryUnit.groupBy({
      by: ['warehouseId', 'productId', 'status'],
      where: {
        warehouseId: { in: warehouseIds },
        productId: { in: productIds },
        status: {
          in: [
            'PENDING_COST',
            'AVAILABLE',
            'ALLOCATED',
            'RESERVED',
            'OUTBOUND',
            'UNAVAILABLE',
          ],
        },
      },
      _count: { _all: true },
    });
  }

  async latestWarehouseProductMovements(
    warehouseIds: string[],
    productIds: string[],
  ) {
    if (warehouseIds.length === 0 || productIds.length === 0) return [];
    return await this.prisma.inventoryMovement.groupBy({
      by: ['productId'],
      where: {
        warehouseId: { in: warehouseIds },
        productId: { in: productIds },
      },
      _max: { businessAt: true },
    });
  }

  async warehouseProductHasHistory(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    const [batches, movements, reservations, serializedUnits, documentLines] =
      await Promise.all([
        transaction.inventoryBatch.count({
          where: { warehouseId, productId },
        }),
        transaction.inventoryMovement.count({
          where: { warehouseId, productId },
        }),
        transaction.inventoryReservation.count({
          where: { warehouseId, productId },
        }),
        transaction.serializedInventoryUnit.count({
          where: { warehouseId, productId },
        }),
        transaction.inventoryDocumentLine.count({
          where: {
            productId,
            document: {
              OR: [
                { warehouseId },
                { fromWarehouseId: warehouseId },
                { toWarehouseId: warehouseId },
              ],
            },
          },
        }),
      ]);
    return batches + movements + reservations + serializedUnits + documentLines > 0;
  }

  async findWarehouseProductStock(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    return await transaction.warehouseProductStock.findUnique({
      where: { warehouseId_productId: { warehouseId, productId } },
    });
  }

  async countActiveSerializedUnits(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    return await transaction.serializedInventoryUnit.count({
      where: {
        warehouseId,
        productId,
        status: {
          in: [
            'PENDING_COST',
            'AVAILABLE',
            'ALLOCATED',
            'RESERVED',
            'UNAVAILABLE',
          ],
        },
      },
    });
  }

  async listStockRows(filters: any) {
    const where: any = {};
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.inventoryTrackingMode || filters.productQuery) {
      where.product = {};
      if (filters.inventoryTrackingMode) {
        where.product.inventoryTrackingMode =
          filters.inventoryTrackingMode;
      }
      if (filters.productQuery) {
        where.product.OR = [
          { id: { contains: filters.productQuery } },
          { name: { contains: filters.productQuery } },
        ];
      }
    }
    if (filters.warehouseQuery) {
      where.warehouse = {
        OR: [
          { code: { contains: filters.warehouseQuery } },
          { name: { contains: filters.warehouseQuery } },
        ],
      };
    }
    const matchingPairs = await this.findBatchPairs(filters);
    if (matchingPairs !== null) {
      if (matchingPairs.length === 0) {
        return [];
      }
      where.AND = [
        {
          OR: matchingPairs.map((pair: any) => ({
            warehouseId: pair.warehouseId,
            productId: pair.productId,
          })),
        },
      ];
    }
    return await this.prisma.warehouseProductStock.findMany({
      where,
      select: STOCK_SELECT,
      orderBy: [
        { warehouse: { code: 'asc' } },
        { product: { name: 'asc' } },
        { id: 'asc' },
      ],
    });
  }

  async listAlertConfigsForPairs(pairs: any[]) {
    if (pairs.length === 0) {
      return [];
    }
    return await this.prisma.stockAlertConfig.findMany({
      where: {
        OR: pairs.map((pair) => ({
          warehouseId: pair.warehouseId,
          productId: pair.productId,
        })),
      },
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        minimumAvailableQty: true,
        enabled: true,
        updatedAt: true,
      },
    });
  }

  async listBatchesForPairs(pairs: any[], includeCosts: boolean) {
    if (pairs.length === 0) {
      return [];
    }
    return await this.prisma.inventoryBatch.findMany({
      where: {
        OR: pairs.map((pair) => ({
          warehouseId: pair.warehouseId,
          productId: pair.productId,
        })),
      },
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        supplierName: true,
        purchaseOrderNo: true,
        productionBatch: true,
        productionDate: true,
        receivedQty: true,
        remainingQty: true,
        unavailableQty: true,
        fifoAt: true,
        createdAt: true,
        updatedAt: true,
        ...(includeCosts
          ? {
              purchaseUnitCostCents: true,
              costStatus: true,
              costCompletedAt: true,
            }
          : {}),
      },
      orderBy: [{ fifoAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listSerializedUnitsForPairs(
    pairs: any[],
    includeCosts: boolean,
  ) {
    if (pairs.length === 0) {
      return [];
    }
    return await this.prisma.serializedInventoryUnit.findMany({
      where: {
        OR: pairs.map((pair) => ({
          warehouseId: pair.warehouseId,
          productId: pair.productId,
        })),
      },
      select: {
        warehouseId: true,
        productId: true,
        status: true,
        ...(includeCosts ? { purchaseCostCents: true } : {}),
      },
    });
  }

  async findStockRow(warehouseId: string, productId: string) {
    return await this.prisma.warehouseProductStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId,
          productId,
        },
      },
      select: STOCK_SELECT,
    });
  }

  async listMovements(filters: any, includeCosts: boolean) {
    const where = buildMovementWhere(filters);
    const [rows, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        select: {
          id: true,
          sourceKey: true,
          warehouseId: true,
          productId: true,
          batchId: true,
          serializedUnitId: true,
          reservationId: true,
          movementType: true,
          onHandDelta: true,
          reservedDelta: true,
          unavailableDelta: true,
          inTransitDelta: true,
          businessAt: true,
          operatorUserId: true,
          operatorNameSnapshot: true,
          operatorRoleSnapshot: true,
          productNameSnapshot: true,
          unitSnapshot: true,
          reason: true,
          reversalOfMovementId: true,
          createdAt: true,
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              inventoryTrackingMode: true,
            },
          },
          batch: {
            select: {
              id: true,
              purchaseOrderNo: true,
              productionBatch: true,
              productionDate: true,
            },
          },
          ...(includeCosts
            ? { purchaseUnitCostCents: true }
            : {}),
        },
        orderBy: [{ businessAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return { rows, total };
  }

  async listInboundDocuments(filters: any, includeCosts: boolean) {
    const where = buildInboundWhere(filters);
    const select = inboundDocumentSelect(includeCosts);
    const [rows, total] = await Promise.all([
      this.prisma.inventoryDocument.findMany({
        where,
        select,
        orderBy: [{ businessAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.inventoryDocument.count({ where }),
    ]);
    return { rows, total };
  }

  async findInboundDocument(id: string, includeCosts: boolean) {
    return await this.prisma.inventoryDocument.findFirst({
      where: {
        id,
        type: {
          in: ['OPENING', 'PURCHASE_RECEIPT', 'OTHER_IN'],
        },
      },
      select: inboundDocumentSelect(includeCosts),
    });
  }

  async listTransfers(
    filters: any,
    includeCosts: boolean,
    includeUnitIds: boolean,
  ) {
    const where = buildTransferWhere(filters);
    const select = transferSelect(includeCosts, includeUnitIds);
    const [rows, total] = await Promise.all([
      this.prisma.inventoryTransfer.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.inventoryTransfer.count({ where }),
    ]);
    return { rows, total };
  }

  async findTransfer(
    id: string,
    includeCosts: boolean,
    includeUnitIds: boolean,
  ) {
    return await this.prisma.inventoryTransfer.findUnique({
      where: { id },
      select: transferSelect(includeCosts, includeUnitIds),
    });
  }

  async listStocksForTransferRows(transfers: any[]) {
    const pairs = new Map<string, any>();
    for (const transfer of transfers) {
      for (const line of transfer.lines || []) {
        for (const warehouseId of [
          transfer.fromWarehouseId,
          transfer.toWarehouseId,
        ]) {
          pairs.set(`${warehouseId}\u0000${line.productId}`, {
            warehouseId,
            productId: line.productId,
          });
        }
      }
    }
    if (pairs.size === 0) {
      return [];
    }
    return await this.prisma.warehouseProductStock.findMany({
      where: { OR: [...pairs.values()] },
      select: {
        warehouseId: true,
        productId: true,
        onHandQty: true,
        reservedQty: true,
        unavailableQty: true,
        inTransitQty: true,
      },
    });
  }

  async companyStockTotals(productIds: string[]) {
    if (productIds.length === 0) {
      return [];
    }
    return await this.prisma.warehouseProductStock.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds } },
      _sum: {
        onHandQty: true,
        inTransitQty: true,
      },
    });
  }

  async listAlertConfigs(filters: any) {
    const where: any = {};
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.enabled !== null) {
      where.enabled = filters.enabled;
    }
    const [rows, total] = await Promise.all([
      this.prisma.stockAlertConfig.findMany({
        where,
        select: {
          id: true,
          warehouseId: true,
          productId: true,
          minimumAvailableQty: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              isActive: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              inventoryTrackingMode: true,
              isActive: true,
            },
          },
        },
        orderBy: [
          { warehouse: { code: 'asc' } },
          { product: { name: 'asc' } },
          { id: 'asc' },
        ],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.stockAlertConfig.count({ where }),
    ]);
    return { rows, total };
  }

  async findAlertConfig(
    transaction: any,
    warehouseId: string,
    productId: string,
  ) {
    return await transaction.stockAlertConfig.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId,
          productId,
        },
      },
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        minimumAvailableQty: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        },
      },
    });
  }

  async findProductForAlert(transaction: any, id: string) {
    return await transaction.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        inventoryTrackingMode: true,
        isActive: true,
      },
    });
  }

  async upsertAlertConfig(
    transaction: any,
    warehouseId: string,
    productId: string,
    create: any,
    update: any,
  ) {
    return await transaction.stockAlertConfig.upsert({
      where: {
        warehouseId_productId: {
          warehouseId,
          productId,
        },
      },
      create,
      update,
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        minimumAvailableQty: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        },
      },
    });
  }

  async listReportMovementFacts(
    filters: any,
    cursorId: string | null,
    take: number,
    includeCosts: boolean,
  ) {
    const where = buildReportMovementWhere(filters);
    if (cursorId) {
      where.id = { gt: cursorId };
    }
    return await this.prisma.inventoryMovement.findMany({
      where,
      select: reportMovementSelect(includeCosts),
      orderBy: { id: 'asc' },
      take,
    });
  }

  async listReportMovementPage(
    filters: any,
    page: number,
    pageSize: number,
    includeCosts: boolean,
  ) {
    const where = buildReportMovementWhere(filters);
    const [rows, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        select: reportMovementSelect(includeCosts),
        orderBy: [{ businessAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return { rows, total };
  }

  async listReportStocks(filters: any) {
    const where: any = {};
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.inventoryTrackingMode) {
      where.product = {
        inventoryTrackingMode: filters.inventoryTrackingMode,
      };
    }
    return await this.prisma.warehouseProductStock.findMany({
      where,
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        onHandQty: true,
        reservedQty: true,
        unavailableQty: true,
        inTransitQty: true,
        version: true,
        lastMovementId: true,
        warehouse: {
          select: { id: true, code: true, name: true },
        },
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
          },
        },
      },
      orderBy: [
        { warehouse: { code: 'asc' } },
        { product: { name: 'asc' } },
        { id: 'asc' },
      ],
    });
  }

  async listReportBatches(
    filters: any,
    cursorId: string | null,
    take: number,
    includeCosts: boolean,
  ) {
    const where: any = {};
    if (cursorId) {
      where.id = { gt: cursorId };
    }
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.inventoryTrackingMode) {
      where.product = {
        inventoryTrackingMode: filters.inventoryTrackingMode,
      };
    }
    return await this.prisma.inventoryBatch.findMany({
      where,
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        supplierName: true,
        purchaseOrderNo: true,
        productionBatch: true,
        productionDate: true,
        receivedQty: true,
        remainingQty: true,
        unavailableQty: true,
        fifoAt: true,
        costStatus: includeCosts,
        purchaseUnitCostCents: includeCosts,
        warehouse: {
          select: { id: true, code: true, name: true },
        },
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take,
    });
  }

  async listReportSerializedCosts(
    filters: any,
    cursorId: string | null,
    take: number,
  ) {
    const where: any = {
      warehouseId: { not: null },
    };
    if (cursorId) {
      where.id = { gt: cursorId };
    }
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    return await this.prisma.serializedInventoryUnit.findMany({
      where,
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        purchaseCostCents: true,
      },
      orderBy: { id: 'asc' },
      take,
    });
  }

  async listReportAlertFacts(
    filters: any,
    page: number,
    pageSize: number,
  ) {
    const where: any = {};
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.alertType) {
      where.type = filters.alertType;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.lastDetectedAt = {};
      if (filters.dateFrom) {
        where.lastDetectedAt.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        where.lastDetectedAt.lte = filters.dateTo;
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.inventoryAlert.findMany({
        where,
        select: {
          id: true,
          type: true,
          status: true,
          warehouseId: true,
          productId: true,
          firstDetectedAt: true,
          lastDetectedAt: true,
          resolvedAt: true,
          warehouse: {
            select: { id: true, code: true, name: true },
          },
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              inventoryTrackingMode: true,
            },
          },
        },
        orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryAlert.count({ where }),
    ]);
    return { rows, total };
  }

  async listReportAlertConfigs(filters: any) {
    const where: any = {};
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    return await this.prisma.stockAlertConfig.findMany({
      where,
      select: {
        warehouseId: true,
        productId: true,
        minimumAvailableQty: true,
        enabled: true,
      },
    });
  }

  async listReportStocktakes(
    filters: any,
    page: number,
    pageSize: number,
  ) {
    const where: any = {};
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        where.createdAt.lte = filters.dateTo;
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.stocktake.findMany({
        where,
        select: {
          id: true,
          stocktakeNo: true,
          warehouseId: true,
          productId: true,
          trackingModeSnapshot: true,
          status: true,
          reason: true,
          rejectionReason: true,
          reversalReason: true,
          submittedAt: true,
          approvedAt: true,
          rejectedAt: true,
          postedAt: true,
          reversedAt: true,
          createdAt: true,
          warehouse: {
            select: { id: true, code: true, name: true },
          },
          product: {
            select: { id: true, name: true, unit: true },
          },
          line: {
            select: {
              snapshotOnHandQty: true,
              snapshotUnavailableQty: true,
              countedOnHandQty: true,
              countedUnavailableQty: true,
              onHandDifferenceQty: true,
              unavailableDifferenceQty: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stocktake.count({ where }),
    ]);
    return { rows, total };
  }

  async listReportTransfers(
    filters: any,
    cursorId: string | null,
    take: number,
  ) {
    const where: any = {};
    if (cursorId) {
      where.id = { gt: cursorId };
    }
    if (filters.warehouseId) {
      where.OR = [
        { fromWarehouseId: filters.warehouseId },
        { toWarehouseId: filters.warehouseId },
      ];
    }
    if (filters.productId) {
      where.lines = { some: { productId: filters.productId } };
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        where.createdAt.lte = filters.dateTo;
      }
    }
    return await this.prisma.inventoryTransfer.findMany({
      where,
      select: {
        id: true,
        transferNo: true,
        status: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        outboundAt: true,
        notes: true,
        createdAt: true,
        fromWarehouse: {
          select: { id: true, code: true, name: true },
        },
        toWarehouse: {
          select: { id: true, code: true, name: true },
        },
        lines: {
          where: filters.productId
            ? { productId: filters.productId }
            : undefined,
          select: {
            id: true,
            lineNo: true,
            productId: true,
            plannedQty: true,
            outboundQty: true,
            receivedQty: true,
            unavailableQty: true,
            differenceQty: true,
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                inventoryTrackingMode: true,
              },
            },
          },
          orderBy: [{ lineNo: 'asc' as const }, { id: 'asc' as const }],
        },
        receipts: {
          select: {
            id: true,
            status: true,
            reversalOfReceiptId: true,
            lines: {
              select: {
                transferLineId: true,
                receivedQty: true,
                unavailableQty: true,
                differenceQty: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      take,
    });
  }

  private async findBatchPairs(filters: any) {
    if (!filters.batchId && !filters.batch) {
      return null;
    }
    const where: any = {};
    if (filters.batchId) {
      where.id = filters.batchId;
    }
    if (filters.batch) {
      where.OR = [
        { productionBatch: { contains: filters.batch } },
        { purchaseOrderNo: { contains: filters.batch } },
      ];
    }
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }
    if (filters.productId) {
      where.productId = filters.productId;
    }
    const rows = await this.prisma.inventoryBatch.findMany({
      where,
      select: {
        warehouseId: true,
        productId: true,
      },
    });
    const pairs = new Map<string, any>();
    for (const row of rows) {
      pairs.set(`${row.warehouseId}\u0000${row.productId}`, row);
    }
    return [...pairs.values()];
  }
}

function buildReportMovementWhere(filters: any) {
  const where: any = {};
  if (filters.warehouseId) {
    where.warehouseId = filters.warehouseId;
  }
  if (filters.productId) {
    where.productId = filters.productId;
  }
  if (filters.inventoryTrackingMode) {
    where.product = {
      inventoryTrackingMode: filters.inventoryTrackingMode,
    };
  }
  if (filters.movementType) {
    where.movementType = filters.movementType;
  }
  const upperBound = filters.asOf || filters.dateTo;
  if (filters.dateFrom || upperBound) {
    where.businessAt = {};
    if (filters.dateFrom) {
      where.businessAt.gte = filters.dateFrom;
    }
    if (upperBound) {
      where.businessAt.lte = upperBound;
    }
  }
  return where;
}

function reportMovementSelect(includeCosts: boolean) {
  return {
    id: true,
    sourceKey: true,
    warehouseId: true,
    productId: true,
    batchId: true,
    serializedUnitId: true,
    movementType: true,
    onHandDelta: true,
    reservedDelta: true,
    unavailableDelta: true,
    inTransitDelta: true,
    businessAt: true,
    operatorNameSnapshot: true,
    operatorRoleSnapshot: true,
    productNameSnapshot: true,
    unitSnapshot: true,
    purchaseUnitCostCents: includeCosts,
    reason: true,
    reversalOfMovementId: true,
    reversalOf: {
      select: { movementType: true },
    },
    warehouse: {
      select: { id: true, code: true, name: true },
    },
    product: {
      select: {
        id: true,
        name: true,
        unit: true,
        inventoryTrackingMode: true,
      },
    },
    documentLine: {
      select: {
        lineNo: true,
        document: {
          select: {
            id: true,
            documentNo: true,
            type: true,
            status: true,
            sourceType: true,
            sourceId: true,
          },
        },
      },
    },
    batch: {
      select: {
        id: true,
        supplierName: true,
        purchaseOrderNo: true,
        productionBatch: true,
        productionDate: true,
        fifoAt: true,
        costStatus: includeCosts,
        purchaseUnitCostCents: includeCosts,
      },
    },
    ...(includeCosts
      ? {
          serializedUnit: {
            select: {
              id: true,
              purchaseCostCents: true,
            },
          },
        }
      : {}),
  };
}

function buildMovementWhere(filters: any) {
  const where: any = {};
  if (filters.warehouseId) {
    where.warehouseId = filters.warehouseId;
  }
  if (filters.productId) {
    where.productId = filters.productId;
  }
  if (filters.movementType) {
    where.movementType = filters.movementType;
  }
  if (filters.inventoryTrackingMode) {
    where.product = {
      inventoryTrackingMode: filters.inventoryTrackingMode,
    };
  }
  if (filters.batchId) {
    where.batchId = filters.batchId;
  }
  if (filters.batch) {
    where.batch = {
      is: {
        OR: [
          { productionBatch: { contains: filters.batch } },
          { purchaseOrderNo: { contains: filters.batch } },
        ],
      },
    };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.businessAt = {};
    if (filters.dateFrom) {
      where.businessAt.gte = filters.dateFrom;
    }
    if (filters.dateTo) {
      where.businessAt.lte = filters.dateTo;
    }
  }
  return where;
}

function buildInboundWhere(filters: any) {
  const where: any = {
    type: {
      in: filters.type
        ? [filters.type]
        : ['OPENING', 'PURCHASE_RECEIPT', 'OTHER_IN'],
    },
  };
  if (filters.warehouseId) {
    where.warehouseId = filters.warehouseId;
  }
  if (filters.productId || filters.batch) {
    where.lines = {
      some: {
        ...(filters.productId
          ? { productId: filters.productId }
          : {}),
        ...(filters.batch
          ? {
              batch: {
                is: {
                  OR: [
                    {
                      productionBatch: {
                        contains: filters.batch,
                      },
                    },
                    {
                      purchaseOrderNo: {
                        contains: filters.batch,
                      },
                    },
                  ],
                },
              },
            }
          : {}),
      },
    };
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.dateFrom || filters.dateTo) {
    where.businessAt = {};
    if (filters.dateFrom) {
      where.businessAt.gte = filters.dateFrom;
    }
    if (filters.dateTo) {
      where.businessAt.lte = filters.dateTo;
    }
  }
  return where;
}

function buildTransferWhere(filters: any) {
  const where: any = {};
  if (filters.fromWarehouseId) {
    where.fromWarehouseId = filters.fromWarehouseId;
  }
  if (filters.toWarehouseId) {
    where.toWarehouseId = filters.toWarehouseId;
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.productId) {
    where.lines = {
      some: { productId: filters.productId },
    };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) {
      where.createdAt.gte = filters.dateFrom;
    }
    if (filters.dateTo) {
      where.createdAt.lte = filters.dateTo;
    }
  }
  return where;
}

function inboundDocumentSelect(includeCosts: boolean) {
  return {
    id: true,
    documentNo: true,
    type: true,
    status: true,
    warehouseId: true,
    sourceType: true,
    sourceId: true,
    sourceKey: true,
    businessAt: true,
    postedById: true,
    postedByNameSnapshot: true,
    postedByRoleSnapshot: true,
    postedAt: true,
    reversedAt: true,
    reversalOfDocumentId: true,
    reason: true,
    attachmentMetadata: true,
    createdAt: true,
    updatedAt: true,
    warehouse: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    lines: {
      select: {
        id: true,
        lineNo: true,
        productId: true,
        batchId: true,
        quantity: true,
        condition: true,
        productNameSnapshot: true,
        unitSnapshot: true,
        notes: true,
        createdAt: true,
        ...(includeCosts
          ? { purchaseUnitCostCents: true }
          : {}),
        batch: {
          select: {
            id: true,
            supplierName: true,
            purchaseOrderNo: true,
            productionBatch: true,
            productionDate: true,
            receivedQty: true,
            remainingQty: true,
            unavailableQty: true,
            fifoAt: true,
            createdAt: true,
            updatedAt: true,
            ...(includeCosts
              ? {
                  purchaseUnitCostCents: true,
                  costStatus: true,
                  costCompletedAt: true,
                }
              : {}),
          },
        },
      },
      orderBy: { lineNo: 'asc' as const },
    },
  };
}

function transferSelect(
  includeCosts: boolean,
  includeUnitIds: boolean,
) {
  const movementSelect = {
    id: true,
    movementType: true,
    onHandDelta: true,
    unavailableDelta: true,
    inTransitDelta: true,
    ...(includeCosts
      ? { purchaseUnitCostCents: true }
      : {}),
  } as const;
  return {
    id: true,
    transferNo: true,
    sourceKey: true,
    fromWarehouseId: true,
    toWarehouseId: true,
    status: true,
    outboundDocumentId: true,
    outboundAt: true,
    outboundById: true,
    outboundByName: true,
    outboundByRole: true,
    notes: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    fromWarehouse: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    toWarehouse: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    lines: {
      select: {
        id: true,
        lineNo: true,
        sourceLineKey: true,
        productId: true,
        trackingModeSnapshot: true,
        plannedQty: true,
        outboundQty: true,
        receivedQty: true,
        unavailableQty: true,
        differenceQty: true,
        ...(includeUnitIds ? { serializedUnitIds: true } : {}),
        notes: true,
        version: true,
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
          },
        },
      },
      orderBy: [{ lineNo: 'asc' as const }, { id: 'asc' as const }],
    },
    outboundDocument: {
      select: {
        id: true,
        documentNo: true,
        status: true,
        businessAt: true,
        lines: {
          select: {
            id: true,
            lineNo: true,
            productId: true,
            quantity: true,
            ...(includeCosts
              ? { purchaseUnitCostCents: true }
              : {}),
            movements: {
              select: movementSelect,
              orderBy: { id: 'asc' as const },
            },
          },
          orderBy: { lineNo: 'asc' as const },
        },
      },
    },
    receipts: {
      select: {
        id: true,
        receiptNo: true,
        sourceKey: true,
        status: true,
        resultDocumentId: true,
        confirmedById: true,
        confirmedByNameSnapshot: true,
        confirmedByRoleSnapshot: true,
        confirmedAt: true,
        reversalOfReceiptId: true,
        notes: true,
        version: true,
        createdAt: true,
        lines: {
          select: {
            id: true,
            transferLineId: true,
            lineNo: true,
            receivedQty: true,
            unavailableQty: true,
            differenceQty: true,
            notes: true,
          },
          orderBy: { lineNo: 'asc' as const },
        },
        resultDocument: {
          select: {
            id: true,
            documentNo: true,
            type: true,
            status: true,
            businessAt: true,
            lines: {
              select: {
                id: true,
                lineNo: true,
                productId: true,
                quantity: true,
                ...(includeCosts
                  ? { purchaseUnitCostCents: true }
                  : {}),
                movements: {
                  select: movementSelect,
                  orderBy: { id: 'asc' as const },
                },
              },
              orderBy: { lineNo: 'asc' as const },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    },
  };
}

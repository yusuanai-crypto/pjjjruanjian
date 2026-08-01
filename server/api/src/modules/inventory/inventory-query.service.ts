import { Inject, Injectable, Optional } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  TODO_REMINDERS_RECONCILER,
  TodoRemindersReconciler,
} from '../todo-reminders/todo-reminders.tokens';
import {
  canReadInventoryCost,
  requireInventoryManage,
  requireInventoryRead,
} from './inventory-access.policy';
import {
  calculateInventoryRequestHash,
  calculateStockMetrics,
  canonicalJson,
  normalizedBusinessKey,
} from './inventory-command.policy';
import { InventoryAccountingService } from './inventory-accounting.service';
import {
  actorId,
  actorName,
  actorRole,
} from './inventory.prisma.repository';
import { InventoryQueryPrismaRepository } from './inventory-query.prisma.repository';

const TRACKING_MODES = new Set([
  'NONE',
  'QUANTITY',
  'SERIALIZED',
]);
const MOVEMENT_TYPES = new Set([
  'OPENING_IN',
  'PURCHASE_IN',
  'CUSTOMER_RETURN',
  'RESERVE',
  'RELEASE',
  'SALES_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_DIFFERENCE',
  'STOCK_GAIN',
  'STOCK_LOSS',
  'OTHER_IN',
  'OTHER_OUT',
  'UNAVAILABLE_IN',
  'UNAVAILABLE_OUT',
  'REVERSAL',
]);
const ACTIVE_SERIALIZED_STATUSES = new Set([
  'PENDING_COST',
  'AVAILABLE',
  'ALLOCATED',
  'RESERVED',
  'UNAVAILABLE',
]);
const MAX_CONCURRENCY_ATTEMPTS = 3;

@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly repository: InventoryQueryPrismaRepository,
    private readonly operationLogsService: OperationLogsNestService,
    @Inject(TODO_REMINDERS_RECONCILER)
    private readonly todoReminders: TodoRemindersReconciler,
    @Optional()
    private readonly accountingService?: InventoryAccountingService,
  ) {}

  async getConfiguration(actor: any) {
    requireInventoryRead(actor);
    const row = await this.repository.findInventoryConfiguration();
    return toInventoryConfigurationDto(row);
  }

  async updateConfiguration(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    assertObject(input);
    assertAllowedFields(input, [
      'goLiveAt',
      'policyVersion',
      'maintenanceMode',
      'transferOverdueHours',
    ]);
    if (Object.keys(input).length === 0) {
      throw validationError(
        'At least one inventory configuration field must be provided.',
      );
    }
    const result = await this.repository.runInTransaction(
      async (transaction) => {
        const current =
          await this.repository.findInventoryConfiguration(
            transaction,
          );
        const now = new Date();
        const update: any = {
          updatedById: actorId(actor),
          updatedAt: now,
        };
        if (hasOwn(input, 'goLiveAt')) {
          update.goLiveAt =
            input.goLiveAt === null || input.goLiveAt === ''
              ? null
              : requiredDate(input.goLiveAt, 'goLiveAt');
        }
        if (hasOwn(input, 'policyVersion')) {
          update.policyVersion = positiveInteger(
            input.policyVersion,
            'policyVersion',
            1,
            2_147_483_647,
          );
        }
        if (hasOwn(input, 'maintenanceMode')) {
          update.maintenanceMode = requiredBoolean(
            input.maintenanceMode,
            'maintenanceMode',
          );
        }
        if (hasOwn(input, 'transferOverdueHours')) {
          update.transferOverdueHours =
            input.transferOverdueHours === null ||
            input.transferOverdueHours === ''
              ? null
              : positiveInteger(
                  input.transferOverdueHours,
                  'transferOverdueHours',
                  1,
                  8_760,
                );
        }
        const created = {
          id: crypto.randomUUID(),
          singletonKey: 'INVENTORY',
          goLiveAt: update.goLiveAt ?? null,
          policyVersion: update.policyVersion ?? 1,
          maintenanceMode: update.maintenanceMode ?? false,
          transferOverdueHours:
            update.transferOverdueHours ?? null,
          createdById: actorId(actor),
          updatedById: actorId(actor),
          createdAt: now,
          updatedAt: now,
        };
        const result =
          await this.repository.upsertInventoryConfiguration(
            transaction,
            created,
            update,
          );
        const before = toInventoryConfigurationDto(current);
        const after = toInventoryConfigurationDto(result);
        await this.appendSafeLog(
          transaction,
          actor,
          current
            ? 'inventory.configuration.update'
            : 'inventory.configuration.create',
          current ? 'UPDATE' : 'CREATE',
          'inventory_configuration',
          result.id,
          before,
          after,
          metadata,
        );
        return after;
      },
    );
    if (hasOwn(input, 'transferOverdueHours')) {
      await this.todoReminders?.safeReconcileAllInventoryPairs();
    }
    return result;
  }

  async listWarehouses(actor: any, input: any = {}) {
    requireInventoryRead(actor);
    const filters = parseWarehouseFilters(input);
    const { rows, total } =
      await this.repository.listWarehouses(filters);
    return {
      warehouses: rows.map(toWarehouseDto),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async getWarehouse(actor: any, warehouseIdInput: unknown) {
    requireInventoryRead(actor);
    const warehouseId = requiredId(warehouseIdInput, 'warehouseId');
    const row = await this.repository.findWarehouse(warehouseId);
    if (!row) {
      throw createHttpError(
        404,
        'INVENTORY_WAREHOUSE_NOT_FOUND',
        '仓库不存在。',
      );
    }
    const blockers = await this.repository.warehouseDeleteBlockers(
      this.repository.root(),
      warehouseId,
    );
    return {
      ...toWarehouseDto(row),
      businessStatus: toWarehouseBusinessStatus(blockers, row),
    };
  }

  async createWarehouse(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    assertObject(input);
    assertAllowedFields(input, [
      'code',
      'name',
      'address',
      'managerUserId',
      'parentWarehouseId',
      'isActive',
      'isDefault',
    ]);
    const code = requiredString(input.code, 'code', 80);
    const name = requiredString(input.name, 'name', 160);
    const address = optionalString(input.address, 'address', 255);
    const managerUserId = optionalId(input.managerUserId, 'managerUserId');
    const parentWarehouseId = optionalId(
      input.parentWarehouseId,
      'parentWarehouseId',
    );
    const isActive =
      input.isActive === undefined
        ? true
        : requiredBoolean(input.isActive, 'isActive');
    const isDefault =
      input.isDefault === undefined
        ? false
        : requiredBoolean(input.isDefault, 'isDefault');
    if (isDefault && !isActive) {
      throw validationError(
        'An inactive warehouse cannot be the default warehouse.',
      );
    }
    if (isDefault && parentWarehouseId) {
      throw createHttpError(
        409,
        'INVENTORY_CHILD_WAREHOUSE_CANNOT_BE_DEFAULT',
        '子仓不能设为默认仓库。',
      );
    }
    const normalizedCode = normalizedWarehouseValue(code);
    const normalizedName = normalizedWarehouseValue(name);
    const id = crypto.randomUUID();
    try {
      return await this.withConcurrencyRetry(async () =>
        this.repository.runInTransaction(async (transaction) => {
          await this.assertWarehouseUnique(
            transaction,
            normalizedCode,
            normalizedName,
          );
          await this.assertManager(transaction, managerUserId);
          await this.assertParentWarehouse(
            transaction,
            parentWarehouseId,
            id,
          );
          if (isDefault) {
            await this.repository.clearOtherDefaults(transaction, id);
          }
          const created = await this.repository.createWarehouse(
            transaction,
            {
              id,
              code,
              normalizedCode,
              name,
              normalizedName,
              address,
              managerUserId,
              parentWarehouseId,
              isActive,
              isDefault,
              activeDefaultKey:
                isActive && isDefault ? 'ACTIVE_DEFAULT' : null,
              createdById: actorId(actor),
              updatedById: actorId(actor),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          );
          const dto = toWarehouseDto(created);
          await this.appendSafeLog(
            transaction,
            actor,
            'inventory.warehouse.create',
            'CREATE',
            'warehouse',
            created.id,
            null,
            dto,
            metadata,
          );
          return dto;
        }),
      );
    } catch (error) {
      throw mapWarehouseWriteError(error);
    }
  }

  async updateWarehouse(
    actor: any,
    warehouseIdInput: unknown,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    const warehouseId = requiredId(warehouseIdInput, 'warehouseId');
    assertObject(input);
    assertAllowedFields(input, [
      'code',
      'name',
      'address',
      'managerUserId',
      'parentWarehouseId',
      'isActive',
      'isDefault',
    ]);
    if (Object.keys(input).length === 0) {
      throw validationError(
        'At least one warehouse field must be provided.',
      );
    }
    try {
      return await this.withConcurrencyRetry(async () =>
        this.repository.runInTransaction(async (transaction) => {
          const current =
            await this.repository.findWarehouseForMutation(
              transaction,
              warehouseId,
            );
          if (!current) {
            throw createHttpError(
              404,
              'INVENTORY_WAREHOUSE_NOT_FOUND',
              'The warehouse does not exist.',
            );
          }
          const data: any = {
            updatedById: actorId(actor),
            updatedAt: new Date(),
          };
          if (hasOwn(input, 'code')) {
            data.code = requiredString(input.code, 'code', 80);
            data.normalizedCode = normalizedWarehouseValue(data.code);
          }
          if (hasOwn(input, 'name')) {
            data.name = requiredString(input.name, 'name', 160);
            data.normalizedName = normalizedWarehouseValue(data.name);
          }
          if (hasOwn(input, 'address')) {
            data.address = optionalString(
              input.address,
              'address',
              255,
            );
          }
          if (hasOwn(input, 'managerUserId')) {
            data.managerUserId = optionalId(
              input.managerUserId,
              'managerUserId',
            );
            await this.assertManager(transaction, data.managerUserId);
          }
          const effectiveParentWarehouseId = hasOwn(
            input,
            'parentWarehouseId',
          )
            ? optionalId(input.parentWarehouseId, 'parentWarehouseId')
            : current.parentWarehouseId ?? null;
          const parentChanged =
            effectiveParentWarehouseId !==
            (current.parentWarehouseId ?? null);
          if (parentChanged) {
            if (
              effectiveParentWarehouseId &&
              Number(current._count?.childWarehouses || 0) > 0
            ) {
              throw createHttpError(
                409,
                'INVENTORY_WAREHOUSE_WITH_CHILDREN_CANNOT_BECOME_CHILD',
                '该仓库已有子仓，不能再改为子仓。请先处理全部子仓。',
              );
            }
            if (
              await this.repository.warehouseHasHistory(
                transaction,
                warehouseId,
              )
            ) {
              throw createHttpError(
                409,
                'INVENTORY_WAREHOUSE_PARENT_CHANGE_HAS_HISTORY',
                '该仓库已有库存或业务历史，不能变更所属父仓，以免改变历史库存归属。',
              );
            }
            await this.assertParentWarehouse(
              transaction,
              effectiveParentWarehouseId,
              warehouseId,
            );
            data.parentWarehouseId = effectiveParentWarehouseId;
          }
          if (
            data.normalizedCode &&
            data.normalizedCode !== current.normalizedCode
          ) {
            await this.assertWarehouseCodeUnique(
              transaction,
              data.normalizedCode,
              warehouseId,
            );
          }
          if (
            data.normalizedName &&
            data.normalizedName !== current.normalizedName
          ) {
            await this.assertWarehouseNameUnique(
              transaction,
              data.normalizedName,
              warehouseId,
            );
          }
          const effectiveActive = hasOwn(input, 'isActive')
            ? requiredBoolean(input.isActive, 'isActive')
            : Boolean(current.isActive);
          const effectiveDefault = hasOwn(input, 'isDefault')
            ? requiredBoolean(input.isDefault, 'isDefault')
            : Boolean(current.isDefault);
          if (!effectiveActive && current.isDefault) {
            throw createHttpError(
              409,
              'INVENTORY_DEFAULT_WAREHOUSE_CANNOT_DISABLE',
              'Select another active default warehouse before disabling this warehouse.',
            );
          }
          if (effectiveDefault && !effectiveActive) {
            throw validationError(
              'An inactive warehouse cannot be the default warehouse.',
            );
          }
          if (effectiveDefault && effectiveParentWarehouseId) {
            throw createHttpError(
              409,
              'INVENTORY_CHILD_WAREHOUSE_CANNOT_BE_DEFAULT',
              '子仓不能设为默认仓库。',
            );
          }
          if (!effectiveActive && current.isActive) {
            const blockers =
              await this.repository.warehouseBlockers(
                transaction,
                warehouseId,
              );
            if (Object.values(blockers).some(Boolean)) {
              throw createHttpError(
                409,
                'INVENTORY_WAREHOUSE_HAS_ACTIVE_BUSINESS',
                'The warehouse cannot be disabled while it has inventory, reservations, in-transit stock, unfinished documents, or an active stocktake.',
              );
            }
          }
          if (effectiveDefault) {
            await this.repository.clearOtherDefaults(
              transaction,
              warehouseId,
            );
          }
          data.isActive = effectiveActive;
          data.isDefault = effectiveDefault;
          data.activeDefaultKey =
            effectiveActive && effectiveDefault
              ? 'ACTIVE_DEFAULT'
              : null;
          const updated = await this.repository.updateWarehouse(
            transaction,
            warehouseId,
            data,
          );
          const before = toWarehouseDto(current);
          const after = toWarehouseDto(updated);
          await this.appendSafeLog(
            transaction,
            actor,
            effectiveActive
              ? 'inventory.warehouse.update'
              : 'inventory.warehouse.disable',
            effectiveActive ? 'UPDATE' : 'STATUS_CHANGE',
            'warehouse',
            warehouseId,
            before,
            after,
            metadata,
          );
          return after;
        }),
      );
    } catch (error) {
      throw mapWarehouseWriteError(error);
    }
  }

  async deleteWarehouse(
    actor: any,
    warehouseIdInput: unknown,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    const warehouseId = requiredId(warehouseIdInput, 'warehouseId');
    return await this.repository.runInTransaction(async (transaction) => {
      const current = await this.repository.findWarehouseForMutation(
        transaction,
        warehouseId,
      );
      if (!current) {
        throw createHttpError(
          404,
          'INVENTORY_WAREHOUSE_NOT_FOUND',
          '仓库不存在。',
        );
      }
      if (current.isDefault) {
        throw createHttpError(
          409,
          'INVENTORY_DEFAULT_WAREHOUSE_CANNOT_DELETE',
          '默认仓库不能直接删除。请先设置新的默认父仓，再停用或删除当前仓库。',
        );
      }
      const blockers = await this.repository.warehouseDeleteBlockers(
        transaction,
        warehouseId,
      );
      if (Number(blockers.childWarehouses || 0) > 0) {
        throw createHttpError(
          409,
          'INVENTORY_WAREHOUSE_HAS_CHILDREN',
          '该父仓仍有子仓，必须先处理全部子仓后才能删除。',
        );
      }
      const reasons = warehouseDeleteReasons(blockers);
      if (reasons.length > 0) {
        throw createHttpError(
          409,
          'INVENTORY_WAREHOUSE_DELETE_BLOCKED',
          `该仓库已有${reasons.join('、')}，不能物理删除。请改为停用仓库。`,
        );
      }
      const before = toWarehouseDto(current);
      await this.repository.deleteWarehouse(transaction, warehouseId);
      await this.appendSafeLog(
        transaction,
        actor,
        'inventory.warehouse.delete',
        'DELETE',
        'warehouse',
        warehouseId,
        before,
        null,
        metadata,
      );
      return { id: warehouseId, deleted: true };
    });
  }

  async listWarehouseProducts(
    actor: any,
    warehouseIdInput: unknown,
    input: any = {},
  ) {
    requireInventoryRead(actor);
    const warehouseId = requiredId(warehouseIdInput, 'warehouseId');
    const warehouse = await this.repository.findWarehouse(warehouseId);
    if (!warehouse) {
      throw createHttpError(
        404,
        'INVENTORY_WAREHOUSE_NOT_FOUND',
        '仓库不存在。',
      );
    }
    const filters = parseWarehouseProductFilters(input);
    const configurations =
      await this.repository.listWarehouseProductConfigurations(
        warehouseId,
        filters,
      );
    const productIds = configurations.map((row: any) => row.productId);
    const serializedProductIds = configurations
      .filter(
        (row: any) =>
          String(row.product?.inventoryTrackingMode).toUpperCase() ===
          'SERIALIZED',
      )
      .map((row: any) => row.productId);
    const childRows = warehouse.parentWarehouseId
      ? []
      : await this.repository.root().warehouse.findMany({
          where: { parentWarehouseId: warehouseId },
          select: { id: true },
        });
    const inclusiveWarehouseIds = [
      warehouseId,
      ...childRows.map((row: any) => row.id),
    ];
    const [
      stockRows,
      serializedUnitRows,
      latestMovements,
      alertConfigs,
    ] = await Promise.all([
      this.repository.aggregateWarehouseProductStocks(
        inclusiveWarehouseIds,
        productIds,
      ),
      serializedProductIds.length > 0
        ? this.repository.aggregateSerializedWarehouseProductUnits(
            inclusiveWarehouseIds,
            serializedProductIds,
          )
        : [],
      this.repository.latestWarehouseProductMovements(
        inclusiveWarehouseIds,
        productIds,
      ),
      this.repository.listAlertConfigsForPairs(
        productIds.map((productId: string) => ({
          warehouseId,
          productId,
        })),
      ),
    ]);
    const stockByPair = new Map(
      stockRows.map((row: any) => [
        `${row.warehouseId}\u0000${row.productId}`,
        stockMetricsFromAggregate(row._sum),
      ]),
    );
    const serializedStockByPair = buildSerializedStockMetrics(
      serializedUnitRows,
      stockByPair,
    );
    const latestByProduct = new Map(
      latestMovements.map((row: any) => [
        row.productId,
        row._max?.businessAt ? toIso(row._max.businessAt) : null,
      ]),
    );
    const alertsByProduct = new Map(
      alertConfigs.map((row: any) => [row.productId, row]),
    );
    let products = configurations.map((configuration: any) => {
      const serialized =
        String(configuration.product.inventoryTrackingMode).toUpperCase() ===
        'SERIALIZED';
      const stockSource = serialized ? serializedStockByPair : stockByPair;
      const localStock =
        stockSource.get(`${warehouseId}\u0000${configuration.productId}`) ||
        zeroStockMetrics();
      const inclusiveStock = inclusiveWarehouseIds.reduce(
        (sum: any, currentWarehouseId: string) =>
          addStockMetrics(
            sum,
            stockSource.get(
              `${currentWarehouseId}\u0000${configuration.productId}`,
            ) || zeroStockMetrics(),
          ),
        zeroStockMetrics(),
      );
      const alert = alertsByProduct.get(configuration.productId);
      const minimumAvailableQty = alert?.enabled
        ? Number(alert.minimumAvailableQty || 0)
        : null;
      return {
        id: configuration.id,
        warehouseId: configuration.warehouseId,
        productId: configuration.productId,
        product: {
          id: configuration.product.id,
          name: configuration.product.name,
          unit: configuration.product.unit,
          inventoryTrackingMode: configuration.product.inventoryTrackingMode,
          isActive: Boolean(configuration.product.isActive),
        },
        isActive: Boolean(configuration.isActive),
        localStock,
        inclusiveStock,
        includesChildWarehouses: inclusiveWarehouseIds.length > 1,
        minimumAvailableQty,
        isLowStock:
          minimumAvailableQty !== null &&
          localStock.availableQty <= minimumAvailableQty,
        lastMovementAt: latestByProduct.get(configuration.productId) ?? null,
        createdAt: toIso(configuration.createdAt),
        updatedAt: toIso(configuration.updatedAt),
      };
    });
    products = products.filter((product: any) => {
      if (filters.isLowStock !== null && product.isLowStock !== filters.isLowStock) {
        return false;
      }
      if (
        filters.hasShortage !== null &&
        (product.localStock.shortageQty > 0) !== filters.hasShortage
      ) {
        return false;
      }
      return true;
    });
    const total = products.length;
    const offset = (filters.page - 1) * filters.pageSize;
    return {
      warehouse: toWarehouseDto(warehouse),
      products: products.slice(offset, offset + filters.pageSize),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async addWarehouseProduct(
    actor: any,
    warehouseIdInput: unknown,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    if (!this.accountingService) {
      throw createHttpError(
        503,
        'INVENTORY_ACCOUNTING_UNAVAILABLE',
        '库存记账服务暂不可用。',
      );
    }
    const warehouseId = requiredId(warehouseIdInput, 'warehouseId');
    const command = parseWarehouseProductAddInput(warehouseId, input);
    const result = await this.repository.runInTransaction(
      async (transaction) => {
        const currentWarehouse =
          await this.repository.findWarehouseForMutation(
            transaction,
            warehouseId,
          );
        if (!currentWarehouse) {
          throw createHttpError(
            404,
            'INVENTORY_WAREHOUSE_NOT_FOUND',
            '仓库不存在。',
          );
        }
        if (!currentWarehouse.isActive) {
          throw createHttpError(
            409,
            'INVENTORY_WAREHOUSE_INACTIVE',
            '停用仓库不能新增仓库商品。',
          );
        }
        const existingReceipt =
          await transaction.inventoryCommandReceipt.findUnique({
            where: { idempotencyKey: command.idempotencyKey },
          });
        if (existingReceipt) {
          if (
            existingReceipt.commandType !== 'WAREHOUSE_PRODUCT_ADD' ||
            existingReceipt.requestHash !== command.requestHash
          ) {
            throw createHttpError(
              409,
              'INVENTORY_IDEMPOTENCY_CONFLICT',
              '同一幂等键已用于不同的仓库商品请求。',
            );
          }
          if (
            existingReceipt.status === 'SUCCEEDED' &&
            existingReceipt.resultSnapshot
          ) {
            return {
              ...(existingReceipt.resultSnapshot as any),
              replayed: true,
            };
          }
          throw createHttpError(
            409,
            'INVENTORY_COMMAND_IN_PROGRESS',
            '该仓库商品请求正在处理中，请稍后重试。',
          );
        }
        const product = await transaction.product.findUnique({
          where: { id: command.productId },
          select: {
            id: true,
            name: true,
            unit: true,
            inventoryTrackingMode: true,
            isActive: true,
          },
        });
        if (!product?.isActive) {
          throw createHttpError(
            409,
            'INVENTORY_PRODUCT_UNAVAILABLE',
            '商品不存在或已停用，不能加入仓库。',
          );
        }
        if (product.inventoryTrackingMode === 'NONE') {
          throw createHttpError(
            409,
            'INVENTORY_TRACKING_DISABLED',
            '该商品尚未启用库存跟踪，不能加入仓库。',
          );
        }
        if (
          product.inventoryTrackingMode === 'SERIALIZED' &&
          command.initialQuantity > 0
        ) {
          throw createHttpError(
            409,
            'INVENTORY_SERIALIZED_OPENING_REQUIRES_UNITS',
            '逐瓶商品不能只录入汇总期初数量。请先以零库存添加，再到逐瓶库存页面扫描或导入真实物流码。',
          );
        }
        if (
          command.initialQuantity > 0 &&
          (await this.repository.warehouseProductHasHistory(
            transaction,
            warehouseId,
            command.productId,
          ))
        ) {
          throw createHttpError(
            409,
            'INVENTORY_WAREHOUSE_PRODUCT_HAS_HISTORY',
            '该仓库商品已有库存历史，不能再次录入期初数量。请发起盘点或库存调整。',
          );
        }
        const receiptId = crypto.randomUUID();
        const receipt = await transaction.inventoryCommandReceipt.create({
          data: {
            id: receiptId,
            sourceKey: `warehouse-product-add:${receiptId}`,
            idempotencyKey: command.idempotencyKey,
            commandType: 'WAREHOUSE_PRODUCT_ADD',
            requestHash: command.requestHash,
            status: 'PROCESSING',
            actorUserId: actorId(actor),
            actorNameSnapshot: actorName(actor),
            actorRoleSnapshot: actorRole(actor),
            requestId: boundedTraceId(metadata?.requestId),
          },
        });
        const existing =
          await this.repository.findWarehouseProductConfiguration(
            transaction,
            warehouseId,
            command.productId,
          );
        if (existing?.isActive) {
          throw createHttpError(
            409,
            'INVENTORY_WAREHOUSE_PRODUCT_ALREADY_ACTIVE',
            '该商品已经在当前仓库中，无需重复添加。',
          );
        }
        const configuration = existing
          ? await this.repository.updateWarehouseProductConfiguration(
              transaction,
              existing.id,
              {
                isActive: true,
                updatedById: actorId(actor),
                updatedAt: new Date(),
              },
            )
          : await this.repository.createWarehouseProductConfiguration(
              transaction,
              {
                id: crypto.randomUUID(),
                warehouseId,
                productId: command.productId,
                isActive: true,
                createdById: actorId(actor),
                updatedById: actorId(actor),
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            );
        let opening: any = null;
        if (command.initialQuantity > 0) {
          const inventoryConfiguration =
            await transaction.inventoryConfiguration.findUnique({
              where: { singletonKey: 'INVENTORY' },
              select: { goLiveAt: true },
            });
          const innerSourceKey = `warehouse-product-opening:${receipt.id}`;
          const innerIdempotencyKey =
            `warehouse-product-opening-idem:${receipt.id}`;
          const openingPayload: any = {
            warehouseId,
            productId: command.productId,
            quantity: command.initialQuantity,
            kind: 'OPENING',
            businessAt:
              inventoryConfiguration?.goLiveAt?.toISOString() ??
              new Date().toISOString(),
            batch: {
              sourceLineKey: `${innerSourceKey}:line`,
            },
            sourceKey: innerSourceKey,
            idempotencyKey: innerIdempotencyKey,
          };
          openingPayload.requestHash = calculateInventoryRequestHash(
            'INBOUND',
            openingPayload,
          );
          opening =
            await this.accountingService!.executeAutomaticInTransaction(
              'INBOUND',
              actor,
              openingPayload,
              transaction,
              metadata,
            );
        }
        const productDto = toWarehouseProductConfigurationDto(configuration);
        const snapshot = {
          product: productDto,
          opening,
          commandReceiptId: receipt.id,
          replayed: false,
        };
        await transaction.inventoryCommandReceipt.update({
          where: { id: receipt.id },
          data: {
            status: 'SUCCEEDED',
            resultDocumentId: opening?.documentId ?? null,
            resultSnapshot: snapshot,
            completedAt: new Date(),
          },
        });
        await this.appendSafeLog(
          transaction,
          actor,
          existing
            ? 'inventory.warehouse_product.restore'
            : 'inventory.warehouse_product.create',
          existing ? 'STATUS_CHANGE' : 'CREATE',
          'warehouse_product_configuration',
          configuration.id,
          existing
            ? toWarehouseProductConfigurationDto(existing)
            : null,
          productDto,
          metadata,
        );
        return snapshot;
      },
    );
    if (result.opening?.commandReceiptId) {
      await this.accountingService.dispatchCommittedReceipts([
        result.opening.commandReceiptId,
      ]);
    }
    return result;
  }

  async deactivateWarehouseProduct(
    actor: any,
    warehouseIdInput: unknown,
    productIdInput: unknown,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    const warehouseId = requiredId(warehouseIdInput, 'warehouseId');
    const productId = requiredId(productIdInput, 'productId');
    return await this.repository.runInTransaction(async (transaction) => {
      const configuration =
        await this.repository.findWarehouseProductConfiguration(
          transaction,
          warehouseId,
          productId,
        );
      if (!configuration) {
        throw createHttpError(
          404,
          'INVENTORY_WAREHOUSE_PRODUCT_NOT_FOUND',
          '当前仓库未配置该商品。',
        );
      }
      if (!configuration.isActive) {
        return {
          product: toWarehouseProductConfigurationDto(configuration),
          deactivated: true,
          replayed: true,
        };
      }
      const [stock, activeSerializedUnits] = await Promise.all([
        this.repository.findWarehouseProductStock(
          transaction,
          warehouseId,
          productId,
        ),
        this.repository.countActiveSerializedUnits(
          transaction,
          warehouseId,
          productId,
        ),
      ]);
      const nonZero = stock
        ? [
            stock.onHandQty,
            stock.reservedQty,
            stock.unavailableQty,
            stock.inTransitQty,
          ].some((value) => Number(value) !== 0)
        : false;
      if (nonZero || activeSerializedUnits > 0) {
        throw createHttpError(
          409,
          'INVENTORY_WAREHOUSE_PRODUCT_HAS_ACTIVE_STOCK',
          '该仓库商品仍有现存、占用、不可售、在途数量或有效逐瓶记录，不能移除。请先通过现有库存流程处理为零。',
        );
      }
      const updated =
        await this.repository.updateWarehouseProductConfiguration(
          transaction,
          configuration.id,
          {
            isActive: false,
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        );
      await this.appendSafeLog(
        transaction,
        actor,
        'inventory.warehouse_product.disable',
        'STATUS_CHANGE',
        'warehouse_product_configuration',
        configuration.id,
        toWarehouseProductConfigurationDto(configuration),
        toWarehouseProductConfigurationDto(updated),
        metadata,
      );
      return {
        product: toWarehouseProductConfigurationDto(updated),
        deactivated: true,
        replayed: false,
      };
    });
  }

  async listStocks(actor: any, input: any = {}) {
    requireInventoryRead(actor);
    const filters = parseStockFilters(input);
    const includeCosts = canReadInventoryCost(actor);
    const rows = await this.repository.listStockRows(filters);
    const pairs = uniquePairs(rows);
    const [configs, batches, serializedUnits] = await Promise.all([
      this.repository.listAlertConfigsForPairs(pairs),
      includeCosts
        ? this.repository.listBatchesForPairs(pairs, true)
        : Promise.resolve([]),
      includeCosts
        ? this.repository.listSerializedUnitsForPairs(pairs, true)
        : Promise.resolve([]),
    ]);
    const context = buildStockContext(
      configs,
      batches,
      serializedUnits,
    );
    let stocks = rows.map((row: any) =>
      toStockDto(row, context, includeCosts),
    );
    stocks = stocks.filter((stock: any) =>
      matchesDerivedStockFilters(stock, filters),
    );
    const total = stocks.length;
    const offset = (filters.page - 1) * filters.pageSize;
    return {
      stocks: stocks.slice(offset, offset + filters.pageSize),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async getStock(
    actor: any,
    warehouseIdInput: unknown,
    productIdInput: unknown,
  ) {
    requireInventoryRead(actor);
    const warehouseId = requiredId(
      warehouseIdInput,
      'warehouseId',
    );
    const productId = requiredId(productIdInput, 'productId');
    const includeCosts = canReadInventoryCost(actor);
    const row = await this.repository.findStockRow(
      warehouseId,
      productId,
    );
    if (!row) {
      throw createHttpError(
        404,
        'INVENTORY_STOCK_NOT_FOUND',
        'The warehouse product stock does not exist.',
      );
    }
    const pairs = [{ warehouseId, productId }];
    const [configs, batches, serializedUnits] = await Promise.all([
      this.repository.listAlertConfigsForPairs(pairs),
      this.repository.listBatchesForPairs(pairs, includeCosts),
      this.repository.listSerializedUnitsForPairs(
        pairs,
        includeCosts,
      ),
    ]);
    const context = buildStockContext(
      configs,
      batches,
      serializedUnits,
    );
    const stock = toStockDto(row, context, includeCosts);
    return {
      ...stock,
      batches: batches.map((batch: any) =>
        toBatchDto(batch, includeCosts),
      ),
      serializedStatusSummary:
        summarizeSerializedUnits(serializedUnits),
    };
  }

  async listMovements(actor: any, input: any = {}) {
    requireInventoryRead(actor);
    const filters = parseMovementFilters(input);
    const includeCosts = canReadInventoryCost(actor);
    const { rows, total } = await this.repository.listMovements(
      filters,
      includeCosts,
    );
    return {
      movements: rows.map((row: any) =>
        toMovementDto(row, includeCosts),
      ),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async listInboundDocuments(actor: any, input: any = {}) {
    requireInventoryRead(actor);
    const filters = parseInboundFilters(input);
    const includeCosts = canReadInventoryCost(actor);
    const { rows, total } =
      await this.repository.listInboundDocuments(
        filters,
        includeCosts,
      );
    return {
      inbounds: rows.map((row: any) =>
        toInboundDocumentDto(row, includeCosts),
      ),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async getInboundDocument(actor: any, idInput: unknown) {
    requireInventoryRead(actor);
    const id = requiredId(idInput, 'inboundId');
    const includeCosts = canReadInventoryCost(actor);
    const row = await this.repository.findInboundDocument(
      id,
      includeCosts,
    );
    if (!row) {
      throw createHttpError(
        404,
        'INVENTORY_INBOUND_DOCUMENT_NOT_FOUND',
        'The inventory inbound document does not exist.',
      );
    }
    return toInboundDocumentDto(row, includeCosts);
  }

  async listTransfers(actor: any, input: any = {}) {
    requireInventoryRead(actor);
    const filters = parseTransferFilters(input);
    const includeCosts = canReadInventoryCost(actor);
    const includeUnitIds = canReadSerializedTransferUnits(actor);
    const { rows, total } = await this.repository.listTransfers(
      filters,
      includeCosts,
      includeUnitIds,
    );
    const context = await this.transferReadContext(rows);
    return {
      transfers: rows.map((row: any) =>
        toTransferDto(
          row,
          includeCosts,
          includeUnitIds,
          context,
        ),
      ),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async getTransfer(actor: any, idInput: unknown) {
    requireInventoryRead(actor);
    const id = requiredId(idInput, 'transferId');
    const includeCosts = canReadInventoryCost(actor);
    const includeUnitIds = canReadSerializedTransferUnits(actor);
    const row = await this.repository.findTransfer(
      id,
      includeCosts,
      includeUnitIds,
    );
    if (!row) {
      throw createHttpError(
        404,
        'INVENTORY_TRANSFER_NOT_FOUND',
        'The inventory transfer does not exist.',
      );
    }
    const context = await this.transferReadContext([row]);
    return toTransferDto(
      row,
      includeCosts,
      includeUnitIds,
      context,
    );
  }

  private async transferReadContext(rows: any[]) {
    const productIds = [
      ...new Set(
        rows.flatMap((row) =>
          (row.lines || []).map((line: any) => line.productId),
        ),
      ),
    ] as string[];
    const [stocks, totals] = await Promise.all([
      this.repository.listStocksForTransferRows(rows),
      this.repository.companyStockTotals(productIds),
    ]);
    return {
      stocks: new Map(
        stocks.map((stock: any) => [
          `${stock.warehouseId}\u0000${stock.productId}`,
          stock,
        ]),
      ),
      companyTotals: new Map(
        totals.map((total: any) => [
          total.productId,
          Number(total._sum.onHandQty ?? 0) +
            Number(total._sum.inTransitQty ?? 0),
        ]),
      ),
    };
  }

  async listAlertConfigs(actor: any, input: any = {}) {
    requireInventoryRead(actor);
    const filters = parseAlertFilters(input);
    const { rows, total } =
      await this.repository.listAlertConfigs(filters);
    return {
      alertConfigs: rows.map(toAlertConfigDto),
      pagination: pagination(filters.page, filters.pageSize, total),
    };
  }

  async updateAlertConfig(
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    requireInventoryManage(actor);
    assertObject(input);
    assertAllowedFields(input, [
      'warehouseId',
      'productId',
      'minimumAvailableQty',
      'enabled',
    ]);
    const warehouseId = requiredId(
      input.warehouseId,
      'warehouseId',
    );
    const productId = requiredId(input.productId, 'productId');
    if (
      !hasOwn(input, 'minimumAvailableQty') &&
      !hasOwn(input, 'enabled')
    ) {
      throw validationError(
        'minimumAvailableQty or enabled must be provided.',
      );
    }
    const minimumAvailableQty = hasOwn(
      input,
      'minimumAvailableQty',
    )
      ? nonNegativeInteger(
          input.minimumAvailableQty,
          'minimumAvailableQty',
        )
      : null;
    const enabled = hasOwn(input, 'enabled')
      ? requiredBoolean(input.enabled, 'enabled')
      : null;
    const result = await this.repository.runInTransaction(
      async (transaction) => {
        const [warehouse, product, current] = await Promise.all([
          this.repository.findWarehouseForMutation(
            transaction,
            warehouseId,
          ),
          this.repository.findProductForAlert(
            transaction,
            productId,
          ),
          this.repository.findAlertConfig(
            transaction,
            warehouseId,
            productId,
          ),
        ]);
        if (!warehouse) {
          throw createHttpError(
            404,
            'INVENTORY_WAREHOUSE_NOT_FOUND',
            'The warehouse does not exist.',
          );
        }
        if (!product) {
          throw createHttpError(
            404,
            'INVENTORY_PRODUCT_NOT_FOUND',
            'The product does not exist.',
          );
        }
        if (
          String(product.inventoryTrackingMode).toUpperCase() ===
          'NONE'
        ) {
          throw createHttpError(
            409,
            'INVENTORY_TRACKING_DISABLED',
            'Inventory tracking is disabled for this product.',
          );
        }
        const now = new Date();
        const created = {
          id: crypto.randomUUID(),
          warehouseId,
          productId,
          minimumAvailableQty: minimumAvailableQty ?? 0,
          enabled: enabled ?? true,
          createdById: actorId(actor),
          updatedById: actorId(actor),
          createdAt: now,
          updatedAt: now,
        };
        const update: any = {
          updatedById: actorId(actor),
          updatedAt: now,
        };
        if (minimumAvailableQty !== null) {
          update.minimumAvailableQty = minimumAvailableQty;
        }
        if (enabled !== null) {
          update.enabled = enabled;
        }
        const result =
          await this.repository.upsertAlertConfig(
            transaction,
            warehouseId,
            productId,
            created,
            update,
          );
        const before = current ? toAlertConfigDto(current) : null;
        const after = toAlertConfigDto(result);
        await this.appendSafeLog(
          transaction,
          actor,
          current
            ? 'inventory.alert_config.update'
            : 'inventory.alert_config.create',
          current ? 'UPDATE' : 'CREATE',
          'stock_alert_config',
          result.id,
          before,
          after,
          metadata,
        );
        return after;
      },
    );
    await this.todoReminders?.safeReconcileInventoryPair(
      warehouseId,
      productId,
    );
    return result;
  }

  private async assertWarehouseUnique(
    transaction: any,
    normalizedCode: string,
    normalizedName: string,
  ) {
    await this.assertWarehouseCodeUnique(
      transaction,
      normalizedCode,
    );
    await this.assertWarehouseNameUnique(
      transaction,
      normalizedName,
    );
  }

  private async assertWarehouseCodeUnique(
    transaction: any,
    normalizedCode: string,
    currentId?: string,
  ) {
    const warehouse =
      await this.repository.findWarehouseByNormalizedCode(
        transaction,
        normalizedCode,
      );
    if (warehouse && warehouse.id !== currentId) {
      throw createHttpError(
        409,
        'INVENTORY_WAREHOUSE_CODE_EXISTS',
        'A warehouse with the same normalized code already exists.',
      );
    }
  }

  private async assertWarehouseNameUnique(
    transaction: any,
    normalizedName: string,
    currentId?: string,
  ) {
    const warehouse =
      await this.repository.findWarehouseByNormalizedName(
        transaction,
        normalizedName,
      );
    if (warehouse && warehouse.id !== currentId) {
      throw createHttpError(
        409,
        'INVENTORY_WAREHOUSE_NAME_EXISTS',
        'A warehouse with the same normalized name already exists.',
      );
    }
  }

  private async assertParentWarehouse(
    transaction: any,
    parentWarehouseId: string | null,
    warehouseId: string,
  ) {
    if (!parentWarehouseId) return;
    if (parentWarehouseId === warehouseId) {
      throw createHttpError(
        409,
        'INVENTORY_WAREHOUSE_PARENT_SELF_REFERENCE',
        '仓库不能把自己设为所属父仓。',
      );
    }
    const parent = await this.repository.findWarehouseForMutation(
      transaction,
      parentWarehouseId,
    );
    if (!parent) {
      throw createHttpError(
        404,
        'INVENTORY_PARENT_WAREHOUSE_NOT_FOUND',
        '所属父仓不存在。',
      );
    }
    if (parent.parentWarehouseId) {
      throw createHttpError(
        409,
        'INVENTORY_WAREHOUSE_MAX_DEPTH_EXCEEDED',
        '仓库最多只允许两级，子仓不能继续创建下级仓库。',
      );
    }
  }

  private async assertManager(
    transaction: any,
    managerUserId: string | null,
  ) {
    if (!managerUserId) {
      return;
    }
    const manager = await this.repository.findManager(
      transaction,
      managerUserId,
    );
    if (!manager) {
      throw createHttpError(
        404,
        'INVENTORY_WAREHOUSE_MANAGER_NOT_FOUND',
        'The selected warehouse manager does not exist.',
      );
    }
    if (!manager.isActive) {
      throw createHttpError(
        409,
        'INVENTORY_WAREHOUSE_MANAGER_INACTIVE',
        'The selected warehouse manager is inactive.',
      );
    }
  }

  private async withConcurrencyRetry<T>(
    work: () => Promise<T>,
  ): Promise<T> {
    for (
      let attempt = 1;
      attempt <= MAX_CONCURRENCY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await work();
      } catch (error) {
        if (
          prismaCode(error) !== 'P2034' ||
          attempt === MAX_CONCURRENCY_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw createHttpError(
      409,
      'INVENTORY_CONCURRENT_UPDATE',
      'Inventory master data changed concurrently. Please retry.',
    );
  }

  private async appendSafeLog(
    transaction: any,
    actor: any,
    action: string,
    operationType: string,
    entityType: string,
    entityId: string,
    beforeData: any,
    afterData: any,
    metadata: any,
  ) {
    await this.operationLogsService.appendLog(
      {
        userId: actorId(actor),
        actorNameSnapshot: actorName(actor),
        actorRoleSnapshot: actorRole(actor),
        module: 'inventory',
        action,
        operationType,
        entityType,
        entityId,
        beforeData,
        afterData,
        requestSummary: {
          entityId,
        },
        requestId: boundedTraceId(metadata?.requestId),
        ipAddress: optionalString(
          metadata?.ipAddress,
          'ipAddress',
          45,
        ),
      },
      transaction,
    );
  }
}

function parseWarehouseFilters(input: any) {
  const parentFilter = parseParentWarehouseFilter(
    input?.parentWarehouseId,
  );
  return {
    query: optionalString(
      input?.q ?? input?.query,
      'query',
      160,
    ),
    isActive: optionalBoolean(input?.isActive, 'isActive'),
    isDefault: optionalBoolean(input?.isDefault, 'isDefault'),
    manager: optionalString(
      input?.manager ?? input?.managerUserId,
      'manager',
      160,
    ),
    parentFilterSet: parentFilter.set,
    parentWarehouseId: parentFilter.value,
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function parseWarehouseProductFilters(input: any) {
  return {
    query: optionalString(input?.q ?? input?.query, 'query', 160),
    inventoryTrackingMode: optionalEnum(
      input?.inventoryTrackingMode,
      'inventoryTrackingMode',
      TRACKING_MODES,
    ),
    isActive: optionalBoolean(input?.isActive, 'isActive'),
    isLowStock: optionalBoolean(
      input?.isLowStock ?? input?.lowStock,
      'isLowStock',
    ),
    hasShortage: optionalBoolean(
      input?.hasShortage ?? input?.shortage,
      'hasShortage',
    ),
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function parseParentWarehouseFilter(value: unknown) {
  if (value === undefined || value === '') {
    return { set: false, value: null };
  }
  if (
    value === null ||
    (typeof value === 'string' &&
      ['root', 'parent', 'null'].includes(value.trim().toLowerCase()))
  ) {
    return { set: true, value: null };
  }
  return {
    set: true,
    value: requiredId(value, 'parentWarehouseId'),
  };
}

function parseStockFilters(input: any) {
  return {
    warehouseId: optionalId(input?.warehouseId, 'warehouseId'),
    productId: optionalId(input?.productId, 'productId'),
    warehouseQuery: optionalString(
      input?.warehouse,
      'warehouse',
      160,
    ),
    productQuery: optionalString(
      input?.product,
      'product',
      160,
    ),
    inventoryTrackingMode: optionalEnum(
      input?.inventoryTrackingMode,
      'inventoryTrackingMode',
      TRACKING_MODES,
    ),
    batchId: optionalId(input?.batchId, 'batchId'),
    batch: optionalString(input?.batch, 'batch', 160),
    hasShortage: optionalBoolean(
      input?.hasShortage ?? input?.shortage,
      'hasShortage',
    ),
    isLowStock: optionalBoolean(
      input?.isLowStock ?? input?.lowStock,
      'isLowStock',
    ),
    hasUnavailable: optionalBoolean(
      input?.hasUnavailable ?? input?.unavailable,
      'hasUnavailable',
    ),
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function parseMovementFilters(input: any) {
  return {
    warehouseId: optionalId(input?.warehouseId, 'warehouseId'),
    productId: optionalId(input?.productId, 'productId'),
    inventoryTrackingMode: optionalEnum(
      input?.inventoryTrackingMode,
      'inventoryTrackingMode',
      TRACKING_MODES,
    ),
    batchId: optionalId(input?.batchId, 'batchId'),
    batch: optionalString(input?.batch, 'batch', 160),
    movementType: optionalEnum(
      input?.movementType,
      'movementType',
      MOVEMENT_TYPES,
    ),
    dateFrom: optionalDate(input?.dateFrom, 'dateFrom', false),
    dateTo: optionalDate(input?.dateTo, 'dateTo', true),
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function parseInboundFilters(input: any) {
  return {
    warehouseId: optionalId(input?.warehouseId, 'warehouseId'),
    productId: optionalId(input?.productId, 'productId'),
    type: optionalEnum(
      input?.type,
      'type',
      new Set(['OPENING', 'PURCHASE_RECEIPT', 'OTHER_IN']),
    ),
    status: optionalEnum(
      input?.status,
      'status',
      new Set(['POSTED', 'REVERSED']),
    ),
    batch: optionalString(input?.batch, 'batch', 160),
    dateFrom: optionalDate(input?.dateFrom, 'dateFrom', false),
    dateTo: optionalDate(input?.dateTo, 'dateTo', true),
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function parseTransferFilters(input: any) {
  return {
    fromWarehouseId: optionalId(
      input?.fromWarehouseId,
      'fromWarehouseId',
    ),
    toWarehouseId: optionalId(
      input?.toWarehouseId,
      'toWarehouseId',
    ),
    productId: optionalId(input?.productId, 'productId'),
    status: optionalEnum(
      input?.status,
      'status',
      new Set([
        'DRAFT',
        'OUTBOUND',
        'PARTIALLY_RECEIVED',
        'RECEIVED',
        'CANCELLED',
        'REVERSED',
      ]),
    ),
    dateFrom: optionalDate(input?.dateFrom, 'dateFrom', false),
    dateTo: optionalDate(input?.dateTo, 'dateTo', true),
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function parseAlertFilters(input: any) {
  return {
    warehouseId: optionalId(input?.warehouseId, 'warehouseId'),
    productId: optionalId(input?.productId, 'productId'),
    enabled: optionalBoolean(input?.enabled, 'enabled'),
    page: positiveInteger(input?.page, 'page', 1, 1_000_000),
    pageSize: positiveInteger(
      input?.pageSize ?? input?.limit,
      'pageSize',
      20,
      100,
    ),
  };
}

function toWarehouseDto(row: any) {
  const relationCount = row._count || {};
  const businessRelationCount = [
    'stocks',
    'productConfigurations',
    'batches',
    'documents',
    'outboundDocuments',
    'inboundDocuments',
    'movements',
    'reservations',
    'outboundTransfers',
    'inboundTransfers',
    'transferReceipts',
    'afterSalesReceipts',
    'previousAfterSalesReceiptUnits',
    'stockAlertConfigs',
    'inventoryAlerts',
    'stocktakes',
    'stocktakeExpectedScans',
    'fulfillmentSalesOrders',
    'serializedUnits',
    'specialOrderItems',
  ].reduce((sum, key) => sum + Number(relationCount[key] || 0), 0);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address ?? null,
    managerUserId: row.managerUserId ?? null,
    manager: row.manager
      ? {
          id: row.manager.id,
          name: row.manager.name,
        }
      : null,
    parentWarehouseId: row.parentWarehouseId ?? null,
    parentWarehouse: row.parentWarehouse
      ? {
          id: row.parentWarehouse.id,
          code: row.parentWarehouse.code,
          name: row.parentWarehouse.name,
          isActive: Boolean(row.parentWarehouse.isActive),
        }
      : null,
    childWarehouses: (row.childWarehouses || []).map((child: any) => ({
      id: child.id,
      code: child.code,
      name: child.name,
      isActive: Boolean(child.isActive),
      isDefault: Boolean(child.isDefault),
    })),
    childWarehouseCount: Number(relationCount.childWarehouses || 0),
    isActive: Boolean(row.isActive),
    isDefault: Boolean(row.isDefault),
    canDelete:
      !row.isDefault &&
      Number(relationCount.childWarehouses || 0) === 0 &&
      businessRelationCount === 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toWarehouseProductConfigurationDto(row: any) {
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    productId: row.productId,
    product: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          unit: row.product.unit,
          inventoryTrackingMode: row.product.inventoryTrackingMode,
          isActive: Boolean(row.product.isActive),
        }
      : null,
    isActive: Boolean(row.isActive),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toWarehouseBusinessStatus(
  blockers: Record<string, unknown>,
  warehouse?: any,
) {
  return {
    canDelete:
      !warehouse?.isDefault && warehouseDeleteReasons(blockers).length === 0,
    hasChildren: Number(blockers.childWarehouses || 0) > 0,
    hasInventoryFacts:
      Number(blockers.stocks || 0) > 0 ||
      Number(blockers.batches || 0) > 0 ||
      Number(blockers.movements || 0) > 0 ||
      Number(blockers.serializedUnits || 0) > 0,
    hasBusinessDocuments:
      Number(blockers.documents || 0) > 0 ||
      Number(blockers.transfers || 0) > 0 ||
      Number(blockers.transferReceipts || 0) > 0 ||
      Number(blockers.afterSalesReceipts || 0) > 0 ||
      Number(blockers.stocktakes || 0) > 0,
    hasFulfillmentHistory:
      Number(blockers.reservations || 0) > 0 ||
      Number(blockers.fulfillmentOrders || 0) > 0 ||
      Number(blockers.specialOrderItems || 0) > 0,
  };
}

function warehouseDeleteReasons(blockers: Record<string, unknown>) {
  const groups = [
    ['childWarehouses', '子仓'],
    ['stocks', '库存余额记录'],
    ['productConfigurations', '仓库商品关联历史'],
    ['batches', '库存批次'],
    ['documents', '库存单据'],
    ['movements', '库存流水'],
    ['reservations', '订单占用'],
    ['transfers', '调拨记录'],
    ['transferReceipts', '调拨收货记录'],
    ['afterSalesReceipts', '售后收货记录'],
    ['previousAfterSalesUnits', '逐瓶售后归属记录'],
    ['stockAlertConfigs', '库存预警配置'],
    ['inventoryAlerts', '库存预警历史'],
    ['stocktakes', '盘点记录'],
    ['stocktakeExpectedScans', '逐瓶盘点记录'],
    ['fulfillmentOrders', '订单履约关系'],
    ['serializedUnits', '逐瓶库存记录'],
    ['specialOrderItems', '特殊订单仓库关系'],
  ];
  return groups
    .filter(([key]) => Number(blockers[key] || 0) > 0)
    .map(([, label]) => label);
}

function zeroStockMetrics() {
  return calculateStockMetrics({
    onHandQty: 0,
    reservedQty: 0,
    unavailableQty: 0,
    inTransitQty: 0,
  });
}

function stockMetricsFromAggregate(sum: any) {
  return calculateStockMetrics({
    onHandQty: Number(sum?.onHandQty || 0),
    reservedQty: Number(sum?.reservedQty || 0),
    unavailableQty: Number(sum?.unavailableQty || 0),
    inTransitQty: Number(sum?.inTransitQty || 0),
  });
}

function addStockMetrics(left: any, right: any) {
  return calculateStockMetrics({
    onHandQty: Number(left.onHandQty) + Number(right.onHandQty),
    reservedQty: Number(left.reservedQty) + Number(right.reservedQty),
    unavailableQty:
      Number(left.unavailableQty) + Number(right.unavailableQty),
    inTransitQty: Number(left.inTransitQty) + Number(right.inTransitQty),
  });
}

function buildSerializedStockMetrics(
  rows: any[],
  projectedStocks: Map<string, any>,
) {
  const raw = new Map<
    string,
    {
      onHandQty: number;
      reservedQty: number;
      unavailableQty: number;
    }
  >();
  for (const row of rows) {
    if (!row.warehouseId) continue;
    const key = `${row.warehouseId}\u0000${row.productId}`;
    const current = raw.get(key) || {
      onHandQty: 0,
      reservedQty: 0,
      unavailableQty: 0,
    };
    const count = Number(row._count?._all || 0);
    const status = String(row.status).toUpperCase();
    if (status !== 'OUTBOUND') {
      current.onHandQty += count;
    }
    if (status === 'RESERVED' || status === 'ALLOCATED') {
      current.reservedQty += count;
    }
    if (status === 'PENDING_COST' || status === 'UNAVAILABLE') {
      current.unavailableQty += count;
    }
    raw.set(key, current);
  }
  return new Map(
    [...raw.entries()].map(([key, value]) => [
      key,
      calculateStockMetrics({
        ...value,
        inTransitQty: Number(projectedStocks.get(key)?.inTransitQty || 0),
      }),
    ]),
  );
}

function parseWarehouseProductAddInput(warehouseId: string, input: any) {
  assertObject(input);
  assertAllowedFields(input, [
    'productId',
    'initialQuantity',
    'idempotencyKey',
    'requestHash',
  ]);
  const productId = requiredId(input.productId, 'productId');
  const initialQuantity = warehouseNonNegativeInteger(
    input.initialQuantity,
    'initialQuantity',
  );
  const idempotencyKey = normalizedBusinessKey(
    input.idempotencyKey,
    'idempotencyKey',
  );
  const requestHash =
    typeof input.requestHash === 'string'
      ? input.requestHash.trim().toLowerCase()
      : '';
  if (!/^[0-9a-f]{64}$/.test(requestHash)) {
    throw validationError('requestHash must be a SHA-256 hexadecimal value.');
  }
  const expectedHash = crypto
    .createHash('sha256')
    .update(
      canonicalJson({
        warehouseId,
        productId,
        initialQuantity,
      }),
      'utf8',
    )
    .digest('hex');
  if (requestHash !== expectedHash) {
    throw createHttpError(
      400,
      'INVENTORY_REQUEST_HASH_MISMATCH',
      'requestHash 与规范化的仓库商品请求不一致。',
    );
  }
  return {
    productId,
    initialQuantity,
    idempotencyKey,
    requestHash,
  };
}

function warehouseNonNegativeInteger(value: unknown, field: string) {
  let parsed: number;
  if (value === undefined || value === null || value === '') {
    parsed = 0;
  } else if (typeof value === 'number') {
    parsed = value;
  } else {
    const text = String(value).trim();
    if (!/^(0|[1-9]\d*)$/.test(text)) {
      throw validationError(`${field} must be a non-negative integer.`);
    }
    parsed = Number(text);
  }
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw validationError(`${field} must be a non-negative integer.`);
  }
  return parsed;
}

function toInventoryConfigurationDto(row: any) {
  if (!row) {
    return {
      configured: false,
      goLiveAt: null,
      policyVersion: 1,
      maintenanceMode: false,
      transferOverdueHours: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    configured: true,
    goLiveAt: row.goLiveAt ? toIso(row.goLiveAt) : null,
    policyVersion: Number(row.policyVersion),
    maintenanceMode: Boolean(row.maintenanceMode),
    transferOverdueHours:
      row.transferOverdueHours === null ||
      row.transferOverdueHours === undefined
        ? null
        : Number(row.transferOverdueHours),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toInboundDocumentDto(row: any, includeCosts: boolean) {
  return {
    id: row.id,
    documentNo: row.documentNo,
    type: String(row.type).toLowerCase(),
    status: String(row.status).toLowerCase(),
    warehouseId: row.warehouseId,
    warehouse: row.warehouse
      ? {
          id: row.warehouse.id,
          code: row.warehouse.code,
          name: row.warehouse.name,
        }
      : null,
    sourceType: row.sourceType,
    sourceId: row.sourceId ?? null,
    sourceKey: row.sourceKey,
    businessAt: toIso(row.businessAt),
    postedBy: {
      userId: row.postedById ?? null,
      name: row.postedByNameSnapshot ?? null,
      role: row.postedByRoleSnapshot ?? null,
    },
    postedAt: toIso(row.postedAt),
    reversedAt: toIso(row.reversedAt),
    reversalOfDocumentId: row.reversalOfDocumentId ?? null,
    reason: row.reason ?? null,
    attachmentMetadata: projectAttachmentMetadata(
      row.attachmentMetadata,
    ),
    lines: (row.lines || []).map((line: any) =>
      toInboundLineDto(line, includeCosts),
    ),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toInboundLineDto(line: any, includeCosts: boolean) {
  const result: any = {
    id: line.id,
    lineNo: Number(line.lineNo),
    productId: line.productId,
    batchId: line.batchId ?? null,
    quantity: Number(line.quantity),
    condition: String(line.condition).toLowerCase(),
    productNameSnapshot: line.productNameSnapshot,
    unitSnapshot: line.unitSnapshot,
    notes: line.notes ?? null,
    batch: line.batch
      ? {
          id: line.batch.id,
          supplierName: line.batch.supplierName ?? null,
          purchaseOrderNo: line.batch.purchaseOrderNo ?? null,
          productionBatch: line.batch.productionBatch ?? null,
          productionDate: toIso(
            line.batch.productionDate,
            true,
          ),
          receivedQty: Number(line.batch.receivedQty),
          remainingQty: Number(line.batch.remainingQty),
          unavailableQty: Number(line.batch.unavailableQty),
          fifoAt: toIso(line.batch.fifoAt),
          createdAt: toIso(line.batch.createdAt),
          updatedAt: toIso(line.batch.updatedAt),
        }
      : null,
    createdAt: toIso(line.createdAt),
  };
  if (includeCosts) {
    const unitCost =
      line.batch?.purchaseUnitCostCents ??
      line.purchaseUnitCostCents ??
      null;
    result.purchaseUnitCostCents =
      unitCost === null ? null : Number(unitCost);
    result.inventoryAmountCents =
      unitCost === null
        ? null
        : safeMoneyProduct(Number(line.quantity), Number(unitCost));
    if (result.batch) {
      result.batch.purchaseUnitCostCents =
        line.batch.purchaseUnitCostCents === null ||
        line.batch.purchaseUnitCostCents === undefined
          ? null
          : Number(line.batch.purchaseUnitCostCents);
      result.batch.costStatus = String(
        line.batch.costStatus || 'PENDING',
      ).toLowerCase();
      result.batch.costCompletedAt = toIso(
        line.batch.costCompletedAt,
      );
    }
  }
  return result;
}

function toTransferDto(
  row: any,
  includeCosts: boolean,
  includeUnitIds: boolean,
  context: any,
) {
  return {
    id: row.id,
    transferNo: row.transferNo,
    sourceKey: row.sourceKey,
    status: String(row.status).toLowerCase(),
    fromWarehouse: {
      id: row.fromWarehouse.id,
      code: row.fromWarehouse.code,
      name: row.fromWarehouse.name,
    },
    toWarehouse: {
      id: row.toWarehouse.id,
      code: row.toWarehouse.code,
      name: row.toWarehouse.name,
    },
    outboundDocumentId: row.outboundDocumentId ?? null,
    outboundAt: toIso(row.outboundAt),
    outboundBy: row.outboundAt
      ? {
          userId: row.outboundById ?? null,
          name: row.outboundByName ?? null,
          role: row.outboundByRole ?? null,
        }
      : null,
    notes: row.notes ?? null,
    version: Number(row.version),
    lines: (row.lines || []).map((line: any) =>
      toTransferLineDto(
        row,
        line,
        includeUnitIds,
        context,
      ),
    ),
    outboundDocument: toTransferDocumentDto(
      row.outboundDocument,
      includeCosts,
    ),
    receipts: (row.receipts || []).map((receipt: any) =>
      toTransferReceiptDto(receipt, includeCosts),
    ),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toTransferLineDto(
  transfer: any,
  line: any,
  includeUnitIds: boolean,
  context: any,
) {
  const sourceStock =
    context.stocks.get(
      `${transfer.fromWarehouseId}\u0000${line.productId}`,
    ) || {
      onHandQty: 0,
      reservedQty: 0,
      unavailableQty: 0,
      inTransitQty: 0,
    };
  const targetStock =
    context.stocks.get(
      `${transfer.toWarehouseId}\u0000${line.productId}`,
    ) || {
      onHandQty: 0,
      reservedQty: 0,
      unavailableQty: 0,
      inTransitQty: 0,
    };
  const sourceMetrics = calculateStockMetrics({
    onHandQty: Number(sourceStock.onHandQty),
    reservedQty: Number(sourceStock.reservedQty),
    unavailableQty: Number(sourceStock.unavailableQty),
    inTransitQty: Number(sourceStock.inTransitQty),
  });
  const targetMetrics = calculateStockMetrics({
    onHandQty: Number(targetStock.onHandQty),
    reservedQty: Number(targetStock.reservedQty),
    unavailableQty: Number(targetStock.unavailableQty),
    inTransitQty: Number(targetStock.inTransitQty),
  });
  const serializedIds = Array.isArray(line.serializedUnitIds)
    ? line.serializedUnitIds.filter(
        (value: any) => typeof value === 'string',
      )
    : [];
  const serializedUnitCount =
    serializedIds.length > 0
      ? serializedIds.length
      : String(
            line.trackingModeSnapshot ||
              line.product.inventoryTrackingMode,
          ).toUpperCase() === 'SERIALIZED'
        ? Number(line.plannedQty)
        : 0;
  return {
    id: line.id,
    lineNo: Number(line.lineNo),
    sourceLineKey: line.sourceLineKey,
    product: {
      id: line.product.id,
      name: line.product.name,
      unit: line.product.unit,
      inventoryTrackingMode:
        line.product.inventoryTrackingMode,
    },
    trackingMode: String(
      line.trackingModeSnapshot ||
        line.product.inventoryTrackingMode,
    ).toLowerCase(),
    plannedQty: Number(line.plannedQty),
    outboundQty: Number(line.outboundQty),
    receivedQty: Number(line.receivedQty),
    unavailableQty: Number(line.unavailableQty),
    differenceQty: Number(line.differenceQty),
    remainingInTransitQty: Math.max(
      0,
      Number(line.outboundQty) -
        Number(line.receivedQty) -
        Number(line.differenceQty),
    ),
    serializedUnitCount,
    ...(includeUnitIds
      ? { serializedUnitIds: serializedIds }
      : {}),
    sourceStock: sourceMetrics,
    targetStock: targetMetrics,
    shortageWarning: sourceMetrics.shortageQty > 0,
    companyQuantity: Number(
      context.companyTotals.get(line.productId) ?? 0,
    ),
    notes: line.notes ?? null,
    version: Number(line.version),
  };
}

function toTransferReceiptDto(
  receipt: any,
  includeCosts: boolean,
) {
  return {
    id: receipt.id,
    receiptNo: receipt.receiptNo,
    sourceKey: receipt.sourceKey,
    status: String(receipt.status).toLowerCase(),
    resultDocumentId: receipt.resultDocumentId ?? null,
    confirmedBy: {
      userId: receipt.confirmedById ?? null,
      name: receipt.confirmedByNameSnapshot ?? null,
      role: receipt.confirmedByRoleSnapshot ?? null,
    },
    confirmedAt: toIso(receipt.confirmedAt),
    reversalOfReceiptId: receipt.reversalOfReceiptId ?? null,
    notes: receipt.notes ?? null,
    lines: (receipt.lines || []).map((line: any) => ({
      id: line.id,
      transferLineId: line.transferLineId,
      lineNo: Number(line.lineNo),
      receivedQty: Number(line.receivedQty),
      unavailableQty: Number(line.unavailableQty),
      differenceQty: Number(line.differenceQty),
      notes: line.notes ?? null,
    })),
    resultDocument: toTransferDocumentDto(
      receipt.resultDocument,
      includeCosts,
    ),
    version: Number(receipt.version),
    createdAt: toIso(receipt.createdAt),
  };
}

function toTransferDocumentDto(
  document: any,
  includeCosts: boolean,
) {
  if (!document) {
    return null;
  }
  return {
    id: document.id,
    documentNo: document.documentNo,
    type: document.type
      ? String(document.type).toLowerCase()
      : null,
    status: String(document.status).toLowerCase(),
    businessAt: toIso(document.businessAt),
    lines: (document.lines || []).map((line: any) => ({
      id: line.id,
      lineNo: Number(line.lineNo),
      productId: line.productId,
      quantity: Number(line.quantity),
      ...(includeCosts
        ? {
            purchaseUnitCostCents:
              line.purchaseUnitCostCents === null ||
              line.purchaseUnitCostCents === undefined
                ? null
                : Number(line.purchaseUnitCostCents),
          }
        : {}),
      movements: (line.movements || []).map((movement: any) => ({
        id: movement.id,
        movementType: String(
          movement.movementType,
        ).toLowerCase(),
        onHandDelta: Number(movement.onHandDelta),
        unavailableDelta: Number(
          movement.unavailableDelta,
        ),
        inTransitDelta: Number(movement.inTransitDelta),
        ...(includeCosts
          ? {
              purchaseUnitCostCents:
                movement.purchaseUnitCostCents === null ||
                movement.purchaseUnitCostCents === undefined
                  ? null
                  : Number(
                      movement.purchaseUnitCostCents,
                    ),
            }
          : {}),
      })),
    })),
  };
}

function projectAttachmentMetadata(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item: any) => ({
    fileName:
      typeof item?.fileName === 'string' ? item.fileName : null,
    contentType:
      typeof item?.contentType === 'string'
        ? item.contentType
        : null,
    sizeBytes:
      Number.isSafeInteger(item?.sizeBytes) &&
      item.sizeBytes >= 0
        ? item.sizeBytes
        : null,
    checksumSha256:
      typeof item?.checksumSha256 === 'string'
        ? item.checksumSha256
        : null,
  }));
}

function toStockDto(
  row: any,
  context: ReturnType<typeof buildStockContext>,
  includeCosts: boolean,
) {
  const key = pairKey(row.warehouseId, row.productId);
  const metrics = calculateStockMetrics({
    onHandQty: Number(row.onHandQty || 0),
    reservedQty: Number(row.reservedQty || 0),
    unavailableQty: Number(row.unavailableQty || 0),
    inTransitQty: Number(row.inTransitQty || 0),
  });
  const alert = context.configs.get(key);
  const minimumAvailableQty = alert
    ? Number(alert.minimumAvailableQty || 0)
    : null;
  const alertEnabled = Boolean(alert?.enabled);
  const result: any = {
    id: row.id,
    warehouseId: row.warehouseId,
    productId: row.productId,
    warehouse: {
      id: row.warehouse.id,
      code: row.warehouse.code,
      name: row.warehouse.name,
      isActive: Boolean(row.warehouse.isActive),
      isDefault: Boolean(row.warehouse.isDefault),
    },
    product: {
      id: row.product.id,
      name: row.product.name,
      unit: row.product.unit,
      isActive: Boolean(row.product.isActive),
      inventoryTrackingMode: String(
        row.product.inventoryTrackingMode,
      ).toLowerCase(),
    },
    onHandQty: metrics.onHandQty,
    reservedQty: metrics.reservedQty,
    unavailableQty: metrics.unavailableQty,
    inTransitQty: metrics.inTransitQty,
    availableQty: metrics.availableQty,
    shortageQty: metrics.shortageQty,
    lowStock: {
      enabled: alertEnabled,
      minimumAvailableQty,
      isLowStock:
        alertEnabled &&
        minimumAvailableQty !== null &&
        metrics.availableQty <= minimumAvailableQty,
    },
    version: Number(row.version || 0),
    lastMovementId: row.lastMovementId ?? null,
    rebuiltAt: toIso(row.rebuiltAt),
    updatedAt: toIso(row.updatedAt),
  };
  if (includeCosts) {
    result.inventoryCost = calculateInventoryCost(
      row,
      context.batches.get(key) || [],
      context.serializedUnits.get(key) || [],
    );
  }
  return result;
}

function toBatchDto(batch: any, includeCosts: boolean) {
  const result: any = {
    id: batch.id,
    warehouseId: batch.warehouseId,
    productId: batch.productId,
    supplierName: batch.supplierName ?? null,
    purchaseOrderNo: batch.purchaseOrderNo ?? null,
    productionBatch: batch.productionBatch ?? null,
    productionDate: toIso(batch.productionDate, true),
    receivedQty: Number(batch.receivedQty || 0),
    remainingQty: Number(batch.remainingQty || 0),
    unavailableQty: Number(batch.unavailableQty || 0),
    fifoAt: toIso(batch.fifoAt),
    createdAt: toIso(batch.createdAt),
    updatedAt: toIso(batch.updatedAt),
  };
  if (includeCosts) {
    const unitCost =
      batch.purchaseUnitCostCents === null ||
      batch.purchaseUnitCostCents === undefined
        ? null
        : Number(batch.purchaseUnitCostCents);
    result.purchaseUnitCostCents = unitCost;
    result.inventoryAmountCents =
      unitCost === null
        ? null
        : safeMoneyProduct(
            Math.max(0, Number(batch.remainingQty || 0)),
            unitCost,
          );
    result.costStatus = String(
      batch.costStatus || 'PENDING',
    ).toLowerCase();
    result.costCompletedAt = toIso(batch.costCompletedAt);
  }
  return result;
}

function toMovementDto(row: any, includeCosts: boolean) {
  const result: any = {
    id: row.id,
    sourceKey: row.sourceKey,
    warehouseId: row.warehouseId,
    productId: row.productId,
    batchId: row.batchId ?? null,
    serializedUnitId: row.serializedUnitId ?? null,
    reservationId: row.reservationId ?? null,
    movementType: String(row.movementType).toLowerCase(),
    onHandDelta: Number(row.onHandDelta || 0),
    reservedDelta: Number(row.reservedDelta || 0),
    unavailableDelta: Number(row.unavailableDelta || 0),
    inTransitDelta: Number(row.inTransitDelta || 0),
    businessAt: toIso(row.businessAt),
    operator: {
      userId: row.operatorUserId ?? null,
      name: row.operatorNameSnapshot ?? null,
      role: row.operatorRoleSnapshot ?? null,
    },
    productNameSnapshot: row.productNameSnapshot,
    unitSnapshot: row.unitSnapshot,
    reason: row.reason ?? null,
    reversalOfMovementId: row.reversalOfMovementId ?? null,
    warehouse: {
      id: row.warehouse.id,
      code: row.warehouse.code,
      name: row.warehouse.name,
    },
    product: {
      id: row.product.id,
      name: row.product.name,
      inventoryTrackingMode: String(
        row.product.inventoryTrackingMode,
      ).toLowerCase(),
    },
    batch: row.batch
      ? {
          id: row.batch.id,
          purchaseOrderNo: row.batch.purchaseOrderNo ?? null,
          productionBatch: row.batch.productionBatch ?? null,
          productionDate: toIso(row.batch.productionDate, true),
        }
      : null,
    createdAt: toIso(row.createdAt),
  };
  if (includeCosts) {
    const unitCost =
      row.purchaseUnitCostCents === null ||
      row.purchaseUnitCostCents === undefined
        ? null
        : Number(row.purchaseUnitCostCents);
    result.purchaseUnitCostCents = unitCost;
    result.inventoryAmountCents =
      unitCost === null
        ? null
        : safeMoneyProduct(
            Math.abs(Number(row.onHandDelta || 0)),
            unitCost,
          );
  }
  return result;
}

function toAlertConfigDto(row: any) {
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    productId: row.productId,
    minimumAvailableQty: Number(row.minimumAvailableQty || 0),
    enabled: Boolean(row.enabled),
    warehouse: row.warehouse
      ? {
          id: row.warehouse.id,
          code: row.warehouse.code,
          name: row.warehouse.name,
          isActive: Boolean(row.warehouse.isActive),
        }
      : null,
    product: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          unit: row.product.unit,
          inventoryTrackingMode: String(
            row.product.inventoryTrackingMode,
          ).toLowerCase(),
          isActive: Boolean(row.product.isActive),
        }
      : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function buildStockContext(
  configs: any[],
  batches: any[],
  serializedUnits: any[],
) {
  return {
    configs: groupSingleByPair(configs),
    batches: groupByPair(batches),
    serializedUnits: groupByPair(serializedUnits),
  };
}

function calculateInventoryCost(
  stock: any,
  batches: any[],
  serializedUnits: any[],
) {
  const mode = String(
    stock.product.inventoryTrackingMode || 'NONE',
  ).toUpperCase();
  const positiveOnHandQty = Math.max(
    0,
    Number(stock.onHandQty || 0),
  );
  let coveredQty = 0;
  let factQty = 0;
  let inventoryAmountCents = 0;
  let basis = 'NONE';
  if (mode === 'SERIALIZED') {
    basis = 'SERIALIZED_UNIT';
    for (const unit of serializedUnits) {
      if (!ACTIVE_SERIALIZED_STATUSES.has(String(unit.status))) {
        continue;
      }
      factQty += 1;
      if (
        unit.purchaseCostCents !== null &&
        unit.purchaseCostCents !== undefined
      ) {
        coveredQty += 1;
        inventoryAmountCents = safeMoneyAdd(
          inventoryAmountCents,
          Number(unit.purchaseCostCents),
        );
      }
    }
  } else if (mode === 'QUANTITY') {
    basis = 'BATCH';
    for (const batch of batches) {
      const quantity = Math.max(
        0,
        Number(batch.remainingQty || 0),
      );
      factQty += quantity;
      if (
        batch.purchaseUnitCostCents !== null &&
        batch.purchaseUnitCostCents !== undefined &&
        String(batch.costStatus || '').toUpperCase() === 'COMPLETE'
      ) {
        coveredQty += quantity;
        inventoryAmountCents = safeMoneyAdd(
          inventoryAmountCents,
          safeMoneyProduct(
            quantity,
            Number(batch.purchaseUnitCostCents),
          ),
        );
      }
    }
  }
  const effectiveCoveredQty = Math.min(
    positiveOnHandQty,
    coveredQty,
  );
  const uncoveredQty = Math.max(
    0,
    positiveOnHandQty - effectiveCoveredQty,
  );
  return {
    basis: basis.toLowerCase(),
    inventoryAmountCents,
    coveredQty: effectiveCoveredQty,
    uncoveredQty,
    factQty,
    coverageStatus:
      positiveOnHandQty === 0
        ? 'not_applicable'
        : effectiveCoveredQty === 0
          ? 'none'
          : uncoveredQty === 0
            ? 'full'
            : 'partial',
  };
}

function summarizeSerializedUnits(units: any[]) {
  const summary: Record<string, number> = {};
  for (const unit of units) {
    const key = String(unit.status || '').toLowerCase();
    if (key) {
      summary[key] = (summary[key] || 0) + 1;
    }
  }
  return summary;
}

function matchesDerivedStockFilters(stock: any, filters: any) {
  if (
    filters.hasShortage !== null &&
    (stock.shortageQty > 0) !== filters.hasShortage
  ) {
    return false;
  }
  if (
    filters.isLowStock !== null &&
    stock.lowStock.isLowStock !== filters.isLowStock
  ) {
    return false;
  }
  if (
    filters.hasUnavailable !== null &&
    (stock.unavailableQty > 0) !== filters.hasUnavailable
  ) {
    return false;
  }
  return true;
}

function uniquePairs(rows: any[]) {
  const pairs = new Map<string, any>();
  for (const row of rows) {
    pairs.set(pairKey(row.warehouseId, row.productId), {
      warehouseId: row.warehouseId,
      productId: row.productId,
    });
  }
  return [...pairs.values()];
}

function groupByPair(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = pairKey(row.warehouseId, row.productId);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function groupSingleByPair(rows: any[]) {
  const groups = new Map<string, any>();
  for (const row of rows) {
    groups.set(pairKey(row.warehouseId, row.productId), row);
  }
  return groups;
}

function pairKey(warehouseId: string, productId: string) {
  return `${warehouseId}\u0000${productId}`;
}

function pagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function assertObject(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('The request body must be an object.');
  }
}

function canReadSerializedTransferUnits(actor: any) {
  const role =
    typeof actor?.role === 'string'
      ? actor.role.trim().toLowerCase()
      : '';
  return ['super_admin', 'admin', 'warehouse'].includes(role);
}

function assertAllowedFields(input: any, fields: string[]) {
  const allowed = new Set(fields);
  const unexpected = Object.keys(input).filter(
    (field) => !allowed.has(field),
  );
  if (unexpected.length > 0) {
    throw validationError(
      `Unsupported field: ${unexpected.sort()[0]}.`,
    );
  }
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (typeof value !== 'string') {
    throw validationError(`${field} must be a string.`);
  }
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw validationError(
      `${field} must be between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredString(value, field, maxLength);
}

function requiredId(value: unknown, field: string) {
  return requiredString(value, field, 191);
}

function optionalId(value: unknown, field: string) {
  return optionalString(value, field, 191);
}

function requiredBoolean(value: unknown, field: string) {
  if (value === true || value === false) {
    return value;
  }
  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }
  throw validationError(`${field} must be a boolean.`);
}

function optionalBoolean(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredBoolean(value, field);
}

function nonNegativeInteger(value: unknown, field: string) {
  const result =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw validationError(
      `${field} must be a non-negative integer bottle count.`,
    );
  }
  return result;
}

function positiveInteger(
  value: unknown,
  field: string,
  fallback: number,
  maximum: number,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const result =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value), 10);
  if (
    !Number.isSafeInteger(result) ||
    result <= 0 ||
    result > maximum
  ) {
    throw validationError(
      `${field} must be an integer between 1 and ${maximum}.`,
    );
  }
  return result;
}

function optionalEnum(
  value: unknown,
  field: string,
  values: Set<string>,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = requiredString(value, field, 80).toUpperCase();
  if (!values.has(normalized)) {
    throw validationError(`${field} has an unsupported value.`);
  }
  return normalized;
}

function optionalDate(
  value: unknown,
  field: string,
  endOfDay: boolean,
) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const raw = requiredString(value, field, 40);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw validationError(`${field} must be a valid date.`);
  }
  return date;
}

function requiredDate(value: unknown, field: string) {
  const date = optionalDate(value, field, false);
  if (!date) {
    throw validationError(`${field} is required.`);
  }
  return date;
}

function normalizedWarehouseValue(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function hasOwn(value: any, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validationError(message: string) {
  return createHttpError(
    400,
    'INVENTORY_VALIDATION_FAILED',
    message,
  );
}

function mapWarehouseWriteError(error: any) {
  if (
    error?.code === 'INVENTORY_WAREHOUSE_CODE_EXISTS' ||
    error?.code === 'INVENTORY_WAREHOUSE_NAME_EXISTS'
  ) {
    return error;
  }
  if (prismaCode(error) === 'P2002') {
    return createHttpError(
      409,
      'INVENTORY_WAREHOUSE_UNIQUE_CONFLICT',
      'The warehouse code, name, or active default conflicts with another warehouse.',
    );
  }
  if (prismaCode(error) === 'P2034') {
    return createHttpError(
      409,
      'INVENTORY_CONCURRENT_UPDATE',
      'Inventory master data changed concurrently. Please retry.',
    );
  }
  return error;
}

function prismaCode(error: any) {
  return typeof error?.code === 'string' ? error.code : '';
}

function safeMoneyProduct(quantity: number, unitCostCents: number) {
  const result = quantity * unitCostCents;
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(
      409,
      'INVENTORY_COST_AMOUNT_OVERFLOW',
      'The inventory amount exceeds the supported integer range.',
    );
  }
  return result;
}

function safeMoneyAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(
      409,
      'INVENTORY_COST_AMOUNT_OVERFLOW',
      'The inventory amount exceeds the supported integer range.',
    );
  }
  return result;
}

function toIso(value: unknown, dateOnly = false) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return dateOnly
    ? date.toISOString().slice(0, 10)
    : date.toISOString();
}

function boundedTraceId(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  return value.normalize('NFKC').trim().slice(0, 64) || null;
}

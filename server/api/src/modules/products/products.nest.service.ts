import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

const PRODUCT_MANAGEMENT_ROLES = ['admin', 'finance'];
const PRODUCT_INVENTORY_MODE_ACTIVATION_ROLES = ['admin'];
const PRODUCT_OPTION_ROLES = [
  'admin',
  'boss',
  'front_desk',
  'sales',
  'finance',
  'warehouse',
  'after_sales',
];
const MAX_EFFECTIVE_DATE = new Date('9999-12-31T00:00:00.000Z');
const PRODUCT_INVENTORY_MODE_ACTIVATION_COMMAND =
  'PRODUCT_INVENTORY_TRACKING_ACTIVATE';
const PRODUCT_INVENTORY_FACT_DELEGATES = [
  'warehouseProductStock',
  'inventoryBatch',
  'inventoryDocumentLine',
  'inventoryMovement',
  'inventoryReservation',
  'inventoryTransferLine',
  'stocktake',
  'serializedInventoryUnit',
  'afterSalesReceiptLine',
] as const;

@Injectable()
export class ProductsNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async listProducts(actor: any, filters: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    const page = normalizePositiveInteger(filters.page, 'page', 1, 1000000);
    const pageSize = normalizePositiveInteger(
      filters.pageSize ?? filters.limit,
      'pageSize',
      20,
      100,
    );
    const where = buildProductWhere(filters);
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      products: products.map(toProductDto),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async listProductOptions(actor: any) {
    requireAnyRole(actor, PRODUCT_OPTION_ROLES);
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        unit: true,
        inventoryTrackingMode: true,
      },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      inventoryTrackingMode: toInventoryTrackingMode(
        product.inventoryTrackingMode,
      ),
    }));
  }

  async getProduct(actor: any, id: string) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    return toProductDto(await this.findProductOrThrow(id));
  }

  async createProduct(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, [
      'name',
      'unit',
      'inventoryTrackingMode',
      'isActive',
      'notes',
    ]);
    const now = new Date();
    const name = normalizeLimitedRequiredString(payload.name, 'name', 160);
    const normalizedName = normalizeProductName(name);
    await this.assertUniqueProductName(normalizedName);
    const inventoryTrackingMode = normalizeInventoryTrackingMode(
      payload.inventoryTrackingMode,
    );
    if (inventoryTrackingMode !== 'NONE') {
      throw productInventoryModeChangeRequiresCommandError();
    }
    const data: any = {
      id: crypto.randomUUID(),
      name,
      normalizedName,
      unit: normalizeLimitedRequiredString(payload.unit, 'unit', 20),
      inventoryTrackingMode: 'NONE',
      isActive:
        payload.isActive === undefined
          ? true
          : normalizeBoolean(payload.isActive, 'isActive'),
      notes: normalizeOptionalString(payload.notes),
      createdById: actor.id,
      updatedById: actor.id,
      createdAt: now,
      updatedAt: now,
    };

    let created: any;
    try {
      created = await this.prisma.product.create({ data });
    } catch (error) {
      throw mapProductUniqueError(error);
    }
    const dto = toProductDto(created);
    await this.appendLog(actor, 'products.create', 'product', created.id, null, dto, metadata);
    return dto;
  }

  async activateQuantityInventoryTracking(
    actor: any,
    productId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, PRODUCT_INVENTORY_MODE_ACTIVATION_ROLES);
    const command = normalizeInventoryModeActivationCommand(
      productId,
      payload,
    );

    const replay = await this.findInventoryModeChangeByIdempotencyKey(
      command.idempotencyKey,
    );
    if (replay) {
      return this.resolveInventoryModeActivationReplay(command, replay);
    }
    assertInventoryModeActivationRequestHash(command);

    try {
      return await this.prisma.$transaction(
        async (tx: any) => {
          const transactionReplay =
            await tx.productInventoryModeChange.findUnique({
              where: { idempotencyKey: command.idempotencyKey },
            });
          if (transactionReplay) {
            return this.resolveInventoryModeActivationReplay(
              command,
              transactionReplay,
              tx,
            );
          }

          const current = await tx.product.findUnique({
            where: { id: command.productId },
          });
          if (!current) {
            throw createHttpError(
              404,
              'PRODUCT_NOT_FOUND',
              '商品不存在。',
            );
          }
          if (!current.isActive) {
            throw createHttpError(
              409,
              'PRODUCT_INACTIVE',
              '已停用商品不能启用库存跟踪，请先启用商品。',
            );
          }
          const actualMode = String(
            current.inventoryTrackingMode || 'NONE',
          ).toUpperCase();
          if (actualMode !== command.expectedCurrentMode) {
            throw createHttpError(
              409,
              'PRODUCT_INVENTORY_MODE_EXPECTATION_MISMATCH',
              `商品当前库存模式为 ${actualMode}，与请求预期的 ${command.expectedCurrentMode} 不一致，请刷新后重试。`,
            );
          }
          if (
            await hasIncompatibleInventoryFacts(tx, command.productId)
          ) {
            throw createHttpError(
              409,
              'PRODUCT_INVENTORY_MODE_FACTS_EXIST',
              '该商品已存在库存事实或逐瓶记录，不能在线启用普通数量库存，请联系超级管理员核查。',
            );
          }

          const now = new Date();
          const change = await tx.productInventoryModeChange.create({
            data: {
              id: crypto.randomUUID(),
              productId: command.productId,
              expectedCurrentMode: command.expectedCurrentMode,
              targetMode: command.targetMode,
              effectiveAt: command.effectiveAt,
              sourceKey: command.sourceKey,
              idempotencyKey: command.idempotencyKey,
              requestHash: command.requestHash,
              status: 'PENDING',
              requestedById: actor.id,
              requestedByNameSnapshot: actor.name || actor.username || null,
              requestedByRoleSnapshot: actor.role || null,
              requestedAt: now,
              appliedById: null,
              appliedByNameSnapshot: null,
              appliedByRoleSnapshot: null,
              appliedAt: null,
              reason: '在线启用普通数量库存',
              createdAt: now,
              updatedAt: now,
            },
          });

          const conditionalUpdate = await tx.product.updateMany({
            where: {
              id: command.productId,
              isActive: true,
              inventoryTrackingMode: command.expectedCurrentMode,
            },
            data: {
              inventoryTrackingMode: command.targetMode,
              updatedById: actor.id,
              updatedAt: now,
            },
          });
          if (conditionalUpdate.count !== 1) {
            throw createHttpError(
              409,
              'PRODUCT_INVENTORY_MODE_CONCURRENT_CONFLICT',
              '商品库存模式已被其他请求修改，请刷新商品后重试。',
            );
          }

          const [updated, appliedChange] = await Promise.all([
            tx.product.findUnique({ where: { id: command.productId } }),
            tx.productInventoryModeChange.update({
              where: { id: change.id },
              data: {
                status: 'APPLIED',
                appliedById: actor.id,
                appliedByNameSnapshot:
                  actor.name || actor.username || null,
                appliedByRoleSnapshot: actor.role || null,
                appliedAt: now,
                updatedAt: now,
              },
            }),
          ]);
          const product = toProductDto(updated);
          const inventoryModeChange =
            toProductInventoryModeChangeDto(appliedChange);
          await this.operationLogsService.appendLog(
            {
              userId: actor.id,
              action: 'products.inventory_tracking.activate',
              module: 'products',
              operationType: 'STATUS_CHANGE',
              entityType: 'product_inventory_mode_change',
              entityId: appliedChange.id,
              beforeData: toProductDto(current),
              afterData: {
                product,
                inventoryModeChange,
              },
              requestSummary: {
                productId: command.productId,
                expectedCurrentMode: command.expectedCurrentMode,
                targetMode: command.targetMode,
                effectiveAt: command.effectiveAt.toISOString(),
                sourceKey: command.sourceKey,
                idempotencyKey: command.idempotencyKey,
                requestHash: command.requestHash,
              },
              ipAddress: metadata.ipAddress || null,
            },
            tx,
          );
          return { product, inventoryModeChange };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (error?.code === 'P2034') {
        throw createHttpError(
          409,
          'PRODUCT_INVENTORY_MODE_CONCURRENT_CONFLICT',
          '商品库存模式启用请求发生并发冲突，请刷新商品后重试。',
        );
      }
      if (error?.code !== 'P2002') throw error;
      const replayAfterConflict =
        await this.findInventoryModeChangeByIdempotencyKey(
          command.idempotencyKey,
        );
      if (replayAfterConflict) {
        return this.resolveInventoryModeActivationReplay(
          command,
          replayAfterConflict,
        );
      }
      throw createHttpError(
        409,
        'PRODUCT_INVENTORY_MODE_SOURCE_CONFLICT',
        'sourceKey 已被其他库存模式切换命令使用，请重新发起操作。',
      );
    }
  }

  async updateProduct(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, [
      'name',
      'unit',
      'inventoryTrackingMode',
      'notes',
    ]);
    const current = await this.findProductOrThrow(id);
    const data: any = {
      updatedById: actor.id,
      updatedAt: new Date(),
    };

    if (hasOwn(payload, 'name')) {
      data.name = normalizeLimitedRequiredString(payload.name, 'name', 160);
      data.normalizedName = normalizeProductName(data.name);
      await this.assertUniqueProductName(data.normalizedName, id);
    }
    if (hasOwn(payload, 'unit')) {
      data.unit = normalizeLimitedRequiredString(payload.unit, 'unit', 20);
    }
    if (hasOwn(payload, 'inventoryTrackingMode')) {
      const requestedMode = normalizeInventoryTrackingMode(
        payload.inventoryTrackingMode,
      );
      if (requestedMode !== String(current.inventoryTrackingMode).toUpperCase()) {
        throw productInventoryModeChangeRequiresCommandError();
      }
      data.inventoryTrackingMode = current.inventoryTrackingMode;
    }
    if (hasOwn(payload, 'notes')) {
      data.notes = normalizeOptionalString(payload.notes);
    }
    assertHasEditableField(data, ['updatedById', 'updatedAt']);

    let updated: any;
    try {
      updated = await this.prisma.product.update({ where: { id }, data });
    } catch (error) {
      throw mapProductUniqueError(error);
    }
    const before = toProductDto(current);
    const after = toProductDto(updated);
    await this.appendLog(actor, 'products.update', 'product', id, before, after, metadata);
    return after;
  }

  async setProductActive(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, ['isActive']);
    if (!hasOwn(payload, 'isActive')) {
      throw validationError('isActive is required.');
    }
    const current = await this.findProductOrThrow(id);
    const isActive = normalizeBoolean(payload.isActive, 'isActive');
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        isActive,
        updatedById: actor.id,
        updatedAt: new Date(),
      },
    });
    const before = toProductDto(current);
    const after = toProductDto(updated);
    await this.appendLog(
      actor,
      isActive ? 'products.enable' : 'products.disable',
      'product',
      id,
      before,
      after,
      metadata,
    );
    return after;
  }

  async listActualCosts(actor: any, productId: string) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    await this.findProductOrThrow(productId);
    const costs = await this.prisma.productActualCost.findMany({
      where: { productId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return costs.map(toActualCostDto);
  }

  async createActualCost(
    actor: any,
    productId: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, [
      'costCents',
      'effectiveFrom',
      'effectiveTo',
      'isActive',
      'notes',
    ]);
    await this.findProductOrThrow(productId);
    const now = new Date();
    const data: any = {
      id: crypto.randomUUID(),
      productId,
      costCents: normalizeCents(payload.costCents, 'costCents'),
      effectiveFrom: normalizeDate(payload.effectiveFrom, 'effectiveFrom', true),
      effectiveTo: normalizeDate(payload.effectiveTo, 'effectiveTo', false),
      isActive:
        payload.isActive === undefined
          ? true
          : normalizeBoolean(payload.isActive, 'isActive'),
      notes: normalizeOptionalString(payload.notes),
      createdById: actor.id,
      updatedById: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    assertValidEffectiveRange(data.effectiveFrom, data.effectiveTo);
    if (data.isActive) {
      await this.assertNoActualCostOverlap(data);
    }

    let created: any;
    try {
      created = await this.prisma.productActualCost.create({ data });
    } catch (error) {
      throw mapActualCostOverlapError(error);
    }
    const dto = toActualCostDto(created);
    await this.appendLog(
      actor,
      'product_actual_costs.create',
      'product_actual_cost',
      created.id,
      null,
      dto,
      metadata,
    );
    return dto;
  }

  async updateActualCost(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, ['costCents', 'effectiveFrom', 'effectiveTo', 'notes']);
    const current = await this.findActualCostOrThrow(id);
    const data: any = {
      updatedById: actor.id,
      updatedAt: new Date(),
    };
    if (hasOwn(payload, 'costCents')) {
      data.costCents = normalizeCents(payload.costCents, 'costCents');
    }
    if (hasOwn(payload, 'effectiveFrom')) {
      data.effectiveFrom = normalizeDate(payload.effectiveFrom, 'effectiveFrom', true);
    }
    if (hasOwn(payload, 'effectiveTo')) {
      data.effectiveTo = normalizeDate(payload.effectiveTo, 'effectiveTo', false);
    }
    if (hasOwn(payload, 'notes')) {
      data.notes = normalizeOptionalString(payload.notes);
    }
    assertHasEditableField(data, ['updatedById', 'updatedAt']);
    const candidate = { ...current, ...data };
    assertValidEffectiveRange(candidate.effectiveFrom, candidate.effectiveTo);
    if (candidate.isActive) {
      await this.assertNoActualCostOverlap(candidate, id);
    }

    let updated: any;
    try {
      updated = await this.prisma.productActualCost.update({ where: { id }, data });
    } catch (error) {
      throw mapActualCostOverlapError(error);
    }
    const before = toActualCostDto(current);
    const after = toActualCostDto(updated);
    await this.appendLog(
      actor,
      'product_actual_costs.update',
      'product_actual_cost',
      id,
      before,
      after,
      metadata,
    );
    return after;
  }

  async setActualCostActive(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, ['isActive']);
    if (!hasOwn(payload, 'isActive')) {
      throw validationError('isActive is required.');
    }
    const current = await this.findActualCostOrThrow(id);
    const isActive = normalizeBoolean(payload.isActive, 'isActive');
    if (isActive) {
      await this.assertNoActualCostOverlap(current, id);
    }
    const updated = await this.prisma.productActualCost.update({
      where: { id },
      data: {
        isActive,
        updatedById: actor.id,
        updatedAt: new Date(),
      },
    });
    const before = toActualCostDto(current);
    const after = toActualCostDto(updated);
    await this.appendLog(
      actor,
      isActive ? 'product_actual_costs.enable' : 'product_actual_costs.disable',
      'product_actual_cost',
      id,
      before,
      after,
      metadata,
    );
    return after;
  }

  private async findProductOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw createHttpError(404, 'PRODUCT_NOT_FOUND', 'Product does not exist.');
    }
    return product;
  }

  private async findInventoryModeChangeByIdempotencyKey(
    idempotencyKey: string,
    prisma: any = this.prisma,
  ) {
    return prisma.productInventoryModeChange.findUnique({
      where: { idempotencyKey },
    });
  }

  private async resolveInventoryModeActivationReplay(
    command: NormalizedInventoryModeActivationCommand,
    change: any,
    prisma: any = this.prisma,
  ) {
    if (!isSameInventoryModeActivationRequest(command, change)) {
      throw createHttpError(
        409,
        'PRODUCT_INVENTORY_MODE_IDEMPOTENCY_CONFLICT',
        '该 idempotencyKey 已用于不同的库存模式切换请求，请勿复用。',
      );
    }
    if (change.status !== 'APPLIED') {
      throw createHttpError(
        409,
        'PRODUCT_INVENTORY_MODE_COMMAND_NOT_APPLIED',
        '该幂等命令尚未成功应用，请联系管理员核查切换记录。',
      );
    }
    const product = await prisma.product.findUnique({
      where: { id: change.productId },
    });
    if (!product) {
      throw createHttpError(404, 'PRODUCT_NOT_FOUND', '商品不存在。');
    }
    return {
      product: toProductDto(product),
      inventoryModeChange: toProductInventoryModeChangeDto(change),
    };
  }

  private async findActualCostOrThrow(id: string) {
    const cost = await this.prisma.productActualCost.findUnique({ where: { id } });
    if (!cost) {
      throw createHttpError(
        404,
        'PRODUCT_ACTUAL_COST_NOT_FOUND',
        'Product actual cost does not exist.',
      );
    }
    return cost;
  }

  private async assertUniqueProductName(normalizedName: string, excludeId?: string) {
    const duplicate = await this.prisma.product.findUnique({
      where: { normalizedName },
    });
    if (duplicate && duplicate.id !== excludeId) {
      throw productNameExistsError();
    }
  }

  private async assertNoActualCostOverlap(candidate: any, excludeId?: string) {
    const overlapping = await this.prisma.productActualCost.findFirst({
      where: {
        productId: candidate.productId,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        effectiveFrom: {
          lte: candidate.effectiveTo || MAX_EFFECTIVE_DATE,
        },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: candidate.effectiveFrom } },
        ],
      },
    });
    if (overlapping) {
      throw actualCostOverlapError();
    }
  }

  private async appendLog(
    actor: any,
    action: string,
    entityType: string,
    entityId: string,
    beforeData: any,
    afterData: any,
    metadata: any,
  ) {
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action,
      entityType,
      entityId,
      beforeData,
      afterData,
      ipAddress: metadata.ipAddress || null,
    });
  }
}

function buildProductWhere(filters: any = {}) {
  const where: any = {};
  const keyword = normalizeOptionalString(
    filters.keyword ?? filters.query ?? filters.search,
  );
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { normalizedName: { contains: normalizeProductName(keyword) } },
      { unit: { contains: keyword } },
    ];
  }
  if (filters.isActive !== undefined && filters.isActive !== '') {
    where.isActive = normalizeBoolean(filters.isActive, 'isActive');
  }
  return where;
}

function normalizeProductName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeInventoryTrackingMode(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 'NONE';
  }
  const normalized = String(value).trim().toUpperCase();
  if (
    normalized !== 'NONE' &&
    normalized !== 'QUANTITY' &&
    normalized !== 'SERIALIZED'
  ) {
    throw validationError(
      'inventoryTrackingMode must be NONE, QUANTITY, or SERIALIZED.',
    );
  }
  return normalized;
}

interface NormalizedInventoryModeActivationCommand {
  productId: string;
  expectedCurrentMode: 'NONE';
  targetMode: 'QUANTITY';
  effectiveAt: Date;
  sourceKey: string;
  idempotencyKey: string;
  requestHash: string;
  calculatedRequestHash: string;
}

function normalizeInventoryModeActivationCommand(
  productIdInput: unknown,
  payload: any,
): NormalizedInventoryModeActivationCommand {
  assertObjectPayload(payload);
  assertAllowedFields(payload, [
    'expectedCurrentMode',
    'targetMode',
    'effectiveAt',
    'sourceKey',
    'idempotencyKey',
    'requestHash',
  ]);
  const productId = normalizeLimitedRequiredString(
    productIdInput,
    'productId',
    191,
  );
  const expectedCurrentMode = normalizeInventoryTrackingMode(
    payload.expectedCurrentMode,
  );
  const targetMode = normalizeInventoryTrackingMode(payload.targetMode);
  if (expectedCurrentMode !== 'NONE' || targetMode !== 'QUANTITY') {
    throw createHttpError(
      400,
      'PRODUCT_INVENTORY_MODE_TRANSITION_NOT_ALLOWED',
      '当前仅允许通过此命令执行 NONE → QUANTITY，不能启用逐瓶模式或切回未启用库存。',
    );
  }
  const effectiveAt = normalizeEffectiveAt(payload.effectiveAt);
  const sourceKey = normalizeBusinessKey(payload.sourceKey, 'sourceKey');
  const idempotencyKey = normalizeBusinessKey(
    payload.idempotencyKey,
    'idempotencyKey',
  );
  const requestHash = normalizeRequestHash(payload.requestHash);
  const calculatedRequestHash = calculateInventoryModeActivationRequestHash({
    productId,
    expectedCurrentMode,
    targetMode,
    effectiveAt: effectiveAt.toISOString(),
    sourceKey,
    idempotencyKey,
  });
  return {
    productId,
    expectedCurrentMode: 'NONE',
    targetMode: 'QUANTITY',
    effectiveAt,
    sourceKey,
    idempotencyKey,
    requestHash,
    calculatedRequestHash,
  };
}

function assertInventoryModeActivationRequestHash(
  command: NormalizedInventoryModeActivationCommand,
) {
  if (command.requestHash !== command.calculatedRequestHash) {
    throw createHttpError(
      400,
      'PRODUCT_INVENTORY_MODE_REQUEST_HASH_MISMATCH',
      'requestHash 与规范化后的库存模式启用请求不一致。',
    );
  }
}

function normalizeEffectiveAt(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())
  ) {
    throw validationError('effectiveAt 必须是包含时区的 ISO-8601 时间。');
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw validationError('effectiveAt 必须是有效时间。');
  }
  parsed.setUTCMilliseconds(0);
  return parsed;
}

function normalizeBusinessKey(value: unknown, fieldName: string) {
  const normalized = normalizeOptionalString(value)?.toLocaleLowerCase(
    'en-US',
  );
  if (!normalized) {
    throw validationError(`${fieldName} 不能为空。`);
  }
  if (normalized.length > 150) {
    throw validationError(`${fieldName} 不能超过 150 个字符。`);
  }
  if (!/^[a-z0-9:./_-]+$/.test(normalized)) {
    throw validationError(
      `${fieldName} 只能包含小写字母、数字、冒号、点、斜杠、下划线和连字符。`,
    );
  }
  return normalized;
}

function normalizeRequestHash(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw validationError('requestHash 必须是 64 位小写 SHA-256。');
  }
  return normalized;
}

export function calculateInventoryModeActivationRequestHash(input: {
  productId: string;
  expectedCurrentMode: string;
  targetMode: string;
  effectiveAt: string;
  sourceKey: string;
  idempotencyKey: string;
}) {
  return crypto
    .createHash('sha256')
    .update(
      canonicalJson({
        commandType: PRODUCT_INVENTORY_MODE_ACTIVATION_COMMAND,
        payload: {
          effectiveAt: input.effectiveAt,
          expectedCurrentMode: input.expectedCurrentMode,
          idempotencyKey: input.idempotencyKey,
          productId: input.productId,
          sourceKey: input.sourceKey,
          targetMode: input.targetMode,
        },
      }),
      'utf8',
    )
    .digest('hex');
}

function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function isSameInventoryModeActivationRequest(
  command: NormalizedInventoryModeActivationCommand,
  change: any,
) {
  return (
    change.productId === command.productId &&
    String(change.expectedCurrentMode).toUpperCase() ===
      command.expectedCurrentMode &&
    String(change.targetMode).toUpperCase() === command.targetMode &&
    normalizeStoredSecond(change.effectiveAt) ===
      command.effectiveAt.toISOString() &&
    change.sourceKey === command.sourceKey &&
    change.idempotencyKey === command.idempotencyKey &&
    String(change.requestHash).toLowerCase() === command.requestHash
  );
}

function normalizeStoredSecond(value: unknown) {
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMilliseconds(0);
  return date.toISOString();
}

async function hasIncompatibleInventoryFacts(tx: any, productId: string) {
  const checks = PRODUCT_INVENTORY_FACT_DELEGATES.map(
    async (delegateName) => {
      const delegate = tx[delegateName];
      if (!delegate) return false;
      const where = buildProductInventoryFactWhere(
        delegateName,
        productId,
      );
      if (typeof delegate.count === 'function') {
        return (await delegate.count({ where })) > 0;
      }
      if (typeof delegate.findFirst === 'function') {
        return Boolean(
          await delegate.findFirst({
            where,
            select: { id: true },
          }),
        );
      }
      if (typeof delegate.findMany === 'function') {
        return (
          (
            await delegate.findMany({
              where,
              select: { id: true },
              take: 1,
            })
          ).length > 0
        );
      }
      return false;
    },
  );
  return (await Promise.all(checks)).some(Boolean);
}

function buildProductInventoryFactWhere(
  delegateName: (typeof PRODUCT_INVENTORY_FACT_DELEGATES)[number],
  productId: string,
) {
  if (delegateName === 'afterSalesReceiptLine') {
    return {
      afterSalesOrderItem: { productId },
    };
  }
  return { productId };
}

function toInventoryTrackingMode(value: unknown) {
  return String(value || 'NONE').toLowerCase();
}

function normalizeCents(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw validationError(`${fieldName} must be a non-negative integer in cents.`);
  }
  if (value > 2147483647) {
    throw validationError(`${fieldName} exceeds the supported integer range.`);
  }
  return value;
}

function normalizeDate(value: unknown, fieldName: string, required: boolean) {
  if ((value === undefined || value === null || value === '') && !required) {
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw validationError(`${fieldName} must be a valid calendar date.`);
  }
  return date;
}

function assertValidEffectiveRange(effectiveFrom: Date, effectiveTo: Date | null) {
  if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    throw validationError('effectiveTo must be on or after effectiveFrom.');
  }
}

function normalizePositiveInteger(
  value: unknown,
  fieldName: string,
  fallback: number,
  maximum: number,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw validationError(`${fieldName} must be a positive integer.`);
  }
  return Math.min(numberValue, maximum);
}

function normalizeBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === '1') {
    return true;
  }
  if (text === 'false' || text === '0') {
    return false;
  }
  throw validationError(`${fieldName} must be a boolean.`);
}

function normalizeLimitedRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw validationError(`${fieldName} is required.`);
  }
  if (text.length > maxLength) {
    throw validationError(`${fieldName} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function assertObjectPayload(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('Request body must be an object.');
  }
}

function assertAllowedFields(payload: any, allowedFields: string[]) {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(payload).find((key) => !allowed.has(key));
  if (unknown) {
    throw validationError(`Unsupported field: ${unknown}.`);
  }
}

function assertHasEditableField(data: any, ignoredFields: string[]) {
  const ignored = new Set(ignoredFields);
  if (!Object.keys(data).some((key) => !ignored.has(key))) {
    throw validationError('At least one editable field is required.');
  }
}

function hasOwn(value: any, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function toProductDto(product: any) {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit,
    inventoryTrackingMode: toInventoryTrackingMode(
      product.inventoryTrackingMode,
    ),
    isActive: Boolean(product.isActive),
    notes: product.notes || null,
    createdById: product.createdById || null,
    updatedById: product.updatedById || null,
    createdAt: toIsoString(product.createdAt),
    updatedAt: toIsoString(product.updatedAt),
  };
}

function toProductInventoryModeChangeDto(change: any) {
  return {
    id: change.id,
    productId: change.productId,
    expectedCurrentMode: toInventoryTrackingMode(
      change.expectedCurrentMode,
    ),
    targetMode: toInventoryTrackingMode(change.targetMode),
    effectiveAt: toIsoString(change.effectiveAt),
    sourceKey: change.sourceKey,
    idempotencyKey: change.idempotencyKey,
    requestHash: change.requestHash,
    status: String(change.status || '').toLowerCase(),
    requestedById: change.requestedById || null,
    requestedByNameSnapshot: change.requestedByNameSnapshot || null,
    requestedByRoleSnapshot: change.requestedByRoleSnapshot || null,
    requestedAt: toIsoString(change.requestedAt),
    appliedById: change.appliedById || null,
    appliedByNameSnapshot: change.appliedByNameSnapshot || null,
    appliedByRoleSnapshot: change.appliedByRoleSnapshot || null,
    appliedAt: toIsoString(change.appliedAt),
    reason: change.reason || null,
    createdAt: toIsoString(change.createdAt),
    updatedAt: toIsoString(change.updatedAt),
  };
}

function toActualCostDto(cost: any) {
  return {
    id: cost.id,
    productId: cost.productId,
    costCents: cost.costCents,
    effectiveFrom: toDateString(cost.effectiveFrom),
    effectiveTo: toDateString(cost.effectiveTo),
    isActive: Boolean(cost.isActive),
    notes: cost.notes || null,
    createdById: cost.createdById || null,
    updatedById: cost.updatedById || null,
    createdAt: toIsoString(cost.createdAt),
    updatedAt: toIsoString(cost.updatedAt),
  };
}

function toDateString(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString().slice(0, 10);
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}

function requireAnyRole(actor: any, roles: string[]) {
  if (
    !actor ||
    (!roles.includes(actor.role) &&
      !(actor.role === 'super_admin' && roles.includes('admin')))
  ) {
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this action.',
    );
  }
}

function validationError(message: string) {
  return createHttpError(400, 'VALIDATION_FAILED', message);
}

function productNameExistsError() {
  return createHttpError(409, 'PRODUCT_NAME_EXISTS', 'Product name already exists.');
}

function actualCostOverlapError() {
  return createHttpError(
    409,
    'PRODUCT_ACTUAL_COST_RANGE_OVERLAP',
    'Active actual-cost effective ranges for the same product must not overlap.',
  );
}

function productInventoryModeChangeRequiresCommandError() {
  return createHttpError(
    409,
    'PRODUCT_INVENTORY_MODE_CHANGE_REQUIRES_COMMAND',
    'Inventory tracking mode changes require the dedicated inventory mode command.',
  );
}

function mapProductUniqueError(error: any) {
  if (error?.code === 'P2002') {
    return productNameExistsError();
  }
  return error;
}

function mapActualCostOverlapError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('must not overlap') || message.includes('range overlap')) {
    return actualCostOverlapError();
  }
  return error;
}

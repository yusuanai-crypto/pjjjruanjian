import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  buildMoutaiLogisticsDocx,
  formatMoutaiLogisticsFileName,
  MOUTAI_LOGISTICS_TEMPLATE_VERSION,
} from './moutai-logistics-docx.helper';

const INVENTORY_MANAGEMENT_ROLES = ['admin', 'finance', 'warehouse'];
const INVENTORY_READ_ROLES = [
  'admin',
  'finance',
  'warehouse',
  'sales',
];
const INVENTORY_EXPORT_ROLES = ['admin', 'finance', 'warehouse'];
const COST_ROLES = new Set(['super_admin', 'admin', 'finance']);
const EXPORT_MAX_UNITS = 100;
const TEMPLATE_FILE_NAME = 'moutai-logistics-sheet.docx';
const UNIT_EDIT_FIELDS = [
  'moutaiName',
  'factoryDate',
  'productionBatch',
  'batchSerialNo',
  'logisticsCode',
  'purchaseCostCents',
];

@Injectable()
export class SerializedInventoryNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async list(actor: any, filters: any = {}) {
    requireAnyRole(actor, INVENTORY_MANAGEMENT_ROLES);
    const page = positiveInt(filters.page, 1, 1000000);
    const pageSize = positiveInt(
      filters.pageSize ?? filters.limit,
      20,
      100,
    );
    const where = buildInventoryWhere(filters);
    const [units, total] = await Promise.all([
      this.prisma.serializedInventoryUnit.findMany({
        where,
        include: inventoryInclude(),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.serializedInventoryUnit.count({ where }),
    ]);
    return {
      units: units.map((unit: any) => toInventoryUnitDto(unit, actor)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async listAvailable(actor: any, filters: any = {}) {
    requireAnyRole(actor, INVENTORY_READ_ROLES);
    const productId = requiredString(filters.productId, 'productId', 36);
    const product = await this.findSerializedProduct(productId);
    const units = await this.prisma.serializedInventoryUnit.findMany({
      where: {
        productId,
        status: 'AVAILABLE',
        moutaiName: { not: null },
        factoryDate: { not: null },
        productionBatch: { not: null },
        batchSerialNo: { not: null },
        logisticsCode: { not: null },
        purchaseCostCents: { not: null },
        ...(optionalString(filters.query)
          ? {
              OR: [
                {
                  normalizedMoutaiName: {
                    contains: normalizeName(filters.query),
                  },
                },
                {
                  normalizedLogisticsCode: {
                    contains: normalizeLogisticsCode(filters.query),
                  },
                },
                {
                  productionBatch: {
                    contains: optionalString(filters.query),
                  },
                },
                {
                  batchSerialNo: {
                    contains: optionalString(filters.query),
                  },
                },
              ],
            }
          : {}),
      },
      include: inventoryInclude(),
      orderBy: [{ factoryDate: 'asc' }, { logisticsCode: 'asc' }],
      take: 500,
    });
    return {
      product: {
        id: product.id,
        name: product.name,
        unit: product.unit,
        inventoryTrackingMode: 'serialized',
      },
      units: units.map((unit: any) => toSelectableInventoryUnitDto(unit)),
    };
  }

  async get(actor: any, id: string) {
    requireAnyRole(actor, INVENTORY_MANAGEMENT_ROLES);
    return toInventoryUnitDto(await this.findUnit(id), actor);
  }

  async createMany(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, INVENTORY_MANAGEMENT_ROLES);
    assertObject(payload);
    assertAllowedFields(payload, ['productId', 'defaults', 'units']);
    const productId = requiredString(payload.productId, 'productId', 36);
    await this.findSerializedProduct(productId);
    const defaults = payload.defaults ?? {};
    assertObject(defaults);
    assertAllowedFields(defaults, UNIT_EDIT_FIELDS);
    const rows = Array.isArray(payload.units) ? payload.units : [];
    if (rows.length === 0 || rows.length > 500) {
      throw validationError('units 必须包含 1 至 500 条逐瓶资料。');
    }

    const normalizedRows = rows.map((row: any, index: number) => {
      assertObject(row);
      assertAllowedFields(row, UNIT_EDIT_FIELDS);
      assertCostFieldAllowed(actor, row);
      const candidate = { ...defaults, ...row };
      assertCostFieldAllowed(actor, defaults);
      return normalizeUnitData(candidate, `units[${index}]`, actor);
    });
    const requestCodes = new Set<string>();
    for (const row of normalizedRows) {
      if (requestCodes.has(row.normalizedLogisticsCode)) {
        throw createHttpError(
          409,
          'LOGISTICS_CODE_DUPLICATE',
          `本次录入存在重复物流码：${row.logisticsCode}`,
        );
      }
      requestCodes.add(row.normalizedLogisticsCode);
    }
    const existing = await this.prisma.serializedInventoryUnit.findFirst({
      where: {
        normalizedLogisticsCode: { in: Array.from(requestCodes) },
      },
    });
    if (existing) {
      throw createHttpError(
        409,
        'LOGISTICS_CODE_DUPLICATE',
        '物流码已存在，请检查后重试。',
      );
    }

    const created = await this.prisma.$transaction(async (tx: any) => {
      const now = new Date();
      const saved: any[] = [];
      for (const row of normalizedRows) {
        try {
          saved.push(
            await tx.serializedInventoryUnit.create({
              data: {
                id: crypto.randomUUID(),
                productId,
                ...row,
                status:
                  row.purchaseCostCents === null
                    ? 'PENDING_COST'
                    : 'AVAILABLE',
                createdById: actor.id,
                updatedById: actor.id,
                createdAt: now,
                updatedAt: now,
              },
              include: inventoryInclude(),
            }),
          );
        } catch (error) {
          throw mapUniqueCodeError(error);
        }
      }
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'serialized_inventory.create',
          entityType: 'serialized_inventory_batch',
          entityId: saved[0]?.id || null,
          afterData: {
            count: saved.length,
            units: saved.map((unit) => toInventoryUnitDto(unit, actor)),
          },
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return saved;
    });
    return {
      units: created.map((unit: any) => toInventoryUnitDto(unit, actor)),
      createdCount: created.length,
    };
  }

  async update(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    return this.updateInternal(actor, id, payload, metadata, false);
  }

  async correct(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    return this.updateInternal(actor, id, payload, metadata, true);
  }

  async exportMoutaiLogisticsDocx(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, INVENTORY_EXPORT_ROLES);
    assertObject(payload);
    assertAllowedFields(payload, ['unitIds']);
    const unitIds = Array.isArray(payload.unitIds)
      ? payload.unitIds.map((id: unknown, index: number) =>
          requiredString(id, `unitIds[${index}]`, 36),
        )
      : [];
    if (unitIds.length === 0) {
      throw createHttpError(
        400,
        'SERIALIZED_INVENTORY_SELECTION_REQUIRED',
        '请至少选择一瓶茅台。',
      );
    }
    if (unitIds.length > EXPORT_MAX_UNITS) {
      throw validationError(`单次最多导出 ${EXPORT_MAX_UNITS} 瓶。`);
    }
    if (new Set(unitIds).size !== unitIds.length) {
      throw createHttpError(
        400,
        'SERIALIZED_INVENTORY_DUPLICATE_IDS',
        '导出列表包含重复库存记录。',
      );
    }

    const found = await this.prisma.serializedInventoryUnit.findMany({
      where: { id: { in: unitIds } },
      include: inventoryInclude(),
    });
    if (found.length !== unitIds.length) {
      throw createHttpError(
        404,
        'SERIALIZED_INVENTORY_NOT_FOUND',
        '部分库存记录不存在，请刷新列表后重试。',
      );
    }
    const byId = new Map(found.map((unit: any) => [unit.id, unit]));
    const ordered = unitIds.map((id: string) => byId.get(id));
    for (const unit of ordered) {
      if (unit.status === 'VOID') {
        throw createHttpError(
          400,
          'SERIALIZED_INVENTORY_INVALID_STATUS',
          '作废库存不能导出物流单。',
        );
      }
      assertUnitComplete(unit);
    }

    const template = await readTemplate();
    const buffer = await buildMoutaiLogisticsDocx(
      template,
      ordered.map((unit: any) => ({
        moutaiName: unit.moutaiName,
        factoryDate: unit.factoryDate,
        productionBatch: unit.productionBatch,
        batchSerialNo: unit.batchSerialNo,
        logisticsCode: unit.logisticsCode,
      })),
    );
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'serialized_inventory.export_moutai_logistics_docx',
      entityType: 'serialized_inventory_export',
      entityId: null,
      afterData: {
        templateVersion: MOUTAI_LOGISTICS_TEMPLATE_VERSION,
        unitIds,
        count: unitIds.length,
      },
      ipAddress: metadata.ipAddress || null,
    });
    return {
      buffer,
      fileName: formatMoutaiLogisticsFileName(unitIds.length),
      templateVersion: MOUTAI_LOGISTICS_TEMPLATE_VERSION,
    };
  }

  private async updateInternal(
    actor: any,
    id: string,
    payload: any,
    metadata: any,
    correction: boolean,
  ) {
    requireAnyRole(actor, INVENTORY_MANAGEMENT_ROLES);
    assertObject(payload);
    assertAllowedFields(
      payload,
      correction ? [...UNIT_EDIT_FIELDS, 'reason'] : UNIT_EDIT_FIELDS,
    );
    assertCostFieldAllowed(actor, payload);
    const current = await this.findUnit(id);
    if (current.salesOrderId && !correction) {
      throw createHttpError(
        409,
        'SERIALIZED_INVENTORY_ASSIGNED',
        '该库存已分配给订单，请使用“资料纠错”并填写原因。',
      );
    }
    const reason = correction
      ? requiredString(payload.reason, 'reason', 500)
      : null;
    const editablePayload = Object.fromEntries(
      Object.entries(payload).filter(([key]) =>
        UNIT_EDIT_FIELDS.includes(key),
      ),
    );
    if (Object.keys(editablePayload).length === 0) {
      throw validationError('请至少修改一个库存字段。');
    }
    const merged = {
      moutaiName: current.moutaiName,
      factoryDate: toDateString(current.factoryDate),
      productionBatch: current.productionBatch,
      batchSerialNo: current.batchSerialNo,
      logisticsCode: current.logisticsCode,
      purchaseCostCents: current.purchaseCostCents,
      ...editablePayload,
    };
    const normalized = normalizeUnitData(
      merged,
      'unit',
      actor.role === 'warehouse' ? { ...actor, role: 'finance' } : actor,
    );
    const data: any = {
      ...normalized,
      status:
        current.status === 'VOID'
          ? 'VOID'
          : normalized.purchaseCostCents === null
            ? 'PENDING_COST'
            : current.salesOrderId
              ? 'ALLOCATED'
              : 'AVAILABLE',
      updatedById: actor.id,
      updatedAt: new Date(),
      ...(correction
        ? {
            correctionReason: reason,
            correctedById: actor.id,
            correctedAt: new Date(),
          }
        : {}),
    };
    const updated = await this.prisma.$transaction(async (tx: any) => {
      let saved: any;
      try {
        saved = await tx.serializedInventoryUnit.update({
          where: { id },
          data,
          include: inventoryInclude(),
        });
      } catch (error) {
        throw mapUniqueCodeError(error);
      }
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: correction
            ? 'serialized_inventory.correct'
            : 'serialized_inventory.update',
          entityType: 'serialized_inventory_unit',
          entityId: id,
          beforeData: {
            ...toInventoryUnitDto(current, actor),
            ...(correction ? { correctionReason: reason } : {}),
          },
          afterData: toInventoryUnitDto(saved, actor),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return saved;
    });
    return toInventoryUnitDto(updated, actor);
  }

  private async findUnit(id: string) {
    const unit = await this.prisma.serializedInventoryUnit.findUnique({
      where: { id },
      include: inventoryInclude(),
    });
    if (!unit) {
      throw createHttpError(
        404,
        'SERIALIZED_INVENTORY_NOT_FOUND',
        '逐瓶库存记录不存在。',
      );
    }
    return unit;
  }

  private async findSerializedProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw createHttpError(404, 'PRODUCT_NOT_FOUND', '商品不存在。');
    }
    if (!product.isActive) {
      throw createHttpError(400, 'PRODUCT_INACTIVE', '该商品已停用。');
    }
    if (product.inventoryTrackingMode !== 'SERIALIZED') {
      throw createHttpError(
        400,
        'PRODUCT_NOT_SERIALIZED',
        '该商品未启用逐瓶库存跟踪。',
      );
    }
    return product;
  }
}

function buildInventoryWhere(filters: any) {
  const where: any = {};
  const name = optionalString(filters.moutaiName ?? filters.name);
  const logisticsCode = optionalString(filters.logisticsCode);
  const factoryDate = optionalString(filters.factoryDate);
  const productionBatch = optionalString(filters.productionBatch);
  const batchSerialNo = optionalString(filters.batchSerialNo);
  const status = optionalString(filters.status);
  const orderNo = optionalString(filters.orderNo);
  if (name) {
    where.normalizedMoutaiName = { contains: normalizeName(name) };
  }
  if (logisticsCode) {
    where.normalizedLogisticsCode = {
      contains: normalizeLogisticsCode(logisticsCode),
    };
  }
  if (factoryDate) {
    where.factoryDate = normalizeDate(factoryDate, 'factoryDate');
  }
  if (productionBatch) {
    where.productionBatch = { contains: productionBatch };
  }
  if (batchSerialNo) {
    where.batchSerialNo = { contains: batchSerialNo };
  }
  if (status) {
    where.status = normalizeStatus(status);
  }
  if (orderNo) {
    where.salesOrder = { is: { orderNo: { contains: orderNo } } };
  }
  return where;
}

function normalizeUnitData(payload: any, prefix: string, actor: any) {
  const moutaiName = requiredString(
    payload.moutaiName,
    `${prefix}.moutaiName`,
    160,
  );
  const logisticsCode = requiredString(
    payload.logisticsCode,
    `${prefix}.logisticsCode`,
    160,
  );
  const purchaseCostCents =
    payload.purchaseCostCents === undefined ||
    payload.purchaseCostCents === null ||
    payload.purchaseCostCents === ''
      ? null
      : cents(payload.purchaseCostCents, `${prefix}.purchaseCostCents`);
  if (actor.role === 'warehouse' && purchaseCostCents !== null) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      '库管无权录入或查看进货价。',
    );
  }
  return {
    moutaiName,
    normalizedMoutaiName: normalizeName(moutaiName),
    factoryDate: normalizeDate(payload.factoryDate, `${prefix}.factoryDate`),
    productionBatch: requiredString(
      payload.productionBatch,
      `${prefix}.productionBatch`,
      80,
    ),
    batchSerialNo: requiredString(
      payload.batchSerialNo,
      `${prefix}.batchSerialNo`,
      80,
    ),
    logisticsCode,
    normalizedLogisticsCode: normalizeLogisticsCode(logisticsCode),
    purchaseCostCents,
  };
}

function toInventoryUnitDto(unit: any, actor: any) {
  const dto: any = {
    id: unit.id,
    productId: unit.productId,
    productName: unit.product?.name || null,
    moutaiName: unit.moutaiName || null,
    normalizedMoutaiName: unit.normalizedMoutaiName || null,
    factoryDate: toDateString(unit.factoryDate),
    productionBatch: unit.productionBatch || null,
    batchSerialNo: unit.batchSerialNo || null,
    logisticsCode: unit.logisticsCode || null,
    status: String(unit.status || '').toLowerCase(),
    dataComplete: isUnitComplete(unit),
    salesOrder: unit.salesOrder
      ? { id: unit.salesOrder.id, orderNo: unit.salesOrder.orderNo }
      : null,
    salesOrderItemId: unit.salesOrderItemId || null,
    correctionReason: unit.correctionReason || null,
    correctedById: unit.correctedById || null,
    correctedAt: toIsoString(unit.correctedAt),
    createdById: unit.createdById || null,
    updatedById: unit.updatedById || null,
    createdAt: toIsoString(unit.createdAt),
    updatedAt: toIsoString(unit.updatedAt),
  };
  if (COST_ROLES.has(actor?.role)) {
    dto.purchaseCostCents =
      unit.purchaseCostCents === null ||
      unit.purchaseCostCents === undefined
        ? null
        : Number(unit.purchaseCostCents);
  }
  return dto;
}

function toSelectableInventoryUnitDto(unit: any) {
  return {
    id: unit.id,
    moutaiName: unit.moutaiName || null,
    factoryDate: toDateString(unit.factoryDate),
    productionBatch: unit.productionBatch || null,
    batchSerialNo: unit.batchSerialNo || null,
    logisticsCode: unit.logisticsCode || null,
  };
}

function inventoryInclude() {
  return {
    product: { select: { id: true, name: true, unit: true } },
    salesOrder: { select: { id: true, orderNo: true } },
  };
}

function isUnitComplete(unit: any) {
  return Boolean(
    optionalString(unit.moutaiName) &&
      unit.factoryDate &&
      optionalString(unit.productionBatch) &&
      optionalString(unit.batchSerialNo) &&
      optionalString(unit.logisticsCode),
  );
}

function assertUnitComplete(unit: any) {
  if (!isUnitComplete(unit)) {
    throw createHttpError(
      400,
      'SERIALIZED_INVENTORY_DATA_INCOMPLETE',
      `库存资料不完整（物流码：${unit.logisticsCode || '未录入'}），无法导出。`,
    );
  }
}

async function readTemplate() {
  const candidates = [
    path.resolve(process.cwd(), 'assets', 'templates', TEMPLATE_FILE_NAME),
    path.resolve(
      __dirname,
      '..',
      '..',
      'assets',
      'templates',
      TEMPLATE_FILE_NAME,
    ),
    path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'assets',
      'templates',
      TEMPLATE_FILE_NAME,
    ),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  throw createHttpError(
    500,
    'MOUTAI_LOGISTICS_TEMPLATE_MISSING',
    '茅台物流单模板缺失，请联系管理员。',
  );
}

function assertCostFieldAllowed(actor: any, payload: any) {
  if (
    actor?.role === 'warehouse' &&
    Object.prototype.hasOwnProperty.call(payload, 'purchaseCostCents')
  ) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      '库管无权录入或修改进货价。',
    );
  }
}

function normalizeName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeLogisticsCode(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function normalizeDate(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${fieldName} 必须使用 YYYY-MM-DD 格式。`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw validationError(`${fieldName} 不是有效日期。`);
  }
  return date;
}

function normalizeStatus(value: unknown) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (
    !['PENDING_COST', 'AVAILABLE', 'ALLOCATED', 'VOID'].includes(normalized)
  ) {
    throw validationError('status 无效。');
  }
  return normalized;
}

function requiredString(value: unknown, fieldName: string, maxLength: number) {
  const text = optionalString(value);
  if (!text) {
    throw validationError(`${fieldName} 不能为空。`);
  }
  if (text.length > maxLength) {
    throw validationError(`${fieldName} 不能超过 ${maxLength} 个字符。`);
  }
  return text;
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function cents(value: unknown, fieldName: string) {
  const numberValue = Number(value);
  if (
    !Number.isInteger(numberValue) ||
    numberValue < 0 ||
    numberValue > 2147483647
  ) {
    throw validationError(`${fieldName} 必须是非负整数分。`);
  }
  return numberValue;
}

function positiveInt(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw validationError('分页参数必须是正整数。');
  }
  return Math.min(numberValue, max);
}

function toDateString(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toIsoString(value: unknown) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function assertObject(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('请求体必须是对象。');
  }
}

function assertAllowedFields(payload: any, allowedFields: string[]) {
  const allowed = new Set(allowedFields);
  const unsupported = Object.keys(payload).find((key) => !allowed.has(key));
  if (unsupported) {
    throw validationError(`不支持字段：${unsupported}。`);
  }
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
      '您没有权限执行此操作。',
    );
  }
}

function validationError(message: string) {
  return createHttpError(400, 'VALIDATION_FAILED', message);
}

function mapUniqueCodeError(error: any) {
  if (error?.code === 'P2002') {
    return createHttpError(
      409,
      'LOGISTICS_CODE_DUPLICATE',
      '物流码已存在，请检查后重试。',
    );
  }
  return error;
}

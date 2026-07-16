import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

const PRODUCT_MANAGEMENT_ROLES = ['admin', 'finance'];
const PRODUCT_OPTION_ROLES = [
  'admin',
  'boss',
  'front_desk',
  'sales',
  'finance',
  'after_sales',
];
const MAX_EFFECTIVE_DATE = new Date('9999-12-31T00:00:00.000Z');

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
      },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
    }));
  }

  async getProduct(actor: any, id: string) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    return toProductDto(await this.findProductOrThrow(id));
  }

  async createProduct(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, ['name', 'unit', 'isActive', 'notes']);
    const now = new Date();
    const name = normalizeLimitedRequiredString(payload.name, 'name', 160);
    const normalizedName = normalizeProductName(name);
    await this.assertUniqueProductName(normalizedName);
    const data = {
      id: crypto.randomUUID(),
      name,
      normalizedName,
      unit: normalizeLimitedRequiredString(payload.unit, 'unit', 20),
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

  async updateProduct(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, PRODUCT_MANAGEMENT_ROLES);
    assertObjectPayload(payload);
    assertAllowedFields(payload, ['name', 'unit', 'notes']);
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
    isActive: Boolean(product.isActive),
    notes: product.notes || null,
    createdById: product.createdById || null,
    updatedById: product.updatedById || null,
    createdAt: toIsoString(product.createdAt),
    updatedAt: toIsoString(product.updatedAt),
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

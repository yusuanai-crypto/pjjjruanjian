import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

const MAINTENANCE_ROLES = new Set(['super_admin', 'admin', 'finance']);
const READ_ROLES = new Set([
  'super_admin',
  'admin',
  'boss',
  'front_desk',
  'sales',
  'finance',
  'warehouse',
  'after_sales',
  'taster',
]);
const PAYMENT_METHOD_CATEGORIES = new Set([
  'DIRECT_RECEIPT',
  'COLLECT_ON_DELIVERY',
]);
const MAX_SORT_ORDER = 2_147_483_647;

type MutationMetadata = {
  ipAddress?: string | null;
};

@Injectable()
export class PaymentMethodsNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async list(actor: any, filters: unknown = {}) {
    requireReadableRole(actor);
    const query = normalizeObject(filters, 'payment method filters');
    assertAllowedFields(query, ['includeInactive'], 'payment method filters');
    const includeInactive =
      isMaintenanceActor(actor) &&
      normalizeOptionalBoolean(
        query.includeInactive,
        'includeInactive',
        false,
      );
    const methods = await this.prisma.paymentMethod.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [
        { sortOrder: 'asc' },
        { name: 'asc' },
        { id: 'asc' },
      ],
    });
    return methods.map(toPaymentMethodDto);
  }

  async create(
    actor: any,
    payload: unknown,
    metadata: MutationMetadata = {},
  ) {
    requireMaintenanceRole(actor);
    const input = normalizeCreatePayload(payload);
    try {
      const created = await this.prisma.$transaction(async (tx: any) => {
        await assertNameAvailable(tx, input.name);
        const now = new Date();
        const previousDefaults = input.isDefault
          ? await tx.paymentMethod.findMany({
              where: { isDefault: true },
            })
          : [];
        if (input.isDefault) {
          await tx.paymentMethod.updateMany({
            where: { isDefault: true },
            data: {
              isDefault: false,
              updatedById: actor.id,
              updatedAt: now,
            },
          });
        }
        const method = await tx.paymentMethod.create({
          data: {
            id: crypto.randomUUID(),
            code: input.code,
            name: input.name,
            category: input.category,
            serviceFeeRate: input.serviceFeeRate,
            isActive: input.isDefault ? true : input.isActive,
            sortOrder: input.sortOrder,
            isDefault: input.isDefault,
            createdById: actor.id,
            updatedById: actor.id,
            createdAt: now,
            updatedAt: now,
          },
        });
        await assertSingleActiveDefault(tx);
        await this.logClearedDefaults(
          tx,
          actor,
          previousDefaults,
          method.id,
          now,
          metadata,
        );
        await this.appendLog(
          tx,
          actor,
          'payment_methods.create',
          null,
          method,
          metadata,
        );
        return method;
      });
      return toPaymentMethodDto(created);
    } catch (error) {
      throw mapPaymentMethodUniqueError(error);
    }
  }

  async update(
    actor: any,
    id: string,
    payload: unknown,
    metadata: MutationMetadata = {},
  ) {
    requireMaintenanceRole(actor);
    const input = normalizeUpdatePayload(payload);
    return this.updateOne(
      actor,
      normalizeId(id),
      input,
      'payment_methods.update',
      metadata,
    );
  }

  async enable(
    actor: any,
    id: string,
    metadata: MutationMetadata = {},
  ) {
    requireMaintenanceRole(actor);
    return this.updateOne(
      actor,
      normalizeId(id),
      { isActive: true },
      'payment_methods.enable',
      metadata,
    );
  }

  async disable(
    actor: any,
    id: string,
    metadata: MutationMetadata = {},
  ) {
    requireMaintenanceRole(actor);
    return this.updateOne(
      actor,
      normalizeId(id),
      { isActive: false },
      'payment_methods.disable',
      metadata,
    );
  }

  async setDefault(
    actor: any,
    id: string,
    metadata: MutationMetadata = {},
  ) {
    requireMaintenanceRole(actor);
    return this.updateOne(
      actor,
      normalizeId(id),
      { isActive: true, isDefault: true },
      'payment_methods.set_default',
      metadata,
    );
  }

  async sort(
    actor: any,
    payload: unknown,
    metadata: MutationMetadata = {},
  ) {
    requireMaintenanceRole(actor);
    const items = normalizeSortPayload(payload);
    const methods = await this.prisma.$transaction(async (tx: any) => {
      const ids = items.map((item) => item.id);
      const currentRows = await tx.paymentMethod.findMany({
        where: {
          id: { in: ids },
        },
      });
      if (currentRows.length !== ids.length) {
        throw createHttpError(
          404,
          'PAYMENT_METHOD_NOT_FOUND',
          'One or more payment methods do not exist.',
        );
      }
      const currentById = new Map(
        currentRows.map((method: any) => [method.id, method]),
      );
      const now = new Date();
      for (const item of items) {
        const before: any = currentById.get(item.id);
        if (Number(before.sortOrder) === item.sortOrder) {
          continue;
        }
        const after = await tx.paymentMethod.update({
          where: { id: item.id },
          data: {
            sortOrder: item.sortOrder,
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        await this.appendLog(
          tx,
          actor,
          'payment_methods.sort',
          before,
          after,
          metadata,
        );
      }
      await assertSingleActiveDefault(tx);
      return tx.paymentMethod.findMany({
        orderBy: [
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
      });
    });
    return methods.map(toPaymentMethodDto);
  }

  private async updateOne(
    actor: any,
    id: string,
    input: Record<string, unknown>,
    action: string,
    metadata: MutationMetadata,
  ) {
    try {
      const updated = await this.prisma.$transaction(async (tx: any) => {
        const current = await tx.paymentMethod.findUnique({
          where: { id },
        });
        if (!current) {
          throw createHttpError(
            404,
            'PAYMENT_METHOD_NOT_FOUND',
            'Payment method does not exist.',
          );
        }
        if (
          current.isDefault &&
          (input.isDefault === false || input.isActive === false)
        ) {
          throw createHttpError(
            409,
            'DEFAULT_PAYMENT_METHOD_REQUIRED',
            'Set another active payment method as default before disabling the current default.',
          );
        }
        if (
          typeof input.name === 'string' &&
          input.name !== current.name
        ) {
          await assertNameAvailable(tx, input.name, current.id);
        }

        const now = new Date();
        const setAsDefault = input.isDefault === true;
        const previousDefaults = setAsDefault
          ? await tx.paymentMethod.findMany({
              where: { isDefault: true },
            })
          : [];
        if (setAsDefault) {
          await tx.paymentMethod.updateMany({
            where: {
              isDefault: true,
              id: { not: current.id },
            },
            data: {
              isDefault: false,
              updatedById: actor.id,
              updatedAt: now,
            },
          });
        }
        const method = await tx.paymentMethod.update({
          where: { id: current.id },
          data: {
            ...input,
            ...(setAsDefault ? { isActive: true } : {}),
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        await assertSingleActiveDefault(tx);
        await this.logClearedDefaults(
          tx,
          actor,
          previousDefaults,
          current.id,
          now,
          metadata,
        );
        await this.appendLog(
          tx,
          actor,
          action,
          current,
          method,
          metadata,
        );
        return method;
      });
      return toPaymentMethodDto(updated);
    } catch (error) {
      throw mapPaymentMethodUniqueError(error);
    }
  }

  private async logClearedDefaults(
    tx: any,
    actor: any,
    previousDefaults: any[],
    nextDefaultId: string,
    updatedAt: Date,
    metadata: MutationMetadata,
  ) {
    for (const previous of previousDefaults) {
      if (previous.id === nextDefaultId || !previous.isDefault) {
        continue;
      }
      await this.appendLog(
        tx,
        actor,
        'payment_methods.set_default',
        previous,
        {
          ...previous,
          isDefault: false,
          updatedById: actor.id,
          updatedAt,
        },
        metadata,
      );
    }
  }

  private async appendLog(
    tx: any,
    actor: any,
    action: string,
    before: any,
    after: any,
    metadata: MutationMetadata,
  ) {
    await this.operationLogsService.appendLog(
      {
        userId: actor.id,
        action,
        entityType: 'payment_method',
        entityId: after?.id || before?.id || null,
        beforeData: before ? toPaymentMethodDto(before) : null,
        afterData: after ? toPaymentMethodDto(after) : null,
        ipAddress: metadata.ipAddress || null,
      },
      tx,
    );
  }
}

function normalizeCreatePayload(payload: unknown) {
  const body = normalizeObject(payload, 'payment method');
  assertAllowedFields(
    body,
    [
      'code',
      'name',
      'category',
      'serviceFeeRate',
      'isActive',
      'sortOrder',
      'isDefault',
    ],
    'payment method',
  );
  const isDefault = normalizeOptionalBoolean(
    body.isDefault,
    'isDefault',
    false,
  );
  return {
    code:
      body.code === undefined
        ? `custom_${crypto.randomUUID().replace(/-/g, '')}`
        : normalizeCode(body.code),
    name: normalizeName(body.name),
    category: normalizeCategory(body.category ?? 'direct_receipt'),
    serviceFeeRate: normalizeNullableProportion(
      body.serviceFeeRate,
      'serviceFeeRate',
    ),
    isActive: isDefault
      ? true
      : normalizeOptionalBoolean(body.isActive, 'isActive', true),
    sortOrder: normalizeSortOrder(body.sortOrder, 'sortOrder', 0),
    isDefault,
  };
}

function normalizeUpdatePayload(payload: unknown) {
  const body = normalizeObject(payload, 'payment method');
  if (Object.prototype.hasOwnProperty.call(body, 'code')) {
    throw createHttpError(
      409,
      'PAYMENT_METHOD_CODE_IMMUTABLE',
      'Payment method code cannot be changed after creation.',
    );
  }
  assertAllowedFields(
    body,
    [
      'name',
      'category',
      'serviceFeeRate',
      'isActive',
      'sortOrder',
      'isDefault',
    ],
    'payment method',
  );
  if (Object.keys(body).length === 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'At least one payment method field is required.',
    );
  }
  const data: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    data.name = normalizeName(body.name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'category')) {
    data.category = normalizeCategory(body.category);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'serviceFeeRate')) {
    data.serviceFeeRate = normalizeNullableProportion(
      body.serviceFeeRate,
      'serviceFeeRate',
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
    data.isActive = normalizeRequiredBoolean(body.isActive, 'isActive');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    data.sortOrder = normalizeSortOrder(body.sortOrder, 'sortOrder');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isDefault')) {
    data.isDefault = normalizeRequiredBoolean(body.isDefault, 'isDefault');
    if (data.isDefault === true) {
      data.isActive = true;
    }
  }
  return data;
}

function normalizeSortPayload(payload: unknown) {
  const body = normalizeObject(payload, 'payment method sort');
  assertAllowedFields(body, ['items'], 'payment method sort');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'items must contain at least one payment method.',
    );
  }
  const ids = new Set<string>();
  return body.items.map((value: unknown, index: number) => {
    const item = normalizeObject(value, `items[${index}]`);
    assertAllowedFields(item, ['id', 'sortOrder'], `items[${index}]`);
    const id = normalizeId(item.id, `items[${index}].id`);
    if (ids.has(id)) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `items[${index}].id is duplicated.`,
      );
    }
    ids.add(id);
    return {
      id,
      sortOrder: normalizeSortOrder(
        item.sortOrder,
        `items[${index}].sortOrder`,
      ),
    };
  });
}

function normalizeObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${label} must be an object.`,
    );
  }
  return value as Record<string, any>;
}

function assertAllowedFields(
  value: Record<string, any>,
  allowedFields: string[],
  label: string,
) {
  const allowed = new Set(allowedFields);
  const denied = Object.keys(value).filter((field) => !allowed.has(field));
  if (denied.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for ${label}: ${denied.join(', ')}.`,
    );
  }
}

function normalizeCode(value: unknown) {
  const code = normalizeRequiredString(value, 'code', 64);
  if (!/^[a-z][a-z0-9_]*$/.test(code)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'code must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.',
    );
  }
  return code;
}

function normalizeName(value: unknown) {
  return normalizeRequiredString(value, 'name', 80);
}

function normalizeNullableProportion(
  value: unknown,
  fieldName: string,
) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized =
    typeof value === 'string'
      ? canonicalizeProportion(value.trim())
      : null;
  if (normalized === null) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be an exact decimal string between 0 and 1 with at most 6 decimal places, or null.`,
    );
  }
  return normalized;
}

function canonicalizeProportion(value: string) {
  const match = /^(0|1)(?:\.(\d{1,6}))?$/.exec(value);
  if (
    !match ||
    (match[1] === '1' && Boolean(match[2]?.replace(/0/g, '')))
  ) {
    return null;
  }
  return `${match[1]}.${(match[2] || '').padEnd(6, '0')}`;
}

function normalizeId(value: unknown, fieldName = 'id') {
  return normalizeRequiredString(value, fieldName, 36);
}

function normalizeRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must not exceed ${maxLength} characters.`,
    );
  }
  return text;
}

function normalizeCategory(value: unknown) {
  let category = String(value || '')
    .trim()
    .toUpperCase();
  if (category === 'AGENCY_COLLECTION') {
    category = 'COLLECT_ON_DELIVERY';
  }
  if (!PAYMENT_METHOD_CATEGORIES.has(category)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'category must be direct_receipt or collect_on_delivery.',
    );
  }
  return category;
}

function normalizeOptionalBoolean(
  value: unknown,
  fieldName: string,
  fallback: boolean,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return normalizeRequiredBoolean(value, fieldName);
}

function normalizeRequiredBoolean(value: unknown, fieldName: string) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (
    value === false ||
    value === 'false' ||
    value === 0 ||
    value === '0'
  ) {
    return false;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a boolean.`,
  );
}

function normalizeSortOrder(
  value: unknown,
  fieldName: string,
  fallback?: number,
) {
  if (
    (value === undefined || value === null || value === '') &&
    fallback !== undefined
  ) {
    return fallback;
  }
  const numberValue = Number(value);
  if (
    !Number.isInteger(numberValue) ||
    numberValue < 0 ||
    numberValue > MAX_SORT_ORDER
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be an integer between 0 and ${MAX_SORT_ORDER}.`,
    );
  }
  return numberValue;
}

async function assertNameAvailable(
  tx: any,
  name: string,
  excludedId?: string,
) {
  const existing = await tx.paymentMethod.findFirst({
    where: {
      name,
      ...(excludedId ? { id: { not: excludedId } } : {}),
    },
  });
  if (existing) {
    throw createHttpError(
      409,
      'PAYMENT_METHOD_NAME_EXISTS',
      'Payment method name already exists.',
    );
  }
}

async function assertSingleActiveDefault(tx: any) {
  const defaults = await tx.paymentMethod.findMany({
    where: { isDefault: true },
  });
  if (defaults.length !== 1 || defaults[0].isActive !== true) {
    throw createHttpError(
      409,
      'DEFAULT_PAYMENT_METHOD_REQUIRED',
      'Exactly one active default payment method is required.',
    );
  }
}

function requireReadableRole(actor: any) {
  if (!READ_ROLES.has(normalizeRole(actor?.role))) {
    throwPermissionDenied();
  }
}

function requireMaintenanceRole(actor: any) {
  if (!isMaintenanceActor(actor)) {
    throwPermissionDenied();
  }
}

function isMaintenanceActor(actor: any) {
  return MAINTENANCE_ROLES.has(normalizeRole(actor?.role));
}

function normalizeRole(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function throwPermissionDenied(): never {
  throw createHttpError(
    403,
    'PERMISSION_DENIED',
    'You do not have permission to perform this action.',
  );
}

function mapPaymentMethodUniqueError(error: any): any {
  if (error?.code !== 'P2002') {
    return error;
  }
  const target = Array.isArray(error?.meta?.target)
    ? error.meta.target.join(' ').toLowerCase()
    : String(error?.meta?.target || '').toLowerCase();
  if (target.includes('name')) {
    return createHttpError(
      409,
      'PAYMENT_METHOD_NAME_EXISTS',
      'Payment method name already exists.',
    );
  }
  if (target.includes('code')) {
    return createHttpError(
      409,
      'PAYMENT_METHOD_CODE_EXISTS',
      'Payment method code already exists.',
    );
  }
  return createHttpError(
    409,
    'PAYMENT_METHOD_UNIQUE_CONFLICT',
    'Payment method conflicts with an existing record.',
  );
}

function toPaymentMethodDto(method: any) {
  return {
    id: String(method.id),
    code: String(method.code),
    name: String(method.name),
    category: normalizeDtoCategory(method.category),
    serviceFeeRate:
      method.serviceFeeRate === null ||
      method.serviceFeeRate === undefined
        ? null
        : canonicalizeProportion(String(method.serviceFeeRate)) ||
          String(method.serviceFeeRate),
    isActive: Boolean(method.isActive),
    isDefault: Boolean(method.isDefault),
    sortOrder: Number(method.sortOrder || 0),
    createdById: method.createdById || null,
    updatedById: method.updatedById || null,
    createdAt: toIsoString(method.createdAt),
    updatedAt: toIsoString(method.updatedAt),
  };
}

function normalizeDtoCategory(value: unknown) {
  const category = String(value || 'DIRECT_RECEIPT').toUpperCase();
  return category === 'AGENCY_COLLECTION'
    ? 'collect_on_delivery'
    : category.toLowerCase();
}

function toIsoString(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

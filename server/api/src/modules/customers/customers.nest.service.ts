import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildGlobalCustomerMarkScope as buildSharedGlobalCustomerMarkScope,
} from '../analytics/analytics-scope.helper';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  buildShanghaiNaturalDayRange,
  formatShanghaiBusinessDate,
} from '../business-data/reconciliation-calculation.helper';

const CUSTOMER_READ_ROLES = ['admin', 'boss', 'sales', 'finance', 'after_sales'];
const CUSTOMER_CREATE_ROLES = ['admin', 'sales', 'after_sales'];
const CUSTOMER_UPDATE_ROLES = ['admin', 'sales', 'after_sales', 'finance'];
const CUSTOMER_FINANCE_MARK_ROLES = ['admin', 'finance'];
const TASTER_COMMISSION_TARGET_TYPE = 'TASTER_COMMISSION';
const CUSTOMER_PATCH_FIELDS = [
  'name',
  'phone',
  'province',
  'city',
  'district',
  'address',
  'notes',
];

const ORDER_TYPE_FROM_PRISMA: any = {
  TRAVEL_GROUP: 'travel_group',
  BUYBACK: 'buyback',
  EXTERNAL: 'external',
  INTERNAL: 'internal',
  AFTER_SALES: 'after_sales',
};

const ORDER_STATUS_FROM_PRISMA: any = {
  VALID: 'valid',
  PARTIAL_REFUND: 'partial_refund',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
};

const DELIVERY_TYPE_FROM_PRISMA: any = {
  SELF_PICKUP: 'self_pickup',
  SHIPPING: 'shipping',
};

const PACKING_STATUS_FROM_PRISMA: any = {
  PENDING: 'pending',
  PACKING: 'packing',
  PACKED: 'packed',
  ABNORMAL: 'abnormal',
};

@Injectable()
export class CustomersNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
  ) {}

  async listCustomers(actor: any, filters: any = {}) {
    requireAnyRole(actor, CUSTOMER_READ_ROLES);
    const customers = await this.prisma.customer.findMany({
      where: await this.buildScopedCustomerWhere(actor, buildCustomerWhere(filters)),
      orderBy: {
        updatedAt: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return customers.map((customer: any) => toCustomerDto(customer));
  }

  async createCustomer(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, CUSTOMER_CREATE_ROLES);
    const created = await this.prisma.customer.create({
      data: buildCustomerData(payload, true, actor),
    });
    const dto = toCustomerDto(created);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'customers.create',
      entityType: 'customer',
      entityId: created.id,
      afterData: dto,
      ipAddress: metadata.ipAddress || null,
    });
    return dto;
  }

  async getCustomer(actor: any, id: string) {
    requireAnyRole(actor, CUSTOMER_READ_ROLES);
    const customer = await this.findReadableCustomerOrThrow(actor, id);
    await this.assertPassesGlobalCustomerMarkScope(customer);
    const recentOrders = await this.prisma.salesOrder.findMany({
      where: this.buildCustomerRecentOrderWhere(actor, id),
      include: {
        items: true,
        travelGroup: true,
        paymentDetails: {
          select: {
            amountCents: true,
            paymentMethodCategorySnapshot: true,
          },
          orderBy: {
            sortOrder: 'asc',
          },
        },
        commissionRecords: {
          where: {
            targetType: TASTER_COMMISSION_TARGET_TYPE,
            manualInput: true,
          },
          include: {
            confirmedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });
    return toCustomerDto(customer, recentOrders);
  }

  async updateCustomer(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, CUSTOMER_UPDATE_ROLES);
    assertCustomerPatchAllowedFields(payload);
    const current = await this.findReadableCustomerOrThrow(actor, id);
    const updated = await this.prisma.customer.update({
      where: {
        id,
      },
      data: buildCustomerData(payload, false, actor),
    });
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'customers.update',
      entityType: 'customer',
      entityId: updated.id,
      beforeData: toCustomerDto(current),
      afterData: toCustomerDto(updated),
      ipAddress: metadata.ipAddress || null,
    });
    return toCustomerDto(updated);
  }

  async setCustomerFinanceMark(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, CUSTOMER_FINANCE_MARK_ROLES);
    const current = await this.findCustomerOrThrow(id);
    const marked = normalizeBoolean(
      payload?.financeMark ?? payload?.marked,
      'financeMark',
    );
    const updated = await this.prisma.customer.update({
      where: {
        id,
      },
      data: buildFinanceMarkData(marked, actor),
    });
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `customers.finance_mark.${marked ? 'enable' : 'disable'}`,
      entityType: 'customer',
      entityId: updated.id,
      beforeData: toCustomerDto(current),
      afterData: toCustomerDto(updated),
      ipAddress: metadata.ipAddress || null,
    });
    return toCustomerDto(updated);
  }

  private async buildScopedCustomerWhere(actor: any, baseWhere: any) {
    return andWhere(
      andWhere(baseWhere, await this.buildCustomerDataScope(actor)),
      await this.buildGlobalCustomerMarkScope(),
    );
  }

  private async buildCustomerDataScope(actor: any) {
    if (actor?.role !== 'sales') {
      return null;
    }

    const orders = await this.prisma.salesOrder.findMany({
      where: buildSalesOrderDataScope(actor),
    });
    const customerIds = Array.from(
      new Set(
        orders
          .map((order: any) => order.customerId)
          .filter((customerId: any) => typeof customerId === 'string' && customerId.length > 0),
      ),
    );
    const scopeOr: any[] = [{ createdById: actor.id }];
    if (customerIds.length > 0) {
      scopeOr.push({
        id: {
          in: customerIds,
        },
      });
    }
    return {
      OR: scopeOr,
    };
  }

  private buildCustomerRecentOrderWhere(actor: any, customerId: string) {
    if (actor?.role !== 'sales') {
      return { customerId };
    }
    return andWhere({ customerId }, buildSalesOrderDataScope(actor));
  }

  private async findReadableCustomerOrThrow(actor: any, id: string) {
    const customer = await this.findCustomerOrThrow(id);
    await this.assertCanReadCustomer(actor, customer);
    return customer;
  }

  private async findCustomerOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id,
      },
    });
    if (!customer) {
      throw createHttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer does not exist.');
    }
    return customer;
  }

  private async assertCanReadCustomer(actor: any, customer: any) {
    if (actor?.role !== 'sales') {
      return;
    }
    if (customer.createdById === actor.id) {
      return;
    }
    const orders = await this.prisma.salesOrder.findMany({
      where: andWhere({ customerId: customer.id }, buildSalesOrderDataScope(actor)),
      take: 1,
    });
    if (orders.length > 0) {
      return;
    }
    throw createHttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer does not exist.');
  }

  private async buildGlobalCustomerMarkScope() {
    return buildSharedGlobalCustomerMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async assertPassesGlobalCustomerMarkScope(customer: any) {
    if ((await this.onlyShowMarkedRecords()) && !customer.financeMark) {
      throw createHttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer does not exist.');
    }
  }

  private async onlyShowMarkedRecords() {
    const settings = await this.settingsService.getGlobalMarkQuery();
    return Boolean(settings.onlyShowMarkedRecords);
  }
}

function buildCustomerWhere(filters: any = {}) {
  const where: any = {};
  const keyword = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { phone: { contains: keyword } },
      { province: { contains: keyword } },
      { city: { contains: keyword } },
      { district: { contains: keyword } },
      { address: { contains: keyword } },
      { notes: { contains: keyword } },
    ];
  }

  const phone = normalizeOptionalString(filters.phone);
  if (phone) {
    where.phone = {
      contains: phone,
    };
  }

  if (filters.financeMark !== undefined && filters.financeMark !== '') {
    where.financeMark = normalizeBoolean(filters.financeMark, 'financeMark');
  }

  return where;
}

function buildCustomerData(payload: any, creating: boolean, actor: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  assignRequiredString(data, 'name', payload?.name, creating, 'name', 100);
  assignOptionalString(data, 'phone', payload?.phone, 'phone', 30);
  assignOptionalString(data, 'province', payload?.province, 'province', 60);
  assignOptionalString(data, 'city', payload?.city, 'city', 60);
  assignOptionalString(data, 'district', payload?.district, 'district', 60);
  assignOptionalString(data, 'address', payload?.address, 'address', 255);
  assignNullableString(data, 'notes', payload?.notes);

  if (creating) {
    data.id = crypto.randomUUID();
    data.financeMark = false;
    data.markedById = null;
    data.markedAt = null;
    data.createdById = actor.id;
    data.createdAt = now;
  }

  return data;
}

function buildFinanceMarkData(marked: boolean, actor: any) {
  const now = new Date();
  return {
    financeMark: marked,
    markedById: actor.id,
    markedAt: now,
    updatedById: actor.id,
    updatedAt: now,
  };
}

function buildSalesOrderDataScope(actor: any) {
  if (actor?.role !== 'sales') {
    return null;
  }
  const businessDate = formatShanghaiBusinessDate(new Date());
  const range = buildShanghaiNaturalDayRange(businessDate)!;
  return {
    salesUserId: actor.id,
    createdAt: {
      gte: range.start,
      lt: new Date(range.end.getTime() + 1),
    },
  };
}

function assertCustomerPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(CUSTOMER_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter((field) => !allowedFields.has(field));
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed here: ${deniedFields.join(', ')}.`,
    );
  }
}

function assignRequiredString(
  data: any,
  key: string,
  value: unknown,
  required: boolean,
  fieldName: string,
  maxLength: number,
) {
  if (value === undefined && !required) {
    return;
  }
  const text = normalizeRequiredString(value, fieldName);
  if (text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  data[key] = text;
}

function assignOptionalString(
  data: any,
  key: string,
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  if (value === undefined) {
    return;
  }
  const text = normalizeOptionalString(value);
  if (text && text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  data[key] = text;
}

function assignNullableString(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = normalizeOptionalString(value);
  }
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
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

function normalizeBoolean(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(text)) {
    return false;
  }
  throw createHttpError(
    400,
    'VALIDATION_FAILED',
    `${fieldName} must be a boolean.`,
  );
}

function normalizeTake(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'limit must be a number.');
  }
  return Math.min(Math.max(Math.trunc(numberValue), 1), 200);
}

function andWhere(baseWhere: any, scopeWhere: any) {
  if (!scopeWhere || Object.keys(scopeWhere).length === 0) {
    return baseWhere;
  }
  if (!baseWhere || Object.keys(baseWhere).length === 0) {
    return scopeWhere;
  }
  return {
    AND: [baseWhere, scopeWhere],
  };
}

function toCustomerDto(customer: any, recentOrders?: any[]) {
  const dto: any = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone || null,
    province: customer.province || null,
    city: customer.city || null,
    district: customer.district || null,
    address: customer.address || null,
    financeMark: Boolean(customer.financeMark),
    markedById: customer.markedById || null,
    markedAt: customer.markedAt ? toIsoString(customer.markedAt) : null,
    notes: customer.notes || null,
    createdById: customer.createdById || null,
    updatedById: customer.updatedById || null,
    createdAt: toIsoString(customer.createdAt),
    updatedAt: toIsoString(customer.updatedAt),
  };
  if (recentOrders) {
    dto.recentOrders = recentOrders.map(toCustomerOrderSummaryDto);
  }
  return dto;
}

function toCustomerOrderSummaryDto(order: any) {
  const tasterCommission = toCustomerOrderTasterCommissionDto(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: ORDER_TYPE_FROM_PRISMA[order.orderType] || order.orderType,
    orderDate: formatDate(order.orderDate),
    customerName: order.customerName,
    customerPhone: order.customerPhone || null,
    travelGroupId: order.travelGroupId || null,
    travelGroup: order.travelGroup
      ? {
          id: order.travelGroup.id,
          groupNo: order.travelGroup.groupNo,
          travelAgency: order.travelGroup.travelAgency || null,
          financeMark: Boolean(order.travelGroup.financeMark),
        }
      : null,
    totalAmountCents: Number(order.totalAmountCents || 0),
    tasterCommissionCents: tasterCommission?.amountCents ?? 0,
    tasterCommission,
    cashOnDeliveryAmountCents:
      getSalesOrderCollectOnDeliveryAmountCents(order),
    status: ORDER_STATUS_FROM_PRISMA[order.status] || order.status,
    packingStatus:
      PACKING_STATUS_FROM_PRISMA[order.packingStatus] || order.packingStatus || null,
    logisticsNo: order.logisticsNo || null,
    financeMark: Boolean(order.financeMark),
    salesUserId: order.salesUserId || null,
    deliverySummary: buildDeliverySummary(order),
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
  };
}

function getSalesOrderCollectOnDeliveryAmountCents(order: any) {
  const paymentDetails = Array.isArray(order?.paymentDetails)
    ? order.paymentDetails
    : [];
  if (paymentDetails.length === 0) {
    return Number(order?.cashOnDeliveryAmountCents || 0);
  }
  return paymentDetails
    .filter((detail: any) => {
      const category = String(
        detail?.paymentMethodCategorySnapshot || '',
      )
        .trim()
        .toLowerCase();
      return (
        category === 'collect_on_delivery' ||
        category === 'agency_collection'
      );
    })
    .reduce(
      (sum: number, detail: any) =>
        sum + Number(detail?.amountCents || 0),
      0,
    );
}

function toCustomerOrderTasterCommissionDto(order: any) {
  const records = (
    Array.isArray(order.commissionRecords) ? order.commissionRecords : []
  )
    .filter(
      (record: any) =>
        record?.salesOrderId === order.id &&
        record?.targetType === TASTER_COMMISSION_TARGET_TYPE &&
        Boolean(record?.manualInput) &&
        (!order.travelGroup?.tasterId ||
          record?.targetUserId === order.travelGroup.tasterId),
    )
    .sort(
      (left: any, right: any) =>
        new Date(right.updatedAt || right.createdAt || 0).getTime() -
        new Date(left.updatedAt || left.createdAt || 0).getTime(),
    );
  const record = records[0];
  if (!record) {
    return null;
  }
  return {
    recordId: record.id,
    amountCents: Number(record.amountCents || 0),
    isConfirmed: Boolean(record.isConfirmed),
    confirmedById: record.confirmedById || null,
    confirmedByName: record.confirmedBy?.name || null,
    confirmedAt: record.confirmedAt ? toIsoString(record.confirmedAt) : null,
  };
}

function buildDeliverySummary(order: any) {
  const items = Array.isArray(order.items) ? order.items : [];
  const deliveryTypes = Array.from(
    new Set(
      items
        .map((item: any) => DELIVERY_TYPE_FROM_PRISMA[item.deliveryType] || item.deliveryType)
        .filter(Boolean),
    ),
  ).sort();
  return deliveryTypes.length > 0 ? deliveryTypes.join(',') : null;
}

function formatDate(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
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

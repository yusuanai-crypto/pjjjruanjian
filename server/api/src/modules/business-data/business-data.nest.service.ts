import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';

const GROUP_TABLES: any = {
  travel: {
    delegate: 'travelGroup',
    entityType: 'travel_group',
    logPrefix: 'travel_groups',
  },
  guideCarried: {
    delegate: 'guideCarriedGroup',
    entityType: 'guide_carried_group',
    logPrefix: 'guide_carried_groups',
  },
  pending: {
    delegate: 'pendingTravelGroup',
    entityType: 'pending_travel_group',
    logPrefix: 'pending_travel_groups',
  },
};

const GROUP_STATUS_TO_PRISMA: any = {
  unmarked: 'UNMARKED',
  pending_summary: 'PENDING_SUMMARY',
  ordered: 'ORDERED',
  UNMARKED: 'UNMARKED',
  PENDING_SUMMARY: 'PENDING_SUMMARY',
  ORDERED: 'ORDERED',
};

const GROUP_STATUS_FROM_PRISMA: any = {
  UNMARKED: 'unmarked',
  PENDING_SUMMARY: 'pending_summary',
  ORDERED: 'ordered',
};

const ORDER_TYPE_TO_PRISMA: any = {
  travel_group: 'TRAVEL_GROUP',
  buyback: 'BUYBACK',
  external: 'EXTERNAL',
  internal: 'INTERNAL',
  after_sales: 'AFTER_SALES',
  TRAVEL_GROUP: 'TRAVEL_GROUP',
  BUYBACK: 'BUYBACK',
  EXTERNAL: 'EXTERNAL',
  INTERNAL: 'INTERNAL',
  AFTER_SALES: 'AFTER_SALES',
};

const ORDER_TYPE_FROM_PRISMA: any = {
  TRAVEL_GROUP: 'travel_group',
  BUYBACK: 'buyback',
  EXTERNAL: 'external',
  INTERNAL: 'internal',
  AFTER_SALES: 'after_sales',
};

const ORDER_STATUS_TO_PRISMA: any = {
  valid: 'VALID',
  partial_refund: 'PARTIAL_REFUND',
  refunded: 'REFUNDED',
  cancelled: 'CANCELLED',
  VALID: 'VALID',
  PARTIAL_REFUND: 'PARTIAL_REFUND',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
};

const ORDER_STATUS_FROM_PRISMA: any = {
  VALID: 'valid',
  PARTIAL_REFUND: 'partial_refund',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
};

const DELIVERY_TYPE_TO_PRISMA: any = {
  self_pickup: 'SELF_PICKUP',
  shipping: 'SHIPPING',
  SELF_PICKUP: 'SELF_PICKUP',
  SHIPPING: 'SHIPPING',
};

const DELIVERY_TYPE_FROM_PRISMA: any = {
  SELF_PICKUP: 'self_pickup',
  SHIPPING: 'shipping',
};

@Injectable()
export class BusinessDataNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
  ) {}

  async listGroups(kind: string, actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'sales', 'finance', 'taster']);
    const table = getGroupTable(kind);
    const delegate = this.groupDelegate(table);
    const where = await this.buildScopedGroupWhere(kind, actor, buildGroupWhere(filters));
    const groups = await delegate.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return groups.map((group: any) => toGroupDto(group, kind));
  }

  async getGroup(kind: string, actor: any, id: string) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'sales', 'finance', 'taster']);
    const group = await this.findGroupOrThrow(kind, id);
    await this.assertCanReadGroup(kind, actor, group);
    await this.assertPassesGlobalGroupMarkScope(group);
    return toGroupDto(group, kind);
  }

  async createGroup(kind: string, actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'sales', 'finance']);
    const table = getGroupTable(kind);
    const delegate = this.groupDelegate(table);
    const data = buildGroupData(payload, actor, true);
    const existing = await delegate.findUnique({
      where: {
        groupNo: data.groupNo,
      },
    });
    if (existing) {
      throw createHttpError(409, 'GROUP_NO_EXISTS', 'Travel group number already exists.');
    }

    const created = await delegate.create({ data });
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `${table.logPrefix}.create`,
      entityType: table.entityType,
      entityId: created.id,
      afterData: toGroupDto(created, kind),
      ipAddress: metadata.ipAddress || null,
    });
    return toGroupDto(created, kind);
  }

  async updateGroup(kind: string, actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'sales', 'finance']);
    const table = getGroupTable(kind);
    const delegate = this.groupDelegate(table);
    const current = await this.findGroupOrThrow(kind, id);
    await this.assertCanReadGroup(kind, actor, current);
    const data = buildGroupData(payload, actor, false);

    if (data.groupNo && data.groupNo !== current.groupNo) {
      const duplicate = await delegate.findUnique({
        where: {
          groupNo: data.groupNo,
        },
      });
      if (duplicate) {
        throw createHttpError(409, 'GROUP_NO_EXISTS', 'Travel group number already exists.');
      }
    }

    const updated = await delegate.update({
      where: {
        id,
      },
      data,
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `${table.logPrefix}.update`,
      entityType: table.entityType,
      entityId: updated.id,
      beforeData: toGroupDto(current, kind),
      afterData: toGroupDto(updated, kind),
      ipAddress: metadata.ipAddress || null,
    });
    return toGroupDto(updated, kind);
  }

  async setGroupFinanceMark(kind: string, actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const table = getGroupTable(kind);
    const delegate = this.groupDelegate(table);
    const current = await this.findGroupOrThrow(kind, id);
    const marked = normalizeBoolean(payload?.financeMark ?? payload?.marked, 'financeMark');
    const updated = await delegate.update({
      where: {
        id,
      },
      data: buildFinanceMarkData(marked, actor),
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `${table.logPrefix}.finance_mark.${marked ? 'enable' : 'disable'}`,
      entityType: table.entityType,
      entityId: updated.id,
      beforeData: toGroupDto(current, kind),
      afterData: toGroupDto(updated, kind),
      ipAddress: metadata.ipAddress || null,
    });
    return toGroupDto(updated, kind);
  }

  async listSalesOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'sales', 'finance', 'warehouse', 'after_sales']);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(actor, buildSalesOrderWhere(filters)),
      include: {
        items: true,
        travelGroup: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return orders.map(toSalesOrderDto);
  }

  async getSalesOrder(actor: any, id: string) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'sales', 'finance', 'warehouse', 'after_sales']);
    const order = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        travelGroup: true,
      },
    });
    if (!order) {
      throw createHttpError(404, 'SALES_ORDER_NOT_FOUND', 'Sales order does not exist.');
    }
    assertCanReadSalesOrder(actor, order);
    await this.assertPassesGlobalSalesOrderMarkScope(order);
    return toSalesOrderDto(order);
  }

  async createSalesOrder(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'sales', 'finance', 'after_sales']);
    const data = buildSalesOrderData(payload, actor);
    const order = await this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.salesOrder.findUnique({
        where: {
          orderNo: data.orderNo,
        },
      });
      if (existing) {
        throw createHttpError(409, 'ORDER_NO_EXISTS', 'Sales order number already exists.');
      }

      let travelGroup: any = null;
      if (data.travelGroupId) {
        travelGroup = await tx.travelGroup.findUnique({
          where: {
            id: data.travelGroupId,
          },
        });
        if (!travelGroup) {
          throw createHttpError(404, 'TRAVEL_GROUP_NOT_FOUND', 'Related travel group does not exist.');
        }
      }

      const createdOrder = await tx.salesOrder.create({
        data,
        include: {
          items: true,
          travelGroup: true,
        },
      });

      let orderForLog = createdOrder;
      if (travelGroup && createdOrder.orderType === 'TRAVEL_GROUP' && createdOrder.status === 'VALID') {
        await tx.travelGroup.update({
          where: {
            id: travelGroup.id,
          },
          data: {
            status: 'ORDERED',
            salesAmountCents: Number(travelGroup.salesAmountCents || 0) + Number(createdOrder.totalAmountCents || 0),
            orderAmountCents: Number(travelGroup.orderAmountCents || 0) + Number(createdOrder.totalAmountCents || 0),
            cashOnDeliveryCents:
              Number(travelGroup.cashOnDeliveryCents || 0) + Number(createdOrder.cashOnDeliveryAmountCents || 0),
            updatedById: actor.id,
            updatedAt: new Date(),
          },
        });
        const reloadedOrder = await tx.salesOrder.findUnique({
          where: {
            id: createdOrder.id,
          },
          include: {
            items: true,
            travelGroup: true,
          },
        });
        orderForLog = reloadedOrder || createdOrder;
      }

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.create',
          entityType: 'sales_order',
          entityId: createdOrder.id,
          afterData: toSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForLog;
    });

    return toSalesOrderDto(order);
  }

  async setSalesOrderFinanceMark(actor: any, id: string, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        travelGroup: true,
      },
    });
    if (!current) {
      throw createHttpError(404, 'SALES_ORDER_NOT_FOUND', 'Sales order does not exist.');
    }

    const marked = normalizeBoolean(payload?.financeMark ?? payload?.marked, 'financeMark');
    const updated = await this.prisma.salesOrder.update({
      where: {
        id,
      },
      data: buildFinanceMarkData(marked, actor),
      include: {
        items: true,
        travelGroup: true,
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: `sales_orders.finance_mark.${marked ? 'enable' : 'disable'}`,
      entityType: 'sales_order',
      entityId: updated.id,
      beforeData: toSalesOrderDto(current),
      afterData: toSalesOrderDto(updated),
      ipAddress: metadata.ipAddress || null,
    });
    return toSalesOrderDto(updated);
  }

  async getFinanceOverview(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    const orderWhere = await this.buildScopedSalesOrderWhere(actor, buildSalesOrderWhere(filters));
    const groupWhere = await this.buildScopedGroupWhere(
      'travel',
      actor,
      buildGroupWhere({
        dateFrom: filters.dateFrom || filters.start,
        dateTo: filters.dateTo || filters.end,
      }),
    );
    const [orders, groups] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: orderWhere,
        include: {
          items: true,
          travelGroup: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: normalizeTake(filters.limit, 50),
      }),
      this.prisma.travelGroup.findMany({
        where: groupWhere,
      }),
    ]);

    const validOrders = orders.filter((order: any) => order.status !== 'CANCELLED');
    const refundOrders = orders.filter((order: any) => ['REFUNDED', 'PARTIAL_REFUND'].includes(order.status));
    return {
      metrics: {
        travelGroupCount: groups.length,
        orderCount: orders.length,
        salesAmountCents: validOrders.reduce((sum: number, order: any) => sum + Number(order.totalAmountCents || 0), 0),
        refundAmountCents: refundOrders.reduce((sum: number, order: any) => sum + Number(order.totalAmountCents || 0), 0),
        cashOnDeliveryAmountCents: validOrders.reduce(
          (sum: number, order: any) => sum + Number(order.cashOnDeliveryAmountCents || 0),
          0,
        ),
      },
      recentOrders: orders.slice(0, 10).map(toSalesOrderDto),
    };
  }

  async getReconciliation(actor: any, businessDateValue: string) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    const businessDate = parseDate(businessDateValue, 'businessDate', true);
    const reconciliation = await this.prisma.dailyReconciliation.findUnique({
      where: {
        businessDate,
      },
      include: {
        paymentMethods: true,
      },
    });
    if (!reconciliation) {
      return emptyReconciliationDto(businessDate);
    }
    return toReconciliationDto(reconciliation);
  }

  async upsertReconciliation(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    const businessDate = parseDate(payload?.businessDate, 'businessDate', true);
    const data = buildReconciliationData(payload, actor);
    const current = await this.prisma.dailyReconciliation.findUnique({
      where: {
        businessDate,
      },
      include: {
        paymentMethods: true,
      },
    });

    const saved = await this.prisma.dailyReconciliation.upsert({
      where: {
        businessDate,
      },
      update: {
        ...data,
        paymentMethods: {
          deleteMany: {},
          create: buildPaymentMethods(payload?.paymentMethods),
        },
      },
      create: {
        ...data,
        businessDate,
        createdById: actor.id,
        createdAt: new Date(),
        paymentMethods: {
          create: buildPaymentMethods(payload?.paymentMethods),
        },
      },
      include: {
        paymentMethods: true,
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: current ? 'reconciliations.update' : 'reconciliations.create',
      entityType: 'daily_reconciliation',
      entityId: saved.id,
      beforeData: current ? toReconciliationDto(current) : null,
      afterData: toReconciliationDto(saved),
      ipAddress: metadata.ipAddress || null,
    });
    return toReconciliationDto(saved);
  }

  async listStrikeBonusAwards(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    const awards = await this.prisma.strikeBonusAward.findMany({
      where: buildBonusWhere(filters),
      orderBy: {
        bonusDate: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return awards.map(toStrikeBonusAwardDto);
  }

  async createStrikeBonusAward(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    const created = await this.prisma.strikeBonusAward.create({
      data: buildStrikeBonusAwardData(payload),
    });
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'strike_bonus_awards.create',
      entityType: 'strike_bonus_award',
      entityId: created.id,
      afterData: toStrikeBonusAwardDto(created),
      ipAddress: metadata.ipAddress || null,
    });
    return toStrikeBonusAwardDto(created);
  }

  private groupDelegate(table: any) {
    return (this.prisma as any)[table.delegate];
  }

  private async buildScopedGroupWhere(kind: string, actor: any, baseWhere: any) {
    return andWhere(andWhere(baseWhere, await this.buildGroupDataScope(kind, actor)), await this.buildGlobalGroupMarkScope());
  }

  private async buildScopedSalesOrderWhere(actor: any, baseWhere: any) {
    return andWhere(andWhere(baseWhere, buildSalesOrderDataScope(actor)), await this.buildGlobalSalesOrderMarkScope());
  }

  private async buildGroupDataScope(kind: string, actor: any) {
    if (actor?.role === 'taster') {
      return { tasterId: actor.id };
    }

    if (actor?.role === 'sales') {
      const scopeOr: any[] = [{ createdById: actor.id }];
      if (kind === 'travel') {
        const travelGroupIds = await this.findSalesRelatedTravelGroupIds(actor);
        if (travelGroupIds.length > 0) {
          scopeOr.push({ id: { in: travelGroupIds } });
        }
      }
      return { OR: scopeOr };
    }

    return null;
  }

  private async findSalesRelatedTravelGroupIds(actor: any) {
    const orders = await this.prisma.salesOrder.findMany({
      where: buildSalesOrderDataScope(actor),
    });
    return Array.from(
      new Set(
        orders
          .map((order: any) => order.travelGroupId)
          .filter((travelGroupId: any) => typeof travelGroupId === 'string' && travelGroupId.length > 0),
      ),
    );
  }

  private async assertCanReadGroup(kind: string, actor: any, group: any) {
    if (actor?.role === 'taster') {
      if (group.tasterId === actor.id) {
        return;
      }
      throw createHttpError(404, 'TRAVEL_GROUP_NOT_FOUND', 'Travel group does not exist.');
    }

    if (actor?.role === 'sales') {
      if (group.createdById === actor.id) {
        return;
      }
      if (kind === 'travel' && (await this.hasSalesRelatedOrder(actor, group.id))) {
        return;
      }
      throw createHttpError(404, 'TRAVEL_GROUP_NOT_FOUND', 'Travel group does not exist.');
    }
  }

  private async hasSalesRelatedOrder(actor: any, travelGroupId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: andWhere({ travelGroupId }, buildSalesOrderDataScope(actor)),
      take: 1,
    });
    return orders.length > 0;
  }

  private async buildGlobalGroupMarkScope() {
    return (await this.onlyShowMarkedRecords()) ? { financeMark: true } : null;
  }

  private async buildGlobalSalesOrderMarkScope() {
    if (!(await this.onlyShowMarkedRecords())) {
      return null;
    }
    const markedGroups = await this.prisma.travelGroup.findMany({
      where: {
        financeMark: true,
      },
    });
    return {
      financeMark: true,
      OR: [
        { travelGroupId: null },
        {
          travelGroupId: {
            in: markedGroups.map((group: any) => group.id),
          },
        },
      ],
    };
  }

  private async assertPassesGlobalGroupMarkScope(group: any) {
    if ((await this.onlyShowMarkedRecords()) && !group.financeMark) {
      throw createHttpError(404, 'TRAVEL_GROUP_NOT_FOUND', 'Travel group does not exist.');
    }
  }

  private async assertPassesGlobalSalesOrderMarkScope(order: any) {
    if (!(await this.onlyShowMarkedRecords())) {
      return;
    }
    if (order.financeMark && (!order.travelGroupId || order.travelGroup?.financeMark)) {
      return;
    }
    throw createHttpError(404, 'SALES_ORDER_NOT_FOUND', 'Sales order does not exist.');
  }

  private async onlyShowMarkedRecords() {
    const settings = await this.settingsService.getGlobalMarkQuery();
    return Boolean(settings.onlyShowMarkedRecords);
  }

  private async findGroupOrThrow(kind: string, id: string) {
    const table = getGroupTable(kind);
    const group = await this.groupDelegate(table).findUnique({
      where: {
        id,
      },
    });
    if (!group) {
      throw createHttpError(404, 'TRAVEL_GROUP_NOT_FOUND', 'Travel group does not exist.');
    }
    return group;
  }
}

function getGroupTable(kind: string) {
  const table = GROUP_TABLES[kind];
  if (!table) {
    throw createHttpError(400, 'INVALID_GROUP_KIND', 'Travel group table type is invalid.');
  }
  return table;
}

function buildGroupWhere(filters: any = {}) {
  const where: any = {};
  const query = normalizeOptionalString(filters.query || filters.search);
  if (query) {
    where.OR = [
      { groupNo: { contains: query } },
      { travelAgency: { contains: query } },
      { guideName: { contains: query } },
      { tasterName: { contains: query } },
    ];
  }
  if (filters.status) {
    where.status = toPrismaGroupStatus(filters.status);
  }
  const dateRange = buildDateRange(filters.dateFrom || filters.start, filters.dateTo || filters.end);
  if (dateRange) {
    where.visitDate = dateRange;
  }
  return where;
}

function buildSalesOrderWhere(filters: any = {}) {
  const where: any = {};
  const query = normalizeOptionalString(filters.query || filters.search);
  if (query) {
    where.OR = [
      { orderNo: { contains: query } },
      { customerName: { contains: query } },
      { customerPhone: { contains: query } },
    ];
  }
  if (filters.orderType) {
    where.orderType = toPrismaOrderType(filters.orderType);
  }
  if (filters.status) {
    where.status = toPrismaOrderStatus(filters.status);
  }
  const dateRange = buildDateRange(filters.dateFrom || filters.start, filters.dateTo || filters.end);
  if (dateRange) {
    where.orderDate = dateRange;
  }
  return where;
}

function buildSalesOrderDataScope(actor: any) {
  if (actor?.role !== 'sales') {
    return null;
  }
  return {
    OR: [{ salesUserId: actor.id }, { createdById: actor.id }],
  };
}

function buildFinanceMarkData(marked: boolean, actor: any) {
  return {
    financeMark: marked,
    markedById: marked ? actor.id : null,
    markedAt: marked ? new Date() : null,
    updatedById: actor.id,
    updatedAt: new Date(),
  };
}

function assertCanReadSalesOrder(actor: any, order: any) {
  if (actor?.role !== 'sales') {
    return;
  }
  if (order.salesUserId === actor.id || order.createdById === actor.id) {
    return;
  }
  throw createHttpError(404, 'SALES_ORDER_NOT_FOUND', 'Sales order does not exist.');
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

function buildBonusWhere(filters: any = {}) {
  const where: any = {};
  const dateRange = buildDateRange(filters.dateFrom || filters.start, filters.dateTo || filters.end);
  if (dateRange) {
    where.bonusDate = dateRange;
  }
  return where;
}

function buildGroupData(payload: any, actor: any, creating: boolean) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  assignString(data, 'groupNo', payload?.groupNo, creating, 'groupNo');
  if (creating || payload?.visitDate !== undefined) {
    data.visitDate = parseDate(payload?.visitDate, 'visitDate', creating);
  }
  assignNullableString(data, 'travelAgency', payload?.travelAgency);
  assignNullableString(data, 'licensePlate', payload?.licensePlate);
  assignNullableString(data, 'guideName', payload?.guideName);
  assignNullableString(data, 'guidePhone', payload?.guidePhone);
  assignInt(data, 'guestCount', payload?.guestCount);
  assignNullableString(data, 'tastingRoomNo', payload?.tastingRoomNo);
  assignNullableString(data, 'tasterName', payload?.tasterName);
  assignNullableString(data, 'arrivalTime', payload?.arrivalTime);
  assignNullableString(data, 'groupType', payload?.groupType);
  assignNullableString(data, 'wineDetails', payload?.wineDetails);
  assignNullableString(data, 'departureTime', payload?.departureTime);
  assignNullableString(data, 'remarks', payload?.remarks);
  if (payload?.status !== undefined) {
    data.status = toPrismaGroupStatus(payload.status);
  }
  assignInt(data, 'salesAmountCents', payload?.salesAmountCents);
  assignInt(data, 'paidDepositCents', payload?.paidDepositCents);
  assignInt(data, 'cashOnDeliveryCents', payload?.cashOnDeliveryCents);
  assignInt(data, 'liquorCostDeductionCents', payload?.liquorCostDeductionCents);
  assignInt(data, 'orderAmountCents', payload?.orderAmountCents);
  assignInt(data, 'points', payload?.points);
  assignInt(data, 'returnedPoints', payload?.returnedPoints);
  assignInt(data, 'unreturnedPoints', payload?.unreturnedPoints);
  assignBool(data, 'guideInfoSent', payload?.guideInfoSent);
  assignBool(data, 'travelAgencyInfoSent', payload?.travelAgencyInfoSent);
  assignNullableString(data, 'tasterId', payload?.tasterId);

  if (creating) {
    data.id = crypto.randomUUID();
    data.createdById = actor.id;
    data.createdAt = now;
    data.status = data.status || 'UNMARKED';
  }
  return data;
}

function buildSalesOrderData(payload: any, actor: any) {
  const now = new Date();
  const items = buildSalesOrderItems(payload?.items);
  const totalAmountCents =
    payload?.totalAmountCents === undefined
      ? items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPriceCents, 0)
      : normalizeInt(payload.totalAmountCents, 'totalAmountCents');

  const data: any = {
    id: crypto.randomUUID(),
    orderNo: normalizeRequiredString(payload?.orderNo || generateOrderNo(), 'orderNo'),
    orderType: toPrismaOrderType(payload?.orderType || 'travel_group'),
    travelGroupId: normalizeOptionalString(payload?.travelGroupId),
    customerName: normalizeRequiredString(payload?.customerName, 'customerName'),
    customerPhone: normalizeOptionalString(payload?.customerPhone),
    province: normalizeOptionalString(payload?.province),
    city: normalizeOptionalString(payload?.city),
    district: normalizeOptionalString(payload?.district),
    address: normalizeOptionalString(payload?.address),
    orderDate: parseDate(payload?.orderDate, 'orderDate', true),
    totalAmountCents,
    cashOnDeliveryAmountCents: normalizeInt(payload?.cashOnDeliveryAmountCents, 'cashOnDeliveryAmountCents', 0),
    remark: normalizeOptionalString(payload?.remark),
    status: toPrismaOrderStatus(payload?.status || 'valid'),
    salesUserId: actor.role === 'sales' ? actor.id : normalizeOptionalString(payload?.salesUserId),
    createdById: actor.id,
    updatedById: actor.id,
    createdAt: now,
    updatedAt: now,
    items: {
      create: items,
    },
  };
  return data;
}

function buildSalesOrderItems(items: any[]) {
  const rawItems = Array.isArray(items) && items.length > 0 ? items : [];
  return rawItems.map((item, index) => ({
    id: crypto.randomUUID(),
    productName: normalizeRequiredString(item?.productName, `items[${index}].productName`),
    quantity: Math.max(1, normalizeInt(item?.quantity, `items[${index}].quantity`, 1)),
    unitPriceCents: normalizeInt(item?.unitPriceCents, `items[${index}].unitPriceCents`, 0),
    deliveryType: toPrismaDeliveryType(item?.deliveryType || 'shipping'),
    createdAt: new Date(),
  }));
}

function buildReconciliationData(payload: any, actor: any) {
  return {
    businessDate: parseDate(payload?.businessDate, 'businessDate', true),
    travelGroupSalesCents: normalizeInt(payload?.travelGroupSalesCents, 'travelGroupSalesCents', 0),
    backOfficeSalesCents: normalizeInt(payload?.backOfficeSalesCents, 'backOfficeSalesCents', 0),
    buybackCents: normalizeInt(payload?.buybackCents, 'buybackCents', 0),
    externalSalesCents: normalizeInt(payload?.externalSalesCents, 'externalSalesCents', 0),
    internalPurchaseCents: normalizeInt(payload?.internalPurchaseCents, 'internalPurchaseCents', 0),
    afterSalesCents: normalizeInt(payload?.afterSalesCents, 'afterSalesCents', 0),
    // refundsCents is stored as a positive deduction; totals subtract it when rendering reconciliation.
    refundsCents: normalizeNonNegativeInt(payload?.refundsCents, 'refundsCents', 0),
    otherReceivableCents: normalizeInt(payload?.otherReceivableCents, 'otherReceivableCents', 0),
    notes: normalizeOptionalString(payload?.notes),
    updatedById: actor.id,
    updatedAt: new Date(),
  };
}

function buildPaymentMethods(methods: any[]) {
  if (!Array.isArray(methods)) {
    return [];
  }
  return methods
    .map((method, index) => ({
      id: crypto.randomUUID(),
      name: normalizeRequiredString(method?.name, `paymentMethods[${index}].name`),
      amountCents: normalizeInt(method?.amountCents, `paymentMethods[${index}].amountCents`, 0),
      sortOrder: normalizeInt(method?.sortOrder, `paymentMethods[${index}].sortOrder`, index + 1),
      createdAt: new Date(),
    }));
}

function buildStrikeBonusAwardData(payload: any) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    bonusDate: parseDate(payload?.bonusDate, 'bonusDate', true),
    travelAgency: normalizeOptionalString(payload?.travelAgency),
    guideName: normalizeOptionalString(payload?.guideName),
    tasterName: normalizeOptionalString(payload?.tasterName),
    roomNo: normalizeOptionalString(payload?.roomNo),
    salesAmountCents: normalizeInt(payload?.salesAmountCents, 'salesAmountCents', 0),
    bonusAmountCents: normalizeInt(payload?.bonusAmountCents, 'bonusAmountCents', 0),
    tasterPaidDate: parseOptionalDate(payload?.tasterPaidDate, 'tasterPaidDate'),
    salesPaidDate: parseOptionalDate(payload?.salesPaidDate, 'salesPaidDate'),
    createdAt: now,
    updatedAt: now,
  };
}

function toGroupDto(group: any, kind: string) {
  return {
    id: group.id,
    kind,
    groupNo: group.groupNo,
    visitDate: formatDate(group.visitDate),
    travelAgency: group.travelAgency,
    licensePlate: group.licensePlate,
    guideName: group.guideName,
    guidePhone: group.guidePhone,
    guestCount: Number(group.guestCount || 0),
    tastingRoomNo: group.tastingRoomNo,
    tasterName: group.tasterName,
    arrivalTime: group.arrivalTime,
    groupType: group.groupType,
    wineDetails: group.wineDetails,
    departureTime: group.departureTime,
    remarks: group.remarks,
    status: GROUP_STATUS_FROM_PRISMA[group.status] || group.status,
    salesAmountCents: Number(group.salesAmountCents || 0),
    paidDepositCents: Number(group.paidDepositCents || 0),
    cashOnDeliveryCents: Number(group.cashOnDeliveryCents || 0),
    liquorCostDeductionCents: Number(group.liquorCostDeductionCents || 0),
    orderAmountCents: Number(group.orderAmountCents || 0),
    points: Number(group.points || 0),
    returnedPoints: Number(group.returnedPoints || 0),
    unreturnedPoints: Number(group.unreturnedPoints || 0),
    guideInfoSent: Boolean(group.guideInfoSent),
    travelAgencyInfoSent: Boolean(group.travelAgencyInfoSent),
    financeMark: Boolean(group.financeMark),
    markedById: group.markedById || null,
    markedAt: group.markedAt ? toIsoString(group.markedAt) : null,
    tasterId: group.tasterId || null,
    createdAt: toIsoString(group.createdAt),
    updatedAt: toIsoString(group.updatedAt),
  };
}

function toSalesOrderDto(order: any) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: ORDER_TYPE_FROM_PRISMA[order.orderType] || order.orderType,
    travelGroupId: order.travelGroupId,
    travelGroup: order.travelGroup ? toGroupDto(order.travelGroup, 'travel') : null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    province: order.province,
    city: order.city,
    district: order.district,
    address: order.address,
    orderDate: formatDate(order.orderDate),
    totalAmountCents: Number(order.totalAmountCents || 0),
    cashOnDeliveryAmountCents: Number(order.cashOnDeliveryAmountCents || 0),
    remark: order.remark,
    status: ORDER_STATUS_FROM_PRISMA[order.status] || order.status,
    financeMark: Boolean(order.financeMark),
    markedById: order.markedById || null,
    markedAt: order.markedAt ? toIsoString(order.markedAt) : null,
    salesUserId: order.salesUserId || null,
    items: Array.isArray(order.items) ? order.items.map(toSalesOrderItemDto) : [],
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
  };
}

function toSalesOrderItemDto(item: any) {
  return {
    id: item.id,
    productName: item.productName,
    quantity: Number(item.quantity || 0),
    unitPriceCents: Number(item.unitPriceCents || 0),
    deliveryType: DELIVERY_TYPE_FROM_PRISMA[item.deliveryType] || item.deliveryType,
  };
}

function emptyReconciliationDto(businessDate: Date) {
  return toReconciliationDto({
    id: null,
    businessDate,
    travelGroupSalesCents: 0,
    backOfficeSalesCents: 0,
    buybackCents: 0,
    externalSalesCents: 0,
    internalPurchaseCents: 0,
    afterSalesCents: 0,
    refundsCents: 0,
    otherReceivableCents: 0,
    notes: null,
    paymentMethods: [],
    createdAt: null,
    updatedAt: null,
  });
}

function toReconciliationDto(row: any) {
  const refundsCents = Math.abs(Number(row.refundsCents || 0));
  const paymentMethods = Array.isArray(row.paymentMethods)
    ? row.paymentMethods
        .slice()
        .sort((left: any, right: any) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
        .map((method: any) => ({
          id: method.id,
          name: method.name,
          amountCents: Number(method.amountCents || 0),
          sortOrder: Number(method.sortOrder || 0),
        }))
    : [];
  const receivableTotalCents =
    Number(row.travelGroupSalesCents || 0) +
    Number(row.backOfficeSalesCents || 0) +
    Number(row.buybackCents || 0) +
    Number(row.externalSalesCents || 0) +
    Number(row.internalPurchaseCents || 0) +
    Number(row.afterSalesCents || 0) -
    refundsCents +
    Number(row.otherReceivableCents || 0);
  const actualTotalCents = paymentMethods.reduce((sum: number, method: any) => sum + method.amountCents, 0);

  return {
    id: row.id,
    businessDate: formatDate(row.businessDate),
    travelGroupSalesCents: Number(row.travelGroupSalesCents || 0),
    backOfficeSalesCents: Number(row.backOfficeSalesCents || 0),
    buybackCents: Number(row.buybackCents || 0),
    externalSalesCents: Number(row.externalSalesCents || 0),
    internalPurchaseCents: Number(row.internalPurchaseCents || 0),
    afterSalesCents: Number(row.afterSalesCents || 0),
    refundsCents,
    otherReceivableCents: Number(row.otherReceivableCents || 0),
    receivableTotalCents,
    actualTotalCents,
    differenceCents: actualTotalCents - receivableTotalCents,
    notes: row.notes,
    paymentMethods,
    createdAt: row.createdAt ? toIsoString(row.createdAt) : null,
    updatedAt: row.updatedAt ? toIsoString(row.updatedAt) : null,
  };
}

function toStrikeBonusAwardDto(row: any) {
  return {
    id: row.id,
    bonusDate: formatDate(row.bonusDate),
    travelAgency: row.travelAgency,
    guideName: row.guideName,
    tasterName: row.tasterName,
    roomNo: row.roomNo,
    salesAmountCents: Number(row.salesAmountCents || 0),
    bonusAmountCents: Number(row.bonusAmountCents || 0),
    tasterPaidDate: row.tasterPaidDate ? formatDate(row.tasterPaidDate) : null,
    salesPaidDate: row.salesPaidDate ? formatDate(row.salesPaidDate) : null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function requireAnyRole(actor: any, roles: string[]) {
  if (!actor || !roles.includes(actor.role)) {
    throw createHttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
  }
}

function buildDateRange(startValue: unknown, endValue: unknown) {
  const range: any = {};
  if (startValue) {
    range.gte = parseDate(startValue, 'dateFrom', true);
  }
  if (endValue) {
    range.lte = parseDate(endValue, 'dateTo', true);
  }
  return Object.keys(range).length > 0 ? range : null;
}

function parseDate(value: unknown, fieldName: string, required: boolean) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) {
      throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} is required.`);
    }
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} must be a valid date.`);
  }
  return date;
}

function parseOptionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  return parseDate(value, fieldName, true);
}

function assignString(data: any, key: string, value: unknown, required: boolean, fieldName: string) {
  if (value === undefined && !required) {
    return;
  }
  data[key] = normalizeRequiredString(value, fieldName);
}

function assignNullableString(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = normalizeOptionalString(value);
  }
}

function assignInt(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = normalizeInt(value, key, 0);
  }
}

function assignBool(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = Boolean(value);
  }
}

function normalizeBoolean(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} is required.`);
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
  throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} must be a boolean.`);
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} is required.`);
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

function normalizeInt(value: unknown, fieldName: string, fallback?: number) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} is required.`);
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} must be a number.`);
  }
  return Math.trunc(numberValue);
}

function normalizeNonNegativeInt(value: unknown, fieldName: string, fallback?: number) {
  const normalized = normalizeInt(value, fieldName, fallback);
  if (normalized < 0) {
    throw createHttpError(400, 'VALIDATION_FAILED', `${fieldName} must be a non-negative number.`);
  }
  return normalized;
}

function toPrismaGroupStatus(value: unknown) {
  const status = GROUP_STATUS_TO_PRISMA[String(value || '').trim()];
  if (!status) {
    throw createHttpError(400, 'INVALID_GROUP_STATUS', 'Travel group status is invalid.');
  }
  return status;
}

function toPrismaOrderType(value: unknown) {
  const orderType = ORDER_TYPE_TO_PRISMA[String(value || '').trim()];
  if (!orderType) {
    throw createHttpError(400, 'INVALID_ORDER_TYPE', 'Sales order type is invalid.');
  }
  return orderType;
}

function toPrismaOrderStatus(value: unknown) {
  const status = ORDER_STATUS_TO_PRISMA[String(value || '').trim()];
  if (!status) {
    throw createHttpError(400, 'INVALID_ORDER_STATUS', 'Sales order status is invalid.');
  }
  return status;
}

function toPrismaDeliveryType(value: unknown) {
  const deliveryType = DELIVERY_TYPE_TO_PRISMA[String(value || '').trim()];
  if (!deliveryType) {
    throw createHttpError(400, 'INVALID_DELIVERY_TYPE', 'Sales order item delivery type is invalid.');
  }
  return deliveryType;
}

function normalizeTake(value: unknown, fallback: number) {
  const raw = value === undefined ? fallback : normalizeInt(value, 'limit', fallback);
  return Math.min(Math.max(raw, 1), 200);
}

function generateOrderNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `SO-${y}${m}${d}-${crypto.randomInt(1000, 9999)}`;
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

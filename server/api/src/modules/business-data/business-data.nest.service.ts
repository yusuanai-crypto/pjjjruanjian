import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import { withGeneratedSalesOrderNo } from './sales-order-no.helper';
import { withGeneratedTravelGroupNo } from './travel-group-no.helper';

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

const TRAVEL_GROUP_FINANCE_PATCH_FIELDS = [
  'status',
  'salesAmountCents',
  'paidDepositCents',
  'cashOnDeliveryCents',
  'liquorCostDeductionCents',
  'orderAmountCents',
  'points',
  'returnedPoints',
  'unreturnedPoints',
  'guideInfoSent',
  'travelAgencyInfoSent',
  'remarks',
];

const TRAVEL_GROUP_PATCH_ALLOWED_FIELDS_BY_ROLE: any = {
  admin: [
    'groupNo',
    'visitDate',
    'travelAgency',
    'licensePlate',
    'guideId',
    'guideName',
    'guidePhone',
    'guestCount',
    'tastingRoomNo',
    'tasterId',
    'tasterName',
    'arrivalTime',
    'groupType',
    'wineDetails',
    'departureTime',
    'remarks',
    'tasterSummary',
    'tastingItems',
    ...TRAVEL_GROUP_FINANCE_PATCH_FIELDS,
  ],
  front_desk: [
    'visitDate',
    'travelAgency',
    'licensePlate',
    'guideId',
    'guestCount',
    'tastingRoomNo',
    'tasterId',
    'arrivalTime',
    'groupType',
    'remarks',
    'tastingItems',
  ],
  sales: ['guestCount', 'departureTime', 'remarks', 'tastingItems'],
  taster: ['guestCount', 'tasterSummary', 'wineDetails'],
  finance: TRAVEL_GROUP_FINANCE_PATCH_FIELDS,
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

const PACKING_STATUS_TO_PRISMA: any = {
  pending: 'PENDING',
  packing: 'PACKING',
  packed: 'PACKED',
  abnormal: 'ABNORMAL',
  PENDING: 'PENDING',
  PACKING: 'PACKING',
  PACKED: 'PACKED',
  ABNORMAL: 'ABNORMAL',
};

const SALES_ORDER_PATCH_ALLOWED_FIELDS_BY_ROLE: any = {
  admin: [
    'orderType',
    'salesUserId',
    'salesFormNo',
    'orderDate',
    'customerId',
    'customer',
    'travelGroupId',
    'cashOnDeliveryAmountCents',
    'invoiceRequired',
    'remark',
    'items',
    'status',
  ],
  sales: [
    'salesFormNo',
    'orderDate',
    'customerId',
    'customer',
    'travelGroupId',
    'cashOnDeliveryAmountCents',
    'invoiceRequired',
    'remark',
    'items',
  ],
};

const SALES_ORDER_FINANCE_PATCH_FIELDS = [
  'logisticsNo',
  'logisticsFeeCents',
  'invoiceIssued',
  'financeRemark',
  'status',
];

const SALES_ORDER_PACKING_PATCH_FIELDS = [
  'logisticsMethod',
  'packingStatus',
  'packageCount',
  'warehouseRemark',
];

const SALES_ORDER_STATUS_PATCH_FIELDS = ['status', 'remark', 'statusReason'];

const SALES_ORDER_CUSTOMER_PATCH_FIELDS = [
  'name',
  'phone',
  'province',
  'city',
  'district',
  'address',
  'notes',
];

@Injectable()
export class BusinessDataNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
  ) {}

  async listGroups(kind: string, actor: any, filters: any = {}) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
    ]);
    const table = getGroupTable(kind);
    const delegate = this.groupDelegate(table);
    const where = await this.buildScopedGroupWhere(
      kind,
      actor,
      buildGroupWhere(filters, kind),
    );
    const include = getGroupInclude(kind);
    const take = normalizeTake(filters.limit, 50);
    const pendingStatusFilter = normalizeOptionalString(filters.pendingStatus);
    const groups = await delegate.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: pendingStatusFilter ? 200 : take,
      ...(include ? { include } : {}),
    });
    return filterGroupDtosByComputedFields(
      annotateDuplicateGroupNos(groups).map((group: any) =>
        toGroupDto(group, kind),
      ),
      filters,
    ).slice(0, take);
  }

  async listPendingTravelGroups(actor: any, filters: any = {}) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
    ]);
    const take = normalizeTake(filters.limit, 50);
    const pendingStatusFilter = normalizeOptionalString(filters.pendingStatus);
    const groups = await this.prisma.travelGroup.findMany({
      where: await this.buildRoleScopedTravelGroupWhere(
        actor,
        buildGroupWhere(filters, 'travel'),
      ),
      include: getGroupInclude('travel', 'detail') as any,
      orderBy: {
        createdAt: 'desc',
      },
      take: pendingStatusFilter ? 500 : 200,
    });
    return filterGroupDtosByComputedFields(
      annotateDuplicateGroupNos(groups).map((group: any) =>
        toGroupDto(group, 'travel'),
      ),
      filters,
    )
      .filter((group: any) => group.pendingStatus)
      .slice(0, take);
  }

  async getGroup(kind: string, actor: any, id: string) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
    ]);
    const group = await this.findGroupOrThrow(kind, id, true);
    await this.assertCanReadGroup(kind, actor, group);
    await this.assertPassesGlobalGroupMarkScope(group);
    return toGroupDto(group, kind);
  }

  async createGroup(
    kind: string,
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    if (kind === 'travel') {
      return this.createTravelGroup(actor, payload, metadata);
    }

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
      throw createHttpError(
        409,
        'GROUP_NO_EXISTS',
        'Travel group number already exists.',
      );
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

  private async createTravelGroup(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'front_desk']);
    const data = buildTravelGroupCreateData(payload, actor);
    const tastingItems = buildTravelGroupTastingItems(payload?.tastingItems);

    const created = await this.prisma.$transaction(async (tx: any) => {
      const guide = await tx.guide.findUnique({
        where: {
          id: data.guideId,
        },
      });
      if (!guide) {
        throw createHttpError(404, 'GUIDE_NOT_FOUND', 'Guide does not exist.');
      }
      if (!guide.isActive) {
        throw createHttpError(400, 'GUIDE_DISABLED', 'Guide is disabled.');
      }

      const taster = await tx.user.findUnique({
        where: {
          id: data.tasterId,
        },
      });
      if (!taster) {
        throw createHttpError(
          404,
          'TASTER_NOT_FOUND',
          'Taster does not exist.',
        );
      }
      if (!isActiveTasterUser(taster)) {
        throw createHttpError(
          400,
          'INVALID_TASTER',
          'tasterId must reference an active taster user.',
        );
      }

      return withGeneratedTravelGroupNo(
        tx.travelGroup,
        data.visitDate,
        async (groupNo) => {
          const createdGroup = await tx.travelGroup.create({
            data: {
              ...data,
              groupNo,
              guideName: guide.name,
              guidePhone: guide.phone,
              tasterName: taster.name,
              ...(tastingItems.length > 0
                ? {
                    tastingItems: {
                      create: tastingItems,
                    },
                  }
                : {}),
            },
            include: getGroupInclude('travel'),
          });
          const dto = toGroupDto(createdGroup, 'travel');
          await this.operationLogsService.appendLog(
            {
              userId: actor.id,
              action: 'travel_groups.create',
              entityType: 'travel_group',
              entityId: createdGroup.id,
              afterData: dto,
              ipAddress: metadata.ipAddress || null,
            },
            tx,
          );
          return createdGroup;
        },
      );
    });

    return toGroupDto(created, 'travel');
  }

  async updateGroup(
    kind: string,
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    if (kind === 'travel') {
      return this.updateTravelGroup(actor, id, payload, metadata);
    }

    requireAnyRole(actor, ['admin', 'front_desk', 'sales', 'finance']);
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
        throw createHttpError(
          409,
          'GROUP_NO_EXISTS',
          'Travel group number already exists.',
        );
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

  private async updateTravelGroup(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, [
      'admin',
      'front_desk',
      'sales',
      'taster',
      'finance',
    ]);
    assertTravelGroupPatchAllowedFields(actor, payload);

    const current = await this.findGroupOrThrow('travel', id, true);
    await this.assertCanReadGroup('travel', actor, current);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const data = buildTravelGroupUpdateData(payload, actor);

      if (data.groupNo && data.groupNo !== current.groupNo) {
        const duplicate = await tx.travelGroup.findUnique({
          where: {
            groupNo: data.groupNo,
          },
        });
        if (duplicate) {
          throw createHttpError(
            409,
            'GROUP_NO_EXISTS',
            'Travel group number already exists.',
          );
        }
      }

      if (data.guideId !== undefined) {
        const guide = await tx.guide.findUnique({
          where: {
            id: data.guideId,
          },
        });
        if (!guide) {
          throw createHttpError(
            404,
            'GUIDE_NOT_FOUND',
            'Guide does not exist.',
          );
        }
        if (!guide.isActive) {
          throw createHttpError(400, 'GUIDE_DISABLED', 'Guide is disabled.');
        }
        data.guideName = guide.name;
        data.guidePhone = guide.phone;
      }

      if (data.tasterId !== undefined) {
        const taster = await tx.user.findUnique({
          where: {
            id: data.tasterId,
          },
        });
        if (!taster) {
          throw createHttpError(
            404,
            'TASTER_NOT_FOUND',
            'Taster does not exist.',
          );
        }
        if (!isActiveTasterUser(taster)) {
          throw createHttpError(
            400,
            'INVALID_TASTER',
            'tasterId must reference an active taster user.',
          );
        }
        data.tasterName = taster.name;
      }

      if (payload?.tastingItems !== undefined) {
        data.tastingItems = {
          deleteMany: {},
          create: buildTravelGroupTastingItems(payload.tastingItems),
        };
      }

      const updatedGroup = await tx.travelGroup.update({
        where: {
          id,
        },
        data,
        include: getGroupInclude('travel', 'detail'),
      });
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'travel_groups.update',
          entityType: 'travel_group',
          entityId: updatedGroup.id,
          beforeData: toGroupDto(current, 'travel'),
          afterData: toGroupDto(updatedGroup, 'travel'),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return updatedGroup;
    });

    return toGroupDto(updated, 'travel');
  }

  async setGroupFinanceMark(
    kind: string,
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
    const table = getGroupTable(kind);
    const current = await this.findGroupOrThrow(kind, id, kind === 'travel');
    const marked = normalizeBoolean(
      payload?.financeMark ?? payload?.marked,
      'financeMark',
    );

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const include = getGroupInclude(
        kind,
        kind === 'travel' ? 'detail' : 'list',
      );
      const updatedGroup = await tx[table.delegate].update({
        where: {
          id,
        },
        data: buildFinanceMarkData(marked, actor),
        ...(include ? { include } : {}),
      });

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: `${table.logPrefix}.finance_mark.${marked ? 'enable' : 'disable'}`,
          entityType: table.entityType,
          entityId: updatedGroup.id,
          beforeData: toGroupDto(current, kind),
          afterData: toGroupDto(updatedGroup, kind),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return updatedGroup;
    });

    return toGroupDto(updated, kind);
  }

  async submitTravelGroupTasterSummary(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'taster']);
    const current = await this.findGroupOrThrow('travel', id, true);
    if (actor.role === 'taster' && current.tasterId !== actor.id) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }

    const now = new Date();
    const summary = normalizeRequiredString(
      payload?.tasterSummary,
      'tasterSummary',
    );
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedGroup = await tx.travelGroup.update({
        where: {
          id,
        },
        data: {
          tasterSummary: summary,
          tasterSummaryAt: now,
          updatedById: actor.id,
          updatedAt: now,
        },
        include: getGroupInclude('travel', 'detail'),
      });
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'travel_groups.taster_summary.upsert',
          entityType: 'travel_group',
          entityId: updatedGroup.id,
          beforeData: toGroupDto(current, 'travel'),
          afterData: toGroupDto(updatedGroup, 'travel'),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return updatedGroup;
    });

    return toGroupDto(updated, 'travel');
  }

  async listSalesOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'sales',
      'finance',
      'warehouse',
      'after_sales',
    ]);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(
        actor,
        buildSalesOrderWhere(filters),
      ),
      include: {
        items: true,
        customer: true,
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
    requireAnyRole(actor, [
      'admin',
      'boss',
      'sales',
      'finance',
      'warehouse',
      'after_sales',
    ]);
    const order = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        customer: true,
        travelGroup: true,
      },
    });
    if (!order) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    assertCanReadSalesOrder(actor, order);
    await this.assertPassesGlobalSalesOrderMarkScope(order);
    return toSalesOrderDto(order);
  }

  async createSalesOrder(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'sales', 'finance', 'after_sales']);
    const data = buildSalesOrderData(payload, actor);
    const order = await this.prisma.$transaction(async (tx: any) => {
      const customerResult = await resolveSalesOrderCustomer(
        tx,
        payload,
        actor,
      );
      const customer = customerResult.customer;

      if (customerResult.created) {
        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'customers.create',
            entityType: 'customer',
            entityId: customer.id,
            afterData: toSalesOrderCustomerDto(customer),
            ipAddress: metadata.ipAddress || null,
          },
          tx,
        );
      }

      let travelGroup: any = null;
      if (data.orderType === 'TRAVEL_GROUP' && !data.travelGroupId) {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          'travelGroupId is required for travel_group orders.',
        );
      }
      if (data.travelGroupId) {
        travelGroup = await tx.travelGroup.findUnique({
          where: {
            id: data.travelGroupId,
          },
        });
        if (!travelGroup) {
          throw createHttpError(
            404,
            'TRAVEL_GROUP_NOT_FOUND',
            'Related travel group does not exist.',
          );
        }
      }

      return withGeneratedSalesOrderNo(
        tx.salesOrder,
        data.orderDate,
        async (orderNo) => {
          const createdOrder = await tx.salesOrder.create({
            data: {
              ...data,
              orderNo,
              customerId: customer.id,
              customerName: customer.name,
              customerPhone: customer.phone || null,
              province: customer.province || null,
              city: customer.city || null,
              district: customer.district || null,
              address: customer.address || null,
            },
            include: {
              items: true,
              customer: true,
              travelGroup: true,
            },
          });

          let orderForLog = createdOrder;
          if (
            travelGroup &&
            createdOrder.orderType === 'TRAVEL_GROUP' &&
            ['VALID', 'PARTIAL_REFUND'].includes(createdOrder.status)
          ) {
            await tx.travelGroup.update({
              where: {
                id: travelGroup.id,
              },
              data: {
                status: 'ORDERED',
                salesAmountCents:
                  Number(travelGroup.salesAmountCents || 0) +
                  Number(createdOrder.totalAmountCents || 0),
                orderAmountCents:
                  Number(travelGroup.orderAmountCents || 0) +
                  Number(createdOrder.totalAmountCents || 0),
                cashOnDeliveryCents:
                  Number(travelGroup.cashOnDeliveryCents || 0) +
                  Number(createdOrder.cashOnDeliveryAmountCents || 0),
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
              customer: true,
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
        },
      );
    });

    return toSalesOrderDto(order);
  }

  async updateSalesOrder(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'sales']);
    assertSalesOrderPatchAllowedFields(actor, payload);

    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        customer: true,
        travelGroup: true,
      },
    });
    if (!current) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    assertCanUpdateSalesOrder(actor, current);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const data = buildSalesOrderUpdateData(payload, actor);
      const customerResult = await resolveSalesOrderPatchCustomer(
        tx,
        payload,
        current,
        actor,
      );

      if (customerResult.customer) {
        Object.assign(
          data,
          buildSalesOrderCustomerSnapshotData(customerResult.customer),
        );
      }

      if (customerResult.created) {
        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'customers.create',
            entityType: 'customer',
            entityId: customerResult.customer.id,
            afterData: toSalesOrderCustomerDto(customerResult.customer),
            ipAddress: metadata.ipAddress || null,
          },
          tx,
        );
      } else if (customerResult.updated) {
        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'customers.update',
            entityType: 'customer',
            entityId: customerResult.customer.id,
            beforeData: toSalesOrderCustomerDto(customerResult.beforeCustomer),
            afterData: toSalesOrderCustomerDto(customerResult.customer),
            ipAddress: metadata.ipAddress || null,
          },
          tx,
        );
      }

      const finalOrderType = data.orderType || current.orderType;
      const finalTravelGroupId =
        data.travelGroupId !== undefined
          ? data.travelGroupId
          : current.travelGroupId;
      if (finalOrderType === 'TRAVEL_GROUP' && !finalTravelGroupId) {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          'travelGroupId is required for travel_group orders.',
        );
      }
      if (finalTravelGroupId) {
        const travelGroup = await tx.travelGroup.findUnique({
          where: {
            id: finalTravelGroupId,
          },
        });
        if (!travelGroup) {
          throw createHttpError(
            404,
            'TRAVEL_GROUP_NOT_FOUND',
            'Related travel group does not exist.',
          );
        }
      }

      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data,
        include: {
          items: true,
          customer: true,
          travelGroup: true,
        },
      });

      for (const travelGroupId of getSalesOrderSummaryAffectedTravelGroupIds(
        current,
        updatedOrder,
      )) {
        await this.refreshTravelGroupOrderSummary(
          tx,
          travelGroupId,
          actor.id,
        );
      }

      const orderForLog =
        (await tx.salesOrder.findUnique({
          where: {
            id,
          },
          include: {
            items: true,
            customer: true,
            travelGroup: true,
          },
        })) || updatedOrder;

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.update',
          entityType: 'sales_order',
          entityId: orderForLog.id,
          beforeData: toSalesOrderDto(current),
          afterData: toSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForLog;
    });

    return toSalesOrderDto(updated);
  }

  async updateSalesOrderFinance(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
    assertSalesOrderFinancePatchAllowedFields(payload);

    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        customer: true,
        travelGroup: true,
      },
    });
    if (!current) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: buildSalesOrderFinanceUpdateData(payload, actor),
        include: {
          items: true,
          customer: true,
          travelGroup: true,
        },
      });

      for (const travelGroupId of getSalesOrderSummaryAffectedTravelGroupIds(
        current,
        updatedOrder,
      )) {
        await this.refreshTravelGroupOrderSummary(
          tx,
          travelGroupId,
          actor.id,
        );
      }

      const orderForLog =
        (await tx.salesOrder.findUnique({
          where: {
            id,
          },
          include: {
            items: true,
            customer: true,
            travelGroup: true,
          },
        })) || updatedOrder;

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.finance.update',
          entityType: 'sales_order',
          entityId: orderForLog.id,
          beforeData: toSalesOrderDto(current),
          afterData: toSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForLog;
    });

    return toSalesOrderDto(updated);
  }

  async updateSalesOrderPacking(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'warehouse']);
    assertSalesOrderPackingPatchAllowedFields(payload);

    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        customer: true,
        travelGroup: true,
      },
    });
    if (!current) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: buildSalesOrderPackingUpdateData(payload, actor),
        include: {
          items: true,
          customer: true,
          travelGroup: true,
        },
      });

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.packing.update',
          entityType: 'sales_order',
          entityId: updatedOrder.id,
          beforeData: toSalesOrderDto(current),
          afterData: toSalesOrderDto(updatedOrder),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return updatedOrder;
    });

    return toSalesOrderDto(updated);
  }

  async updateSalesOrderStatus(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance', 'after_sales']);
    assertSalesOrderStatusPatchAllowedFields(payload);

    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        customer: true,
        travelGroup: true,
      },
    });
    if (!current) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: buildSalesOrderStatusUpdateData(payload, actor),
        include: {
          items: true,
          customer: true,
          travelGroup: true,
        },
      });

      for (const travelGroupId of getSalesOrderSummaryAffectedTravelGroupIds(
        current,
        updatedOrder,
      )) {
        await this.refreshTravelGroupOrderSummary(
          tx,
          travelGroupId,
          actor.id,
        );
      }

      const orderForLog =
        (await tx.salesOrder.findUnique({
          where: {
            id,
          },
          include: {
            items: true,
            customer: true,
            travelGroup: true,
          },
        })) || updatedOrder;

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.status.update',
          entityType: 'sales_order',
          entityId: orderForLog.id,
          beforeData: toSalesOrderDto(current),
          afterData: toSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForLog;
    });

    return toSalesOrderDto(updated);
  }

  async setSalesOrderFinanceMark(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: {
        items: true,
        customer: true,
        travelGroup: true,
      },
    });
    if (!current) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }

    const marked = normalizeBoolean(
      payload?.financeMark ?? payload?.marked,
      'financeMark',
    );
    const updated = await this.prisma.salesOrder.update({
      where: {
        id,
      },
      data: buildFinanceMarkData(marked, actor),
      include: {
        items: true,
        customer: true,
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
    const orderWhere = await this.buildScopedSalesOrderWhere(
      actor,
      buildSalesOrderWhere(filters),
    );
    const groupWhere = await this.buildScopedGroupWhere(
      'travel',
      actor,
      buildGroupWhere(
        {
          dateFrom: filters.dateFrom || filters.start,
          dateTo: filters.dateTo || filters.end,
        },
        'travel',
      ),
    );
    const [orders, groups] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: orderWhere,
        include: {
          items: true,
          customer: true,
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

    const validOrders = orders.filter(
      (order: any) => order.status !== 'CANCELLED',
    );
    const refundOrders = orders.filter((order: any) =>
      ['REFUNDED', 'PARTIAL_REFUND'].includes(order.status),
    );
    return {
      metrics: {
        travelGroupCount: groups.length,
        orderCount: orders.length,
        salesAmountCents: validOrders.reduce(
          (sum: number, order: any) =>
            sum + Number(order.totalAmountCents || 0),
          0,
        ),
        refundAmountCents: refundOrders.reduce(
          (sum: number, order: any) =>
            sum + Number(order.totalAmountCents || 0),
          0,
        ),
        cashOnDeliveryAmountCents: validOrders.reduce(
          (sum: number, order: any) =>
            sum + Number(order.cashOnDeliveryAmountCents || 0),
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

  private async refreshTravelGroupOrderSummary(
    tx: any,
    travelGroupId: string | null | undefined,
    actorId: string,
  ) {
    if (!travelGroupId) {
      return;
    }
    const orders = await tx.salesOrder.findMany({
      where: {
        travelGroupId,
        orderType: 'TRAVEL_GROUP',
        status: {
          in: ['VALID', 'PARTIAL_REFUND'],
        },
      },
    });
    const salesAmountCents = orders.reduce(
      (sum: number, order: any) => sum + Number(order.totalAmountCents || 0),
      0,
    );
    const cashOnDeliveryCents = orders.reduce(
      (sum: number, order: any) =>
        sum + Number(order.cashOnDeliveryAmountCents || 0),
      0,
    );
    await tx.travelGroup.update({
      where: {
        id: travelGroupId,
      },
      data: {
        status: orders.length > 0 ? 'ORDERED' : 'UNMARKED',
        salesAmountCents,
        orderAmountCents: salesAmountCents,
        cashOnDeliveryCents,
        updatedById: actorId,
        updatedAt: new Date(),
      },
    });
  }

  private groupDelegate(table: any) {
    return (this.prisma as any)[table.delegate];
  }

  private async buildScopedGroupWhere(
    kind: string,
    actor: any,
    baseWhere: any,
  ) {
    return andWhere(
      andWhere(baseWhere, await this.buildGroupDataScope(kind, actor)),
      await this.buildGlobalGroupMarkScope(),
    );
  }

  private async buildRoleScopedTravelGroupWhere(actor: any, baseWhere: any) {
    return andWhere(baseWhere, await this.buildGroupDataScope('travel', actor));
  }

  private async buildScopedSalesOrderWhere(actor: any, baseWhere: any) {
    return andWhere(
      andWhere(baseWhere, buildSalesOrderDataScope(actor)),
      await this.buildGlobalSalesOrderMarkScope(),
    );
  }

  private async buildGroupDataScope(kind: string, actor: any) {
    if (actor?.role === 'taster') {
      return { tasterId: actor.id };
    }

    if (actor?.role === 'front_desk' && kind === 'travel') {
      return { createdById: actor.id };
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
          .filter(
            (travelGroupId: any) =>
              typeof travelGroupId === 'string' && travelGroupId.length > 0,
          ),
      ),
    );
  }

  private async assertCanReadGroup(kind: string, actor: any, group: any) {
    if (actor?.role === 'taster') {
      if (group.tasterId === actor.id) {
        return;
      }
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }

    if (actor?.role === 'front_desk' && kind === 'travel') {
      if (group.createdById === actor.id) {
        return;
      }
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }

    if (actor?.role === 'sales') {
      if (group.createdById === actor.id) {
        return;
      }
      if (
        kind === 'travel' &&
        (await this.hasSalesRelatedOrder(actor, group.id))
      ) {
        return;
      }
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
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
    return {
      customer: {
        is: {
          financeMark: true,
        },
      },
      OR: [
        { travelGroupId: null },
        {
          travelGroup: {
            is: {
              financeMark: true,
            },
          },
        },
      ],
    };
  }

  private async assertPassesGlobalGroupMarkScope(group: any) {
    if ((await this.onlyShowMarkedRecords()) && !group.financeMark) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }
  }

  private async assertPassesGlobalSalesOrderMarkScope(order: any) {
    if (!(await this.onlyShowMarkedRecords())) {
      return;
    }
    if (
      order.customer?.financeMark &&
      (!order.travelGroupId || order.travelGroup?.financeMark)
    ) {
      return;
    }
    throw createHttpError(
      404,
      'SALES_ORDER_NOT_FOUND',
      'Sales order does not exist.',
    );
  }

  private async onlyShowMarkedRecords() {
    const settings = await this.settingsService.getGlobalMarkQuery();
    return Boolean(settings.onlyShowMarkedRecords);
  }

  private async findGroupOrThrow(kind: string, id: string, detail = false) {
    const table = getGroupTable(kind);
    const include = getGroupInclude(kind, detail ? 'detail' : 'list');
    const group = await this.groupDelegate(table).findUnique({
      where: {
        id,
      },
      ...(include ? { include } : {}),
    });
    if (!group) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }
    return group;
  }
}

function getGroupTable(kind: string) {
  const table = GROUP_TABLES[kind];
  if (!table) {
    throw createHttpError(
      400,
      'INVALID_GROUP_KIND',
      'Travel group table type is invalid.',
    );
  }
  return table;
}

function getGroupInclude(kind: string, mode = 'list') {
  if (kind !== 'travel') {
    return null;
  }
  if (mode === 'detail') {
    return {
      tastingItems: {
        orderBy: {
          sortOrder: 'asc',
        },
      },
      taster: true,
      salesOrders: {
        orderBy: {
          createdAt: 'desc',
        },
      },
    };
  }
  return {
    tastingItems: {
      orderBy: {
        sortOrder: 'asc',
      },
    },
    salesOrders: {
      orderBy: {
        createdAt: 'desc',
      },
    },
  };
}

function buildGroupWhere(filters: any = {}, kind = '') {
  const where: any = {};
  const query = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (query) {
    where.OR = [
      { groupNo: { contains: query } },
      { travelAgency: { contains: query } },
      { guideName: { contains: query } },
      { tasterName: { contains: query } },
    ];
  }
  const groupNo = normalizeOptionalString(filters.groupNo);
  if (groupNo) {
    where.groupNo = {
      contains: groupNo,
    };
  }
  const guideId = normalizeOptionalString(filters.guideId);
  if (guideId && kind === 'travel') {
    where.guideId = guideId;
  }
  const tasterId = normalizeOptionalString(filters.tasterId);
  if (tasterId) {
    where.tasterId = tasterId;
  }
  const groupType = normalizeOptionalString(filters.groupType);
  if (groupType) {
    where.groupType = groupType;
  }
  if (filters.financeMark !== undefined && filters.financeMark !== '') {
    where.financeMark = normalizeBoolean(filters.financeMark, 'financeMark');
  }
  if (filters.status) {
    where.status = toPrismaGroupStatus(filters.status);
  }
  const dateRange = buildDateRange(
    filters.dateFrom || filters.start,
    filters.dateTo || filters.end,
  );
  if (dateRange) {
    where.visitDate = dateRange;
  }
  return where;
}

function filterGroupDtosByComputedFields(groups: any[], filters: any = {}) {
  const pendingStatus = normalizeOptionalString(filters.pendingStatus);
  if (!pendingStatus) {
    return groups;
  }
  return groups.filter((group) => group.pendingStatus === pendingStatus);
}

function buildSalesOrderWhere(filters: any = {}) {
  let where: any = {};
  const query = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (query) {
    where = andWhere(where, {
      OR: [
        { orderNo: { contains: query } },
        { salesFormNo: { contains: query } },
        { customerName: { contains: query } },
        { customerPhone: { contains: query } },
        { address: { contains: query } },
        { customer: { is: { name: { contains: query } } } },
        { customer: { is: { phone: { contains: query } } } },
        { travelGroup: { is: { groupNo: { contains: query } } } },
        { travelGroup: { is: { travelAgency: { contains: query } } } },
      ],
    });
  }
  const customerId = normalizeOptionalString(filters.customerId);
  if (customerId) {
    where.customerId = customerId;
  }
  const customerPhone = normalizeOptionalString(filters.customerPhone);
  if (customerPhone) {
    where = andWhere(where, {
      OR: [
        { customerPhone: { contains: customerPhone } },
        { customer: { is: { phone: { contains: customerPhone } } } },
      ],
    });
  }
  const travelGroupId = normalizeOptionalString(filters.travelGroupId);
  if (travelGroupId) {
    where.travelGroupId = travelGroupId;
  }
  if (filters.orderType) {
    where.orderType = toPrismaOrderType(filters.orderType);
  }
  if (filters.status) {
    where.status = toPrismaOrderStatus(filters.status);
  }
  if (filters.deliveryType) {
    where.items = {
      some: {
        deliveryType: toPrismaDeliveryType(filters.deliveryType),
      },
    };
  }
  if (filters.packingStatus) {
    where.packingStatus = toPrismaPackingStatus(filters.packingStatus);
  }
  if (filters.financeMark !== undefined && filters.financeMark !== '') {
    where.financeMark = normalizeBoolean(filters.financeMark, 'financeMark');
  }
  if (
    filters.customerFinanceMark !== undefined &&
    filters.customerFinanceMark !== ''
  ) {
    where = andWhere(where, {
      customer: {
        is: {
          financeMark: normalizeBoolean(
            filters.customerFinanceMark,
            'customerFinanceMark',
          ),
        },
      },
    });
  }
  const salesUserId = normalizeOptionalString(filters.salesUserId);
  if (salesUserId) {
    where.salesUserId = salesUserId;
  }
  const dateRange = buildDateRange(
    filters.dateFrom || filters.start,
    filters.dateTo || filters.end,
  );
  if (dateRange) {
    where.orderDate = dateRange;
  }
  return where;
}

function buildSalesOrderDataScope(actor: any): any {
  if (actor?.role === 'sales') {
    return {
      OR: [{ salesUserId: actor.id }, { createdById: actor.id }],
    };
  }
  if (actor?.role === 'warehouse') {
    return {
      OR: [
        {
          items: {
            some: {
              deliveryType: 'SHIPPING',
            },
          },
        },
        {
          packingStatus: {
            in: ['PENDING', 'PACKING', 'ABNORMAL'],
          },
        },
      ],
    };
  }
  return null;
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

function assertSalesOrderPatchAllowedFields(actor: any, payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(
    SALES_ORDER_PATCH_ALLOWED_FIELDS_BY_ROLE[actor?.role] || [],
  );
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for ${actor.role}: ${deniedFields.join(', ')}.`,
    );
  }
  if (hasOwn(payload, 'customer')) {
    assertSalesOrderCustomerPatchAllowedFields(payload.customer);
  }
}

function assertSalesOrderFinancePatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(SALES_ORDER_FINANCE_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for sales order finance: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertSalesOrderPackingPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(SALES_ORDER_PACKING_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for sales order packing: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertSalesOrderStatusPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(SALES_ORDER_STATUS_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for sales order status: ${deniedFields.join(', ')}.`,
    );
  }
  if (!hasOwn(payload, 'status')) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'status is required.',
    );
  }
}

function assertSalesOrderCustomerPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'customer must be an object.',
    );
  }
  const allowedFields = new Set(SALES_ORDER_CUSTOMER_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Customer fields are not allowed here: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertCanUpdateSalesOrder(actor: any, order: any) {
  if (actor?.role === 'admin') {
    return;
  }
  if (
    actor?.role === 'sales' &&
    (order.salesUserId === actor.id || order.createdById === actor.id)
  ) {
    return;
  }
  throw createHttpError(
    404,
    'SALES_ORDER_NOT_FOUND',
    'Sales order does not exist.',
  );
}

function assertCanReadSalesOrder(actor: any, order: any) {
  if (actor?.role === 'sales') {
    if (order.salesUserId === actor.id || order.createdById === actor.id) {
      return;
    }
    throw createHttpError(
      404,
      'SALES_ORDER_NOT_FOUND',
      'Sales order does not exist.',
    );
  }
  if (actor?.role === 'warehouse') {
    if (isWarehouseReadableSalesOrder(order)) {
      return;
    }
    throw createHttpError(
      404,
      'SALES_ORDER_NOT_FOUND',
      'Sales order does not exist.',
    );
  }
}

function isWarehouseReadableSalesOrder(order: any) {
  if (['PENDING', 'PACKING', 'ABNORMAL'].includes(order.packingStatus)) {
    return;
  }
  return (Array.isArray(order.items) ? order.items : []).some(
    (item: any) => item.deliveryType === 'SHIPPING',
  );
}

function getSalesOrderSummaryAffectedTravelGroupIds(current: any, updated: any) {
  const summaryChanged =
    current.travelGroupId !== updated.travelGroupId ||
    current.orderType !== updated.orderType ||
    current.status !== updated.status ||
    Number(current.totalAmountCents || 0) !==
      Number(updated.totalAmountCents || 0) ||
    Number(current.cashOnDeliveryAmountCents || 0) !==
      Number(updated.cashOnDeliveryAmountCents || 0);
  if (!summaryChanged) {
    return [];
  }
  return Array.from(
    new Set(
      [current.travelGroupId, updated.travelGroupId].filter(
        (travelGroupId) =>
          typeof travelGroupId === 'string' && travelGroupId.length > 0,
      ),
    ),
  );
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
  const dateRange = buildDateRange(
    filters.dateFrom || filters.start,
    filters.dateTo || filters.end,
  );
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
  assignInt(
    data,
    'liquorCostDeductionCents',
    payload?.liquorCostDeductionCents,
  );
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

function buildTravelGroupCreateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    id: crypto.randomUUID(),
    visitDate: parseDate(payload?.visitDate, 'visitDate', true),
    travelAgency: normalizeRequiredString(
      payload?.travelAgency,
      'travelAgency',
    ),
    licensePlate: normalizeRequiredString(
      payload?.licensePlate,
      'licensePlate',
    ),
    guideId: normalizeRequiredString(payload?.guideId, 'guideId'),
    guestCount: normalizeInt(payload?.guestCount, 'guestCount'),
    tastingRoomNo: normalizeRequiredString(
      payload?.tastingRoomNo,
      'tastingRoomNo',
    ),
    tasterId: normalizeRequiredString(payload?.tasterId, 'tasterId'),
    groupType: normalizeRequiredString(payload?.groupType, 'groupType'),
    createdById: actor.id,
    updatedById: actor.id,
    financeMark: false,
    createdAt: now,
    updatedAt: now,
    status: 'UNMARKED',
  };

  assignNullableString(data, 'arrivalTime', payload?.arrivalTime);
  assignNullableString(data, 'wineDetails', payload?.wineDetails);
  assignNullableString(data, 'departureTime', payload?.departureTime);
  assignNullableString(data, 'remarks', payload?.remarks);
  if (payload?.status !== undefined) {
    data.status = toPrismaGroupStatus(payload.status);
  }
  assignInt(data, 'salesAmountCents', payload?.salesAmountCents);
  assignInt(data, 'paidDepositCents', payload?.paidDepositCents);
  assignInt(data, 'cashOnDeliveryCents', payload?.cashOnDeliveryCents);
  assignInt(
    data,
    'liquorCostDeductionCents',
    payload?.liquorCostDeductionCents,
  );
  assignInt(data, 'orderAmountCents', payload?.orderAmountCents);
  assignInt(data, 'points', payload?.points);
  assignInt(data, 'returnedPoints', payload?.returnedPoints);
  assignInt(data, 'unreturnedPoints', payload?.unreturnedPoints);
  assignBool(data, 'guideInfoSent', payload?.guideInfoSent);
  assignBool(data, 'travelAgencyInfoSent', payload?.travelAgencyInfoSent);
  return data;
}

function buildTravelGroupUpdateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  assignString(data, 'groupNo', payload?.groupNo, false, 'groupNo');
  if (payload?.visitDate !== undefined) {
    data.visitDate = parseDate(payload.visitDate, 'visitDate', false);
  }
  assignNullableString(data, 'travelAgency', payload?.travelAgency);
  assignNullableString(data, 'licensePlate', payload?.licensePlate);
  if (payload?.guideId !== undefined) {
    data.guideId = normalizeRequiredString(payload.guideId, 'guideId');
  }
  assignNullableString(data, 'guideName', payload?.guideName);
  assignNullableString(data, 'guidePhone', payload?.guidePhone);
  assignInt(data, 'guestCount', payload?.guestCount);
  assignNullableString(data, 'tastingRoomNo', payload?.tastingRoomNo);
  if (payload?.tasterId !== undefined) {
    data.tasterId = normalizeRequiredString(payload.tasterId, 'tasterId');
  }
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
  assignInt(
    data,
    'liquorCostDeductionCents',
    payload?.liquorCostDeductionCents,
  );
  assignInt(data, 'orderAmountCents', payload?.orderAmountCents);
  assignInt(data, 'points', payload?.points);
  assignInt(data, 'returnedPoints', payload?.returnedPoints);
  assignInt(data, 'unreturnedPoints', payload?.unreturnedPoints);
  assignNormalizedBool(data, 'guideInfoSent', payload?.guideInfoSent);
  assignNormalizedBool(
    data,
    'travelAgencyInfoSent',
    payload?.travelAgencyInfoSent,
  );
  if (payload?.tasterSummary !== undefined) {
    data.tasterSummary = normalizeOptionalString(payload.tasterSummary);
    data.tasterSummaryAt = data.tasterSummary ? now : null;
  }
  return data;
}

function buildTravelGroupTastingItems(items: any[]) {
  if (items === undefined || items === null) {
    return [];
  }
  if (!Array.isArray(items)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'tastingItems must be an array.',
    );
  }
  const now = new Date();
  return items.map((item, index) => {
    const quantity = normalizeInt(
      item?.quantity,
      `tastingItems[${index}].quantity`,
    );
    if (quantity <= 0) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `tastingItems[${index}].quantity must be greater than 0.`,
      );
    }
    return {
      id: crypto.randomUUID(),
      productName: normalizeRequiredString(
        item?.productName,
        `tastingItems[${index}].productName`,
      ),
      quantity,
      unit: normalizeRequiredString(item?.unit, `tastingItems[${index}].unit`),
      note: normalizeOptionalString(item?.note),
      sortOrder: normalizeInt(
        item?.sortOrder,
        `tastingItems[${index}].sortOrder`,
        index + 1,
      ),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function buildSalesOrderData(payload: any, actor: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const now = new Date();
  const items = buildSalesOrderItems(payload?.items);
  const totalAmountCents = items.reduce(
    (sum: number, item: any) => sum + item.subtotalCents,
    0,
  );

  const data: any = {
    id: crypto.randomUUID(),
    orderType: toPrismaOrderType(payload?.orderType || 'travel_group'),
    travelGroupId: normalizeOptionalString(payload?.travelGroupId),
    orderDate: parseDate(payload?.orderDate, 'orderDate', true),
    salesFormNo: normalizeOptionalString(payload?.salesFormNo),
    totalAmountCents,
    cashOnDeliveryAmountCents: normalizeInt(
      payload?.cashOnDeliveryAmountCents,
      'cashOnDeliveryAmountCents',
      0,
    ),
    logisticsMethod: null,
    packingStatus: items.some((item: any) => item.deliveryType === 'SHIPPING')
      ? 'PENDING'
      : 'PACKED',
    packageCount: 0,
    warehouseRemark: null,
    logisticsNo: null,
    logisticsFeeCents: 0,
    invoiceRequired:
      payload?.invoiceRequired === undefined
        ? false
        : normalizeBoolean(payload.invoiceRequired, 'invoiceRequired'),
    invoiceIssued: false,
    financeRemark: null,
    remark: normalizeOptionalString(payload?.remark),
    status: toPrismaOrderStatus(payload?.status || 'valid'),
    financeMark: false,
    markedById: null,
    markedAt: null,
    salesUserId:
      actor.role === 'sales'
        ? actor.id
        : normalizeOptionalString(payload?.salesUserId),
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

function buildSalesOrderUpdateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  if (hasOwn(payload, 'orderType')) {
    data.orderType = toPrismaOrderType(payload.orderType);
  }
  if (hasOwn(payload, 'salesUserId')) {
    data.salesUserId = normalizeOptionalString(payload.salesUserId);
  }
  if (hasOwn(payload, 'salesFormNo')) {
    data.salesFormNo = normalizeOptionalString(payload.salesFormNo);
  }
  if (hasOwn(payload, 'orderDate')) {
    data.orderDate = parseDate(payload.orderDate, 'orderDate', true);
  }
  if (hasOwn(payload, 'travelGroupId')) {
    data.travelGroupId = normalizeOptionalString(payload.travelGroupId);
  }
  if (hasOwn(payload, 'cashOnDeliveryAmountCents')) {
    data.cashOnDeliveryAmountCents = normalizeNonNegativeInt(
      payload.cashOnDeliveryAmountCents,
      'cashOnDeliveryAmountCents',
    );
  }
  if (hasOwn(payload, 'invoiceRequired')) {
    data.invoiceRequired = normalizeBoolean(
      payload.invoiceRequired,
      'invoiceRequired',
    );
  }
  if (hasOwn(payload, 'remark')) {
    data.remark = normalizeOptionalString(payload.remark);
  }
  if (hasOwn(payload, 'status')) {
    data.status = toPrismaOrderStatus(payload.status);
  }
  if (hasOwn(payload, 'items')) {
    const items = buildSalesOrderItems(payload.items);
    data.totalAmountCents = items.reduce(
      (sum: number, item: any) => sum + Number(item.subtotalCents || 0),
      0,
    );
    data.items = {
      deleteMany: {},
      create: items,
    };
  }

  return data;
}

function buildSalesOrderFinanceUpdateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  if (hasOwn(payload, 'logisticsNo')) {
    data.logisticsNo = normalizeOptionalString(payload.logisticsNo);
  }
  if (hasOwn(payload, 'logisticsFeeCents')) {
    data.logisticsFeeCents = normalizeNonNegativeInt(
      payload.logisticsFeeCents,
      'logisticsFeeCents',
    );
  }
  if (hasOwn(payload, 'invoiceIssued')) {
    data.invoiceIssued = normalizeBoolean(
      payload.invoiceIssued,
      'invoiceIssued',
    );
  }
  if (hasOwn(payload, 'financeRemark')) {
    data.financeRemark = normalizeOptionalString(payload.financeRemark);
  }
  if (hasOwn(payload, 'status')) {
    data.status = toPrismaOrderStatus(payload.status);
  }

  return data;
}

function buildSalesOrderPackingUpdateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  if (hasOwn(payload, 'logisticsMethod')) {
    data.logisticsMethod = normalizeOptionalString(payload.logisticsMethod);
  }
  if (hasOwn(payload, 'packingStatus')) {
    data.packingStatus = toPrismaPackingStatus(payload.packingStatus);
  }
  if (hasOwn(payload, 'packageCount')) {
    data.packageCount = normalizeNonNegativeInt(
      payload.packageCount,
      'packageCount',
    );
  }
  if (hasOwn(payload, 'warehouseRemark')) {
    data.warehouseRemark = normalizeOptionalString(payload.warehouseRemark);
  }

  return data;
}

function buildSalesOrderStatusUpdateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    status: toPrismaOrderStatus(payload.status),
    updatedById: actor.id,
    updatedAt: now,
  };

  if (hasOwn(payload, 'statusReason')) {
    data.remark = normalizeOptionalString(payload.statusReason);
  } else if (hasOwn(payload, 'remark')) {
    data.remark = normalizeOptionalString(payload.remark);
  }

  return data;
}

async function resolveSalesOrderCustomer(tx: any, payload: any, actor: any) {
  const customerId = normalizeOptionalString(payload?.customerId);
  if (customerId) {
    const customer = await tx.customer.findUnique({
      where: {
        id: customerId,
      },
    });
    if (!customer) {
      throw createHttpError(
        404,
        'CUSTOMER_NOT_FOUND',
        'Customer does not exist.',
      );
    }
    return {
      customer,
      created: false,
    };
  }

  if (payload?.customer !== undefined) {
    const customer = await tx.customer.create({
      data: buildCustomerCreateData(payload.customer, actor),
    });
    return {
      customer,
      created: true,
    };
  }

  throw createHttpError(
    400,
    'CUSTOMER_REQUIRED',
    'customerId or customer is required.',
  );
}

async function resolveSalesOrderPatchCustomer(
  tx: any,
  payload: any,
  currentOrder: any,
  actor: any,
) {
  const hasCustomerId = hasOwn(payload, 'customerId');
  const hasCustomerPayload = hasOwn(payload, 'customer');
  if (!hasCustomerId && !hasCustomerPayload) {
    return {
      customer: null,
      created: false,
      updated: false,
      beforeCustomer: null,
    };
  }

  if (hasCustomerId) {
    const customerId = normalizeOptionalString(payload.customerId);
    if (!customerId) {
      throw createHttpError(
        400,
        'CUSTOMER_REQUIRED',
        'customerId cannot be empty when relinking a sales order.',
      );
    }
    const customer = await tx.customer.findUnique({
      where: {
        id: customerId,
      },
    });
    if (!customer) {
      throw createHttpError(
        404,
        'CUSTOMER_NOT_FOUND',
        'Customer does not exist.',
      );
    }
    if (!hasCustomerPayload) {
      return {
        customer,
        created: false,
        updated: false,
        beforeCustomer: null,
      };
    }
    const updatedCustomer = await tx.customer.update({
      where: {
        id: customer.id,
      },
      data: buildCustomerPatchData(payload.customer, actor),
    });
    return {
      customer: updatedCustomer,
      created: false,
      updated: true,
      beforeCustomer: customer,
    };
  }

  if (currentOrder.customerId) {
    const customer = await tx.customer.findUnique({
      where: {
        id: currentOrder.customerId,
      },
    });
    if (customer) {
      const updatedCustomer = await tx.customer.update({
        where: {
          id: customer.id,
        },
        data: buildCustomerPatchData(payload.customer, actor),
      });
      return {
        customer: updatedCustomer,
        created: false,
        updated: true,
        beforeCustomer: customer,
      };
    }
  }

  const createdCustomer = await tx.customer.create({
    data: buildCustomerCreateData(payload.customer, actor),
  });
  return {
    customer: createdCustomer,
    created: true,
    updated: false,
    beforeCustomer: null,
  };
}

function buildCustomerCreateData(payload: any, actor: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'customer must be an object.',
    );
  }
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name: normalizeRequiredString(payload?.name, 'customer.name'),
    phone: normalizeOptionalString(payload?.phone),
    province: normalizeOptionalString(payload?.province),
    city: normalizeOptionalString(payload?.city),
    district: normalizeOptionalString(payload?.district),
    address: normalizeOptionalString(payload?.address),
    financeMark: false,
    markedById: null,
    markedAt: null,
    notes: normalizeOptionalString(payload?.notes),
    createdById: actor.id,
    updatedById: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

function buildCustomerPatchData(payload: any, actor: any) {
  assertSalesOrderCustomerPatchAllowedFields(payload);
  const data: any = {
    updatedById: actor.id,
    updatedAt: new Date(),
  };
  if (hasOwn(payload, 'name')) {
    data.name = normalizeRequiredString(payload.name, 'customer.name');
  }
  if (hasOwn(payload, 'phone')) {
    data.phone = normalizeOptionalString(payload.phone);
  }
  if (hasOwn(payload, 'province')) {
    data.province = normalizeOptionalString(payload.province);
  }
  if (hasOwn(payload, 'city')) {
    data.city = normalizeOptionalString(payload.city);
  }
  if (hasOwn(payload, 'district')) {
    data.district = normalizeOptionalString(payload.district);
  }
  if (hasOwn(payload, 'address')) {
    data.address = normalizeOptionalString(payload.address);
  }
  if (hasOwn(payload, 'notes')) {
    data.notes = normalizeOptionalString(payload.notes);
  }
  return data;
}

function buildSalesOrderCustomerSnapshotData(customer: any) {
  return {
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone || null,
    province: customer.province || null,
    city: customer.city || null,
    district: customer.district || null,
    address: customer.address || null,
  };
}

function buildSalesOrderItems(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'items must contain at least one item.',
    );
  }
  const now = new Date();
  return items.map((item, index) => {
    const quantity = normalizeInt(item?.quantity, `items[${index}].quantity`);
    if (quantity <= 0) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `items[${index}].quantity must be greater than 0.`,
      );
    }
    const unitPriceCents = normalizeNonNegativeInt(
      item?.unitPriceCents,
      `items[${index}].unitPriceCents`,
    );
    return {
      id: crypto.randomUUID(),
      productName: normalizeRequiredString(
        item?.productName,
        `items[${index}].productName`,
      ),
      quantity,
      unitPriceCents,
      subtotalCents: quantity * unitPriceCents,
      deliveryType: toPrismaDeliveryType(item?.deliveryType),
      notes: normalizeOptionalString(item?.notes),
      sortOrder: normalizeInt(
        item?.sortOrder,
        `items[${index}].sortOrder`,
        index + 1,
      ),
      createdAt: now,
    };
  });
}

function buildReconciliationData(payload: any, actor: any) {
  return {
    businessDate: parseDate(payload?.businessDate, 'businessDate', true),
    travelGroupSalesCents: normalizeInt(
      payload?.travelGroupSalesCents,
      'travelGroupSalesCents',
      0,
    ),
    backOfficeSalesCents: normalizeInt(
      payload?.backOfficeSalesCents,
      'backOfficeSalesCents',
      0,
    ),
    buybackCents: normalizeInt(payload?.buybackCents, 'buybackCents', 0),
    externalSalesCents: normalizeInt(
      payload?.externalSalesCents,
      'externalSalesCents',
      0,
    ),
    internalPurchaseCents: normalizeInt(
      payload?.internalPurchaseCents,
      'internalPurchaseCents',
      0,
    ),
    afterSalesCents: normalizeInt(
      payload?.afterSalesCents,
      'afterSalesCents',
      0,
    ),
    // refundsCents is stored as a positive deduction; totals subtract it when rendering reconciliation.
    refundsCents: normalizeNonNegativeInt(
      payload?.refundsCents,
      'refundsCents',
      0,
    ),
    otherReceivableCents: normalizeInt(
      payload?.otherReceivableCents,
      'otherReceivableCents',
      0,
    ),
    notes: normalizeOptionalString(payload?.notes),
    updatedById: actor.id,
    updatedAt: new Date(),
  };
}

function buildPaymentMethods(methods: any[]) {
  if (!Array.isArray(methods)) {
    return [];
  }
  return methods.map((method, index) => ({
    id: crypto.randomUUID(),
    name: normalizeRequiredString(
      method?.name,
      `paymentMethods[${index}].name`,
    ),
    amountCents: normalizeInt(
      method?.amountCents,
      `paymentMethods[${index}].amountCents`,
      0,
    ),
    sortOrder: normalizeInt(
      method?.sortOrder,
      `paymentMethods[${index}].sortOrder`,
      index + 1,
    ),
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
    salesAmountCents: normalizeInt(
      payload?.salesAmountCents,
      'salesAmountCents',
      0,
    ),
    bonusAmountCents: normalizeInt(
      payload?.bonusAmountCents,
      'bonusAmountCents',
      0,
    ),
    tasterPaidDate: parseOptionalDate(
      payload?.tasterPaidDate,
      'tasterPaidDate',
    ),
    salesPaidDate: parseOptionalDate(payload?.salesPaidDate, 'salesPaidDate'),
    createdAt: now,
    updatedAt: now,
  };
}

function toGroupDto(group: any, kind: string) {
  const pending = calculateGroupPendingState(group, kind);
  const rawSalesOrders = Array.isArray(group.salesOrders)
    ? group.salesOrders
    : [];
  const salesOrders = rawSalesOrders.map(toTravelGroupOrderSummaryDto);
  const effectiveSalesOrders = getEffectiveSalesOrders(rawSalesOrders).map(
    toTravelGroupOrderSummaryDto,
  );
  return {
    id: group.id,
    kind,
    groupNo: group.groupNo,
    visitDate: formatDate(group.visitDate),
    travelAgency: group.travelAgency || null,
    licensePlate: group.licensePlate || null,
    guideName: group.guideName || null,
    guidePhone: group.guidePhone || null,
    guestCount: Number(group.guestCount || 0),
    tastingRoomNo: group.tastingRoomNo || null,
    tasterName: group.tasterName || null,
    arrivalTime: group.arrivalTime || null,
    groupType: group.groupType || null,
    wineDetails: group.wineDetails || null,
    departureTime: group.departureTime || null,
    remarks: group.remarks || null,
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
    guide: buildGuideSnapshotDto(group),
    guideId: group.guideId || null,
    tasterId: group.tasterId || null,
    taster: buildTasterSnapshotDto(group),
    tasterSummary: group.tasterSummary || null,
    tasterSummaryAt: group.tasterSummaryAt
      ? toIsoString(group.tasterSummaryAt)
      : null,
    tastingItems: Array.isArray(group.tastingItems)
      ? group.tastingItems
          .slice()
          .sort(
            (left: any, right: any) =>
              Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
          )
          .map(toTravelGroupTastingItemDto)
      : [],
    salesOrders,
    orderSummary: buildTravelGroupOrderSummaryDto(effectiveSalesOrders),
    pendingStatus: pending.status,
    pendingReasons: pending.reasons,
    createdAt: toIsoString(group.createdAt),
    updatedAt: toIsoString(group.updatedAt),
  };
}

function buildGuideSnapshotDto(group: any) {
  if (
    !group.guideId &&
    !group.guideName &&
    !group.guidePhone &&
    !group.travelAgency
  ) {
    return null;
  }
  return {
    id: group.guideId || null,
    name: group.guideName || null,
    phone: group.guidePhone || null,
    travelAgency: group.travelAgency || null,
  };
}

function buildTasterSnapshotDto(group: any) {
  if (group.taster) {
    return {
      id: group.taster.id,
      name: group.taster.name,
      username: group.taster.username,
    };
  }
  if (!group.tasterId && !group.tasterName) {
    return null;
  }
  return {
    id: group.tasterId || null,
    name: group.tasterName || null,
    username: null,
  };
}

function toTravelGroupOrderSummaryDto(order: any) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: ORDER_TYPE_FROM_PRISMA[order.orderType] || order.orderType,
    orderDate: formatDate(order.orderDate),
    customerName: order.customerName || null,
    customerPhone: order.customerPhone || null,
    totalAmountCents: Number(order.totalAmountCents || 0),
    cashOnDeliveryAmountCents: Number(order.cashOnDeliveryAmountCents || 0),
    status: ORDER_STATUS_FROM_PRISMA[order.status] || order.status,
    financeMark: Boolean(order.financeMark),
    markedById: order.markedById || null,
    markedAt: order.markedAt ? toIsoString(order.markedAt) : null,
    salesUserId: order.salesUserId || null,
  };
}

function buildTravelGroupOrderSummaryDto(salesOrders: any[]) {
  return {
    orderCount: salesOrders.length,
    totalAmountCents: salesOrders.reduce(
      (sum, order) => sum + Number(order.totalAmountCents || 0),
      0,
    ),
    cashOnDeliveryAmountCents: salesOrders.reduce(
      (sum, order) => sum + Number(order.cashOnDeliveryAmountCents || 0),
      0,
    ),
  };
}

function getEffectiveSalesOrders(salesOrders: any[]) {
  return (Array.isArray(salesOrders) ? salesOrders : []).filter(
    (order: any) =>
      ['VALID', 'PARTIAL_REFUND', 'valid', 'partial_refund'].includes(
        order?.status,
      ),
  );
}

function calculateGroupPendingState(group: any, kind: string) {
  if (kind !== 'travel') {
    return {
      status: null,
      reasons: [],
    };
  }

  const findings: any[] = [];
  const addFinding = (status: string, reason: string) => {
    findings.push({ status, reason });
  };

  if (!hasText(group.tasterId) && !hasText(group.tasterName)) {
    addFinding('pending_front_desk', 'missing_taster');
  }
  if (!hasText(group.guideName)) {
    addFinding('pending_front_desk', 'missing_guide_name');
  }
  if (!hasText(group.guidePhone)) {
    addFinding('pending_front_desk', 'missing_guide_phone');
  }
  if (!hasText(group.travelAgency)) {
    addFinding('pending_front_desk', 'missing_travel_agency');
  }

  const guestCount = Number(group.guestCount || 0);
  if (!Number.isFinite(guestCount) || guestCount <= 0) {
    addFinding('pending_front_desk', 'missing_guest_count');
  }
  if (guestCount === 0) {
    addFinding('abnormal', 'invalid_guest_count_zero');
  }

  const salesOrders = getEffectiveSalesOrders(group.salesOrders);
  if (salesOrders.length === 0 && !hasText(group.tasterSummary)) {
    addFinding('pending_taster', 'no_order_and_missing_taster_summary');
  }

  if (!group.financeMark && isAfterVisitDayEnd(group.visitDate)) {
    addFinding('pending_finance', 'finance_unmarked_after_day_end');
  }

  if (group.__duplicateGroupNo) {
    addFinding('abnormal', 'duplicate_group_no');
  }

  const arrivalMinutes = parseClockMinutes(group.arrivalTime);
  const departureMinutes = parseClockMinutes(group.departureTime);
  if (
    arrivalMinutes !== null &&
    departureMinutes !== null &&
    departureMinutes < arrivalMinutes
  ) {
    addFinding('abnormal', 'departure_before_arrival');
  }

  const status =
    [
      'abnormal',
      'pending_front_desk',
      'pending_taster',
      'pending_finance',
    ].find((candidate) =>
      findings.some((finding) => finding.status === candidate),
    ) || null;
  return {
    status,
    reasons: Array.from(new Set(findings.map((finding) => finding.reason))),
  };
}

function annotateDuplicateGroupNos(groups: any[]) {
  const counts = new Map<string, number>();
  for (const group of groups) {
    if (hasText(group.groupNo)) {
      counts.set(group.groupNo, (counts.get(group.groupNo) || 0) + 1);
    }
  }
  return groups.map((group) => ({
    ...group,
    __duplicateGroupNo:
      hasText(group.groupNo) && (counts.get(group.groupNo) || 0) > 1,
  }));
}

function hasOwn(value: any, key: string) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function hasText(value: unknown) {
  return typeof value === 'string'
    ? value.trim().length > 0
    : value !== undefined && value !== null && value !== '';
}

function isAfterVisitDayEnd(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return Date.now() > end.getTime();
}

function parseClockMinutes(value: unknown) {
  if (!hasText(value)) {
    return null;
  }
  const match = String(value)
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function toTravelGroupTastingItemDto(item: any) {
  return {
    id: item.id,
    travelGroupId: item.travelGroupId || null,
    productName: item.productName,
    quantity: Number(item.quantity || 0),
    unit: item.unit,
    note: item.note || null,
    sortOrder: Number(item.sortOrder || 0),
  };
}

function toSalesOrderDto(order: any) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: ORDER_TYPE_FROM_PRISMA[order.orderType] || order.orderType,
    travelGroupId: order.travelGroupId,
    travelGroup: order.travelGroup
      ? toGroupDto(order.travelGroup, 'travel')
      : null,
    customerId: order.customerId || null,
    customer: order.customer ? toSalesOrderCustomerDto(order.customer) : null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    province: order.province,
    city: order.city,
    district: order.district,
    address: order.address,
    orderDate: formatDate(order.orderDate),
    salesFormNo: order.salesFormNo || null,
    totalAmountCents: Number(order.totalAmountCents || 0),
    cashOnDeliveryAmountCents: Number(order.cashOnDeliveryAmountCents || 0),
    deliverySummary: toSalesOrderDeliverySummary(order.items),
    logisticsMethod: order.logisticsMethod || null,
    packingStatus: order.packingStatus
      ? String(order.packingStatus).toLowerCase()
      : null,
    packageCount: Number(order.packageCount || 0),
    warehouseRemark: order.warehouseRemark || null,
    logisticsNo: order.logisticsNo || null,
    logisticsFeeCents: Number(order.logisticsFeeCents || 0),
    invoiceRequired: Boolean(order.invoiceRequired),
    invoiceIssued: Boolean(order.invoiceIssued),
    financeRemark: order.financeRemark || null,
    remark: order.remark,
    status: ORDER_STATUS_FROM_PRISMA[order.status] || order.status,
    financeMark: Boolean(order.financeMark),
    markedById: order.markedById || null,
    markedAt: order.markedAt ? toIsoString(order.markedAt) : null,
    salesUserId: order.salesUserId || null,
    items: Array.isArray(order.items)
      ? order.items.map(toSalesOrderItemDto)
      : [],
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
  };
}

function toSalesOrderDeliverySummary(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const types = new Set(
    items
      .map(
        (item: any) =>
          DELIVERY_TYPE_FROM_PRISMA[item?.deliveryType] ||
          item?.deliveryType,
      )
      .filter(
        (type: any) => type === 'shipping' || type === 'self_pickup',
      ),
  );
  if (types.size === 0) {
    return null;
  }
  if (types.size > 1) {
    return 'mixed';
  }
  return Array.from(types)[0];
}

function toSalesOrderCustomerDto(customer: any) {
  return {
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
    createdAt: customer.createdAt ? toIsoString(customer.createdAt) : null,
    updatedAt: customer.updatedAt ? toIsoString(customer.updatedAt) : null,
  };
}

function toSalesOrderItemDto(item: any) {
  return {
    id: item.id,
    productName: item.productName,
    quantity: Number(item.quantity || 0),
    unitPriceCents: Number(item.unitPriceCents || 0),
    subtotalCents: Number(item.subtotalCents || 0),
    deliveryType:
      DELIVERY_TYPE_FROM_PRISMA[item.deliveryType] || item.deliveryType,
    notes: item.notes || null,
    sortOrder: Number(item.sortOrder || 0),
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
        .sort(
          (left: any, right: any) =>
            Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
        )
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
  const actualTotalCents = paymentMethods.reduce(
    (sum: number, method: any) => sum + method.amountCents,
    0,
  );

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
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this action.',
    );
  }
}

function assertTravelGroupPatchAllowedFields(actor: any, payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(
    TRAVEL_GROUP_PATCH_ALLOWED_FIELDS_BY_ROLE[actor?.role] || [],
  );
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for ${actor.role}: ${deniedFields.join(', ')}.`,
    );
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
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `${fieldName} is required.`,
      );
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
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid date.`,
    );
  }
  return date;
}

function parseOptionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  return parseDate(value, fieldName, true);
}

function assignString(
  data: any,
  key: string,
  value: unknown,
  required: boolean,
  fieldName: string,
) {
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

function assignNormalizedBool(data: any, key: string, value: unknown) {
  if (value !== undefined) {
    data[key] = normalizeBoolean(value, key);
  }
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

function normalizeInt(value: unknown, fieldName: string, fallback?: number) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a number.`,
    );
  }
  return Math.trunc(numberValue);
}

function normalizeNonNegativeInt(
  value: unknown,
  fieldName: string,
  fallback?: number,
) {
  const normalized = normalizeInt(value, fieldName, fallback);
  if (normalized < 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a non-negative number.`,
    );
  }
  return normalized;
}

function toPrismaGroupStatus(value: unknown) {
  const status = GROUP_STATUS_TO_PRISMA[String(value || '').trim()];
  if (!status) {
    throw createHttpError(
      400,
      'INVALID_GROUP_STATUS',
      'Travel group status is invalid.',
    );
  }
  return status;
}

function toPrismaOrderType(value: unknown) {
  const orderType = ORDER_TYPE_TO_PRISMA[String(value || '').trim()];
  if (!orderType) {
    throw createHttpError(
      400,
      'INVALID_ORDER_TYPE',
      'Sales order type is invalid.',
    );
  }
  return orderType;
}

function toPrismaOrderStatus(value: unknown) {
  const status = ORDER_STATUS_TO_PRISMA[String(value || '').trim()];
  if (!status) {
    throw createHttpError(
      400,
      'INVALID_ORDER_STATUS',
      'Sales order status is invalid.',
    );
  }
  return status;
}

function toPrismaDeliveryType(value: unknown) {
  const deliveryType = DELIVERY_TYPE_TO_PRISMA[String(value || '').trim()];
  if (!deliveryType) {
    throw createHttpError(
      400,
      'INVALID_DELIVERY_TYPE',
      'Sales order item delivery type is invalid.',
    );
  }
  return deliveryType;
}

function toPrismaPackingStatus(value: unknown) {
  const packingStatus = PACKING_STATUS_TO_PRISMA[String(value || '').trim()];
  if (!packingStatus) {
    throw createHttpError(
      400,
      'INVALID_PACKING_STATUS',
      'Sales order packing status is invalid.',
    );
  }
  return packingStatus;
}

function isActiveTasterUser(user: any) {
  return (
    Boolean(user?.isActive) &&
    ['TASTER', 'taster'].includes(String(user?.role || ''))
  );
}

function normalizeTake(value: unknown, fallback: number) {
  const raw =
    value === undefined ? fallback : normalizeInt(value, 'limit', fallback);
  return Math.min(Math.max(raw, 1), 200);
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

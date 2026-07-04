import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildGlobalCustomerMarkScope as buildSharedGlobalCustomerMarkScope,
  buildGlobalSalesOrderMarkScope as buildSharedGlobalSalesOrderMarkScope,
  buildGlobalTravelGroupMarkScope as buildSharedGlobalTravelGroupMarkScope,
} from '../analytics/analytics-scope.helper';
import { CommissionRecordsNestService } from '../commissions/commission-records.nest.service';
import { TravelGroupFinanceSummaryNestService } from '../commissions/travel-group-finance-summary.nest.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  calculateQrCodeExpiresAt,
  generateQrCodeToken,
  hasReusableQrCodeToken,
  isQrCodeTokenUnexpired,
} from './qr-code-token.helper';
import {
  renderPublicSalesSheetErrorHtml,
  renderPublicSalesSheetHtml,
} from './public-sales-sheet-html.helper';
import { withGeneratedAfterSalesNo } from './after-sales-order-no.helper';
import { withGeneratedSalesOrderNo } from './sales-order-no.helper';
import { buildSalesSheetDto } from './sales-sheet.dto.helper';
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

const AFTER_SALES_STATUS_TO_PRISMA: any = {
  negotiating: 'NEGOTIATING',
  waiting_receive: 'WAITING_RECEIVE',
  waiting_resend: 'WAITING_RESEND',
  waiting_refund: 'WAITING_REFUND',
  completed: 'COMPLETED',
  NEGOTIATING: 'NEGOTIATING',
  WAITING_RECEIVE: 'WAITING_RECEIVE',
  WAITING_RESEND: 'WAITING_RESEND',
  WAITING_REFUND: 'WAITING_REFUND',
  COMPLETED: 'COMPLETED',
};

const AFTER_SALES_STATUS_FROM_PRISMA: any = {
  NEGOTIATING: 'negotiating',
  WAITING_RECEIVE: 'waiting_receive',
  WAITING_RESEND: 'waiting_resend',
  WAITING_REFUND: 'waiting_refund',
  COMPLETED: 'completed',
};

const AFTER_SALES_ISSUE_TYPE_TO_PRISMA: any = {
  quality_issue: 'QUALITY_ISSUE',
  logistics_damage: 'LOGISTICS_DAMAGE',
  wrong_item: 'WRONG_ITEM',
  missing_item: 'MISSING_ITEM',
  customer_return: 'CUSTOMER_RETURN',
  invoice_issue: 'INVOICE_ISSUE',
  other: 'OTHER',
  QUALITY_ISSUE: 'QUALITY_ISSUE',
  LOGISTICS_DAMAGE: 'LOGISTICS_DAMAGE',
  WRONG_ITEM: 'WRONG_ITEM',
  MISSING_ITEM: 'MISSING_ITEM',
  CUSTOMER_RETURN: 'CUSTOMER_RETURN',
  INVOICE_ISSUE: 'INVOICE_ISSUE',
  OTHER: 'OTHER',
};

const AFTER_SALES_ISSUE_TYPE_FROM_PRISMA: any = {
  QUALITY_ISSUE: 'quality_issue',
  LOGISTICS_DAMAGE: 'logistics_damage',
  WRONG_ITEM: 'wrong_item',
  MISSING_ITEM: 'missing_item',
  CUSTOMER_RETURN: 'customer_return',
  INVOICE_ISSUE: 'invoice_issue',
  OTHER: 'other',
};

const AFTER_SALES_ACTION_TYPE_TO_PRISMA: any = {
  record_only: 'RECORD_ONLY',
  refund: 'REFUND',
  return_refund: 'RETURN_REFUND',
  resend: 'RESEND',
  exchange: 'EXCHANGE',
  cancel_order: 'CANCEL_ORDER',
  RECORD_ONLY: 'RECORD_ONLY',
  REFUND: 'REFUND',
  RETURN_REFUND: 'RETURN_REFUND',
  RESEND: 'RESEND',
  EXCHANGE: 'EXCHANGE',
  CANCEL_ORDER: 'CANCEL_ORDER',
};

const AFTER_SALES_ACTION_TYPE_FROM_PRISMA: any = {
  RECORD_ONLY: 'record_only',
  REFUND: 'refund',
  RETURN_REFUND: 'return_refund',
  RESEND: 'resend',
  EXCHANGE: 'exchange',
  CANCEL_ORDER: 'cancel_order',
};

const SALES_ORDER_EXPORT_MAX_ROWS = 5000;
const TASTER_COMMISSION_TARGET_TYPE = 'TASTER_COMMISSION';
const TRAVEL_GROUP_EXPORT_MAX_ROWS = 5000;

const SALES_ORDER_EXPORT_COLUMNS = [
  { header: '系统单号', key: 'orderNo', width: 18 },
  { header: '销售单号', key: 'salesFormNo', width: 18 },
  { header: '订单日期', key: 'orderDate', width: 14 },
  { header: '客户姓名', key: 'customerName', width: 18 },
  { header: '客户电话', key: 'customerPhone', width: 16 },
  { header: '地址', key: 'address', width: 36 },
  { header: '旅行团号', key: 'travelGroupNo', width: 18 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '销售人员', key: 'salesUserName', width: 16 },
  { header: '酒品明细', key: 'itemsSummary', width: 36 },
  { header: '配送摘要', key: 'deliverySummary', width: 14 },
  { header: '订单总额', key: 'totalAmountYuan', width: 14 },
  { header: '货到付款金额', key: 'cashOnDeliveryAmountYuan', width: 16 },
  { header: '订单状态', key: 'status', width: 14 },
  { header: '客户标记', key: 'customerMark', width: 12 },
  { header: '订单标记', key: 'orderMark', width: 12 },
  { header: '打包状态', key: 'packingStatus', width: 14 },
  { header: '物流方式', key: 'logisticsMethod', width: 16 },
  { header: '物流单号', key: 'logisticsNo', width: 20 },
  { header: '运费', key: 'logisticsFeeYuan', width: 12 },
  { header: '是否需要开票', key: 'invoiceRequired', width: 14 },
  { header: '是否已开票', key: 'invoiceIssued', width: 14 },
  { header: '创建时间', key: 'createdAt', width: 24 },
  { header: '更新时间', key: 'updatedAt', width: 24 },
];

const SALES_ORDER_EXPORT_AMOUNT_KEYS = new Set([
  'totalAmountYuan',
  'cashOnDeliveryAmountYuan',
  'logisticsFeeYuan',
]);

const ORDER_STATUS_EXPORT_LABELS: any = {
  valid: '有效',
  partial_refund: '部分退款',
  refunded: '已退款',
  cancelled: '已取消',
  VALID: '有效',
  PARTIAL_REFUND: '部分退款',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

const PACKING_STATUS_EXPORT_LABELS: any = {
  pending: '待打包',
  packing: '打包中',
  packed: '已打包',
  abnormal: '异常',
  PENDING: '待打包',
  PACKING: '打包中',
  PACKED: '已打包',
  ABNORMAL: '异常',
};

const DELIVERY_SUMMARY_EXPORT_LABELS: any = {
  shipping: '邮寄',
  self_pickup: '自提',
  mixed: '混合配送',
};

const TRAVEL_GROUP_EXPORT_COLUMNS = [
  { header: '团号', key: 'groupNo', width: 18 },
  { header: '日期', key: 'visitDate', width: 14 },
  { header: '旅行社', key: 'travelAgency', width: 24 },
  { header: '车牌号', key: 'licensePlate', width: 14 },
  { header: '导游', key: 'guideName', width: 16 },
  { header: '导游电话', key: 'guidePhone', width: 16 },
  { header: '人数', key: 'guestCount', width: 10 },
  { header: '品鉴馆馆号', key: 'tastingRoomNo', width: 14 },
  { header: '品鉴师', key: 'tasterName', width: 16 },
  { header: '进店时间', key: 'arrivalTime', width: 12 },
  { header: '离店时间', key: 'departureTime', width: 12 },
  { header: '团型', key: 'groupType', width: 14 },
  { header: '品酒种类和瓶数', key: 'tastingSummary', width: 32 },
  { header: '是否出单', key: 'hasEffectiveOrder', width: 12 },
  { header: '订单总额', key: 'orderAmountYuan', width: 14 },
  { header: '财务标记', key: 'financeMark', width: 12 },
  { header: '品鉴师总结', key: 'tasterSummary', width: 36 },
  { header: '备注', key: 'remarks', width: 30 },
  { header: '创建时间', key: 'createdAt', width: 24 },
  { header: '更新时间', key: 'updatedAt', width: 24 },
];

const TRAVEL_GROUP_EXPORT_AMOUNT_KEYS = new Set(['orderAmountYuan']);

const SALES_ORDER_PATCH_ALLOWED_FIELDS_BY_ROLE: any = {
  admin: [
    'orderType',
    'salesUserId',
    'outreachUserId',
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
  finance: [
    'orderType',
    'salesUserId',
    'outreachUserId',
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

const AFTER_SALES_ORDER_PATCH_FIELDS = [
  'issueType',
  'actionType',
  'description',
  'resolution',
  'refundAmountCents',
  'notes',
];

const AFTER_SALES_ORDER_STATUS_PATCH_FIELDS = [
  'status',
  'resolution',
  'notes',
];

const AFTER_SALES_ORDER_FINANCE_CONFIRM_PATCH_FIELDS = ['financeConfirmed'];

const AFTER_SALES_ORDER_REFUND_LINK_STATUSES = [
  'WAITING_REFUND',
  'COMPLETED',
];

@Injectable()
export class BusinessDataNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
    private readonly commissionRecordsService: CommissionRecordsNestService,
    private readonly travelGroupFinanceSummaryService: TravelGroupFinanceSummaryNestService,
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

  async exportTravelGroupsXlsx(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const groups = await this.prisma.travelGroup.findMany({
      where: await this.buildScopedGroupWhere(
        'travel',
        actor,
        buildGroupWhere(filters, 'travel'),
      ),
      orderBy: {
        createdAt: 'desc',
      },
      take: TRAVEL_GROUP_EXPORT_MAX_ROWS + 1,
      include: getGroupInclude('travel') as any,
    });

    const groupDtos = filterGroupDtosByComputedFields(
      annotateDuplicateGroupNos(groups).map((group: any) =>
        toGroupDto(group, 'travel'),
      ),
      filters,
    );

    if (groupDtos.length > TRAVEL_GROUP_EXPORT_MAX_ROWS) {
      throw createHttpError(
        400,
        'EXPORT_LIMIT_EXCEEDED',
        `Travel group export exceeds ${TRAVEL_GROUP_EXPORT_MAX_ROWS} rows. Please narrow filters.`,
      );
    }

    const workbook = buildTravelGroupsExportWorkbook(groupDtos);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildTravelGroupsExportFileName(),
      buffer: Buffer.from(xlsxData as any),
    };
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
      include: getSalesOrderInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return orders.map(toSalesOrderDto);
  }

  async exportSalesOrdersXlsx(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(
        actor,
        buildSalesOrderWhere(filters),
      ),
      include: getSalesOrderInclude({ includeSalesUser: true }),
      orderBy: {
        createdAt: 'desc',
      },
      take: SALES_ORDER_EXPORT_MAX_ROWS + 1,
    });

    if (orders.length > SALES_ORDER_EXPORT_MAX_ROWS) {
      throw createHttpError(
        400,
        'EXPORT_LIMIT_EXCEEDED',
        `Sales order export exceeds ${SALES_ORDER_EXPORT_MAX_ROWS} rows. Please narrow filters.`,
      );
    }

    const workbook = buildSalesOrdersExportWorkbook(orders);
    const xlsxData = await workbook.xlsx.writeBuffer();
    return {
      fileName: buildSalesOrdersExportFileName(),
      buffer: Buffer.from(xlsxData as any),
    };
  }

  async getSalesOrder(actor: any, id: string) {
    const order = await this.findReadableSalesOrderOrThrow(actor, id);
    return toSalesOrderDto(order);
  }

  async getSalesOrderSalesSheet(actor: any, id: string, options: any = {}) {
    const order = await this.findReadableSalesOrderOrThrow(actor, id, {
      includeSalesUser: true,
    });
    return buildSalesSheetDto(order, {
      publicUrl: buildPublicSalesSheetUrl(
        options?.publicSalesSheetBaseUrl,
        order.qrCodeToken,
      ),
    });
  }

  async generateSalesOrderQrCode(
    actor: any,
    id: string,
    payload: any = {},
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'sales']);
    const body = normalizeOptionalObjectPayload(payload);
    const regenerate = normalizeOptionalBoolean(
      body.regenerate,
      'regenerate',
      false,
    );
    const now = new Date();
    const expiresAt = calculateQrCodeExpiresAt(body.expiresInDays, now);
    const current = await this.findReadableSalesOrderOrThrow(actor, id, {
      includeSalesUser: true,
    });

    if (
      !regenerate &&
      hasReusableQrCodeToken(current.qrCodeToken, current.qrCodeExpiresAt, now)
    ) {
      return buildSalesOrderQrCodeResponse(
        current,
        metadata.publicSalesSheetBaseUrl,
      );
    }

    const nextQrCodeToken = generateQrCodeToken();
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: {
          qrCodeToken: nextQrCodeToken,
          qrCodeGeneratedAt: now,
          qrCodeExpiresAt: expiresAt,
          updatedById: actor.id,
          updatedAt: now,
        },
        include: getSalesOrderInclude({ includeSalesUser: true }),
      });

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: hasText(current.qrCodeToken)
            ? 'sales_orders.qr_code.regenerate'
            : 'sales_orders.qr_code.generate',
          entityType: 'sales_order',
          entityId: updatedOrder.id,
          beforeData: toSalesOrderQrCodeLogDto(current),
          afterData: toSalesOrderQrCodeLogDto(updatedOrder),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return updatedOrder;
    });

    return buildSalesOrderQrCodeResponse(
      updated,
      metadata.publicSalesSheetBaseUrl,
    );
  }

  async getPublicSalesSheetHtml(token: string) {
    const tokenText = normalizeOptionalString(token);
    if (!tokenText) {
      return buildPublicSalesSheetErrorResult(
        404,
        '二维码无效',
        '这个二维码无法识别，请联系销售人员重新确认。',
      );
    }

    const order = await this.prisma.salesOrder.findUnique({
      where: {
        qrCodeToken: tokenText,
      },
      include: getSalesOrderInclude({ includeSalesUser: true }),
    });
    if (!order) {
      return buildPublicSalesSheetErrorResult(
        404,
        '销售单不存在',
        '未找到对应的销售单，请联系销售人员重新生成二维码。',
      );
    }
    if (!isQrCodeTokenUnexpired(order.qrCodeExpiresAt)) {
      return buildPublicSalesSheetErrorResult(
        410,
        '二维码已过期',
        '这个二维码已经过期，请联系销售人员重新生成二维码。',
      );
    }

    const salesSheet = buildSalesSheetDto(order).public;
    return {
      statusCode: 200,
      html: renderPublicSalesSheetHtml(salesSheet),
    };
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
            include: getSalesOrderInclude(),
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
            include: getSalesOrderInclude(),
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
          await this.refreshStage7SalesOrderCommissionAndSummary(
            tx,
            createdOrder.id,
            actor,
            metadata,
            {
              trigger: 'sales_order_create',
              entityType: 'sales_order',
              entityId: createdOrder.id,
              affectedTravelGroupIds: [orderForLog?.travelGroupId],
            },
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
    requireAnyRole(actor, ['admin', 'sales', 'finance']);
    assertSalesOrderPatchAllowedFields(actor, payload);

    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: getSalesOrderInclude(),
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
        include: getSalesOrderInclude(),
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
          include: getSalesOrderInclude(),
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
      if (shouldRecalculateStage7ForSalesOrderUpdate(current, orderForLog, payload)) {
        await this.refreshStage7SalesOrderCommissionAndSummary(
          tx,
          orderForLog.id,
          actor,
          metadata,
          {
            trigger: 'sales_order_update',
            entityType: 'sales_order',
            entityId: orderForLog.id,
            affectedTravelGroupIds: getStage7AffectedTravelGroupIds(
              current,
              orderForLog,
            ),
          },
        );
      }
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
      include: getSalesOrderInclude(),
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
        include: getSalesOrderInclude(),
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
          include: getSalesOrderInclude(),
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
    requireAnyRole(actor, ['admin', 'warehouse', 'finance']);
    assertSalesOrderPackingPatchAllowedFields(payload);

    const current = await this.prisma.salesOrder.findUnique({
      where: {
        id,
      },
      include: getSalesOrderInclude(),
    });
    if (!current) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    assertCanReadSalesOrder(actor, current);
    await this.assertPassesGlobalSalesOrderMarkScope(current);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: buildSalesOrderPackingUpdateData(payload, actor),
        include: getSalesOrderInclude(),
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
      include: getSalesOrderInclude(),
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
        include: getSalesOrderInclude(),
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
          include: getSalesOrderInclude(),
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
      await this.refreshStage7SalesOrderCommissionAndSummary(
        tx,
        orderForLog.id,
        actor,
        metadata,
        {
          trigger: 'sales_order_status_update',
          entityType: 'sales_order',
          entityId: orderForLog.id,
          affectedTravelGroupIds: getStage7AffectedTravelGroupIds(
            current,
            orderForLog,
          ),
        },
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
      include: getSalesOrderInclude(),
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
      include: getSalesOrderInclude(),
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

  async listAfterSalesOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance', 'after_sales', 'sales']);
    const orders = await this.prisma.afterSalesOrder.findMany({
      where: await this.buildScopedAfterSalesOrderWhere(
        actor,
        buildAfterSalesOrderWhere(filters),
      ),
      include: getAfterSalesOrderInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return orders.map(toAfterSalesOrderDto);
  }

  async createAfterSalesOrder(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'after_sales']);
    const body = normalizeOptionalObjectPayload(payload);
    const salesOrderId = normalizeRequiredString(
      body.salesOrderId,
      'salesOrderId',
    );
    const salesOrder = await this.findReadableSalesOrderOrThrow(
      actor,
      salesOrderId,
    );
    const data = buildAfterSalesOrderCreateData(body, actor, salesOrder);

    const created = await this.prisma.$transaction(async (tx: any) => {
      return withGeneratedAfterSalesNo(
        tx.afterSalesOrder,
        data.createdAt,
        async (afterSalesNo) => {
          const createdOrder = await tx.afterSalesOrder.create({
            data: {
              ...data,
              afterSalesNo,
            },
            include: getAfterSalesOrderInclude(),
          });
          await this.syncSalesOrderStatusFromAfterSales(
            tx,
            createdOrder,
            salesOrder,
            actor,
            metadata,
          );
          const orderForLog =
            (await tx.afterSalesOrder.findUnique({
              where: {
                id: createdOrder.id,
              },
              include: getAfterSalesOrderInclude(),
            })) || createdOrder;
          await this.operationLogsService.appendLog(
            {
              userId: actor.id,
              action: 'after_sales_orders.create',
              entityType: 'after_sales_order',
              entityId: orderForLog.id,
              beforeData: null,
              afterData: toAfterSalesOrderDto(orderForLog),
              ipAddress: metadata.ipAddress || null,
            },
            tx,
          );
          return orderForLog;
        },
      );
    });

    return toAfterSalesOrderDto(created);
  }

  async getAfterSalesOrder(actor: any, id: string) {
    requireAnyRole(actor, ['admin', 'boss', 'finance', 'after_sales', 'sales']);
    const order = await this.prisma.afterSalesOrder.findUnique({
      where: {
        id,
      },
      include: getAfterSalesOrderInclude(),
    });
    if (!order) {
      throw createHttpError(
        404,
        'AFTER_SALES_ORDER_NOT_FOUND',
        'After-sales order does not exist.',
      );
    }
    assertCanReadSalesOrder(actor, order.salesOrder);
    await this.assertPassesGlobalSalesOrderMarkScope(order.salesOrder);
    return toAfterSalesOrderDto(order);
  }

  async updateAfterSalesOrder(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'after_sales']);
    assertAfterSalesOrderPatchAllowedFields(payload);
    const current = await this.prisma.afterSalesOrder.findUnique({
      where: {
        id,
      },
      include: getAfterSalesOrderInclude(),
    });
    if (!current) {
      throw createHttpError(
        404,
        'AFTER_SALES_ORDER_NOT_FOUND',
        'After-sales order does not exist.',
      );
    }
    await this.assertPassesGlobalSalesOrderMarkScope(current.salesOrder);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: buildAfterSalesOrderUpdateData(payload, actor),
        include: getAfterSalesOrderInclude(),
      });
      await this.syncSalesOrderStatusFromAfterSales(
        tx,
        updatedOrder,
        current.salesOrder,
        actor,
        metadata,
      );
      const orderForLog =
        (await tx.afterSalesOrder.findUnique({
          where: {
            id,
          },
          include: getAfterSalesOrderInclude(),
        })) || updatedOrder;
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'after_sales_orders.update',
          entityType: 'after_sales_order',
          entityId: orderForLog.id,
          beforeData: toAfterSalesOrderDto(current),
          afterData: toAfterSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForLog;
    });

    return toAfterSalesOrderDto(updated);
  }

  async updateAfterSalesOrderStatus(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'after_sales']);
    assertAfterSalesOrderStatusPatchAllowedFields(payload);
    const body = normalizeOptionalObjectPayload(payload);
    const status = toPrismaAfterSalesStatus(
      normalizeRequiredString(body.status, 'status'),
    );
    const current = await this.prisma.afterSalesOrder.findUnique({
      where: {
        id,
      },
      include: getAfterSalesOrderInclude(),
    });
    if (!current) {
      throw createHttpError(
        404,
        'AFTER_SALES_ORDER_NOT_FOUND',
        'After-sales order does not exist.',
      );
    }
    await this.assertPassesGlobalSalesOrderMarkScope(current.salesOrder);

    const effectiveResolution = hasOwn(body, 'resolution')
      ? normalizeOptionalString(body.resolution)
      : current.resolution;
    const effectiveNotes = hasOwn(body, 'notes')
      ? normalizeOptionalString(body.notes)
      : current.notes;
    if (
      status === 'COMPLETED' &&
      !hasText(effectiveResolution) &&
      !hasText(effectiveNotes)
    ) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'completed status requires resolution or notes.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: buildAfterSalesOrderStatusUpdateData(body, actor, status),
        include: getAfterSalesOrderInclude(),
      });
      await this.syncSalesOrderStatusFromAfterSales(
        tx,
        updatedOrder,
        current.salesOrder,
        actor,
        metadata,
      );
      const orderForLog =
        (await tx.afterSalesOrder.findUnique({
          where: {
            id,
          },
          include: getAfterSalesOrderInclude(),
        })) || updatedOrder;
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'after_sales_orders.status.update',
          entityType: 'after_sales_order',
          entityId: orderForLog.id,
          beforeData: toAfterSalesOrderDto(current),
          afterData: toAfterSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForLog;
    });

    return toAfterSalesOrderDto(updated);
  }

  async confirmAfterSalesOrderFinance(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
    assertAfterSalesOrderFinanceConfirmPatchAllowedFields(payload);
    const body = normalizeOptionalObjectPayload(payload);
    const financeConfirmed = normalizeBoolean(
      body.financeConfirmed,
      'financeConfirmed',
    );
    const current = await this.prisma.afterSalesOrder.findUnique({
      where: {
        id,
      },
      include: getAfterSalesOrderInclude(),
    });
    if (!current) {
      throw createHttpError(
        404,
        'AFTER_SALES_ORDER_NOT_FOUND',
        'After-sales order does not exist.',
      );
    }
    await this.assertPassesGlobalSalesOrderMarkScope(current.salesOrder);
    if (Number(current.refundAmountCents || 0) <= 0) {
      throw createHttpError(
        400,
        'AFTER_SALES_REFUND_NOT_REQUIRED',
        'After-sales order has no refund amount to confirm.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: buildAfterSalesOrderFinanceConfirmData(
          financeConfirmed,
          actor,
        ),
        include: getAfterSalesOrderInclude(),
      });
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: financeConfirmed
            ? 'after_sales_orders.finance_confirm.enable'
            : 'after_sales_orders.finance_confirm.disable',
          entityType: 'after_sales_order',
          entityId: updatedOrder.id,
          beforeData: toAfterSalesOrderDto(current),
          afterData: toAfterSalesOrderDto(updatedOrder),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      const currentSalesOrder = (current as any).salesOrder;
      const updatedSalesOrder = (updatedOrder as any).salesOrder;
      await this.refreshStage7SalesOrderCommissionAndSummary(
        tx,
        updatedOrder.salesOrderId,
        actor,
        metadata,
        {
          trigger: financeConfirmed
            ? 'after_sales_finance_confirm'
            : 'after_sales_finance_unconfirm',
          entityType: 'after_sales_order',
          entityId: updatedOrder.id,
          afterSalesOrderId: updatedOrder.id,
          affectedTravelGroupIds: [
            currentSalesOrder?.travelGroupId,
            updatedSalesOrder?.travelGroupId,
          ],
        },
      );
      return updatedOrder;
    });

    return toAfterSalesOrderDto(updated);
  }

  async getFinanceOverview(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    // Finance overview uses orderDate for order-side metrics and after-sales createdAt for refund metrics.
    const orderWhere = await this.buildScopedSalesOrderWhere(
      actor,
      buildSalesOrderWhere(filters),
    );
    const afterSalesWhere = await this.buildScopedAfterSalesOrderWhere(
      actor,
      buildAfterSalesOrderWhere({
        dateFrom: filters.dateFrom || filters.start,
        dateTo: filters.dateTo || filters.end,
        keyword: filters.keyword || filters.query || filters.search,
        salesOrderId: filters.salesOrderId,
        customerId: filters.customerId,
      }),
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
    const pendingCustomerMarkWhere = await this.buildScopedCustomerWhere(
      actor,
      { financeMark: false },
    );
    const pendingTravelGroupMarkWhere = await this.buildScopedGroupWhere(
      'travel',
      actor,
      buildGroupWhere({ financeMark: false }, 'travel'),
    );
    const [orders, groups, afterSalesOrders, pendingCustomers, pendingGroups] =
      await Promise.all([
        this.prisma.salesOrder.findMany({
          where: orderWhere,
          include: getSalesOrderInclude(),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this.prisma.travelGroup.findMany({
          where: groupWhere,
        }),
        this.prisma.afterSalesOrder.findMany({
          where: afterSalesWhere,
          select: {
            refundAmountCents: true,
            financeConfirmed: true,
          },
        }),
        this.prisma.customer.findMany({
          where: pendingCustomerMarkWhere,
        }),
        this.prisma.travelGroup.findMany({
          where: pendingTravelGroupMarkWhere,
        }),
      ]);

    const effectiveOrders = getEffectiveSalesOrders(orders);
    const legacyRefundOrders = orders.filter((order: any) =>
      ['REFUNDED', 'PARTIAL_REFUND', 'refunded', 'partial_refund'].includes(
        order.status,
      ),
    );
    const refundAfterSalesOrders = afterSalesOrders.filter(
      (order: any) => Number(order.refundAmountCents || 0) > 0,
    );
    const grossSalesAmountCents = sumAmountCents(
      effectiveOrders,
      'totalAmountCents',
    );
    const refundAmountCents = sumAmountCents(
      refundAfterSalesOrders.filter((order: any) => order.financeConfirmed),
      'refundAmountCents',
    );
    const pendingAfterSalesRefundAmountCents = sumAmountCents(
      refundAfterSalesOrders.filter((order: any) => !order.financeConfirmed),
      'refundAmountCents',
    );
    const logisticsFeeCents = sumAmountCents(orders, 'logisticsFeeCents');
    const pendingInvoiceCount = orders.filter(
      (order: any) => order.invoiceRequired && !order.invoiceIssued,
    ).length;
    const cashOnDeliveryAmountCents = sumAmountCents(
      effectiveOrders,
      'cashOnDeliveryAmountCents',
    );
    return {
      metrics: {
        travelGroupCount: groups.length,
        orderCount: orders.length,
        grossSalesAmountCents,
        salesAmountCents: grossSalesAmountCents,
        refundAmountCents,
        pendingAfterSalesRefundAmountCents,
        legacyRefundOrderAmountCents: sumAmountCents(
          legacyRefundOrders,
          'totalAmountCents',
        ),
        netSalesAmountCents: grossSalesAmountCents - refundAmountCents,
        logisticsFeeCents,
        pendingInvoiceCount,
        pendingCustomerMarkCount: pendingCustomers.length,
        pendingTravelGroupMarkCount: pendingGroups.length,
        pendingAfterSalesConfirmCount: refundAfterSalesOrders.filter(
          (order: any) => !order.financeConfirmed,
        ).length,
        cashOnDeliveryAmountCents,
      },
      recentOrders: orders.slice(0, 10).map(toSalesOrderDto),
    };
  }

  async getFinanceWorkbench(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'finance']);
    const limit = normalizeTake(filters.limit, 20);
    const overview = await this.getFinanceOverview(actor, filters);
    const orderWhere = await this.buildScopedSalesOrderWhere(
      actor,
      buildSalesOrderWhere(filters),
    );
    const pendingAfterSalesWhere = await this.buildScopedAfterSalesOrderWhere(
      actor,
      buildAfterSalesOrderWhere({
        dateFrom: filters.dateFrom || filters.start,
        dateTo: filters.dateTo || filters.end,
        keyword: filters.keyword || filters.query || filters.search,
        financeConfirmed: false,
      }),
    );
    const [orders, afterSalesOrders] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: orderWhere,
        include: getSalesOrderInclude(),
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.afterSalesOrder.findMany({
        where: pendingAfterSalesWhere,
        include: getAfterSalesOrderInclude(),
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);
    const effectiveOrders = getEffectiveSalesOrders(orders);
    const pendingAfterSales = afterSalesOrders
      .filter(
        (order: any) =>
          Number(order.refundAmountCents || 0) > 0 &&
          !order.financeConfirmed,
      )
      .slice(0, limit)
      .map(toAfterSalesOrderDto);

    return {
      metrics: overview.metrics,
      recentOrders: orders.slice(0, limit).map(toSalesOrderDto),
      pendingAfterSales,
      pendingMarks: buildFinancePendingMarks(effectiveOrders, limit),
      pendingLogistics: effectiveOrders
        .map(toFinancePendingLogisticsDto)
        .filter((item: any) => item.reasons.length > 0)
        .slice(0, limit),
    };
  }

  async listWarehouseOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'warehouse']);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(
        actor,
        buildWarehouseSalesOrderWhere(filters),
      ),
      include: getSalesOrderInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizeTake(filters.limit, 50),
    });
    return orders.map(toSalesOrderDto);
  }

  async updateWarehouseOrderPacking(
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
      include: getSalesOrderInclude(),
    });
    if (!current || !hasShippingDelivery(current)) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    assertCanReadSalesOrder(actor, current);
    await this.assertPassesGlobalSalesOrderMarkScope(current);
    return this.updateSalesOrderPacking(actor, id, payload, metadata);
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

  private async syncSalesOrderStatusFromAfterSales(
    tx: any,
    afterSalesOrder: any,
    currentSalesOrder: any,
    actor: any,
    metadata: any = {},
  ) {
    if (!afterSalesOrder?.salesOrderId || !currentSalesOrder) {
      return null;
    }

    const refundOrders = await tx.afterSalesOrder.findMany({
      where: {
        salesOrderId: afterSalesOrder.salesOrderId,
        status: {
          in: AFTER_SALES_ORDER_REFUND_LINK_STATUSES,
        },
      },
      select: {
        refundAmountCents: true,
      },
    });
    const refundAmountCents = refundOrders.reduce(
      (sum: number, order: any) =>
        sum + Math.max(0, Number(order.refundAmountCents || 0)),
      0,
    );
    const targetStatus = resolveAfterSalesLinkedSalesOrderStatus(
      afterSalesOrder,
      currentSalesOrder,
      refundAmountCents,
    );
    if (!targetStatus || currentSalesOrder.status === targetStatus) {
      return currentSalesOrder;
    }

    const updatedOrder = await tx.salesOrder.update({
      where: {
        id: currentSalesOrder.id,
      },
      data: buildSalesOrderAfterSalesSyncData(targetStatus, actor),
      include: getSalesOrderInclude(),
    });

    for (const travelGroupId of getSalesOrderSummaryAffectedTravelGroupIds(
      currentSalesOrder,
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
          id: updatedOrder.id,
        },
        include: getSalesOrderInclude(),
      })) || updatedOrder;

    await this.operationLogsService.appendLog(
      {
        userId: actor.id,
        action: 'sales_orders.status.update',
        entityType: 'sales_order',
        entityId: orderForLog.id,
        beforeData: toSalesOrderDto(currentSalesOrder),
        afterData: toSalesOrderDto(orderForLog),
        ipAddress: metadata.ipAddress || null,
      },
      tx,
    );
    await this.refreshStage7SalesOrderCommissionAndSummary(
      tx,
      orderForLog.id,
      actor,
      metadata,
      {
        trigger: 'after_sales_order_status_sync',
        entityType: 'sales_order',
        entityId: orderForLog.id,
        afterSalesOrderId: afterSalesOrder.id,
        affectedTravelGroupIds: getStage7AffectedTravelGroupIds(
          currentSalesOrder,
          orderForLog,
        ),
      },
    );
    return orderForLog;
  }

  private async refreshStage7SalesOrderCommissionAndSummary(
    tx: any,
    salesOrderId: string | null | undefined,
    actor: any,
    metadata: any = {},
    context: any = {},
  ) {
    const orderId = normalizeOptionalString(salesOrderId);
    if (!orderId) {
      return null;
    }

    const recalculation =
      await this.commissionRecordsService.recalculateSalesOrderRecords(
        orderId,
        {
          prisma: tx,
          actor,
          ipAddress: metadata.ipAddress || null,
        },
      );
    const latestOrder = await tx.salesOrder.findUnique({
      where: {
        id: orderId,
      },
      include: getSalesOrderInclude(),
    });
    const travelGroupIds = normalizeIdList([
      ...(context.affectedTravelGroupIds || []),
      latestOrder?.travelGroupId,
      ...recalculation.records.map((record: any) => record.travelGroupId),
    ]);
    const summaryResults: any[] = [];
    for (const travelGroupId of travelGroupIds) {
      summaryResults.push(
        await this.travelGroupFinanceSummaryService.refreshTravelGroupFinanceSummary(
          travelGroupId,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
            syncCompatibilityFields: false,
          },
        ),
      );
    }
    const tasterAdjustment =
      await this.commissionRecordsService.markTasterManualAdjustmentPending(
        travelGroupIds,
        {
          prisma: tx,
          actor,
          ipAddress: metadata.ipAddress || null,
          trigger: context.trigger || 'sales_order_recalculation',
          salesOrderId: orderId,
          afterSalesOrderId: context.afterSalesOrderId || null,
          orderStatus: latestOrder?.status || null,
          warnings: recalculation.warnings,
        },
      );
    await this.operationLogsService.appendLog(
      {
        userId: actor?.id || null,
        action: 'commission_records.recalculate.trigger',
        entityType: context.entityType || 'sales_order',
        entityId: context.entityId || orderId,
        beforeData: null,
        afterData: {
          trigger: context.trigger || 'sales_order_recalculation',
          salesOrderId: orderId,
          afterSalesOrderId: context.afterSalesOrderId || null,
          travelGroupIds,
          orderStatus: latestOrder?.status || null,
          generatedRecordCount: recalculation.generatedRecords.length,
          updatedRecordCount: recalculation.updatedRecords.length,
          unchangedRecordCount: recalculation.unchangedRecords.length,
          warningCodes: recalculation.warnings.map(
            (warning: any) => warning.code,
          ),
          warnings: recalculation.warnings,
          summaryRefreshes: summaryResults.map((result: any) => ({
            travelGroupId: result.travelGroupId,
            amountChanged: result.amountChanged,
            agencyDeductionConfirmationReset:
              result.agencyDeductionConfirmationReset,
          })),
          tasterManualAdjustmentRecordIds:
            tasterAdjustment.recordIds || [],
        },
        ipAddress: metadata.ipAddress || null,
      },
      tx,
    );
    return {
      recalculation,
      summaryResults,
      tasterAdjustment,
    };
  }

  private groupDelegate(table: any) {
    return (this.prisma as any)[table.delegate];
  }

  private async findReadableSalesOrderOrThrow(
    actor: any,
    id: string,
    options: any = {},
  ) {
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
      include: getSalesOrderInclude(options),
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
    return order;
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

  private async buildScopedAfterSalesOrderWhere(actor: any, baseWhere: any) {
    const salesOrderScope = await this.buildScopedSalesOrderWhere(actor, {});
    if (!salesOrderScope || Object.keys(salesOrderScope).length === 0) {
      return baseWhere;
    }
    return andWhere(baseWhere, {
      salesOrder: {
        is: salesOrderScope,
      },
    });
  }

  private async buildScopedCustomerWhere(_actor: any, baseWhere: any) {
    return andWhere(baseWhere, await this.buildGlobalCustomerMarkScope());
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
    return buildSharedGlobalTravelGroupMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async buildGlobalSalesOrderMarkScope() {
    return buildSharedGlobalSalesOrderMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async buildGlobalCustomerMarkScope() {
    return buildSharedGlobalCustomerMarkScope(
      await this.onlyShowMarkedRecords(),
    );
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
        { logisticsNo: { contains: query } },
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
  const logisticsMethod = normalizeOptionalString(filters.logisticsMethod);
  if (logisticsMethod) {
    where.logisticsMethod = {
      contains: logisticsMethod,
    };
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

function buildWarehouseSalesOrderWhere(filters: any = {}) {
  return buildSalesOrderWhere({
    ...filters,
    deliveryType: 'shipping',
  });
}

function buildAfterSalesOrderWhere(filters: any = {}) {
  let where: any = {};
  const query = normalizeOptionalString(
    filters.keyword || filters.query || filters.search,
  );
  if (query) {
    where = andWhere(where, {
      OR: [
        { afterSalesNo: { contains: query } },
        { description: { contains: query } },
        { resolution: { contains: query } },
        { notes: { contains: query } },
        { salesOrder: { is: { orderNo: { contains: query } } } },
        { salesOrder: { is: { salesFormNo: { contains: query } } } },
        { salesOrder: { is: { customerName: { contains: query } } } },
        { salesOrder: { is: { customerPhone: { contains: query } } } },
        { salesOrder: { is: { logisticsNo: { contains: query } } } },
        { customer: { is: { name: { contains: query } } } },
        { customer: { is: { phone: { contains: query } } } },
      ],
    });
  }
  const status = normalizeOptionalString(filters.status);
  if (status) {
    where.status = toPrismaAfterSalesStatus(status);
  }
  const issueType = normalizeOptionalString(filters.issueType);
  if (issueType) {
    where.issueType = toPrismaAfterSalesIssueType(issueType);
  }
  const actionType = normalizeOptionalString(filters.actionType);
  if (actionType) {
    where.actionType = toPrismaAfterSalesActionType(actionType);
  }
  const salesOrderId = normalizeOptionalString(filters.salesOrderId);
  if (salesOrderId) {
    where.salesOrderId = salesOrderId;
  }
  const customerId = normalizeOptionalString(filters.customerId);
  if (customerId) {
    where.customerId = customerId;
  }
  if (
    filters.financeConfirmed !== undefined &&
    filters.financeConfirmed !== ''
  ) {
    where.financeConfirmed = normalizeBoolean(
      filters.financeConfirmed,
      'financeConfirmed',
    );
  }
  const dateRange = buildDateRange(
    filters.dateFrom || filters.start,
    filters.dateTo || filters.end,
  );
  if (dateRange) {
    where.createdAt = dateRange;
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

function assertAfterSalesOrderPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(AFTER_SALES_ORDER_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for after-sales order: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertAfterSalesOrderStatusPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(AFTER_SALES_ORDER_STATUS_PATCH_FIELDS);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for after-sales status: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertAfterSalesOrderFinanceConfirmPatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(
    AFTER_SALES_ORDER_FINANCE_CONFIRM_PATCH_FIELDS,
  );
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for after-sales finance confirm: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertCanUpdateSalesOrder(actor: any, order: any) {
  if (actor?.role === 'admin' || actor?.role === 'finance') {
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
    return true;
  }
  return hasShippingDelivery(order);
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

function shouldRecalculateStage7ForSalesOrderUpdate(
  current: any,
  updated: any,
  payload: any = {},
) {
  return (
    hasOwn(payload, 'items') ||
    current.travelGroupId !== updated.travelGroupId ||
    current.salesUserId !== updated.salesUserId ||
    current.outreachUserId !== updated.outreachUserId ||
    current.orderType !== updated.orderType ||
    current.status !== updated.status ||
    Number(current.totalAmountCents || 0) !==
      Number(updated.totalAmountCents || 0)
  );
}

function getStage7AffectedTravelGroupIds(current: any, updated: any) {
  return normalizeIdList([current?.travelGroupId, updated?.travelGroupId]);
}

function normalizeIdList(values: any[]) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeOptionalString(value))
        .filter(Boolean),
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
    outreachUserId: normalizeOptionalString(payload?.outreachUserId),
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
  if (hasOwn(payload, 'outreachUserId')) {
    data.outreachUserId = normalizeOptionalString(payload.outreachUserId);
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

function buildSalesOrderAfterSalesSyncData(status: string, actor: any) {
  return {
    status,
    updatedById: actor.id,
    updatedAt: new Date(),
  };
}

function resolveAfterSalesLinkedSalesOrderStatus(
  afterSalesOrder: any,
  salesOrder: any,
  refundAmountCents: number,
) {
  const orderTotalAmountCents = Number(salesOrder.totalAmountCents || 0);
  if (refundAmountCents > orderTotalAmountCents) {
    throw createHttpError(
      400,
      'AFTER_SALES_REFUND_EXCEEDS_ORDER_TOTAL',
      'After-sales refund amount exceeds sales order total amount.',
    );
  }
  if (afterSalesOrder.actionType === 'CANCEL_ORDER') {
    return 'CANCELLED';
  }
  if (refundAmountCents <= 0) {
    return null;
  }
  return refundAmountCents < orderTotalAmountCents
    ? 'PARTIAL_REFUND'
    : 'REFUNDED';
}

function buildAfterSalesOrderCreateData(
  payload: any,
  actor: any,
  salesOrder: any,
) {
  const now = new Date();
  const status = toPrismaAfterSalesStatus(payload?.status || 'negotiating');
  return {
    id: crypto.randomUUID(),
    salesOrderId: salesOrder.id,
    customerId: salesOrder.customerId || null,
    issueType: toPrismaAfterSalesIssueType(
      normalizeRequiredString(payload?.issueType, 'issueType'),
    ),
    actionType: toPrismaAfterSalesActionType(
      normalizeRequiredString(payload?.actionType, 'actionType'),
    ),
    description: normalizeRequiredString(payload?.description, 'description'),
    resolution: normalizeOptionalString(payload?.resolution),
    refundAmountCents: normalizeNonNegativeInt(
      payload?.refundAmountCents,
      'refundAmountCents',
      0,
    ),
    status,
    financeConfirmed: false,
    financeConfirmedById: null,
    financeConfirmedAt: null,
    handledById: actor.id,
    handledAt: now,
    completedAt: status === 'COMPLETED' ? now : null,
    notes: normalizeOptionalString(payload?.notes),
    createdById: actor.id,
    updatedById: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

function buildAfterSalesOrderUpdateData(payload: any, actor: any) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };

  if (hasOwn(payload, 'issueType')) {
    data.issueType = toPrismaAfterSalesIssueType(payload.issueType);
  }
  if (hasOwn(payload, 'actionType')) {
    data.actionType = toPrismaAfterSalesActionType(payload.actionType);
  }
  if (hasOwn(payload, 'description')) {
    data.description = normalizeRequiredString(
      payload.description,
      'description',
    );
  }
  if (hasOwn(payload, 'resolution')) {
    data.resolution = normalizeOptionalString(payload.resolution);
  }
  if (hasOwn(payload, 'refundAmountCents')) {
    data.refundAmountCents = normalizeNonNegativeInt(
      payload.refundAmountCents,
      'refundAmountCents',
    );
  }
  if (hasOwn(payload, 'notes')) {
    data.notes = normalizeOptionalString(payload.notes);
  }

  return data;
}

function buildAfterSalesOrderStatusUpdateData(
  payload: any,
  actor: any,
  status: string,
) {
  const now = new Date();
  const data: any = {
    status,
    handledById: actor.id,
    handledAt: now,
    updatedById: actor.id,
    updatedAt: now,
  };

  if (hasOwn(payload, 'resolution')) {
    data.resolution = normalizeOptionalString(payload.resolution);
  }
  if (hasOwn(payload, 'notes')) {
    data.notes = normalizeOptionalString(payload.notes);
  }
  if (status === 'COMPLETED') {
    data.completedAt = now;
  }

  return data;
}

function buildAfterSalesOrderFinanceConfirmData(
  financeConfirmed: boolean,
  actor: any,
) {
  const now = new Date();
  return {
    financeConfirmed,
    financeConfirmedById: financeConfirmed ? actor.id : null,
    financeConfirmedAt: financeConfirmed ? now : null,
    updatedById: actor.id,
    updatedAt: now,
  };
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
    outreachUserId: order.outreachUserId || null,
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

function sumAmountCents(rows: any[], fieldName: string) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum: number, row: any) => sum + Number(row?.[fieldName] || 0),
    0,
  );
}

function buildFinancePendingMarks(orders: any[], limit: number) {
  const customerEntries = new Map<string, any[]>();
  const travelGroupEntries = new Map<string, any[]>();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (order.customer?.id && !order.customer.financeMark) {
      const rows = customerEntries.get(order.customer.id) || [];
      rows.push(order);
      customerEntries.set(order.customer.id, rows);
    }
    if (order.travelGroup?.id && !order.travelGroup.financeMark) {
      const rows = travelGroupEntries.get(order.travelGroup.id) || [];
      rows.push(order);
      travelGroupEntries.set(order.travelGroup.id, rows);
    }
  }

  const entries: any[] = [];
  for (const rows of customerEntries.values()) {
    const latestOrder = rows[0];
    entries.push({
      type: 'customer',
      reason: 'customer_unmarked',
      customer: toSalesOrderCustomerDto(latestOrder.customer),
      travelGroup: null,
      orderCount: rows.length,
      latestOrder: toSalesOrderDto(latestOrder),
    });
  }
  for (const rows of travelGroupEntries.values()) {
    const latestOrder = rows[0];
    entries.push({
      type: 'travel_group',
      reason: 'travel_group_unmarked',
      customer: null,
      travelGroup: toGroupDto(latestOrder.travelGroup, 'travel'),
      orderCount: rows.length,
      latestOrder: toSalesOrderDto(latestOrder),
    });
  }
  return entries.slice(0, limit);
}

function toFinancePendingLogisticsDto(order: any) {
  return {
    order: toSalesOrderDto(order),
    reasons: buildFinancePendingLogisticsReasons(order),
  };
}

function buildFinancePendingLogisticsReasons(order: any) {
  const reasons: string[] = [];
  const shippingOrder = hasShippingDelivery(order);
  if (shippingOrder && !hasText(order.logisticsNo)) {
    reasons.push('missing_logistics_no');
  }
  if (shippingOrder && Number(order.logisticsFeeCents || 0) === 0) {
    reasons.push('missing_logistics_fee');
  }
  if (order.invoiceRequired && !order.invoiceIssued) {
    reasons.push('pending_invoice');
  }
  return reasons;
}

function hasShippingDelivery(order: any) {
  return (Array.isArray(order?.items) ? order.items : []).some((item: any) => {
    const deliveryType =
      DELIVERY_TYPE_FROM_PRISMA[item?.deliveryType] || item?.deliveryType;
    return deliveryType === 'shipping';
  });
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

function getSalesOrderInclude(options: any = {}): any {
  return {
    items: true,
    customer: true,
    travelGroup: getSalesOrderTravelGroupInclude(),
    commissionRecords: getSalesOrderTasterCommissionInclude(),
    ...(options.includeSalesUser ? { salesUser: true } : {}),
  };
}

function getSalesOrderTravelGroupInclude(): any {
  return {
    include: {
      commissionRecords: getSalesOrderTasterCommissionInclude(),
    },
  };
}

function getSalesOrderTasterCommissionInclude(): any {
  return {
    where: {
      targetType: TASTER_COMMISSION_TARGET_TYPE,
    },
  };
}

function getAfterSalesOrderInclude(): any {
  return {
    salesOrder: {
      include: getSalesOrderInclude(),
    },
    customer: true,
  };
}

function toAfterSalesOrderDto(order: any) {
  return {
    id: order.id,
    afterSalesNo: order.afterSalesNo,
    salesOrderId: order.salesOrderId,
    salesOrder: order.salesOrder ? toSalesOrderDto(order.salesOrder) : null,
    customerId: order.customerId || null,
    customer: order.customer ? toSalesOrderCustomerDto(order.customer) : null,
    issueType:
      AFTER_SALES_ISSUE_TYPE_FROM_PRISMA[order.issueType] || order.issueType,
    actionType:
      AFTER_SALES_ACTION_TYPE_FROM_PRISMA[order.actionType] ||
      order.actionType,
    description: order.description,
    resolution: order.resolution || null,
    refundAmountCents: Number(order.refundAmountCents || 0),
    status: AFTER_SALES_STATUS_FROM_PRISMA[order.status] || order.status,
    financeConfirmed: Boolean(order.financeConfirmed),
    financeConfirmedById: order.financeConfirmedById || null,
    financeConfirmedAt: order.financeConfirmedAt
      ? toIsoString(order.financeConfirmedAt)
      : null,
    handledById: order.handledById || null,
    handledAt: order.handledAt ? toIsoString(order.handledAt) : null,
    completedAt: order.completedAt ? toIsoString(order.completedAt) : null,
    notes: order.notes || null,
    createdById: order.createdById || null,
    updatedById: order.updatedById || null,
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
  };
}

function toSalesOrderDto(order: any) {
  const tasterCommissionCents = calculateSalesOrderTasterCommissionCents(order);
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
    entryAmountCents: Number(
      order.entryAmountCents ?? order.totalAmountCents ?? 0,
    ),
    tasterCommissionCents,
    tasterId: order.travelGroup?.tasterId || null,
    tasterName: order.travelGroup?.tasterName || null,
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
    outreachUserId: order.outreachUserId || null,
    salesUserId: order.salesUserId || null,
    items: Array.isArray(order.items)
      ? order.items.map(toSalesOrderItemDto)
      : [],
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
  };
}

function calculateSalesOrderTasterCommissionCents(order: any) {
  const records = collectSalesOrderTasterCommissionRecords(order);
  return records.reduce(
    (sum: number, record: any) => sum + Number(record.amountCents || 0),
    0,
  );
}

function collectSalesOrderTasterCommissionRecords(order: any) {
  const seen = new Set<string>();
  const records: any[] = [];
  for (const record of [
    ...(Array.isArray(order.commissionRecords) ? order.commissionRecords : []),
    ...(Array.isArray(order.travelGroup?.commissionRecords)
      ? order.travelGroup.commissionRecords
      : []),
  ]) {
    if (record?.targetType !== TASTER_COMMISSION_TARGET_TYPE) {
      continue;
    }
    const id =
      record.id ||
      `${record.salesOrderId || ''}:${record.travelGroupId || ''}:${records.length}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    records.push(record);
  }
  return records;
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

function buildSalesOrdersExportWorkbook(orders: any[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('销售订单');
  worksheet.columns = SALES_ORDER_EXPORT_COLUMNS;
  for (const column of worksheet.columns) {
    if (column.key && SALES_ORDER_EXPORT_AMOUNT_KEYS.has(String(column.key))) {
      column.numFmt = '0.00';
    }
    column.alignment = { vertical: 'top', wrapText: true };
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: SALES_ORDER_EXPORT_COLUMNS.length },
  };

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
  };

  for (const order of orders) {
    worksheet.addRow(toSalesOrderExportRow(order));
  }

  return workbook;
}

function buildTravelGroupsExportWorkbook(groups: any[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'jiangjiu-api';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('旅行团');
  worksheet.columns = TRAVEL_GROUP_EXPORT_COLUMNS;
  for (const column of worksheet.columns) {
    if (column.key && TRAVEL_GROUP_EXPORT_AMOUNT_KEYS.has(String(column.key))) {
      column.numFmt = '0.00';
    }
    column.alignment = { vertical: 'top', wrapText: true };
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: TRAVEL_GROUP_EXPORT_COLUMNS.length },
  };

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
  };

  for (const group of groups) {
    worksheet.addRow(toTravelGroupExportRow(group));
  }

  return workbook;
}

function toTravelGroupExportRow(group: any) {
  const orderSummary = group.orderSummary || {};
  const effectiveOrderCount = Number(orderSummary.orderCount || 0);
  return {
    groupNo: group.groupNo || '',
    visitDate: group.visitDate || '',
    travelAgency: group.travelAgency || '',
    licensePlate: group.licensePlate || '',
    guideName: group.guideName || '',
    guidePhone: group.guidePhone || '',
    guestCount: Number(group.guestCount || 0),
    tastingRoomNo: group.tastingRoomNo || '',
    tasterName: group.tasterName || '',
    arrivalTime: group.arrivalTime || '',
    departureTime: group.departureTime || '',
    groupType: group.groupType || '',
    tastingSummary: buildTravelGroupTastingSummary(group),
    hasEffectiveOrder: booleanLabel(effectiveOrderCount > 0),
    orderAmountYuan: centsToYuanNumber(orderSummary.totalAmountCents),
    financeMark: markLabel(group.financeMark),
    tasterSummary: group.tasterSummary || '',
    remarks: group.remarks || '',
    createdAt: group.createdAt || '',
    updatedAt: group.updatedAt || '',
  };
}

function buildTravelGroupTastingSummary(group: any) {
  if (Array.isArray(group.tastingItems) && group.tastingItems.length > 0) {
    return group.tastingItems
      .map((item: any) => {
        const productName =
          normalizeOptionalString(item?.productName) || '未命名品酒';
        const quantity = Number(item?.quantity || 0);
        const unit = normalizeOptionalString(item?.unit) || '';
        return `${productName} x ${quantity}${unit}`;
      })
      .join('；');
  }
  return group.wineDetails || '';
}

function toSalesOrderExportRow(order: any) {
  const deliverySummary = toSalesOrderDeliverySummary(order.items);
  const status = ORDER_STATUS_FROM_PRISMA[order.status] || order.status;
  const packingStatus = order.packingStatus
    ? String(order.packingStatus).toLowerCase()
    : null;
  return {
    orderNo: order.orderNo || '',
    salesFormNo: order.salesFormNo || '',
    orderDate: formatDate(order.orderDate) || '',
    customerName: order.customerName || order.customer?.name || '',
    customerPhone: order.customerPhone || order.customer?.phone || '',
    address: buildSalesOrderExportAddress(order),
    travelGroupNo: order.travelGroup?.groupNo || '',
    travelAgency: order.travelGroup?.travelAgency || '',
    salesUserName: order.salesUser?.name || '',
    itemsSummary: buildSalesOrderItemsSummary(order.items),
    deliverySummary:
      DELIVERY_SUMMARY_EXPORT_LABELS[deliverySummary || ''] ||
      deliverySummary ||
      '',
    totalAmountYuan: centsToYuanNumber(order.totalAmountCents),
    cashOnDeliveryAmountYuan: centsToYuanNumber(
      order.cashOnDeliveryAmountCents,
    ),
    status: ORDER_STATUS_EXPORT_LABELS[status] || status || '',
    customerMark: markLabel(order.customer?.financeMark ?? false),
    orderMark: markLabel(order.financeMark),
    packingStatus:
      PACKING_STATUS_EXPORT_LABELS[packingStatus || ''] ||
      PACKING_STATUS_EXPORT_LABELS[order.packingStatus] ||
      packingStatus ||
      '',
    logisticsMethod: order.logisticsMethod || '',
    logisticsNo: order.logisticsNo || '',
    logisticsFeeYuan: centsToYuanNumber(order.logisticsFeeCents),
    invoiceRequired: booleanLabel(order.invoiceRequired),
    invoiceIssued: booleanLabel(order.invoiceIssued),
    createdAt: toIsoString(order.createdAt) || '',
    updatedAt: toIsoString(order.updatedAt) || '',
  };
}

function buildSalesOrderExportAddress(order: any) {
  return [
    order.province,
    order.city,
    order.district,
    order.address,
  ]
    .map(normalizeOptionalString)
    .filter(Boolean)
    .join('');
}

function buildSalesOrderItemsSummary(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return [...items]
    .sort((left: any, right: any) => {
      const leftOrder = Number(left?.sortOrder || 0);
      const rightOrder = Number(right?.sortOrder || 0);
      return leftOrder - rightOrder;
    })
    .map((item: any) => {
      const productName = normalizeOptionalString(item?.productName) || '未命名商品';
      const quantity = Number(item?.quantity || 0);
      return `${productName} x ${quantity}`;
    })
    .join('；');
}

function centsToYuanNumber(value: unknown) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function markLabel(value: unknown) {
  return value ? '已标记' : '未标记';
}

function booleanLabel(value: unknown) {
  return value ? '是' : '否';
}

function buildSalesOrdersExportFileName(date = new Date()) {
  return `sales-orders-${formatFileNameTimestamp(date)}.xlsx`;
}

function buildTravelGroupsExportFileName(date = new Date()) {
  return `travel-groups-${formatFileNameTimestamp(date)}.xlsx`;
}

function formatFileNameTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function buildPublicSalesSheetUrl(baseUrl: unknown, token: unknown) {
  const baseUrlText = normalizeOptionalString(baseUrl);
  const tokenText = normalizeOptionalString(token);
  if (!baseUrlText || !tokenText) {
    return null;
  }
  return `${baseUrlText.replace(/\/+$/, '')}/api/public/sales-sheets/${encodeURIComponent(tokenText)}`;
}

function buildSalesOrderQrCodeResponse(order: any, baseUrl: unknown) {
  const salesSheet = buildSalesSheetDto(order, {
    publicUrl: buildPublicSalesSheetUrl(baseUrl, order?.qrCodeToken),
  });
  return {
    salesSheet,
    qrCode: salesSheet.qrCode,
  };
}

function buildPublicSalesSheetErrorResult(
  statusCode: number,
  title: string,
  message: string,
) {
  return {
    statusCode,
    html: renderPublicSalesSheetErrorHtml({ title, message }),
  };
}

function toSalesOrderQrCodeLogDto(order: any) {
  return {
    id: order?.id || null,
    orderNo: order?.orderNo || null,
    salesUserId: order?.salesUserId || null,
    qrCode: {
      tokenPresent: hasText(order?.qrCodeToken),
      tokenFingerprint: buildQrCodeTokenFingerprint(order?.qrCodeToken),
      generatedAt: toIsoString(order?.qrCodeGeneratedAt),
      expiresAt: toIsoString(order?.qrCodeExpiresAt),
    },
  };
}

function buildQrCodeTokenFingerprint(token: unknown) {
  const tokenText = normalizeOptionalString(token);
  if (!tokenText) {
    return null;
  }
  return crypto
    .createHash('sha256')
    .update(tokenText)
    .digest('hex')
    .slice(0, 16);
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

function normalizeOptionalBoolean(
  value: unknown,
  fieldName: string,
  fallback: boolean,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return normalizeBoolean(value, fieldName);
}

function normalizeOptionalObjectPayload(payload: unknown) {
  if (payload === undefined || payload === null || payload === '') {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  return payload as any;
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

function toPrismaAfterSalesStatus(value: unknown) {
  const status = AFTER_SALES_STATUS_TO_PRISMA[String(value || '').trim()];
  if (!status) {
    throw createHttpError(
      400,
      'INVALID_AFTER_SALES_STATUS',
      'After-sales status is invalid.',
    );
  }
  return status;
}

function toPrismaAfterSalesIssueType(value: unknown) {
  const issueType =
    AFTER_SALES_ISSUE_TYPE_TO_PRISMA[String(value || '').trim()];
  if (!issueType) {
    throw createHttpError(
      400,
      'INVALID_AFTER_SALES_ISSUE_TYPE',
      'After-sales issue type is invalid.',
    );
  }
  return issueType;
}

function toPrismaAfterSalesActionType(value: unknown) {
  const actionType =
    AFTER_SALES_ACTION_TYPE_TO_PRISMA[String(value || '').trim()];
  if (!actionType) {
    throw createHttpError(
      400,
      'INVALID_AFTER_SALES_ACTION_TYPE',
      'After-sales action type is invalid.',
    );
  }
  return actionType;
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

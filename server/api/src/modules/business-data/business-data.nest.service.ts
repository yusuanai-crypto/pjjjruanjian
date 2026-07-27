import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { GuidePointsSummaryNestService } from '../commissions/guide-points-summary.nest.service';
import { TravelGroupFinanceSummaryNestService } from '../commissions/travel-group-finance-summary.nest.service';
import {
  SalesOrderInventoryService,
  serverInventoryLineKey,
  shouldAssignInventoryLineKeys,
} from '../inventory/sales-order-inventory.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  calculateOrderProductProfit,
  calculateProductProfitSummary,
} from '../products/product-profit.helper';
import { SettingsNestService } from '../settings/settings.nest.service';
import {
  TODO_REMINDERS_RECONCILER,
  TodoRemindersReconciler,
} from '../todo-reminders/todo-reminders.tokens';
import {
  buildQrCodeTokenFingerprint,
  calculateQrCodeExpiresAt,
  generateQrCodeToken,
  hashQrCodeToken,
  hasReusableQrCodeToken,
  isQrCodeTokenUnexpired,
  normalizePublicQrCodeToken,
} from './qr-code-token.helper';
import {
  renderPublicSalesSheetErrorHtml,
  renderPublicSalesSheetHtml,
} from './public-sales-sheet-html.helper';
import { withGeneratedAfterSalesNo } from './after-sales-order-no.helper';
import {
  buildShanghaiNaturalDayRange,
  calculateReconciliation,
  formatDatabaseDate,
  formatShanghaiBusinessDate,
  listReconciliationBusinessDates,
  normalizeReconciliationBusinessDate,
  RECONCILIATION_INCLUDED_ORDER_STATUSES,
  RECONCILIATION_TIMEZONE,
} from './reconciliation-calculation.helper';
import { withGeneratedSalesOrderNo } from './sales-order-no.helper';
import { buildSalesSheetDto } from './sales-sheet.dto.helper';
import {
  clearTrackingCacheData,
  LogisticsTrackingService,
} from './logistics-tracking.service';
import {
  assertLogisticsProviderCode,
  logisticsProviderName,
  normalizeLogisticsProviderCode,
} from './logistics-provider.helper';
import {
  assertShippingDateNotBeforeSubmission,
  defaultBackfillShippingDate,
  formatDateOnly,
  isSameShanghaiNaturalDay,
  parseRequiredShippingDate,
  resolveSubmissionShippingDate,
  SAME_DAY_SHIPPING_WARNING,
} from './sales-order-shipping-date.helper';
import {
  assertAttachmentAggregateSize,
  createAttachmentStorageKey,
  finalizeStagedTravelGroupAttachmentDeletion,
  isSafeAttachmentStorageKey,
  normalizeTravelGroupAttachmentCategory,
  readTravelGroupAttachmentFile,
  removeTravelGroupAttachmentFile,
  restoreStagedTravelGroupAttachmentDeletion,
  sanitizeAttachmentOriginalName,
  stageTravelGroupAttachmentDeletion,
  REFUND_PROOF_ATTACHMENT_MAX_FILES_PER_REQUEST,
  TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST,
  validateRefundProofAttachmentFile,
  validateTravelGroupAttachmentFile,
  writeTravelGroupAttachmentFile,
} from './travel-group-attachment-storage.helper';
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

const PRISMA_INT_MAX = 2_147_483_647;
const SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 30_000,
};
const TRAVEL_GROUP_TYPES = new Set([
  'KB团',
  'AB团',
  '保险团',
  '渠道团',
  '散客团',
  '其他',
]);
const TRAVEL_GROUP_LOSS_STATUSES = new Set([
  'PENDING',
  'RECORDED',
  'NO_LOSS',
]);

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

const TRAVEL_GROUP_INTAKE_PATCH_FIELDS = [
  'sourceRegion',
  'ageInfo',
  'mentionedFeitian',
  'previousStopOrderStatus',
  'keyCustomerInfo',
];

const TRAVEL_GROUP_TASTER_PATCH_FIELDS = [
  'licensePlate',
  'guestCount',
  'adultCount',
  'childCount',
  'expectedArrivalTime',
  'remarks',
  'wineDetails',
  'tasterSummary',
  ...TRAVEL_GROUP_INTAKE_PATCH_FIELDS,
];

const TRAVEL_GROUP_PATCH_ALLOWED_FIELDS_BY_ROLE: any = {
  super_admin: [
    'groupNo',
    'visitDate',
    'travelAgency',
    'licensePlate',
    'guideId',
    'guideName',
    'guidePhone',
    'guestCount',
    'adultCount',
    'childCount',
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
    'lossStatus',
    ...TRAVEL_GROUP_INTAKE_PATCH_FIELDS,
    'liaisonTasterId',
    'expectedArrivalTime',
    'cigaretteFeeCents',
    ...TRAVEL_GROUP_FINANCE_PATCH_FIELDS,
  ],
  admin: [
    'groupNo',
    'visitDate',
    'travelAgency',
    'licensePlate',
    'guideId',
    'guideName',
    'guidePhone',
    'guestCount',
    'adultCount',
    'childCount',
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
    'lossStatus',
    ...TRAVEL_GROUP_INTAKE_PATCH_FIELDS,
    'liaisonTasterId',
    'expectedArrivalTime',
    'cigaretteFeeCents',
    ...TRAVEL_GROUP_FINANCE_PATCH_FIELDS,
  ],
  front_desk: [
    'visitDate',
    'travelAgency',
    'licensePlate',
    'guideId',
    'guestCount',
    'adultCount',
    'childCount',
    'tastingRoomNo',
    'tasterId',
    'arrivalTime',
    'groupType',
    'remarks',
    ...TRAVEL_GROUP_INTAKE_PATCH_FIELDS,
    'liaisonTasterId',
    'cigaretteFeeCents',
  ],
  sales: ['departureTime', 'remarks', 'tastingItems', 'lossStatus'],
  taster: TRAVEL_GROUP_TASTER_PATCH_FIELDS,
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
  { header: '发货日期', key: 'shippingDate', width: 14 },
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
  { header: '客源地', key: 'sourceRegion', width: 18 },
  { header: '年龄描述', key: 'ageInfo', width: 18 },
  { header: '车牌号', key: 'licensePlate', width: 14 },
  { header: '导游', key: 'guideName', width: 16 },
  { header: '导游电话', key: 'guidePhone', width: 16 },
  { header: '大人人数', key: 'adultCount', width: 10 },
  { header: '小孩人数', key: 'childCount', width: 10 },
  { header: '人数', key: 'guestCount', width: 10 },
  { header: '品鉴馆馆号', key: 'tastingRoomNo', width: 14 },
  { header: '品鉴师', key: 'tasterName', width: 16 },
  { header: '对接品鉴师', key: 'liaisonTasterName', width: 16 },
  { header: '预计进店时间', key: 'expectedArrivalTime', width: 14 },
  { header: '进店时间', key: 'arrivalTime', width: 12 },
  { header: '离店时间', key: 'departureTime', width: 12 },
  { header: '团型', key: 'groupType', width: 14 },
  { header: '是否提及飞天', key: 'mentionedFeitian', width: 14 },
  { header: '前站出单情况', key: 'previousStopOrderStatus', width: 22 },
  { header: '重点客户信息', key: 'keyCustomerInfo', width: 36 },
  { header: '重点客户照片数', key: 'keyCustomerPhotoCount', width: 16 },
  { header: '客人信息附件数', key: 'guestInfoAttachmentCount', width: 16 },
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
  super_admin: [
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
  'logisticsProviderCode',
  'packingStatus',
  'packageCount',
  'warehouseRemark',
  'hasPackingMark',
  'fulfillmentWarehouseId',
];

const SALES_ORDER_STATUS_PATCH_FIELDS = ['status', 'remark', 'statusReason'];

const SALES_ORDER_SALES_EDIT_FIELDS = new Set([
  'orderType',
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
  ...SALES_ORDER_FINANCE_PATCH_FIELDS,
  ...SALES_ORDER_PACKING_PATCH_FIELDS.filter(
    (field) => field !== 'fulfillmentWarehouseId',
  ),
]);

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
  'description',
  'resolution',
  'notes',
];

const AFTER_SALES_ORDER_STATUS_PATCH_FIELDS = [
  'status',
  'resolution',
  'notes',
];

const AFTER_SALES_ORDER_FINANCE_CONFIRM_PATCH_FIELDS = ['financeConfirmed'];
const AFTER_SALES_ORDER_WAREHOUSE_CONFIRM_PATCH_FIELDS = [
  'note',
  'warehouseConfirmNote',
];

const RECONCILIATION_MANUAL_PATCH_FIELDS = new Set([
  'businessDate',
  'backOfficeSalesCents',
  'paymentMethods',
  'notes',
]);

@Injectable()
export class BusinessDataNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
    private readonly settingsService: SettingsNestService,
    private readonly commissionRecordsService: CommissionRecordsNestService,
    private readonly travelGroupFinanceSummaryService: TravelGroupFinanceSummaryNestService,
    private readonly guidePointsSummaryService: GuidePointsSummaryNestService,
    private readonly logisticsTrackingService: LogisticsTrackingService,
    private readonly salesOrderInventoryService: SalesOrderInventoryService,
    @Optional()
    @Inject(TODO_REMINDERS_RECONCILER)
    private readonly todoReminders?: TodoRemindersReconciler,
  ) {}

  async listGroups(kind: string, actor: any, filters: any = {}) {
    const readRoles = [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
      ...(kind === 'travel' ? ['warehouse', 'after_sales'] : []),
    ];
    requireAnyRole(actor, readRoles);
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
    const onlyShowMarkedRecords = await this.onlyShowMarkedRecords();
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
        toGroupDto(group, kind, actor, onlyShowMarkedRecords),
      ),
      filters,
    ).slice(0, take);
  }

  async exportTravelGroupsXlsx(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const onlyShowMarkedRecords = await this.onlyShowMarkedRecords();
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
        toGroupDto(
          group,
          'travel',
          actor,
          onlyShowMarkedRecords,
        ),
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

  async uploadTravelGroupAttachments(
    actor: any,
    id: string,
    categoryValue: unknown,
    files: any[],
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'front_desk', 'taster']);
    const category = normalizeTravelGroupAttachmentCategory(categoryValue);
    const current = await this.findGroupOrThrow('travel', id, true);
    await this.assertCanReadGroup('travel', actor, current);
    assertTasterCanEditTravelGroup(actor, current);

    if (!Array.isArray(files) || files.length === 0) {
      throw createHttpError(
        400,
        'ATTACHMENT_FILE_REQUIRED',
        'At least one attachment file is required.',
      );
    }
    if (files.length > TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST) {
      throw createHttpError(
        400,
        'TOO_MANY_ATTACHMENT_FILES',
        `A maximum of ${TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST} files can be uploaded at once.`,
      );
    }
    assertAttachmentAggregateSize(files);

    const uploadedAt = new Date().toISOString();
    const storedAttachments: any[] = [];
    try {
      for (const file of files) {
        const validated = validateTravelGroupAttachmentFile(file);
        const storageKey = createAttachmentStorageKey();
        await writeTravelGroupAttachmentFile(storageKey, validated);
        storedAttachments.push({
          id: crypto.randomUUID(),
          category,
          originalName: validated.originalName,
          contentType: validated.contentType,
          size: validated.size,
          storageKey,
          uploadedById: actor.id,
          uploadedAt,
        });
      }
    } catch (error) {
      await cleanupStoredTravelGroupAttachments(storedAttachments);
      throw normalizeAttachmentStorageError(error, 'write');
    }

    const fieldName = getTravelGroupAttachmentFieldName(category);
    const beforeAttachments = getTravelGroupAttachmentMetadata(
      current,
      category,
    );
    const nextAttachments = [...beforeAttachments, ...storedAttachments];
    let updated: any;
    try {
      updated = await this.prisma.$transaction(async (tx: any) => {
        await recordTravelGroupTasterEditActivity(
          tx,
          actor,
          id,
          new Date(),
        );
        const updatedGroup = await tx.travelGroup.update({
          where: { id },
          data: {
            [fieldName]: nextAttachments,
            updatedById: actor.id,
            updatedAt: new Date(),
          },
          include: getGroupInclude('travel', 'detail'),
        });
        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'travel_groups.attachments.upload',
            entityType: 'travel_group',
            entityId: id,
            beforeData: {
              category,
              attachments: beforeAttachments.map((attachment: any) =>
                toTravelGroupAttachmentDto(attachment, category),
              ),
            },
            afterData: {
              category,
              attachments: nextAttachments.map((attachment: any) =>
                toTravelGroupAttachmentDto(attachment, category),
              ),
              uploaded: storedAttachments.map((attachment: any) =>
                toTravelGroupAttachmentDto(attachment, category),
              ),
            },
            ipAddress: metadata.ipAddress || null,
          },
          tx,
        );
        return updatedGroup;
      });
    } catch (error) {
      await cleanupStoredTravelGroupAttachments(storedAttachments);
      throw error;
    }

    return {
      attachments: storedAttachments.map((attachment: any) =>
        toTravelGroupAttachmentDto(attachment, category),
      ),
      travelGroup: toGroupDto(updated, 'travel', actor),
    };
  }

  async downloadTravelGroupAttachment(
    actor: any,
    id: string,
    attachmentId: string,
  ) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
    ]);
    const current = await this.findGroupOrThrow('travel', id, true);
    await this.assertCanReadGroup('travel', actor, current);
    await this.assertPassesGlobalGroupMarkScope(actor, current);
    const located = findTravelGroupAttachment(current, attachmentId);
    if (!located || !isSafeAttachmentStorageKey(located.attachment.storageKey)) {
      throw attachmentNotFoundError();
    }

    let buffer: Buffer;
    try {
      buffer = await readTravelGroupAttachmentFile(
        located.attachment.storageKey,
      );
    } catch (error) {
      if ((error as any)?.statusCode === 404 || (error as any)?.code === 'ENOENT') {
        throw attachmentNotFoundError();
      }
      throw createHttpError(
        500,
        'ATTACHMENT_READ_FAILED',
        'Attachment could not be read.',
      );
    }

    return {
      attachment: toTravelGroupAttachmentDto(
        located.attachment,
        located.category,
      ),
      originalName: located.attachment.originalName,
      contentType: located.attachment.contentType,
      buffer,
    };
  }

  async deleteTravelGroupAttachment(
    actor: any,
    id: string,
    attachmentId: string,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'front_desk', 'taster']);
    const current = await this.findGroupOrThrow('travel', id, true);
    await this.assertCanReadGroup('travel', actor, current);
    assertTasterCanEditTravelGroup(actor, current);
    const located = findTravelGroupAttachment(current, attachmentId);
    if (!located || !isSafeAttachmentStorageKey(located.attachment.storageKey)) {
      throw attachmentNotFoundError();
    }

    let staged: any;
    try {
      staged = await stageTravelGroupAttachmentDeletion(
        located.attachment.storageKey,
      );
    } catch (error) {
      throw normalizeAttachmentStorageError(error, 'delete');
    }

    const beforeAttachments = getTravelGroupAttachmentMetadata(
      current,
      located.category,
    );
    const nextAttachments = beforeAttachments.filter(
      (attachment: any) => attachment?.id !== attachmentId,
    );
    const fieldName = getTravelGroupAttachmentFieldName(located.category);
    let updated: any;
    try {
      updated = await this.prisma.$transaction(async (tx: any) => {
        await recordTravelGroupTasterEditActivity(
          tx,
          actor,
          id,
          new Date(),
        );
        const updatedGroup = await tx.travelGroup.update({
          where: { id },
          data: {
            [fieldName]: nextAttachments,
            updatedById: actor.id,
            updatedAt: new Date(),
          },
          include: getGroupInclude('travel', 'detail'),
        });
        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'travel_groups.attachments.delete',
            entityType: 'travel_group',
            entityId: id,
            beforeData: {
              category: located.category,
              attachment: toTravelGroupAttachmentDto(
                located.attachment,
                located.category,
              ),
            },
            afterData: {
              category: located.category,
              attachments: nextAttachments.map((attachment: any) =>
                toTravelGroupAttachmentDto(attachment, located.category),
              ),
            },
            ipAddress: metadata.ipAddress || null,
          },
          tx,
        );
        return updatedGroup;
      });
    } catch (error) {
      try {
        await restoreStagedTravelGroupAttachmentDeletion(staged);
      } catch {
        throw createHttpError(
          500,
          'ATTACHMENT_DELETE_ROLLBACK_FAILED',
          'Attachment metadata update failed and the file could not be restored.',
        );
      }
      throw error;
    }

    try {
      await finalizeStagedTravelGroupAttachmentDeletion(staged);
    } catch {
      throw createHttpError(
        500,
        'ATTACHMENT_DELETE_CLEANUP_FAILED',
        'Attachment metadata was deleted but file cleanup failed.',
      );
    }

    return {
      attachment: toTravelGroupAttachmentDto(
        located.attachment,
        located.category,
      ),
      travelGroup: toGroupDto(updated, 'travel', actor),
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
    const onlyShowMarkedRecords = await this.onlyShowMarkedRecords();
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
        toGroupDto(
          group,
          'travel',
          actor,
          onlyShowMarkedRecords,
        ),
      ),
      filters,
    )
      .filter((group: any) => group.pendingStatus)
      .slice(0, take);
  }

  async getGroup(kind: string, actor: any, id: string) {
    const readRoles = [
      'admin',
      'boss',
      'front_desk',
      'sales',
      'finance',
      'taster',
      ...(kind === 'travel' ? ['warehouse', 'after_sales'] : []),
    ];
    requireAnyRole(actor, readRoles);
    const group = await this.findGroupOrThrow(kind, id, true);
    await this.assertCanReadGroup(kind, actor, group);
    await this.assertPassesGlobalGroupMarkScope(actor, group);
    return toGroupDto(
      group,
      kind,
      actor,
      await this.onlyShowMarkedRecords(),
    );
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
    assertTravelGroupCreateAllowedFields(actor, payload);
    const data = buildTravelGroupCreateData(payload, actor);
    const tastingItemInputs = buildTravelGroupTastingItems(
      payload?.tastingItems,
    );

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

      const taster = data.tasterId
        ? await findActiveTasterUser(tx, data.tasterId, 'tasterId')
        : null;
      const liaisonTaster = data.liaisonTasterId
        ? await findActiveTasterUser(
            tx,
            data.liaisonTasterId,
            'liaisonTasterId',
          )
        : null;

      const tastingItems = await resolveTravelGroupTastingItems(
        tx,
        tastingItemInputs,
      );
      if (tastingItems.length > 0) {
        data.lossStatus = 'RECORDED';
        data.lossConfirmedAt = new Date();
        data.lossConfirmedById = actor.id;
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
              tasterName: taster?.name || null,
              liaisonTasterName: liaisonTaster?.name || null,
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

    await this.reconcileTodoSources([
      { sourceType: 'TRAVEL_GROUP', sourceId: created.id },
    ]);
    return toGroupDto(created, 'travel', actor);
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
    return toGroupDto(updated, kind, actor);
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
    const current = await this.findGroupOrThrow('travel', id, true);
    await this.assertCanReadGroup('travel', actor, current);
    assertTasterCanEditTravelGroup(actor, current);
    assertSalesCanEditTravelGroup(actor, current);
    assertTravelGroupPatchAllowedFields(actor, payload, current);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const data = buildTravelGroupUpdateData(payload, actor, current);

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
        const taster = data.tasterId
          ? await findActiveTasterUser(tx, data.tasterId, 'tasterId')
          : null;
        data.tasterName = taster?.name || null;
      }

      if (data.liaisonTasterId !== undefined) {
        const liaisonTaster = data.liaisonTasterId
          ? await findActiveTasterUser(
              tx,
              data.liaisonTasterId,
              'liaisonTasterId',
            )
          : null;
        data.liaisonTasterName = liaisonTaster?.name || null;
      }

      if (payload?.tastingItems !== undefined) {
        const tastingItems = await resolveTravelGroupTastingItems(
          tx,
          buildTravelGroupTastingItems(payload.tastingItems),
        );
        applyTravelGroupLossConfirmationData(
          data,
          actor,
          payload,
          current,
          tastingItems,
        );
        data.tastingItems = {
          deleteMany: {},
          create: tastingItems,
        };
      } else if (payload?.lossStatus !== undefined) {
        applyTravelGroupLossConfirmationData(
          data,
          actor,
          payload,
          current,
          null,
        );
      }

      await recordTravelGroupTasterEditActivity(
        tx,
        actor,
        id,
        new Date(),
      );
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

    await this.reconcileTodoSources([
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.id },
    ]);
    return toGroupDto(updated, 'travel', actor);
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

    if (kind === 'travel') {
      await this.reconcileTodoSources([
        { sourceType: 'TRAVEL_GROUP', sourceId: updated.id },
      ]);
    }
    return toGroupDto(updated, kind, actor);
  }

  async submitTravelGroupTasterSummary(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'taster']);
    const current = await this.findGroupOrThrow('travel', id, true);
    await this.assertCanReadGroup('travel', actor, current);
    assertTasterCanEditTravelGroup(actor, current);

    const now = new Date();
    const summary = normalizeRequiredString(
      payload?.tasterSummary,
      'tasterSummary',
    );
    const updated = await this.prisma.$transaction(async (tx: any) => {
      await recordTravelGroupTasterEditActivity(tx, actor, id, now);
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

    await this.reconcileTodoSources([
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.id },
    ]);
    return toGroupDto(updated, 'travel', actor);
  }

  async listSalesOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, [
      'admin',
      'boss',
      'sales',
      'finance',
      'warehouse',
      'after_sales',
      'taster',
    ]);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(
        actor,
        buildReadableSalesOrderWhere(actor, filters),
      ),
      include: getSalesOrderInclude(),
      orderBy: buildSalesOrderOrderBy(filters),
      take: normalizeTake(filters.limit, 50),
    });
    return orders.map((order: any) => toSalesOrderDtoForActor(order, actor));
  }

  async exportSalesOrdersXlsx(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(
        actor,
        buildSalesOrderWhere(filters),
      ),
      include: getSalesOrderInclude({ includeSalesUser: true }),
      orderBy: buildSalesOrderOrderBy(filters),
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
    return toSalesOrderDtoForActor(order, actor);
  }

  async getSalesOrderSalesSheet(actor: any, id: string) {
    const order = await this.findReadableSalesOrderOrThrow(actor, id, {
      includeSalesUser: true,
    });
    const tracking = await this.logisticsTrackingService.resolveForSalesSheet(
      order,
    );
    return buildSalesSheetDto({
      ...tracking.order,
      trackingMessage: tracking.trackingMessage,
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
      !current.qrCodeRevokedAt &&
      hasReusableQrCodeToken(
        current.qrCodeTokenHash,
        current.qrCodeExpiresAt,
        now,
      )
    ) {
      throw createHttpError(
        409,
        'QR_CODE_ALREADY_ACTIVE',
        'An active QR code already exists. Revoke it or explicitly regenerate it.',
      );
    }

    const nextQrCodeToken = generateQrCodeToken();
    const nextQrCodeTokenHash = hashQrCodeToken(nextQrCodeToken);
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: {
          qrCodeTokenHash: nextQrCodeTokenHash,
          qrCodeGeneratedAt: now,
          qrCodeExpiresAt: expiresAt,
          qrCodeRevokedAt: null,
          updatedById: actor.id,
          updatedAt: now,
        },
        include: getSalesOrderInclude({ includeSalesUser: true }),
      });

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: hasText(current.qrCodeTokenHash)
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

    const tracking = await this.logisticsTrackingService.resolveForSalesSheet(
      updated,
    );
    return buildSalesOrderQrCodeResponse(
      {
        ...tracking.order,
        trackingMessage: tracking.trackingMessage,
      },
      metadata.publicSalesSheetBaseUrl,
      nextQrCodeToken,
    );
  }

  async revokeSalesOrderQrCode(
    actor: any,
    id: string,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'sales']);
    const current = await this.findReadableSalesOrderOrThrow(actor, id, {
      includeSalesUser: true,
    });
    if (!current.qrCodeTokenHash) {
      return buildSalesOrderQrCodeResponse(current, null, null);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: { id },
        data: {
          qrCodeTokenHash: null,
          qrCodeRevokedAt: now,
          updatedById: actor.id,
          updatedAt: now,
        },
        include: getSalesOrderInclude({ includeSalesUser: true }),
      });

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.qr_code.revoke',
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

    return buildSalesOrderQrCodeResponse(updated, null, null);
  }

  async getPublicSalesSheetHtml(token: string) {
    const tokenText = normalizePublicQrCodeToken(token);
    if (!tokenText) {
      return buildPublicSalesSheetUnavailableResult();
    }

    const order = await this.prisma.salesOrder.findUnique({
      where: {
        qrCodeTokenHash: hashQrCodeToken(tokenText),
      },
      include: getSalesOrderInclude({ includeSalesUser: true }),
    });
    if (
      !order ||
      order.qrCodeRevokedAt ||
      !isQrCodeTokenUnexpired(order.qrCodeExpiresAt)
    ) {
      return buildPublicSalesSheetUnavailableResult();
    }

    const tracking = await this.logisticsTrackingService.resolveForSalesSheet(
      order,
    );
    const salesSheet = buildSalesSheetDto({
      ...tracking.order,
      trackingMessage: tracking.trackingMessage,
    }).public;
    return {
      statusCode: 200,
      html: renderPublicSalesSheetHtml(salesSheet),
    };
  }

  async createSalesOrder(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'sales', 'finance']);
    assertSalesOrderInventoryFieldsAreServerOwned(payload);
    const itemInputs = buildSalesOrderItems(payload?.items);
    const submittedAt = new Date();
    const data = buildSalesOrderData(
      payload,
      actor,
      itemInputs,
      submittedAt,
    );
    const inventoryReceiptIds: string[] = [];
    const order = await this.prisma.$transaction(async (tx: any) => {
      const inventoryActivation =
        await this.salesOrderInventoryService.prepareNewOrder(
          tx,
          data.orderType,
          submittedAt,
        );
      if (inventoryActivation) {
        Object.assign(data, inventoryActivation);
      }
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
        assertSalesCanUseTravelGroup(actor, travelGroup);
        if (data.orderType === 'TRAVEL_GROUP') {
          await assertTravelGroupFrontDeskInfoComplete(tx, travelGroup);
        }
      }
      if (data.salesUserId) {
        await findActiveRoleUser(tx, data.salesUserId, 'salesUserId', [
          'SALES',
          'sales',
        ]);
      }
      if (data.outreachUserId) {
        await findActiveRoleUser(tx, data.outreachUserId, 'outreachUserId', [
          'SALES',
          'sales',
        ]);
      }

      const orderItems = await resolveSalesOrderItemSnapshots(
        tx,
        itemInputs,
        data.orderDate,
        [],
        false,
        {
          assignQuantityInventoryLineKeys:
            shouldAssignInventoryLineKeys(data.inventoryAppliedAt),
        },
      );
      data.totalAmountCents = sumSalesOrderItemSubtotals(orderItems);
      data.items = {
        create: orderItems.map(toSalesOrderItemCreateData),
      };

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

          const inventorySync =
            await this.salesOrderInventoryService.synchronize(
              tx,
              actor,
              null,
              createdOrder,
              metadata,
            );
          inventoryReceiptIds.push(
            ...inventorySync.commandReceiptIds,
          );
          let orderForLog =
            (await tx.salesOrder.findUnique({
              where: {
                id: createdOrder.id,
              },
              include: getSalesOrderInclude(),
            })) || createdOrder;
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
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.salesOrderInventoryService.dispatchCommittedReceipts(
      inventoryReceiptIds,
    );
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: order.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: order.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(order, actor);
  }

  async salesEditSalesOrder(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['sales']);
    assertSalesOrderSalesEditAllowedFields(payload);
    const current = await this.findReadableSalesOrderOrThrow(actor, id);
    const submittedItemInputs = hasOwn(payload, 'items')
      ? buildSalesOrderItems(payload.items)
      : null;

    const inventoryReceiptIds: string[] = [];
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const data = {
        ...buildSalesOrderUpdateData(payload, actor),
        ...buildSalesOrderFinanceUpdateData(payload, actor),
        ...buildSalesOrderPackingUpdateData(payload, actor),
      };
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
          where: { id: finalTravelGroupId },
        });
        if (!travelGroup) {
          throw createHttpError(
            404,
            'TRAVEL_GROUP_NOT_FOUND',
            'Related travel group does not exist.',
          );
        }
        assertSalesCanUseTravelGroup(actor, travelGroup);
      }
      if (data.outreachUserId) {
        await findActiveRoleUser(tx, data.outreachUserId, 'outreachUserId', [
          'SALES',
          'sales',
        ]);
      }

      const finalOrderDate = data.orderDate || current.orderDate;
      const orderDateChanged =
        data.orderDate !== undefined &&
        formatDate(data.orderDate) !== formatDate(current.orderDate);
      let resolvedOrderItems: any[] | null = null;
      if (submittedItemInputs) {
        resolvedOrderItems = await resolveSalesOrderItemSnapshots(
          tx,
          submittedItemInputs,
          finalOrderDate,
          current.items || [],
          orderDateChanged,
          {
            assignQuantityInventoryLineKeys:
              shouldAssignInventoryLineKeys(
                current.inventoryAppliedAt,
              ),
          },
        );
        data.totalAmountCents =
          sumSalesOrderItemSubtotals(resolvedOrderItems);
        data.items = {
          deleteMany: {},
          create: resolvedOrderItems.map(toSalesOrderItemCreateData),
        };
      } else if (orderDateChanged) {
        const existingItemInputs = (current.items || []).map(
          salesOrderItemToSnapshotInput,
        );
        resolvedOrderItems = await resolveSalesOrderItemSnapshots(
          tx,
          existingItemInputs,
          finalOrderDate,
          current.items || [],
          true,
          {
            assignQuantityInventoryLineKeys:
              shouldAssignInventoryLineKeys(
                current.inventoryAppliedAt,
              ),
          },
        );
        data.totalAmountCents =
          sumSalesOrderItemSubtotals(resolvedOrderItems);
        data.items = {
          deleteMany: {},
          create: resolvedOrderItems.map(toSalesOrderItemCreateData),
        };
      }

      if (
        hasOwn(payload, 'logisticsNo') &&
        normalizeOptionalString(current.logisticsNo) !==
          normalizeOptionalString(data.logisticsNo)
      ) {
        Object.assign(data, clearTrackingCacheData());
      }
      if (packingUpdateChangesProvider(current, data)) {
        Object.assign(data, clearTrackingCacheData());
      }
      const validationCurrent = {
        ...current,
        logisticsNo: hasOwn(data, 'logisticsNo')
          ? data.logisticsNo
          : current.logisticsNo,
        items: resolvedOrderItems || current.items,
      };
      assertExistingPackedLogisticsNoNotCleared(current, data);
      assertPackingProviderDetails(current, data);
      assertPackedLogisticsProviderPresent(validationCurrent, data);

      await claimSalesOrderEditOpportunity(tx, actor, id, new Date());
      const updatedOrder = await tx.salesOrder.update({
        where: { id },
        data,
        include: getSalesOrderInclude(),
      });
      const inventorySync =
        await this.salesOrderInventoryService.synchronize(
          tx,
          actor,
          current,
          updatedOrder,
          metadata,
        );
      inventoryReceiptIds.push(...inventorySync.commandReceiptIds);

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
          where: { id },
          include: getSalesOrderInclude(),
        })) || updatedOrder;
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.sales_edit',
          entityType: 'sales_order',
          entityId: orderForLog.id,
          beforeData: toSalesOrderDto(current),
          afterData: toSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      if (
        shouldRecalculateStage7ForSalesOrderUpdate(
          current,
          orderForLog,
          payload,
        )
      ) {
        await this.refreshStage7SalesOrderCommissionAndSummary(
          tx,
          orderForLog.id,
          actor,
          metadata,
          {
            trigger: 'sales_order_sales_edit',
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
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.salesOrderInventoryService.dispatchCommittedReceipts(
      inventoryReceiptIds,
    );
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: current.travelGroupId },
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
  }

  async updateSalesOrder(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
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
    const submittedItemInputs = hasOwn(payload, 'items')
      ? buildSalesOrderItems(payload.items)
      : null;

    const inventoryReceiptIds: string[] = [];
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
      if (data.salesUserId) {
        await findActiveRoleUser(tx, data.salesUserId, 'salesUserId', [
          'SALES',
          'sales',
        ]);
      }
      if (data.outreachUserId) {
        await findActiveRoleUser(tx, data.outreachUserId, 'outreachUserId', [
          'SALES',
          'sales',
        ]);
      }

      const finalOrderDate = data.orderDate || current.orderDate;
      const orderDateChanged =
        data.orderDate !== undefined &&
        formatDate(data.orderDate) !== formatDate(current.orderDate);
      let resolvedOrderItems: any[] | null = null;
      if (submittedItemInputs) {
        const orderItems = await resolveSalesOrderItemSnapshots(
          tx,
          submittedItemInputs,
          finalOrderDate,
          current.items || [],
          orderDateChanged,
          {
            assignQuantityInventoryLineKeys:
              shouldAssignInventoryLineKeys(
                current.inventoryAppliedAt,
              ),
          },
        );
        resolvedOrderItems = orderItems;
        data.totalAmountCents = sumSalesOrderItemSubtotals(orderItems);
        data.items = {
          deleteMany: {},
          create: orderItems.map(toSalesOrderItemCreateData),
        };
      } else if (orderDateChanged) {
        const existingItemInputs = (current.items || []).map(
          salesOrderItemToSnapshotInput,
        );
        const orderItems = await resolveSalesOrderItemSnapshots(
          tx,
          existingItemInputs,
          finalOrderDate,
          current.items || [],
          true,
          {
            assignQuantityInventoryLineKeys:
              shouldAssignInventoryLineKeys(
                current.inventoryAppliedAt,
              ),
          },
        );
        resolvedOrderItems = orderItems;
        data.totalAmountCents = sumSalesOrderItemSubtotals(orderItems);
        data.items = {
          deleteMany: {},
          create: orderItems.map(toSalesOrderItemCreateData),
        };
      }

      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data,
        include: getSalesOrderInclude(),
      });
      const inventorySync =
        await this.salesOrderInventoryService.synchronize(
          tx,
          actor,
          current,
          updatedOrder,
          metadata,
        );
      inventoryReceiptIds.push(...inventorySync.commandReceiptIds);

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
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.salesOrderInventoryService.dispatchCommittedReceipts(
      inventoryReceiptIds,
    );
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: current.travelGroupId },
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
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
    assertCanReadSalesOrder(actor, current);
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current);
    const inventoryReceiptIds: string[] = [];
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const financeData = buildSalesOrderFinanceUpdateData(payload, actor);
      if (
        hasOwn(payload, 'logisticsNo') &&
        normalizeOptionalString(current.logisticsNo) !==
          normalizeOptionalString(financeData.logisticsNo)
      ) {
        Object.assign(financeData, clearTrackingCacheData());
      }
      assertExistingPackedLogisticsNoNotCleared(current, financeData);
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: financeData,
        include: getSalesOrderInclude(),
      });
      const inventorySync =
        await this.salesOrderInventoryService.synchronize(
          tx,
          actor,
          current,
          updatedOrder,
          metadata,
        );
      inventoryReceiptIds.push(...inventorySync.commandReceiptIds);

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
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.salesOrderInventoryService.dispatchCommittedReceipts(
      inventoryReceiptIds,
    );
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
  }

  async updateSalesOrderPacking(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'warehouse', 'finance']);
    assertSalesOrderPackingPatchAllowedFields(payload, actor);
    const serializedAssignments =
      normalizeSerializedPackingAssignments(
        payload.serializedAssignments,
      );

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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current);

    const inventoryReceiptIds: string[] = [];
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const packingData = buildSalesOrderPackingUpdateData(payload, actor);
      if (packingUpdateChangesProvider(current, packingData)) {
        Object.assign(packingData, clearTrackingCacheData());
      }
      assertPackingProviderDetails(current, packingData);
      assertPackedLogisticsProviderPresent(current, packingData);
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: packingData,
        include: getSalesOrderInclude(),
      });
      const inventorySync =
        await this.salesOrderInventoryService.synchronize(
          tx,
          actor,
          current,
          updatedOrder,
          {
            ...metadata,
            serializedAssignments,
          },
        );
      inventoryReceiptIds.push(...inventorySync.commandReceiptIds);
      const orderForResponse =
        (await tx.salesOrder.findUnique({
          where: { id: updatedOrder.id },
          include: getSalesOrderInclude(),
        })) || updatedOrder;

      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'sales_orders.packing.update',
          entityType: 'sales_order',
          entityId: updatedOrder.id,
          beforeData: toSalesOrderDto(current),
          afterData: toSalesOrderDto(orderForResponse),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return orderForResponse;
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.salesOrderInventoryService.dispatchCommittedReceipts(
      inventoryReceiptIds,
    );
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
  }

  async updateSalesOrderShippingDate(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['sales', 'finance', 'after_sales', 'warehouse']);
    assertShippingDatePatchAllowedFields(payload);
    const shippingDate = parseRequiredShippingDate(payload.shippingDate);
    const reason = normalizeOptionalString(payload.reason);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const current = await tx.salesOrder.findUnique({
        where: { id },
        include: getSalesOrderInclude(),
      });
      if (!current) {
        throw createHttpError(
          404,
          'SALES_ORDER_NOT_FOUND',
          'Sales order does not exist.',
        );
      }
      assertCanUpdateSalesOrderShippingDate(actor, current);
      await this.assertPassesGlobalSalesOrderMarkScope(actor, current);
      assertShippingDateNotBeforeSubmission(shippingDate, current.createdAt);
      if (current.packingStatus === 'PACKED') {
        throw salesOrderAlreadyOutboundError();
      }

      const previousDate = current.shippingDate
        ? formatDateOnly(current.shippingDate)
        : null;
      const nextDate = formatDateOnly(shippingDate);
      if (previousDate === nextDate) {
        return current;
      }

      const claimed = await tx.salesOrder.updateMany({
        where: {
          id,
          packingStatus: {
            not: 'PACKED',
          },
        },
        data: {
          shippingDate,
          shippingDateSource: 'USER_SPECIFIED',
          shippingDateBackfillBatchId: null,
          updatedById: actor.id,
          updatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw salesOrderAlreadyOutboundError();
      }

      const updatedOrder = await tx.salesOrder.findUnique({
        where: { id },
        include: getSalesOrderInclude(),
      });
      if (!updatedOrder) {
        throw createHttpError(
          404,
          'SALES_ORDER_NOT_FOUND',
          'Sales order does not exist.',
        );
      }
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          actorRoleSnapshot: actor.role,
          action: 'sales_orders.shipping_date.update',
          entityType: 'sales_order',
          entityId: id,
          beforeData: {
            id,
            orderNo: current.orderNo,
            shippingDate: previousDate,
          },
          afterData: {
            id,
            orderNo: updatedOrder.orderNo,
            shippingDate: nextDate,
            reason,
          },
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return updatedOrder;
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
  }

  async updateSalesOrderStatus(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
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

    const inventoryReceiptIds: string[] = [];
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.salesOrder.update({
        where: {
          id,
        },
        data: buildSalesOrderStatusUpdateData(payload, actor),
        include: getSalesOrderInclude(),
      });
      const inventorySync =
        await this.salesOrderInventoryService.synchronize(
          tx,
          actor,
          current,
          updatedOrder,
          metadata,
        );
      inventoryReceiptIds.push(...inventorySync.commandReceiptIds);

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
    }, SALES_ORDER_INVENTORY_TRANSACTION_OPTIONS);

    await this.salesOrderInventoryService.dispatchCommittedReceipts(
      inventoryReceiptIds,
    );
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: current.travelGroupId },
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
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
    await this.reconcileTodoSources([
      { sourceType: 'SALES_ORDER', sourceId: updated.id },
      { sourceType: 'TRAVEL_GROUP', sourceId: updated.travelGroupId },
    ]);
    return toSalesOrderDtoForActor(updated, actor);
  }

  async listAfterSalesOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, [
      'admin',
      'finance',
      'after_sales',
      'sales',
      'warehouse',
    ]);
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
    return orders.map((order: any) => toAfterSalesOrderDto(order, actor));
  }

  async createAfterSalesOrder(
    actor: any,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'after_sales']);
    const body = normalizeOptionalObjectPayload(payload);
    const salesOrderId = normalizeRequiredString(
      body.sourceSalesOrderId || body.salesOrderId,
      'salesOrderId',
    );
    const readableSalesOrder = await this.findReadableSalesOrderOrThrow(
      actor,
      salesOrderId,
    );
    if (readableSalesOrder.orderType === 'AFTER_SALES') {
      throw createHttpError(
        400,
        'AFTER_SALES_SOURCE_ORDER_INVALID',
        'After-sales orders must reference an original sales order.',
      );
    }

    const created = await this.prisma.$transaction(
      async (tx: any) => {
        const salesOrder = await tx.salesOrder.findUnique({
          where: {
            id: salesOrderId,
          },
          include: {
            items: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
            customer: true,
            travelGroup: true,
            afterSalesOrders: {
              include: {
                items: true,
              },
            },
          },
        });
        if (!salesOrder) {
          throw createHttpError(
            404,
            'SALES_ORDER_NOT_FOUND',
            'Sales order does not exist.',
          );
        }
        if (salesOrder.orderType === 'AFTER_SALES') {
          throw createHttpError(
            400,
            'AFTER_SALES_SOURCE_ORDER_INVALID',
            'After-sales orders must reference an original sales order.',
          );
        }

        const now = new Date();
        const calculationDate = getShanghaiTodayDate(now);
        const actionType = toPrismaAfterSalesActionType(
          normalizeRequiredString(body.actionType, 'actionType'),
        );
        const items = resolveAfterSalesOrderItems(
          body.items,
          salesOrder,
          actionType,
        );
        validateAfterSalesAvailableQuantity(items, salesOrder.afterSalesOrders);
        const refundAmountCents = items.reduce(
          (sum: number, item: any) => sum + item.subtotalCents,
          0,
        );
        validateAfterSalesRefundAmount(
          body,
          salesOrder,
          salesOrder.afterSalesOrders,
          actionType,
          refundAmountCents,
        );
        const calculationSnapshot =
          await this.resolveAfterSalesCalculationSnapshot(
            tx,
            salesOrder,
            refundAmountCents,
            calculationDate,
          );
        const afterSalesOrderId = crypto.randomUUID();

        return withGeneratedAfterSalesNo(
          tx.afterSalesOrder,
          now,
          async (afterSalesNo) => {
            const afterSalesSalesOrderId = crypto.randomUUID();
            const generatedSalesOrder = await tx.salesOrder.create({
              data: buildAfterSalesSalesOrderCreateData({
                id: afterSalesSalesOrderId,
                afterSalesNo,
                sourceSalesOrder: salesOrder,
                items,
                refundAmountCents,
                orderDate: calculationDate,
                actor,
                now,
              }),
              include: getSalesOrderInclude(),
            });

            const data = buildAfterSalesOrderCreateData(
              body,
              actor,
              salesOrder,
              {
                id: afterSalesOrderId,
                afterSalesSalesOrderId,
                refundAmountCents,
                actionType,
                calculationDate,
                calculationSnapshot,
                items,
                now,
              },
            );
          const createdOrder = await tx.afterSalesOrder.create({
            data: {
              ...data,
              afterSalesNo,
            },
            include: getAfterSalesOrderInclude(),
          });

            const impact = await this.refreshAfterSalesAdjustmentRecords(
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
            await this.operationLogsService.appendLog(
              {
                userId: actor.id,
                action: 'sales_orders.create',
                entityType: 'sales_order',
                entityId: generatedSalesOrder.id,
                beforeData: null,
                afterData: toSalesOrderDto(generatedSalesOrder),
                ipAddress: metadata.ipAddress || null,
              },
              tx,
            );
          return attachAfterSalesCommissionAndPointsImpact(
            orderForLog,
            impact,
          );
          },
          tx.salesOrder,
        );
      },
      {
        isolationLevel: 'Serializable',
      },
    );

    await this.reconcileTodoSources([
      { sourceType: 'AFTER_SALES_ORDER', sourceId: created.id },
      {
        sourceType: 'SALES_ORDER',
        sourceId: created.afterSalesSalesOrderId,
      },
    ]);
    return toAfterSalesOrderMutationResult(created);
  }

  async getAfterSalesOrder(actor: any, id: string) {
    requireAnyRole(actor, [
      'admin',
      'finance',
      'after_sales',
      'sales',
      'warehouse',
    ]);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, order.salesOrder);
    return toAfterSalesOrderDto(order, actor);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: buildAfterSalesOrderUpdateData(payload, actor),
        include: getAfterSalesOrderInclude(),
      });
      const impact =
        await this.refreshAfterSalesAdjustmentRecords(
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
      return attachAfterSalesCommissionAndPointsImpact(orderForLog, impact);
    });

    await this.reconcileTodoSources([
      { sourceType: 'AFTER_SALES_ORDER', sourceId: updated.id },
    ]);
    return toAfterSalesOrderMutationResult(updated);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);

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
    if (
      status === 'WAITING_REFUND' &&
      ['WAITING_RECEIVE', 'WAITING_RESEND'].includes(current.status) &&
      !isAfterSalesPhysicalReturnComplete(current)
    ) {
      throw createHttpError(
        400,
        hasReturnRequiredItems(current)
          ? 'AFTER_SALES_RECEIPT_REQUIRED'
          : 'AFTER_SALES_WAREHOUSE_CONFIRM_REQUIRED',
        hasReturnRequiredItems(current)
          ? 'All required goods must be posted through actual warehouse receipts before waiting refund.'
          : 'Warehouse confirmation is required before waiting refund.',
      );
    }
    if (status === 'COMPLETED') {
      if (
        ['WAITING_RECEIVE', 'WAITING_RESEND'].includes(current.status) &&
        !isAfterSalesPhysicalReturnComplete(current)
      ) {
        throw createHttpError(
          400,
          hasReturnRequiredItems(current)
            ? 'AFTER_SALES_RECEIPT_REQUIRED'
            : 'AFTER_SALES_WAREHOUSE_CONFIRM_REQUIRED',
          hasReturnRequiredItems(current)
            ? 'All required goods must be posted through actual warehouse receipts before completion.'
            : 'Warehouse confirmation is required before completion.',
        );
      }
      if (
        Number(current.refundAmountCents || 0) > 0 &&
        (!current.financeConfirmed ||
          getAfterSalesRefundProofAttachments(current).length === 0)
      ) {
        throw createHttpError(
          400,
          'AFTER_SALES_FINANCE_CONFIRM_REQUIRED',
          'Refund completion requires finance confirmation and refund proof.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: buildAfterSalesOrderStatusUpdateData(body, actor, status),
        include: getAfterSalesOrderInclude(),
      });
      const impact =
        await this.refreshAfterSalesAdjustmentRecords(
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
      return attachAfterSalesCommissionAndPointsImpact(orderForLog, impact);
    });

    await this.reconcileTodoSources([
      { sourceType: 'AFTER_SALES_ORDER', sourceId: updated.id },
    ]);
    return toAfterSalesOrderMutationResult(updated);
  }

  async confirmAfterSalesOrderWarehouse(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'warehouse']);
    assertAfterSalesOrderWarehouseConfirmPatchAllowedFields(payload);
    const body = normalizeOptionalObjectPayload(payload);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);
    if (!['WAITING_RECEIVE', 'WAITING_RESEND'].includes(current.status)) {
      throw createHttpError(
        400,
        'AFTER_SALES_WAREHOUSE_CONFIRM_STATUS_INVALID',
        'Warehouse confirmation only supports waiting_receive or waiting_resend.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: buildAfterSalesOrderWarehouseConfirmData(body, actor),
        include: getAfterSalesOrderInclude(),
      });
      const impact =
        await this.refreshAfterSalesAdjustmentRecords(
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
          action: 'after_sales_orders.warehouse_confirm',
          entityType: 'after_sales_order',
          entityId: orderForLog.id,
          beforeData: toAfterSalesOrderDto(current),
          afterData: toAfterSalesOrderDto(orderForLog),
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return attachAfterSalesCommissionAndPointsImpact(orderForLog, impact);
    });

    await this.reconcileTodoSources([
      { sourceType: 'AFTER_SALES_ORDER', sourceId: updated.id },
    ]);
    return toAfterSalesOrderMutationResult(updated);
  }

  async confirmAfterSalesOrderFinanceRefund(
    actor: any,
    id: string,
    files: any[],
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);
    if (current.status !== 'WAITING_REFUND') {
      throw createHttpError(
        400,
        'AFTER_SALES_REFUND_STATUS_INVALID',
        'Finance refund confirmation requires waiting_refund status.',
      );
    }
    if (Number(current.refundAmountCents || 0) <= 0) {
      throw createHttpError(
        400,
        'AFTER_SALES_REFUND_NOT_REQUIRED',
        'After-sales order has no refund amount to confirm.',
      );
    }
    assertAfterSalesAgencyDeductionReadyForConfirmation(current);
    if (!Array.isArray(files) || files.length === 0) {
      throw createHttpError(
        400,
        'REFUND_PROOF_FILE_REQUIRED',
        'At least one refund proof file is required.',
      );
    }
    if (files.length > REFUND_PROOF_ATTACHMENT_MAX_FILES_PER_REQUEST) {
      throw createHttpError(
        400,
        'TOO_MANY_REFUND_PROOF_FILES',
        `A maximum of ${REFUND_PROOF_ATTACHMENT_MAX_FILES_PER_REQUEST} refund proof files can be uploaded at once.`,
      );
    }
    assertAttachmentAggregateSize(files);

    const uploadedAt = new Date().toISOString();
    const storedAttachments: any[] = [];
    try {
      for (const file of files) {
        const validated = validateRefundProofAttachmentFile(file);
        const storageKey = createAttachmentStorageKey();
        await writeTravelGroupAttachmentFile(storageKey, validated);
        storedAttachments.push({
          id: crypto.randomUUID(),
          category: 'refund_proof',
          originalName: validated.originalName,
          contentType: validated.contentType,
          size: validated.size,
          storageKey,
          uploadedById: actor.id,
          uploadedAt,
        });
      }
    } catch (error) {
      await cleanupStoredTravelGroupAttachments(storedAttachments);
      throw normalizeAttachmentStorageError(error, 'write');
    }

    const beforeProofs = getAfterSalesRefundProofAttachments(current);
    const nextProofs = [...beforeProofs, ...storedAttachments];
    let updated: any;
    try {
      updated = await this.prisma.$transaction(async (tx: any) => {
        const updatedOrder = await tx.afterSalesOrder.update({
          where: {
            id,
          },
          data: buildAfterSalesOrderFinanceRefundConfirmData(
            actor,
            nextProofs,
            current,
          ),
          include: getAfterSalesOrderInclude(),
        });
        await this.operationLogsService.appendLog(
          {
            userId: actor.id,
            action: 'after_sales_orders.finance_refund_confirm',
            entityType: 'after_sales_order',
            entityId: updatedOrder.id,
            beforeData: toAfterSalesOrderDto(current),
            afterData: toAfterSalesOrderDto(updatedOrder),
            ipAddress: metadata.ipAddress || null,
          },
          tx,
        );
        const impact =
          await this.refreshAfterSalesAdjustmentRecords(
          tx,
          updatedOrder,
          current.salesOrder,
          actor,
          metadata,
        );
        const orderForReturn =
          (await tx.afterSalesOrder.findUnique({
            where: {
              id: updatedOrder.id,
            },
            include: getAfterSalesOrderInclude(),
          })) || updatedOrder;
        return attachAfterSalesCommissionAndPointsImpact(
          orderForReturn,
          impact,
        );
      });
    } catch (error) {
      await cleanupStoredTravelGroupAttachments(storedAttachments);
      throw error;
    }

    await this.reconcileTodoSources([
      { sourceType: 'AFTER_SALES_ORDER', sourceId: updated.id },
    ]);
    return toAfterSalesOrderMutationResult(updated);
  }

  async downloadAfterSalesRefundProof(
    actor: any,
    id: string,
    attachmentId: string,
  ) {
    requireAnyRole(actor, ['admin', 'finance', 'after_sales']);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);
    const attachment = findAfterSalesRefundProofAttachment(
      current,
      attachmentId,
    );
    if (!attachment || !isSafeAttachmentStorageKey(attachment.storageKey)) {
      throw attachmentNotFoundError();
    }

    let buffer: Buffer;
    try {
      buffer = await readTravelGroupAttachmentFile(attachment.storageKey);
    } catch (error) {
      if ((error as any)?.statusCode === 404 || (error as any)?.code === 'ENOENT') {
        throw attachmentNotFoundError();
      }
      throw createHttpError(
        500,
        'ATTACHMENT_READ_FAILED',
        'Attachment could not be read.',
      );
    }

    return {
      attachment: toAfterSalesRefundProofAttachmentDto(attachment),
      originalName: attachment.originalName,
      contentType: attachment.contentType,
      buffer,
    };
  }

  async updateAfterSalesAgencyDeduction(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'finance']);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);
    if (current.deductionCalculationMode !== 'manual_product_reference') {
      throw createHttpError(
        400,
        'AFTER_SALES_DEDUCTION_NOT_MANUAL',
        'Only manual_product_reference after-sales orders can be edited.',
      );
    }
    const agencyDeductionAdjustmentCents = normalizeNonNegativeInt(
      normalizeOptionalObjectPayload(payload)
        .agencyDeductionAdjustmentCents,
      'agencyDeductionAdjustmentCents',
    );
    if (
      agencyDeductionAdjustmentCents >
      Number(current.refundAmountCents || 0)
    ) {
      throw createHttpError(
        400,
        'AFTER_SALES_DEDUCTION_EXCEEDS_REFUND',
        'After-sales deduction cannot exceed the refund amount.',
      );
    }

    const siblings = await this.prisma.afterSalesOrder.findMany({
      where: {
        salesOrderId: current.salesOrderId,
        id: {
          not: current.id,
        },
        agencyDeductionAdjustmentCents: {
          not: null,
        },
      },
      select: {
        agencyDeductionAdjustmentCents: true,
      },
    });
    const usedDeductionCents = siblings.reduce(
      (sum: number, order: any) =>
        sum + Math.max(0, Number(order.agencyDeductionAdjustmentCents || 0)),
      0,
    );
    if (
      Number(current.sourceAgencyDeductionCents || 0) > 0 &&
      usedDeductionCents + agencyDeductionAdjustmentCents >
        Number(current.sourceAgencyDeductionCents)
    ) {
      throw createHttpError(
        400,
        'AFTER_SALES_DEDUCTION_EXCEEDS_SOURCE_COST',
        'Cumulative after-sales deduction exceeds the source order deduction.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.afterSalesOrder.update({
        where: {
          id,
        },
        data: {
          agencyDeductionAdjustmentCents,
          financialEffectStatus:
            current.financialEffectStatus === 'PENDING_RECOVERY'
              ? 'PENDING_RECOVERY'
              : current.financeConfirmed
                ? 'CONFIRMED'
                : 'PENDING_CONFIRMATION',
          updatedById: actor.id,
          updatedAt: new Date(),
        },
        include: getAfterSalesOrderInclude(),
      });
      await this.refreshAfterSalesAdjustmentRecords(
        tx,
        updatedOrder,
        current.salesOrder,
        actor,
        metadata,
      );
      await this.operationLogsService.appendLog(
        {
          userId: actor.id,
          action: 'after_sales_orders.agency_deduction.update',
          entityType: 'after_sales_order',
          entityId: updatedOrder.id,
          beforeData: {
            agencyDeductionAdjustmentCents:
              current.agencyDeductionAdjustmentCents,
          },
          afterData: {
            agencyDeductionAdjustmentCents,
          },
          ipAddress: metadata.ipAddress || null,
        },
        tx,
      );
      return (
        (await tx.afterSalesOrder.findUnique({
          where: {
            id,
          },
          include: getAfterSalesOrderInclude(),
        })) || updatedOrder
      );
    });
    return {
      afterSalesOrder: toAfterSalesOrderDto(updated),
    };
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current.salesOrder);
    if (Number(current.refundAmountCents || 0) <= 0) {
      throw createHttpError(
        400,
        'AFTER_SALES_REFUND_NOT_REQUIRED',
        'After-sales order has no refund amount to confirm.',
      );
    }
    if (financeConfirmed) {
      assertAfterSalesAgencyDeductionReadyForConfirmation(current);
      if (current.status !== 'WAITING_REFUND') {
        throw createHttpError(
          400,
          'AFTER_SALES_REFUND_STATUS_INVALID',
          'Finance refund confirmation requires waiting_refund status.',
        );
      }
      throw createHttpError(
        400,
        'REFUND_PROOF_FILE_REQUIRED',
        'Refund proof must be uploaded with finance refund confirmation.',
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
          current,
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
      const impact =
        await this.refreshAfterSalesAdjustmentRecords(
        tx,
        updatedOrder,
        current.salesOrder,
        actor,
        metadata,
      );
      const orderForReturn =
        (await tx.afterSalesOrder.findUnique({
          where: {
            id: updatedOrder.id,
          },
          include: getAfterSalesOrderInclude(),
        })) || updatedOrder;
      return attachAfterSalesCommissionAndPointsImpact(orderForReturn, impact);
    });

    await this.reconcileTodoSources([
      { sourceType: 'AFTER_SALES_ORDER', sourceId: updated.id },
    ]);
    return toAfterSalesOrderMutationResult(updated);
  }

  async getFinanceOverview(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    // Finance overview uses orderDate for order-side metrics and after-sales createdAt for refund metrics.
    const orderWhere = await this.buildScopedSalesOrderWhere(
      actor,
      andWhere(buildSalesOrderWhere(filters), {
        orderType: {
          not: 'AFTER_SALES',
        },
      }),
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
          include: {
            ...getSalesOrderInclude(),
            afterSalesOrders: {
              select: {
                id: true,
              },
            },
          },
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
      recentOrders: orders
        .slice(0, 10)
        .map((order: any) => toSalesOrderDtoForActor(order, actor)),
    };
  }

  async getFinanceProfitOverview(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(
        actor,
        andWhere(buildSalesOrderWhere(filters), {
          orderType: {
            not: 'AFTER_SALES',
          },
        }),
      ),
      include: getSalesOrderProfitInclude(),
      orderBy: { orderDate: 'desc' },
    });
    return calculateProductProfitSummary(orders);
  }

  async getFinanceOrderProfit(actor: any, id: string) {
    requireAnyRole(actor, ['admin', 'finance']);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.buildScopedSalesOrderWhere(actor, {
        id: normalizeRequiredString(id, 'id'),
        orderType: {
          not: 'AFTER_SALES',
        },
      }),
      include: getSalesOrderProfitInclude(),
      take: 1,
    });
    if (!orders[0]) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Sales order does not exist.',
      );
    }
    return calculateOrderProductProfit(orders[0]);
  }

  async getFinanceWorkbench(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const limit = normalizeTake(filters.limit, 20);
    const onlyShowMarkedRecords = await this.onlyShowMarkedRecords();
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
      recentOrders: orders
        .slice(0, limit)
        .map((order: any) => toSalesOrderDtoForActor(order, actor)),
      pendingAfterSales,
      pendingMarks: onlyShowMarkedRecords
        ? []
        : buildFinancePendingMarks(effectiveOrders, limit),
      pendingLogistics: effectiveOrders
        .map(toFinancePendingLogisticsDto)
        .filter((item: any) => item.reasons.length > 0)
        .slice(0, limit),
    };
  }

  async listWarehouseOrders(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'warehouse']);
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
    return orders.map((order: any) => toSalesOrderDtoForActor(order, actor));
  }

  async updateWarehouseOrderPacking(
    actor: any,
    id: string,
    payload: any,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin', 'warehouse']);
    assertSalesOrderPackingPatchAllowedFields(payload, actor);
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, current);
    return this.updateSalesOrderPacking(actor, id, payload, metadata);
  }

  async listReconciliations(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
    const dateFrom = requireReconciliationBusinessDate(
      filters.dateFrom || filters.start,
      'dateFrom',
    );
    const dateTo = requireReconciliationBusinessDate(
      filters.dateTo || filters.end,
      'dateTo',
    );
    const businessDates = listReconciliationBusinessDates(dateFrom, dateTo);
    if (!businessDates || businessDates.length === 0) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'dateFrom cannot be later than dateTo.',
      );
    }
    if (businessDates.length > 366) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'Reconciliation date range cannot exceed 366 days.',
      );
    }

    const facts = await this.loadReconciliationFacts(dateFrom, dateTo);
    return businessDates.map((businessDate) =>
      buildAggregatedReconciliationDto(
        businessDate,
        facts.ordersByDate.get(businessDate) || [],
        facts.refundsByDate.get(businessDate) || [],
        facts.manualByDate.get(businessDate) || null,
      ),
    );
  }

  async getReconciliation(actor: any, businessDateValue: string) {
    requireAnyRole(actor, ['admin', 'finance']);
    const businessDate = requireReconciliationBusinessDate(
      businessDateValue,
      'businessDate',
    );
    const facts = await this.loadReconciliationFacts(
      businessDate,
      businessDate,
    );
    return buildAggregatedReconciliationDto(
      businessDate,
      facts.ordersByDate.get(businessDate) || [],
      facts.refundsByDate.get(businessDate) || [],
      facts.manualByDate.get(businessDate) || null,
    );
  }

  async upsertReconciliation(actor: any, payload: any, metadata: any = {}) {
    requireAnyRole(actor, ['finance']);
    assertReconciliationManualPatchAllowedFields(payload);
    const businessDateText = requireReconciliationBusinessDate(
      payload?.businessDate,
      'businessDate',
    );
    const businessDate = parseDate(businessDateText, 'businessDate', true);
    const data = buildReconciliationManualData(payload, actor);
    const current = await this.prisma.dailyReconciliation.findUnique({
      where: {
        businessDate,
      },
      include: {
        paymentMethods: true,
        reviewedBy: true,
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
        reviewedBy: true,
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: current ? 'reconciliations.update' : 'reconciliations.create',
      entityType: 'daily_reconciliation',
      entityId: saved.id,
      beforeData: current ? toReconciliationManualAuditDto(current) : null,
      afterData: toReconciliationManualAuditDto(saved),
      ipAddress: metadata.ipAddress || null,
    });
    return this.getReconciliation(actor, businessDateText);
  }

  async reviewReconciliation(
    actor: any,
    businessDateValue: string,
    metadata: any = {},
  ) {
    requireAnyRole(actor, ['admin']);
    const businessDateText = requireReconciliationBusinessDate(
      businessDateValue,
      'businessDate',
    );
    const businessDate = parseDate(
      businessDateText,
      'businessDate',
      true,
    );
    const facts = await this.loadReconciliationFacts(
      businessDateText,
      businessDateText,
    );
    const manual = facts.manualByDate.get(businessDateText) || null;
    if (!manual) {
      throw createHttpError(
        409,
        'RECONCILIATION_NOT_SUBMITTED',
        'Finance must submit the daily reconciliation before it can be reviewed.',
      );
    }
    const calculation = calculateReconciliation({
      businessDate: businessDateText,
      orders: facts.ordersByDate.get(businessDateText) || [],
      refunds: facts.refundsByDate.get(businessDateText) || [],
      manual,
    });
    const now = new Date();
    const saved = await this.prisma.dailyReconciliation.update({
      where: { businessDate },
      data: {
        reviewStatus: 'REVIEWED',
        reviewedById: actor.id,
        reviewedAt: now,
        reviewSourceHash: calculation.sourceHash,
        updatedById: actor.id,
        updatedAt: now,
      },
      include: {
        paymentMethods: true,
        reviewedBy: true,
      },
    });

    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'reconciliations.review',
      entityType: 'daily_reconciliation',
      entityId: saved.id,
      beforeData: toReconciliationManualAuditDto(manual),
      afterData: toReconciliationManualAuditDto(saved),
      ipAddress: metadata.ipAddress || null,
    });
    return this.getReconciliation(actor, businessDateText);
  }

  private async loadReconciliationFacts(dateFrom: string, dateTo: string) {
    const refundStart = buildShanghaiNaturalDayRange(dateFrom);
    const refundEnd = buildShanghaiNaturalDayRange(dateTo);
    const orderDateFrom = parseDate(dateFrom, 'dateFrom', true);
    const orderDateTo = parseDate(dateTo, 'dateTo', true);
    const [orders, refunds, manualRows] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: {
          orderDate: { gte: orderDateFrom, lte: orderDateTo },
          orderType: { not: 'AFTER_SALES' },
          status: { in: [...RECONCILIATION_INCLUDED_ORDER_STATUSES] },
        },
      }),
      this.prisma.afterSalesOrder.findMany({
        where: {
          financeConfirmed: true,
          createdAt: {
            gte: refundStart!.start,
            lte: refundEnd!.end,
          },
        },
      }),
      this.prisma.dailyReconciliation.findMany({
        where: {
          businessDate: { gte: orderDateFrom, lte: orderDateTo },
        },
        include: {
          paymentMethods: true,
          reviewedBy: true,
        },
      }),
    ]);
    const ordersByDate = groupFactsByBusinessDate(orders, (order) =>
      formatDatabaseDate(order?.orderDate),
    );
    const refundsByDate = groupFactsByBusinessDate(refunds, (refund) =>
      formatShanghaiBusinessDate(refund?.createdAt),
    );
    const manualByDate = new Map<string, any>();
    for (const row of manualRows) {
      const businessDate = formatDatabaseDate(row?.businessDate);
      if (businessDate) {
        manualByDate.set(businessDate, row);
      }
    }
    return { ordersByDate, refundsByDate, manualByDate };
  }

  async listStrikeBonusAwards(actor: any, filters: any = {}) {
    requireAnyRole(actor, ['admin', 'finance']);
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
    requireAnyRole(actor, ['admin', 'finance']);
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

  private async resolveAfterSalesCalculationSnapshot(
    tx: any,
    salesOrder: any,
    refundAmountCents: number,
    calculationDate: Date,
  ) {
    const records = await tx.commissionRecord.findMany({
      where: {
        salesOrderId: salesOrder.id,
        afterSalesOrderId: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const agencyRecords = records.filter((record: any) =>
      ['AGENCY_DAILY_REBATE', 'AGENCY_MONTHLY_REBATE'].includes(
        String(record.targetType || '').toUpperCase(),
      ),
    );
    const dailyRecord = agencyRecords.find(
      (record: any) =>
        String(record.targetType || '').toUpperCase() ===
        'AGENCY_DAILY_REBATE',
    );
    const monthlyRecord = agencyRecords.find(
      (record: any) =>
        String(record.targetType || '').toUpperCase() ===
        'AGENCY_MONTHLY_REBATE',
    );
    const sourceAgencyDeductionCents = agencyRecords.reduce(
      (maximum: number, record: any) =>
        Math.max(maximum, Math.abs(Number(record.deductionAmountCents || 0))),
      0,
    );
    const deductionCalculationMode =
      resolveAgencyDeductionModeFromRecords(agencyRecords);
    const existingDeductionCents = (salesOrder.afterSalesOrders || []).reduce(
      (sum: number, order: any) =>
        sum +
        (order.agencyDeductionAdjustmentCents === null ||
        order.agencyDeductionAdjustmentCents === undefined
          ? 0
          : Math.max(0, Number(order.agencyDeductionAdjustmentCents))),
      0,
    );
    const agencyDeductionAdjustmentCents =
      refundAmountCents <= 0
        ? 0
        : deductionCalculationMode === 'effective_sales_rate'
          ? calculateProportionalAfterSalesDeductionCents({
              sourceAgencyDeductionCents,
              refundAmountCents,
              sourceOrderAmountCents: Number(
                salesOrder.totalAmountCents || 0,
              ),
              existingDeductionCents,
            })
          : null;
    const financeSummary = salesOrder.travelGroupId
      ? await tx.travelGroupFinanceSummary.findUnique({
          where: {
            travelGroupId: salesOrder.travelGroupId,
          },
        })
      : null;
    const hasReturnedPoints = Boolean(
      financeSummary?.dailyRebatePaid ||
        financeSummary?.monthlyRebatePaid,
    );
    const financialEffectStatus =
      refundAmountCents <= 0 && agencyDeductionAdjustmentCents === 0
        ? 'NO_FINANCIAL_EFFECT'
        : hasReturnedPoints
          ? 'PENDING_RECOVERY'
          : 'PENDING_CONFIRMATION';
    return {
      deductionCalculationMode,
      sourceAgencyDeductionCents,
      agencyDeductionRate:
        Number(salesOrder.totalAmountCents || 0) > 0
          ? (
              sourceAgencyDeductionCents /
              Number(salesOrder.totalAmountCents)
            ).toFixed(4)
          : null,
      dailyRebateRate: normalizeRateSnapshot(dailyRecord?.rateSnapshot),
      monthlyRebateRate: normalizeRateSnapshot(monthlyRecord?.rateSnapshot),
      agencyDeductionRuleId:
        findAgencyDeductionRuleId(agencyRecords) || null,
      agencyRebateRuleId:
        dailyRecord?.agencyRebateRuleId ||
        monthlyRecord?.agencyRebateRuleId ||
        null,
      calculationDate,
      agencyDeductionAdjustmentCents,
      financialEffectStatus,
      sourceRecords: records,
    };
  }

  private async refreshAfterSalesAdjustmentRecords(
    tx: any,
    afterSalesOrder: any,
    currentSalesOrder: any,
    actor: any,
    metadata: any = {},
  ) {
    const sourceSalesOrder =
      currentSalesOrder?.id === afterSalesOrder?.salesOrderId
        ? currentSalesOrder
        : await tx.salesOrder.findUnique({
            where: {
              id: afterSalesOrder.salesOrderId,
            },
          });
    if (!sourceSalesOrder) {
      throw createHttpError(
        404,
        'SALES_ORDER_NOT_FOUND',
        'Source sales order does not exist.',
      );
    }
    const sourceRecords = await tx.commissionRecord.findMany({
      where: {
        salesOrderId: sourceSalesOrder.id,
        afterSalesOrderId: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const adjustmentRecords = buildAfterSalesCommissionAdjustmentRecords({
      afterSalesOrder,
      sourceSalesOrder,
      sourceRecords,
      actor,
    });
    const existingRecords = await tx.commissionRecord.findMany({
      where: {
        afterSalesOrderId: afterSalesOrder.id,
      },
    });
    const touchedRecordIds: string[] = [];
    for (const data of adjustmentRecords) {
      const current = existingRecords.find((record: any) =>
        isSameAfterSalesCommissionBusinessKey(record, data),
      );
      const record = current
        ? await tx.commissionRecord.update({
            where: {
              id: current.id,
            },
            data: {
              ...data,
              updatedById: actor?.id || null,
              updatedAt: new Date(),
            },
          })
        : await tx.commissionRecord.create({
            data: {
              id: crypto.randomUUID(),
              ...data,
              createdById: actor?.id || null,
              updatedById: actor?.id || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
      touchedRecordIds.push(record.id);
    }

    for (const staleRecord of existingRecords) {
      if (touchedRecordIds.includes(staleRecord.id)) {
        continue;
      }
      await tx.commissionRecord.update({
        where: {
          id: staleRecord.id,
        },
        data: {
          grossAmountCents: 0,
          confirmedRefundAmountCents: 0,
          baseAmountCents: 0,
          deductionAmountCents: 0,
          amountCents: 0,
          pointsCents: 0,
          isConfirmed: false,
          confirmedById: null,
          confirmedAt: null,
          calculationNote: '售后调整来源已失效，保留记录用于审计。',
          updatedById: actor?.id || null,
          updatedAt: new Date(),
        },
      });
    }

    return {
      recalculation: {
        calculation: {
          amounts: {
            unconfirmedRefundAmountCents: afterSalesOrder.financeConfirmed
              ? 0
              : Math.max(0, Number(afterSalesOrder.refundAmountCents || 0)),
          },
        },
      },
      summaryResults: [],
      adjustmentRecordIds: touchedRecordIds,
      warnings: [],
      metadata: {
        ipAddress: metadata.ipAddress || null,
      },
    };
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
    const guideSummaryResults: any[] = [];
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
      guideSummaryResults.push(
        await this.guidePointsSummaryService.refreshGuidePointsSummariesForTravelGroup(
          travelGroupId,
          {
            prisma: tx,
            actor,
            ipAddress: metadata.ipAddress || null,
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
          pendingAfterSalesRefundAmountCents:
            recalculation.calculation.amounts
              .unconfirmedRefundAmountCents || 0,
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
          guideSummaryRefreshes: guideSummaryResults.map((result: any) => ({
            travelGroupId: result.travelGroupId,
            summaryCount: result.summaries?.length || 0,
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
      guideSummaryResults,
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
      'taster',
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
    await this.assertPassesGlobalSalesOrderMarkScope(actor, order);
    return order;
  }

  private async buildScopedGroupWhere(
    kind: string,
    actor: any,
    baseWhere: any,
  ) {
    return andWhere(
      andWhere(baseWhere, await this.buildGroupDataScope(kind, actor)),
      await this.buildGlobalGroupMarkScope(actor),
    );
  }

  private async buildRoleScopedTravelGroupWhere(actor: any, baseWhere: any) {
    return andWhere(
      andWhere(
        baseWhere,
        await this.buildPendingTravelGroupDataScope(actor),
      ),
      await this.buildGlobalGroupMarkScope(actor),
    );
  }

  private async buildScopedSalesOrderWhere(actor: any, baseWhere: any) {
    return andWhere(
      andWhere(baseWhere, buildSalesOrderDataScope(actor)),
      await this.buildGlobalSalesOrderMarkScope(actor),
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
      return kind === 'travel'
        ? {
            OR: [
              { tasterId: actor.id },
              { liaisonTasterId: actor.id },
            ],
          }
        : { tasterId: actor.id };
    }

    if (actor?.role === 'front_desk' && kind === 'travel') {
      return null;
    }

    if (actor?.role === 'sales') {
      if (kind === 'travel') {
        return buildSalesTravelGroupScope();
      }
      return { createdById: actor.id };
    }

    return null;
  }

  private async buildPendingTravelGroupDataScope(actor: any) {
    if (actor?.role === 'taster') {
      return {
        OR: [
          { tasterId: actor.id },
          { liaisonTasterId: actor.id },
        ],
      };
    }
    if (actor?.role === 'front_desk') {
      return null;
    }

    if (actor?.role === 'sales') {
      return buildSalesTravelGroupScope();
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
      if (
        kind === 'travel' &&
        (group.tasterId === actor.id ||
          group.liaisonTasterId === actor.id)
      ) {
        return;
      }
      if (kind !== 'travel' && group.tasterId === actor.id) {
        return;
      }
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }

    if (actor?.role === 'front_desk' && kind === 'travel') {
      return;
    }

    if (actor?.role === 'sales') {
      if (kind === 'travel') {
        if (canSalesHandleTravelGroup(group)) {
          return;
        }
        throw createHttpError(
          404,
          'TRAVEL_GROUP_NOT_FOUND',
          'Travel group does not exist.',
        );
      }
      if (group.createdById === actor.id) {
        return;
      }
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }
  }

  private async buildGlobalGroupMarkScope(_actor: any) {
    return buildSharedGlobalTravelGroupMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async buildGlobalSalesOrderMarkScope(_actor: any) {
    return buildSharedGlobalSalesOrderMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async buildGlobalCustomerMarkScope() {
    return buildSharedGlobalCustomerMarkScope(
      await this.onlyShowMarkedRecords(),
    );
  }

  private async assertPassesGlobalGroupMarkScope(_actor: any, group: any) {
    if ((await this.onlyShowMarkedRecords()) && !group.financeMark) {
      throw createHttpError(
        404,
        'TRAVEL_GROUP_NOT_FOUND',
        'Travel group does not exist.',
      );
    }
  }

  private async assertPassesGlobalSalesOrderMarkScope(
    _actor: any,
    order: any,
  ) {
    if (!(await this.onlyShowMarkedRecords())) {
      return;
    }
    if (order.financeMark) {
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

  private async reconcileTodoSources(
    sources: Array<{
      sourceType:
        | 'TRAVEL_GROUP'
        | 'SALES_ORDER'
        | 'AFTER_SALES_ORDER';
      sourceId: string | null | undefined;
    }>,
  ) {
    if (!this.todoReminders) {
      return;
    }
    for (const source of sources) {
      if (source.sourceId) {
        await this.todoReminders.safeReconcileSource(
          source.sourceType,
          source.sourceId,
        );
      }
    }
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
      liaisonTaster: true,
      lossConfirmedBy: true,
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
    taster: true,
    lossConfirmedBy: true,
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
      ...(kind === 'travel'
        ? [
            { sourceRegion: { contains: query } },
            { previousStopOrderStatus: { contains: query } },
            { keyCustomerInfo: { contains: query } },
          ]
        : []),
    ];
  }
  const groupNo = normalizeOptionalString(filters.groupNo);
  if (groupNo) {
    where.groupNo = {
      contains: groupNo,
    };
  }
  const travelAgency = normalizeOptionalString(filters.travelAgency);
  if (travelAgency) {
    where.travelAgency = {
      contains: travelAgency,
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
  const liaisonTasterId = normalizeOptionalString(filters.liaisonTasterId);
  if (liaisonTasterId && kind === 'travel') {
    where.liaisonTasterId = liaisonTasterId;
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
        {
          sourceSalesOrder: {
            is: {
              orderNo: {
                contains: query,
              },
            },
          },
        },
        {
          sourceSalesOrder: {
            is: {
              salesFormNo: {
                contains: query,
              },
            },
          },
        },
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
  const shippingDateRange = buildDateRange(
    filters.shippingDateFrom,
    filters.shippingDateTo,
  );
  if (shippingDateRange) {
    where.shippingDate = shippingDateRange;
  }
  return where;
}

function buildSalesOrderOrderBy(
  filters: any = {},
):
  | Prisma.SalesOrderOrderByWithRelationInput
  | Prisma.SalesOrderOrderByWithRelationInput[] {
  const sort = normalizeOptionalString(
    filters.shippingDateSort || filters.sort,
  )?.toLowerCase();
  if (sort === 'shipping_date_asc' || sort === 'asc') {
    return [
      { shippingDate: 'asc' },
      { createdAt: 'desc' },
    ];
  }
  if (sort === 'shipping_date_desc' || sort === 'desc') {
    return [
      { shippingDate: 'desc' },
      { createdAt: 'desc' },
    ];
  }
  if (sort) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'shippingDateSort must be shipping_date_asc or shipping_date_desc.',
    );
  }
  return { createdAt: 'desc' };
}

function buildReadableSalesOrderWhere(actor: any, filters: any = {}) {
  return buildSalesOrderWhere(
    actor?.role === 'taster'
      ? omitTasterSensitiveSalesOrderFilters(filters)
      : filters,
  );
}

function omitTasterSensitiveSalesOrderFilters(filters: any = {}) {
  const {
    financeMark: _financeMark,
    customerFinanceMark: _customerFinanceMark,
    ...rest
  } = filters || {};
  return rest;
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
        {
          afterSalesSalesOrder: {
            is: {
              orderNo: {
                contains: query,
              },
            },
          },
        },
        { customer: { is: { name: { contains: query } } } },
        { customer: { is: { phone: { contains: query } } } },
      ],
    });
  }
  const status = normalizeOptionalString(filters.status);
  if (status) {
    where.status = toPrismaAfterSalesStatus(status);
  }
  if (filters.unfinished !== undefined && filters.unfinished !== '') {
    const unfinished = normalizeBoolean(filters.unfinished, 'unfinished');
    if (unfinished) {
      where = andWhere(where, {
        status: {
          not: 'COMPLETED',
        },
      });
    }
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
    const range = getShanghaiTodayCreatedAtRange();
    return {
      salesUserId: actor.id,
      createdAt: {
        gte: range.start,
        lt: range.end,
      },
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
  if (actor?.role === 'taster') {
    return {
      travelGroup: {
        is: {
          tasterId: actor.id,
          visitDate: {
            gte: getShanghaiTodayDate(),
          },
        },
      },
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
  assertSalesOrderInventoryLineFieldsNotSubmitted(payload);
}

function assertSalesOrderInventoryFieldsAreServerOwned(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return;
  }
  const serverOwnedOrderFields = [
    'fulfillmentWarehouseId',
    'inventoryAppliedAt',
    'inventoryPolicyVersion',
    'inventoryVersion',
  ];
  const submittedOrderField = serverOwnedOrderFields.find((field) =>
    hasOwn(payload, field),
  );
  const submittedLineField =
    salesOrderInventoryLineFieldWasSubmitted(payload);
  if (submittedOrderField || submittedLineField) {
    throw createHttpError(
      403,
      'INVENTORY_FIELD_SERVER_OWNED',
      'Inventory warehouse, line keys, and inventory state are assigned by the server.',
    );
  }
}

function assertSalesOrderInventoryLineFieldsNotSubmitted(payload: any) {
  if (salesOrderInventoryLineFieldWasSubmitted(payload)) {
    throw createHttpError(
      403,
      'INVENTORY_FIELD_SERVER_OWNED',
      'Inventory line keys and inventory state are assigned by the server.',
    );
  }
}

function salesOrderInventoryLineFieldWasSubmitted(payload: any) {
  return Array.isArray(payload?.items)
    ? payload.items.some(
        (item: any) =>
          item &&
          typeof item === 'object' &&
          (hasOwn(item, 'inventoryLineKey') ||
            hasOwn(item, 'inventoryReservation') ||
            hasOwn(item, 'stock')),
      )
    : false;
}

function assertSalesOrderSalesEditAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const deniedFields = Object.keys(payload).filter(
    (field) => !SALES_ORDER_SALES_EDIT_FIELDS.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for sales edit: ${deniedFields.join(', ')}.`,
    );
  }
  if (hasOwn(payload, 'customer')) {
    assertSalesOrderCustomerPatchAllowedFields(payload.customer);
  }
  assertSalesOrderInventoryLineFieldsNotSubmitted(payload);
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

function assertSalesOrderPackingPatchAllowedFields(
  payload: any,
  actor?: any,
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(SALES_ORDER_PACKING_PATCH_FIELDS);
  allowedFields.add('serializedAssignments');
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
  if (
    hasOwn(payload, 'fulfillmentWarehouseId') &&
    !['super_admin', 'admin', 'warehouse'].includes(actor?.role)
  ) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      'Only warehouse or administrator roles may change the fulfillment warehouse.',
    );
  }
  if (
    hasOwn(payload, 'serializedAssignments') &&
    !['super_admin', 'admin', 'warehouse'].includes(actor?.role)
  ) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      'Only warehouse or administrator roles may select serialized units for fulfillment.',
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

function assertShippingDatePatchAllowedFields(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const allowedFields = new Set(['shippingDate', 'reason']);
  const deniedFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for shipping date update: ${deniedFields.join(', ')}.`,
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

function assertAfterSalesOrderWarehouseConfirmPatchAllowedFields(payload: any) {
  const body = normalizeOptionalObjectPayload(payload);
  const allowedFields = new Set(
    AFTER_SALES_ORDER_WAREHOUSE_CONFIRM_PATCH_FIELDS,
  );
  const deniedFields = Object.keys(body).filter(
    (field) => !allowedFields.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Fields are not allowed for after-sales warehouse confirm: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertReconciliationManualPatchAllowedFields(payload: any) {
  const body = normalizeOptionalObjectPayload(payload);
  const deniedFields = Object.keys(body).filter(
    (field) => !RECONCILIATION_MANUAL_PATCH_FIELDS.has(field),
  );
  if (deniedFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Reconciliation fields are read-only: ${deniedFields.join(', ')}.`,
    );
  }
}

function assertCanUpdateSalesOrder(actor: any, order: any) {
  if (actor?.role === 'super_admin' || actor?.role === 'admin' || actor?.role === 'finance') {
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
    if (
      order.salesUserId === actor.id &&
      isWithinShanghaiToday(order.createdAt)
    ) {
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
  if (actor?.role === 'taster') {
    if (
      order.travelGroup?.tasterId === actor.id &&
      formatDate(order.travelGroup?.visitDate) >=
        getShanghaiTodayBusinessDate()
    ) {
      return;
    }
    throw createHttpError(
      404,
      'SALES_ORDER_NOT_FOUND',
      'Sales order does not exist.',
    );
  }
}

function assertCanUpdateSalesOrderShippingDate(actor: any, order: any) {
  if (
    actor?.role === 'finance' ||
    actor?.role === 'after_sales'
  ) {
    return;
  }
  if (actor?.role === 'sales' && order.salesUserId === actor.id) {
    return;
  }
  if (actor?.role === 'warehouse' && isWarehouseReadableSalesOrder(order)) {
    return;
  }
  throw createHttpError(
    403,
    'PERMISSION_DENIED',
    'You do not have permission to update the shipping date.',
  );
}

function salesOrderAlreadyOutboundError() {
  return createHttpError(
    409,
    'SALES_ORDER_ALREADY_OUTBOUND',
    '订单已出库，发货日期不可修改。',
  );
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

function buildTravelGroupCreateGuestCounts(payload: any) {
  if (hasOwn(payload, 'adultCount') || hasOwn(payload, 'childCount')) {
    const adultCount = normalizeTravelGroupGuestCount(
      payload?.adultCount,
      'adultCount',
      0,
    );
    const childCount = normalizeTravelGroupGuestCount(
      payload?.childCount,
      'childCount',
      0,
    );
    return buildTravelGroupGuestCounts(adultCount, childCount);
  }

  const guestCount = normalizeTravelGroupGuestCount(
    payload?.guestCount,
    'guestCount',
    0,
  );
  return {
    adultCount: guestCount,
    childCount: 0,
    guestCount,
  };
}

function buildTravelGroupUpdateGuestCounts(payload: any, current: any) {
  const hasAdultCount = hasOwn(payload, 'adultCount');
  const hasChildCount = hasOwn(payload, 'childCount');
  if (hasAdultCount || hasChildCount) {
    const currentCounts = readTravelGroupGuestCounts(current);
    const adultCount = hasAdultCount
      ? normalizeTravelGroupGuestCount(
          payload.adultCount,
          'adultCount',
          0,
        )
      : currentCounts.adultCount;
    const childCount = hasChildCount
      ? normalizeTravelGroupGuestCount(
          payload.childCount,
          'childCount',
          0,
        )
      : currentCounts.childCount;
    return buildTravelGroupGuestCounts(adultCount, childCount);
  }

  if (!hasOwn(payload, 'guestCount')) {
    return {};
  }
  const guestCount = normalizeTravelGroupGuestCount(
    payload.guestCount,
    'guestCount',
    0,
  );
  return {
    adultCount: guestCount,
    childCount: 0,
    guestCount,
  };
}

function buildTravelGroupGuestCounts(
  adultCount: number,
  childCount: number,
) {
  if (adultCount > PRISMA_INT_MAX - childCount) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'adultCount and childCount total exceeds the supported integer range.',
    );
  }
  return {
    adultCount,
    childCount,
    guestCount: adultCount + childCount,
  };
}

function readTravelGroupGuestCounts(group: any) {
  const legacyGuestCount = normalizeStoredTravelGroupGuestCount(
    group?.guestCount,
    0,
  );
  const adultCount = normalizeStoredTravelGroupGuestCount(
    group?.adultCount,
    legacyGuestCount,
  );
  const childCount = normalizeStoredTravelGroupGuestCount(
    group?.childCount,
    0,
  );
  return {
    adultCount,
    childCount,
    guestCount: adultCount + childCount,
  };
}

function normalizeStoredTravelGroupGuestCount(
  value: unknown,
  fallback: number,
) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) &&
    numberValue >= 0 &&
    numberValue <= PRISMA_INT_MAX
    ? numberValue
    : fallback;
}

function normalizeTravelGroupGuestCount(
  value: unknown,
  fieldName: string,
  fallback: number,
) {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return fallback;
  }

  let numberValue: number;
  if (typeof value === 'number') {
    numberValue = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    numberValue = Number(value.trim());
  } else {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a non-negative integer.`,
    );
  }

  if (
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0 ||
    numberValue > PRISMA_INT_MAX
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a non-negative integer.`,
    );
  }
  return numberValue;
}

function buildTravelGroupCreateData(payload: any, actor: any) {
  const now = new Date();
  const guestCounts = buildTravelGroupCreateGuestCounts(payload);
  const data: any = {
    id: crypto.randomUUID(),
    visitDate: parseDate(payload?.visitDate, 'visitDate', true),
    travelAgency: normalizeRequiredString(
      payload?.travelAgency,
      'travelAgency',
    ),
    guideId: normalizeRequiredString(payload?.guideId, 'guideId'),
    ...guestCounts,
    createdById: actor.id,
    updatedById: actor.id,
    financeMark: false,
    parkingFeeCents: 500,
    cigaretteFeeCents:
      payload?.cigaretteFeeCents === undefined ||
      payload?.cigaretteFeeCents === null ||
      payload?.cigaretteFeeCents === ''
        ? null
        : normalizeCentsAmount(
            payload.cigaretteFeeCents,
            'cigaretteFeeCents',
            1,
          ),
    createdAt: now,
    updatedAt: now,
    status: 'UNMARKED',
  };

  assignNullableString(data, 'licensePlate', payload?.licensePlate);
  assignNullableString(data, 'tastingRoomNo', payload?.tastingRoomNo);
  assignNullableString(data, 'tasterId', payload?.tasterId);
  assignNullableString(data, 'liaisonTasterId', payload?.liaisonTasterId);
  assignOptionalTravelGroupType(data, payload?.groupType);
  assignNullableString(data, 'sourceRegion', payload?.sourceRegion);
  assignNullableString(data, 'ageInfo', payload?.ageInfo);
  assignNullableBoolean(data, 'mentionedFeitian', payload?.mentionedFeitian);
  assignNullableString(
    data,
    'previousStopOrderStatus',
    payload?.previousStopOrderStatus,
  );
  assignNullableString(data, 'keyCustomerInfo', payload?.keyCustomerInfo);
  assignOptionalClockTime(
    data,
    'expectedArrivalTime',
    payload?.expectedArrivalTime,
  );
  assignOptionalClockTime(data, 'arrivalTime', payload?.arrivalTime);
  assignNullableString(data, 'wineDetails', payload?.wineDetails);
  assignOptionalClockTime(data, 'departureTime', payload?.departureTime);
  assertDepartureNotBeforeArrival(data.arrivalTime, data.departureTime);
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

function buildTravelGroupUpdateData(payload: any, actor: any, current: any) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
    ...buildTravelGroupUpdateGuestCounts(payload, current),
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
  assignNullableString(data, 'tastingRoomNo', payload?.tastingRoomNo);
  if (payload?.tasterId !== undefined) {
    data.tasterId = normalizeOptionalString(payload.tasterId);
  }
  if (payload?.liaisonTasterId !== undefined) {
    data.liaisonTasterId = normalizeOptionalString(payload.liaisonTasterId);
  }
  assignNullableString(data, 'tasterName', payload?.tasterName);
  assignNullableString(data, 'sourceRegion', payload?.sourceRegion);
  assignNullableString(data, 'ageInfo', payload?.ageInfo);
  assignNullableBoolean(data, 'mentionedFeitian', payload?.mentionedFeitian);
  assignNullableString(
    data,
    'previousStopOrderStatus',
    payload?.previousStopOrderStatus,
  );
  assignNullableString(data, 'keyCustomerInfo', payload?.keyCustomerInfo);
  assignOptionalClockTime(
    data,
    'expectedArrivalTime',
    payload?.expectedArrivalTime,
  );
  assignOptionalClockTime(data, 'arrivalTime', payload?.arrivalTime);
  assignOptionalTravelGroupType(data, payload?.groupType);
  assignNullableString(data, 'wineDetails', payload?.wineDetails);
  assignOptionalClockTime(data, 'departureTime', payload?.departureTime);
  assignNullableString(data, 'remarks', payload?.remarks);
  if (payload?.cigaretteFeeCents !== undefined) {
    data.cigaretteFeeCents =
      payload.cigaretteFeeCents === null || payload.cigaretteFeeCents === ''
        ? null
        : normalizeCentsAmount(
            payload.cigaretteFeeCents,
            'cigaretteFeeCents',
            1,
          );
  }
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
  assertDepartureNotBeforeArrival(
    hasOwn(data, 'arrivalTime') ? data.arrivalTime : current?.arrivalTime,
    hasOwn(data, 'departureTime') ? data.departureTime : current?.departureTime,
  );
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
      productId: normalizeOptionalString(item?.productId),
      productName: normalizeOptionalString(item?.productName),
      unit: normalizeOptionalString(item?.unit),
      quantity,
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

async function resolveTravelGroupTastingItems(prisma: any, items: any[]) {
  const resolved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.productId) {
      if (item.productName !== '罐装酒') {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          `tastingItems[${index}].productName must be 罐装酒 when productId is empty.`,
        );
      }
      if (item.unit !== null && item.unit !== '瓶') {
        throw createHttpError(
          400,
          'VALIDATION_FAILED',
          `tastingItems[${index}].unit must be 瓶.`,
        );
      }
      resolved.push({
        ...item,
        productId: null,
        productName: '罐装酒',
        unit: '瓶',
      });
      continue;
    }
    const product = await findActiveProductOrThrow(
      prisma,
      item.productId,
      `tastingItems[${index}].productId`,
    );
    resolved.push({
      ...item,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
    });
  }
  return resolved;
}

function applyTravelGroupLossConfirmationData(
  data: any,
  actor: any,
  payload: any,
  current: any,
  tastingItems: any[] | null,
) {
  const requestedStatus =
    payload?.lossStatus === undefined
      ? null
      : normalizeTravelGroupLossStatus(payload.lossStatus);
  const currentItems = Array.isArray(current?.tastingItems)
    ? current.tastingItems
    : [];
  const effectiveItems = tastingItems === null ? currentItems : tastingItems;

  if (effectiveItems.length > 0) {
    if (requestedStatus === 'NO_LOSS' || requestedStatus === 'PENDING') {
      throw createHttpError(
        409,
        'TRAVEL_GROUP_LOSS_STATUS_CONFLICT',
        'Existing loss items must be cleared before changing the loss status.',
      );
    }
    data.lossStatus = 'RECORDED';
    data.lossConfirmedAt = new Date();
    data.lossConfirmedById = actor.id;
    return;
  }

  if (requestedStatus === 'RECORDED') {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'RECORDED loss status requires at least one tasting item.',
    );
  }
  if (requestedStatus === 'NO_LOSS') {
    if (tastingItems !== null && currentItems.length > 0) {
      throw createHttpError(
        409,
        'TRAVEL_GROUP_LOSS_STATUS_CONFLICT',
        'Clear the existing loss items before confirming no loss.',
      );
    }
    data.lossStatus = 'NO_LOSS';
    data.lossConfirmedAt = new Date();
    data.lossConfirmedById = actor.id;
    return;
  }

  data.lossStatus = 'PENDING';
  data.lossConfirmedAt = null;
  data.lossConfirmedById = null;
}

function normalizeTravelGroupLossStatus(value: unknown) {
  const status = String(value || '')
    .trim()
    .toUpperCase();
  if (!TRAVEL_GROUP_LOSS_STATUSES.has(status)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'lossStatus must be PENDING, RECORDED, or NO_LOSS.',
    );
  }
  return status;
}

async function assertTravelGroupFrontDeskInfoComplete(
  prisma: any,
  group: any,
) {
  const missingFields = getTravelGroupFrontDeskMissingFields(group);
  if (group?.tasterId) {
    const taster = await prisma.user.findUnique({
      where: { id: group.tasterId },
    });
    if (!isActiveTasterUser(taster) && !missingFields.includes('tasterId')) {
      missingFields.push('tasterId');
    }
  }
  if (missingFields.length === 0) {
    return;
  }
  throw createHttpError(
    409,
    'TRAVEL_GROUP_FRONT_DESK_INFO_INCOMPLETE',
    'Travel group front desk information is incomplete.',
    { missingFields },
  );
}

function getTravelGroupFrontDeskMissingFields(group: any) {
  const missingFields: string[] = [];
  if (!hasText(group?.licensePlate)) {
    missingFields.push('licensePlate');
  }
  const guestCount = Number(group?.guestCount);
  if (!Number.isSafeInteger(guestCount) || guestCount <= 0) {
    missingFields.push('guestCount');
  }
  const cigaretteFeeCents = Number(group?.cigaretteFeeCents);
  if (
    group?.cigaretteFeeCents === null ||
    group?.cigaretteFeeCents === undefined ||
    !Number.isSafeInteger(cigaretteFeeCents) ||
    cigaretteFeeCents <= 0
  ) {
    missingFields.push('cigaretteFeeCents');
  }
  if (!hasText(group?.tastingRoomNo)) {
    missingFields.push('tastingRoomNo');
  }
  if (!hasText(group?.tasterId)) {
    missingFields.push('tasterId');
  }
  if (!isValidClockTime(group?.arrivalTime)) {
    missingFields.push('arrivalTime');
  }
  if (
    !hasText(group?.groupType) ||
    !TRAVEL_GROUP_TYPES.has(String(group.groupType).trim())
  ) {
    missingFields.push('groupType');
  }
  return missingFields;
}

function buildSalesOrderData(
  payload: any,
  actor: any,
  items: any[],
  submittedAt = new Date(),
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'Request body must be an object.',
    );
  }
  const now = submittedAt;
  const shippingDate = resolveSubmissionShippingDate(payload, submittedAt);
  const totalAmountCents = items.reduce(
    (sum: number, item: any) => sum + item.subtotalCents,
    0,
  );

  const data: any = {
    id: crypto.randomUUID(),
    orderType: toPrismaOrderType(payload?.orderType || 'travel_group'),
    travelGroupId: normalizeOptionalString(payload?.travelGroupId),
    orderDate: parseDate(payload?.orderDate, 'orderDate', true),
    shippingDate: shippingDate.shippingDate,
    shippingDateSource: shippingDate.source,
    shippingDateBackfillBatchId: null,
    salesFormNo: normalizeOptionalString(payload?.salesFormNo),
    totalAmountCents,
    cashOnDeliveryAmountCents: normalizeInt(
      payload?.cashOnDeliveryAmountCents,
      'cashOnDeliveryAmountCents',
      0,
    ),
    logisticsMethod: null,
    logisticsProviderCode: null,
    packingStatus: items.some((item: any) => item.deliveryType === 'SHIPPING')
      ? 'PENDING'
      : 'PACKED',
    packageCount: 0,
    warehouseRemark: null,
    hasPackingMark: false,
    logisticsNo: null,
    ...clearTrackingCacheData(),
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
  if (hasOwn(payload, 'logisticsProviderCode')) {
    const rawProviderCode = normalizeOptionalString(
      payload.logisticsProviderCode,
    );
    const providerCode = rawProviderCode
      ? assertLogisticsProviderCode(rawProviderCode)
      : null;
    if (rawProviderCode && !providerCode) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        'logisticsProviderCode is not supported.',
      );
    }
    data.logisticsProviderCode = providerCode;
    if (providerCode && providerCode !== 'other') {
      data.logisticsMethod = logisticsProviderName(providerCode);
    }
  } else if (hasOwn(payload, 'logisticsMethod')) {
    data.logisticsProviderCode = normalizeLogisticsProviderCode(
      null,
      data.logisticsMethod,
    );
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
  if (hasOwn(payload, 'hasPackingMark')) {
    data.hasPackingMark = normalizeStrictBoolean(
      payload.hasPackingMark,
      'hasPackingMark',
    );
  }
  if (hasOwn(payload, 'fulfillmentWarehouseId')) {
    data.fulfillmentWarehouseId = normalizeRequiredString(
      payload.fulfillmentWarehouseId,
      'fulfillmentWarehouseId',
    );
  }

  return data;
}

function normalizeSerializedPackingAssignments(value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'serializedAssignments must be an array.',
    );
  }
  const lineKeys = new Set<string>();
  const unitIds = new Set<string>();
  return value.map((raw: any, index: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `serializedAssignments[${index}] must be an object.`,
      );
    }
    const unsupported = Object.keys(raw).find(
      (key) => !['inventoryLineKey', 'unitIds'].includes(key),
    );
    if (unsupported) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `Unsupported serialized assignment field: ${unsupported}.`,
      );
    }
    const inventoryLineKey = normalizeRequiredString(
      raw.inventoryLineKey,
      `serializedAssignments[${index}].inventoryLineKey`,
    );
    if (lineKeys.has(inventoryLineKey)) {
      throw createHttpError(
        400,
        'SERIALIZED_ASSIGNMENT_LINE_DUPLICATE',
        'A packing request cannot repeat an inventory line key.',
      );
    }
    lineKeys.add(inventoryLineKey);
    if (!Array.isArray(raw.unitIds)) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `serializedAssignments[${index}].unitIds must be an array.`,
      );
    }
    const normalizedUnitIds = raw.unitIds.map(
      (id: unknown, unitIndex: number) =>
        normalizeRequiredString(
          id,
          `serializedAssignments[${index}].unitIds[${unitIndex}]`,
        ),
    );
    for (const unitId of normalizedUnitIds) {
      if (unitIds.has(unitId)) {
        throw createHttpError(
          400,
          'SERIALIZED_ASSIGNMENT_UNIT_DUPLICATE',
          'A bottle cannot be selected more than once in a packing request.',
        );
      }
      unitIds.add(unitId);
    }
    return { inventoryLineKey, unitIds: normalizedUnitIds };
  });
}

function packingUpdateChangesProvider(current: any, data: any) {
  return (
    (hasOwn(data, 'logisticsProviderCode') &&
      normalizeOptionalString(current?.logisticsProviderCode) !==
        normalizeOptionalString(data.logisticsProviderCode)) ||
    (hasOwn(data, 'logisticsMethod') &&
      normalizeOptionalString(current?.logisticsMethod) !==
        normalizeOptionalString(data.logisticsMethod))
  );
}

function assertPackingProviderDetails(current: any, data: any) {
  const providerCode = normalizeLogisticsProviderCode(
    hasOwn(data, 'logisticsProviderCode')
      ? data.logisticsProviderCode
      : current?.logisticsProviderCode,
    hasOwn(data, 'logisticsMethod')
      ? data.logisticsMethod
      : current?.logisticsMethod,
  );
  const logisticsMethod = hasOwn(data, 'logisticsMethod')
    ? data.logisticsMethod
    : current?.logisticsMethod;
  if (providerCode === 'other' && !hasText(logisticsMethod)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'logisticsMethod is required when logisticsProviderCode is other.',
    );
  }
}

function assertPackedLogisticsProviderPresent(current: any, data: any) {
  const enteringPacked =
    data.packingStatus === 'PACKED' &&
    String(current?.packingStatus || '').toUpperCase() !== 'PACKED';
  if (!enteringPacked || !hasShippingDelivery(current)) {
    return;
  }
  const providerCode = normalizeLogisticsProviderCode(
    hasOwn(data, 'logisticsProviderCode')
      ? data.logisticsProviderCode
      : current?.logisticsProviderCode,
    hasOwn(data, 'logisticsMethod')
      ? data.logisticsMethod
      : current?.logisticsMethod,
  );
  const logisticsMethod = hasOwn(data, 'logisticsMethod')
    ? data.logisticsMethod
    : current?.logisticsMethod;
  if (providerCode === 'self_carry') {
    return;
  }
  if (
    !providerCode ||
    (providerCode === 'other' && !hasText(logisticsMethod))
  ) {
    throw createHttpError(
      400,
      'SHIPPED_LOGISTICS_PROVIDER_REQUIRED',
      '邮寄订单进入已打包状态前必须选择物流公司。',
    );
  }
}

function assertExistingPackedLogisticsNoNotCleared(current: any, data: any) {
  if (
    !hasOwn(data, 'logisticsNo') ||
    String(current?.packingStatus || '').toUpperCase() !== 'PACKED' ||
    !hasShippingDelivery(current)
  ) {
    return;
  }
  const providerCode = normalizeLogisticsProviderCode(
    hasOwn(data, 'logisticsProviderCode')
      ? data.logisticsProviderCode
      : current?.logisticsProviderCode,
    hasOwn(data, 'logisticsMethod')
      ? data.logisticsMethod
      : current?.logisticsMethod,
  );
  if (
    providerCode !== 'self_carry' &&
    hasText(current?.logisticsNo) &&
    !hasText(data.logisticsNo)
  ) {
    throw createHttpError(
      400,
      'PACKED_LOGISTICS_NO_CANNOT_BE_CLEARED',
      '已打包订单已有物流单号，不能清空。',
    );
  }
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

function buildAfterSalesOrderCreateData(
  payload: any,
  actor: any,
  salesOrder: any,
  options: any,
) {
  const now = options.now;
  const status = toPrismaAfterSalesStatus(payload?.status || 'negotiating');
  const calculation = options.calculationSnapshot;
  return {
    id: options.id,
    salesOrderId: salesOrder.id,
    afterSalesSalesOrderId: options.afterSalesSalesOrderId,
    customerId: salesOrder.customerId || null,
    issueType: toPrismaAfterSalesIssueType(
      normalizeRequiredString(payload?.issueType, 'issueType'),
    ),
    actionType: options.actionType,
    description: normalizeRequiredString(payload?.description, 'description'),
    resolution: normalizeOptionalString(payload?.resolution),
    refundAmountCents: options.refundAmountCents,
    deductionCalculationMode: calculation.deductionCalculationMode,
    sourceAgencyDeductionCents: calculation.sourceAgencyDeductionCents,
    agencyDeductionRate: calculation.agencyDeductionRate,
    dailyRebateRate: calculation.dailyRebateRate,
    monthlyRebateRate: calculation.monthlyRebateRate,
    agencyDeductionRuleId: calculation.agencyDeductionRuleId,
    agencyRebateRuleId: calculation.agencyRebateRuleId,
    calculationDate: options.calculationDate,
    agencyDeductionAdjustmentCents:
      calculation.agencyDeductionAdjustmentCents,
    financialEffectStatus: calculation.financialEffectStatus,
    status,
    financeConfirmed: false,
    financeConfirmedById: null,
    financeConfirmedAt: null,
    warehouseConfirmedById: null,
    warehouseConfirmedAt: null,
    warehouseConfirmNote: null,
    refundProofAttachments: [],
    handledById: actor.id,
    handledAt: now,
    completedAt: status === 'COMPLETED' ? now : null,
    notes: normalizeOptionalString(payload?.notes),
    items: {
      create: options.items.map((item: any, index: number) => ({
        id: crypto.randomUUID(),
        sourceSalesOrderItemId: item.sourceSalesOrderItemId,
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        originalUnitPriceCents: item.originalUnitPriceCents,
        subtotalCents: item.subtotalCents,
        returnRequired: item.returnRequired,
        expectedReturnQty: item.expectedReturnQty,
        postedReceivedQty: 0,
        returnVersion: 0,
        isHistoricalPlaceholder: false,
        notes: null,
        sortOrder: index,
        createdAt: now,
      })),
    },
    createdById: actor.id,
    updatedById: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

function buildAfterSalesSalesOrderCreateData(options: any) {
  const source = options.sourceSalesOrder;
  const shippingDate = defaultBackfillShippingDate(options.now);
  return {
    id: options.id,
    orderNo: options.afterSalesNo,
    orderType: 'AFTER_SALES',
    sourceSalesOrderId: source.id,
    travelGroupId: source.travelGroupId || null,
    customerId: source.customerId || null,
    customerName: source.customerName,
    customerPhone: source.customerPhone || null,
    province: source.province || null,
    city: source.city || null,
    district: source.district || null,
    address: source.address || null,
    orderDate: options.orderDate,
    shippingDate,
    shippingDateSource: 'SYSTEM_DEFAULT',
    shippingDateBackfillBatchId: null,
    salesFormNo: options.afterSalesNo,
    totalAmountCents: options.refundAmountCents,
    cashOnDeliveryAmountCents: 0,
    logisticsMethod: null,
    logisticsProviderCode: null,
    packingStatus: 'PACKED',
    packageCount: 0,
    warehouseRemark: null,
    hasPackingMark: false,
    logisticsNo: null,
    ...clearTrackingCacheData(),
    logisticsFeeCents: 0,
    invoiceRequired: false,
    invoiceIssued: false,
    financeRemark: null,
    remark: `关联原销售订单 ${source.orderNo}`,
    status: 'VALID',
    financeMark: Boolean(source.financeMark),
    markedById: source.financeMark ? source.markedById || null : null,
    markedAt: source.financeMark ? source.markedAt || null : null,
    salesUserId: source.salesUserId || null,
    outreachUserId: source.outreachUserId || null,
    pointsDestination: source.pointsDestination || 'TRAVEL_AGENCY',
    personalPointsGuideId: source.personalPointsGuideId || null,
    personalGuideNameSnapshot: source.personalGuideNameSnapshot || null,
    personalDailyRebateRate: source.personalDailyRebateRate || null,
    personalMonthlyRebateRate: source.personalMonthlyRebateRate || null,
    items: {
      create: options.items.map((item: any, index: number) => ({
        id: crypto.randomUUID(),
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceCents: item.originalUnitPriceCents,
        subtotalCents: item.subtotalCents,
        deliveryType: 'SELF_PICKUP',
        notes: `售后明细，来源销售明细 ${item.sourceSalesOrderItemId}`,
        sortOrder: index,
        createdAt: options.now,
      })),
    },
    createdById: options.actor.id,
    updatedById: options.actor.id,
    createdAt: options.now,
    updatedAt: options.now,
  };
}

function resolveAfterSalesOrderItems(
  value: unknown,
  salesOrder: any,
  actionType: string,
) {
  const requiresItems = actionType !== 'RECORD_ONLY';
  if (value === undefined || value === null) {
    if (!requiresItems) {
      return [];
    }
    throw createHttpError(
      400,
      'AFTER_SALES_ITEMS_REQUIRED',
      'items is required for this after-sales action.',
    );
  }
  if (!Array.isArray(value)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'items must be an array.',
    );
  }
  if (requiresItems && value.length === 0) {
    throw createHttpError(
      400,
      'AFTER_SALES_ITEMS_REQUIRED',
      'items is required for this after-sales action.',
    );
  }
  const sourceItems = new Map(
    (salesOrder.items || []).map((item: any) => [item.id, item]),
  );
  const seen = new Set<string>();
  return value.map((input: any, index: number) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw createHttpError(
        400,
        'VALIDATION_FAILED',
        `items[${index}] must be an object.`,
      );
    }
    const sourceSalesOrderItemId = normalizeRequiredString(
      input.sourceSalesOrderItemId,
      `items[${index}].sourceSalesOrderItemId`,
    );
    if (seen.has(sourceSalesOrderItemId)) {
      throw createHttpError(
        400,
        'AFTER_SALES_ITEM_DUPLICATED',
        'The same source sales order item cannot be submitted twice.',
      );
    }
    seen.add(sourceSalesOrderItemId);
    const sourceItem = sourceItems.get(sourceSalesOrderItemId) as any;
    if (!sourceItem) {
      throw createHttpError(
        400,
        'AFTER_SALES_ITEM_NOT_IN_SOURCE_ORDER',
        'After-sales items must belong to the source sales order.',
      );
    }
    const quantity = Number(input.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw createHttpError(
        400,
        'AFTER_SALES_ITEM_QUANTITY_INVALID',
        'After-sales item quantity must be a positive integer.',
      );
    }
    const subtotalCents = Number(input.totalPriceCents);
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
      throw createHttpError(
        400,
        'AFTER_SALES_ITEM_TOTAL_PRICE_INVALID',
        'After-sales item totalPriceCents must be a non-negative integer.',
      );
    }
    const returnRequired = normalizeAfterSalesReturnRequired(
      input.returnRequired,
      `items[${index}].returnRequired`,
    );
    const expectedReturnQty = normalizeExpectedReturnQty(
      input.expectedReturnQty,
      returnRequired,
      quantity,
      index,
    );
    return {
      sourceSalesOrderItemId,
      productId: sourceItem.productId || null,
      productName: sourceItem.productName,
      unit: sourceItem.unit || null,
      quantity,
      originalQuantity: Number(sourceItem.quantity || 0),
      originalUnitPriceCents: Number(sourceItem.unitPriceCents || 0),
      subtotalCents,
      returnRequired,
      expectedReturnQty,
    };
  });
}

function normalizeAfterSalesReturnRequired(
  value: unknown,
  field: string,
) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${field} must be a boolean.`,
    );
  }
  return value;
}

function normalizeExpectedReturnQty(
  value: unknown,
  returnRequired: boolean,
  quantity: number,
  index: number,
) {
  if (!returnRequired) {
    if (
      value !== undefined &&
      value !== null &&
      Number(value) !== 0
    ) {
      throw createHttpError(
        400,
        'AFTER_SALES_EXPECTED_RETURN_QTY_INVALID',
        `items[${index}].expectedReturnQty must be 0 when returnRequired is false.`,
      );
    }
    return 0;
  }
  const expectedReturnQty = Number(value);
  if (
    !Number.isSafeInteger(expectedReturnQty) ||
    expectedReturnQty <= 0 ||
    expectedReturnQty > quantity
  ) {
    throw createHttpError(
      400,
      'AFTER_SALES_EXPECTED_RETURN_QTY_INVALID',
      `items[${index}].expectedReturnQty must be a positive integer no greater than quantity.`,
    );
  }
  return expectedReturnQty;
}

function hasReturnRequiredItems(order: any) {
  return (order?.items || []).some(
    (item: any) =>
      Boolean(item.returnRequired) &&
      Number(item.expectedReturnQty || 0) > 0,
  );
}

function isAfterSalesPhysicalReturnComplete(order: any) {
  const returnItems = (order?.items || []).filter(
    (item: any) =>
      Boolean(item.returnRequired) &&
      Number(item.expectedReturnQty || 0) > 0,
  );
  if (returnItems.length === 0) {
    return Boolean(order?.warehouseConfirmedAt);
  }
  return returnItems.every(
    (item: any) =>
      Number(item.postedReceivedQty || 0) >=
      Number(item.expectedReturnQty || 0),
  );
}

function validateAfterSalesAvailableQuantity(
  items: any[],
  existingOrders: any[],
) {
  const usedQuantity = new Map<string, number>();
  for (const order of existingOrders || []) {
    for (const item of order.items || []) {
      const sourceItemId = normalizeOptionalString(
        item.sourceSalesOrderItemId,
      );
      if (!sourceItemId) {
        continue;
      }
      usedQuantity.set(
        sourceItemId,
        (usedQuantity.get(sourceItemId) || 0) +
          Math.max(0, Number(item.quantity || 0)),
      );
    }
  }
  for (const item of items) {
    const remaining =
      item.originalQuantity -
      (usedQuantity.get(item.sourceSalesOrderItemId) || 0);
    if (item.quantity > remaining) {
      throw createHttpError(
        400,
        'AFTER_SALES_ITEM_QUANTITY_EXCEEDED',
        `After-sales quantity exceeds the remaining quantity for ${item.productName}.`,
      );
    }
  }
}

function validateAfterSalesRefundAmount(
  payload: any,
  salesOrder: any,
  existingOrders: any[],
  actionType: string,
  refundAmountCents: number,
) {
  if (
    ['REFUND', 'RETURN_REFUND', 'CANCEL_ORDER'].includes(actionType) &&
    refundAmountCents <= 0
  ) {
    throw createHttpError(
      400,
      'AFTER_SALES_REFUND_AMOUNT_REQUIRED',
      'Refund actions require a positive item total.',
    );
  }
  if (
    hasOwn(payload, 'refundAmountCents') &&
    normalizeNonNegativeInt(
      payload.refundAmountCents,
      'refundAmountCents',
    ) !== refundAmountCents
  ) {
    throw createHttpError(
      400,
      'AFTER_SALES_REFUND_AMOUNT_MISMATCH',
      'refundAmountCents must equal the sum of item totalPriceCents.',
    );
  }
  const existingRefundAmountCents = (existingOrders || []).reduce(
    (sum: number, order: any) =>
      sum + Math.max(0, Number(order.refundAmountCents || 0)),
    0,
  );
  if (
    existingRefundAmountCents + refundAmountCents >
    Number(salesOrder.totalAmountCents || 0)
  ) {
    throw createHttpError(
      400,
      'AFTER_SALES_REFUND_EXCEEDS_ORDER_TOTAL',
      'Cumulative after-sales refunds exceed the source sales order total.',
    );
  }
}

function resolveAgencyDeductionModeFromRecords(records: any[]) {
  for (const record of records || []) {
    const snapshotText = JSON.stringify({
      calculationNote: record.calculationNote || null,
      ruleSnapshot: record.ruleSnapshot || null,
      sourceSnapshot: record.sourceSnapshot || null,
    });
    if (snapshotText.includes('effective_sales_rate')) {
      return 'effective_sales_rate';
    }
  }
  return 'manual_product_reference';
}

function findAgencyDeductionRuleId(records: any[]) {
  for (const record of records || []) {
    const rules = record?.ruleSnapshot?.agencyDeductionRules;
    if (!Array.isArray(rules)) {
      continue;
    }
    const rule = rules.find((item: any) => normalizeOptionalString(item?.id));
    if (rule) {
      return normalizeOptionalString(rule.id);
    }
  }
  return null;
}

function normalizeRateSnapshot(value: unknown) {
  const rate = Number(value || 0);
  return Number.isFinite(rate) && rate >= 0 ? rate.toFixed(4) : '0.0000';
}

function roundCentsProductRatio(
  left: number,
  right: number,
  denominator: number,
) {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(denominator) ||
    left <= 0 ||
    right <= 0 ||
    denominator <= 0
  ) {
    return 0;
  }
  const numerator = BigInt(left) * BigInt(right);
  return Number(
    (numerator + BigInt(Math.floor(denominator / 2))) / BigInt(denominator),
  );
}

export function calculateProportionalAfterSalesDeductionCents(input: {
  sourceAgencyDeductionCents: number;
  refundAmountCents: number;
  sourceOrderAmountCents: number;
  existingDeductionCents?: number;
}) {
  const sourceDeductionCents = Math.max(
    0,
    Number(input.sourceAgencyDeductionCents || 0),
  );
  const refundAmountCents = Math.max(
    0,
    Number(input.refundAmountCents || 0),
  );
  const sourceOrderAmountCents = Math.max(
    0,
    Number(input.sourceOrderAmountCents || 0),
  );
  const existingDeductionCents = Math.max(
    0,
    Number(input.existingDeductionCents || 0),
  );
  if (
    !Number.isSafeInteger(sourceDeductionCents) ||
    !Number.isSafeInteger(refundAmountCents) ||
    !Number.isSafeInteger(sourceOrderAmountCents) ||
    !Number.isSafeInteger(existingDeductionCents) ||
    sourceDeductionCents === 0 ||
    refundAmountCents === 0 ||
    sourceOrderAmountCents === 0
  ) {
    return 0;
  }
  const remainingDeductionCents = Math.max(
    0,
    sourceDeductionCents - existingDeductionCents,
  );
  return Math.min(
    refundAmountCents,
    remainingDeductionCents,
    roundCentsProductRatio(
      sourceDeductionCents,
      refundAmountCents,
      sourceOrderAmountCents,
    ),
  );
}

function multiplyCentsByRateSnapshot(cents: number, rateValue: unknown) {
  if (!Number.isSafeInteger(cents) || cents === 0) {
    return 0;
  }
  const rateUnits = Math.round(Number(rateValue || 0) * 10000);
  if (!Number.isSafeInteger(rateUnits) || rateUnits <= 0) {
    return 0;
  }
  const sign = cents < 0 ? -1 : 1;
  const rounded = Number(
    (BigInt(Math.abs(cents)) * BigInt(rateUnits) + 5000n) / 10000n,
  );
  return sign * rounded;
}

export function buildAfterSalesCommissionAdjustmentRecords(options: any) {
  const afterSalesOrder = options.afterSalesOrder;
  const sourceSalesOrder = options.sourceSalesOrder;
  const actor = options.actor;
  const refundAmountCents = Math.max(
    0,
    Number(afterSalesOrder.refundAmountCents || 0),
  );
  const sourceTotalAmountCents = Math.max(
    1,
    Number(sourceSalesOrder.totalAmountCents || 0),
  );
  const deductionCents =
    afterSalesOrder.agencyDeductionAdjustmentCents === null ||
    afterSalesOrder.agencyDeductionAdjustmentCents === undefined
      ? null
      : Math.max(
          0,
          Number(afterSalesOrder.agencyDeductionAdjustmentCents),
        );
  const isConfirmed =
    Boolean(afterSalesOrder.financeConfirmed) && deductionCents !== null;
  const now = new Date();
  const common = {
    salesOrderId: afterSalesOrder.afterSalesSalesOrderId || null,
    travelGroupId: sourceSalesOrder.travelGroupId || null,
    afterSalesOrderId: afterSalesOrder.id,
    grossAmountCents: -refundAmountCents,
    confirmedRefundAmountCents: -refundAmountCents,
    manualInput: false,
    isConfirmed,
    confirmedById: isConfirmed
      ? afterSalesOrder.financeConfirmedById || actor?.id || null
      : null,
    confirmedAt: isConfirmed
      ? afterSalesOrder.financeConfirmedAt || now
      : null,
    calculationVersion: 'after_sales_v1',
  };
  const sourceRecords = options.sourceRecords || [];
  const records: any[] = [];

  for (const sourceRecord of sourceRecords) {
    const targetType = String(sourceRecord.targetType || '').toUpperCase();
    if (
      ['AGENCY_DAILY_REBATE', 'AGENCY_MONTHLY_REBATE'].includes(
        targetType,
      )
    ) {
      continue;
    }
    records.push({
      ...common,
      commissionRuleId: sourceRecord.commissionRuleId || null,
      agencyRebateRuleId: null,
      targetType,
      targetUserId: sourceRecord.targetUserId || null,
      agencyId: sourceRecord.agencyId || null,
      agencyName: sourceRecord.agencyName || null,
      baseAmountCents: -roundCentsProductRatio(
        Math.abs(Number(sourceRecord.baseAmountCents || 0)),
        refundAmountCents,
        sourceTotalAmountCents,
      ),
      deductionAmountCents: -roundCentsProductRatio(
        Math.abs(Number(sourceRecord.deductionAmountCents || 0)),
        refundAmountCents,
        sourceTotalAmountCents,
      ),
      rateSnapshot: sourceRecord.rateSnapshot || null,
      amountCents: -roundCentsProductRatio(
        Math.abs(Number(sourceRecord.amountCents || 0)),
        refundAmountCents,
        sourceTotalAmountCents,
      ),
      pointsCents: -roundCentsProductRatio(
        Math.abs(Number(sourceRecord.pointsCents || 0)),
        refundAmountCents,
        sourceTotalAmountCents,
      ),
      calculationNote: `售后订单 ${afterSalesOrder.afterSalesNo} 的独立负向提成调整。`,
      ruleSnapshot: {
        sourceCommissionRecordId: sourceRecord.id,
        sourceRuleSnapshot: sourceRecord.ruleSnapshot || null,
        refundRatioNumerator: refundAmountCents,
        refundRatioDenominator: sourceTotalAmountCents,
      },
      sourceSnapshot: {
        afterSalesOrderId: afterSalesOrder.id,
        afterSalesNo: afterSalesOrder.afterSalesNo,
        sourceSalesOrderId: sourceSalesOrder.id,
        sourceOrderNo: sourceSalesOrder.orderNo,
      },
    });
  }

  const agencyBaseAmountCents =
    deductionCents === null ? 0 : -(refundAmountCents - deductionCents);
  const agencyDeductionAmountCents =
    deductionCents === null ? 0 : -deductionCents;
  for (const targetType of [
    'AGENCY_DAILY_REBATE',
    'AGENCY_MONTHLY_REBATE',
  ]) {
    const sourceRecord = sourceRecords.find(
      (record: any) =>
        String(record.targetType || '').toUpperCase() === targetType,
    );
    const rateSnapshot =
      targetType === 'AGENCY_DAILY_REBATE'
        ? afterSalesOrder.dailyRebateRate
        : afterSalesOrder.monthlyRebateRate;
    records.push({
      ...common,
      commissionRuleId: null,
      agencyRebateRuleId:
        afterSalesOrder.agencyRebateRuleId ||
        sourceRecord?.agencyRebateRuleId ||
        null,
      targetType,
      targetUserId: null,
      agencyId: sourceRecord?.agencyId || null,
      agencyName:
        sourceRecord?.agencyName ||
        sourceSalesOrder.travelGroup?.travelAgency ||
        null,
      baseAmountCents: agencyBaseAmountCents,
      deductionAmountCents: agencyDeductionAmountCents,
      rateSnapshot: normalizeRateSnapshot(rateSnapshot),
      amountCents: 0,
      pointsCents:
        deductionCents === null
          ? 0
          : multiplyCentsByRateSnapshot(
              agencyBaseAmountCents,
              rateSnapshot,
            ),
      calculationNote:
        deductionCents === null
          ? `售后订单 ${afterSalesOrder.afterSalesNo} 待财务填写扣酒成本。`
          : `售后订单 ${afterSalesOrder.afterSalesNo} 的独立负向积分调整。`,
      ruleSnapshot: {
        deductionCalculationMode:
          afterSalesOrder.deductionCalculationMode,
        sourceAgencyDeductionCents: Number(
          afterSalesOrder.sourceAgencyDeductionCents || 0,
        ),
        agencyDeductionRate:
          afterSalesOrder.agencyDeductionRate === null
            ? null
            : Number(afterSalesOrder.agencyDeductionRate),
        dailyRebateRate: Number(afterSalesOrder.dailyRebateRate || 0),
        monthlyRebateRate: Number(afterSalesOrder.monthlyRebateRate || 0),
        agencyDeductionRuleId:
          afterSalesOrder.agencyDeductionRuleId || null,
        agencyRebateRuleId:
          afterSalesOrder.agencyRebateRuleId || null,
        calculationDate: formatDate(afterSalesOrder.calculationDate),
      },
      sourceSnapshot: {
        afterSalesOrderId: afterSalesOrder.id,
        afterSalesNo: afterSalesOrder.afterSalesNo,
        sourceSalesOrderId: sourceSalesOrder.id,
        sourceOrderNo: sourceSalesOrder.orderNo,
        refundAmountCents,
        agencyDeductionAdjustmentCents: deductionCents,
        financialEffectStatus: afterSalesOrder.financialEffectStatus,
      },
    });
  }
  return records;
}

export function isSameAfterSalesCommissionBusinessKey(
  record: any,
  data: any,
) {
  return (
    String(record.targetType || '').toUpperCase() === data.targetType &&
    (record.targetUserId || null) === (data.targetUserId || null) &&
    (record.agencyId || null) === (data.agencyId || null) &&
    (record.agencyName || null) === (data.agencyName || null)
  );
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
  if (hasOwn(payload, 'description')) {
    data.description = normalizeRequiredString(
      payload.description,
      'description',
    );
  }
  if (hasOwn(payload, 'resolution')) {
    data.resolution = normalizeOptionalString(payload.resolution);
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

function buildAfterSalesOrderWarehouseConfirmData(payload: any, actor: any) {
  const now = new Date();
  const note = hasOwn(payload, 'warehouseConfirmNote')
    ? normalizeOptionalString(payload.warehouseConfirmNote)
    : normalizeOptionalString(payload?.note);
  return {
    status: 'WAITING_REFUND',
    warehouseConfirmedById: actor.id,
    warehouseConfirmedAt: now,
    warehouseConfirmNote: note,
    handledById: actor.id,
    handledAt: now,
    updatedById: actor.id,
    updatedAt: now,
  };
}

function buildAfterSalesOrderFinanceRefundConfirmData(
  actor: any,
  refundProofAttachments: any[],
  current: any,
) {
  const now = new Date();
  return {
    financeConfirmed: true,
    financeConfirmedById: actor.id,
    financeConfirmedAt: now,
    financialEffectStatus:
      current.financialEffectStatus === 'PENDING_RECOVERY'
        ? 'PENDING_RECOVERY'
        : 'CONFIRMED',
    refundProofAttachments,
    updatedById: actor.id,
    updatedAt: now,
  };
}

function buildAfterSalesOrderFinanceConfirmData(
  financeConfirmed: boolean,
  actor: any,
  current: any,
) {
  const now = new Date();
  const data: any = {
    financeConfirmed,
    financeConfirmedById: financeConfirmed ? actor.id : null,
    financeConfirmedAt: financeConfirmed ? now : null,
    financialEffectStatus:
      current.financialEffectStatus === 'NO_FINANCIAL_EFFECT'
        ? 'NO_FINANCIAL_EFFECT'
        : current.financialEffectStatus === 'PENDING_RECOVERY'
          ? 'PENDING_RECOVERY'
          : financeConfirmed
            ? 'CONFIRMED'
            : 'PENDING_CONFIRMATION',
    updatedById: actor.id,
    updatedAt: now,
  };
  if (!financeConfirmed) {
    data.refundProofAttachments = [];
  }
  return data;
}

function assertAfterSalesAgencyDeductionReadyForConfirmation(order: any) {
  if (
    order?.deductionCalculationMode === 'manual_product_reference' &&
    (order?.agencyDeductionAdjustmentCents === null ||
      order?.agencyDeductionAdjustmentCents === undefined)
  ) {
    throw createHttpError(
      400,
      'AFTER_SALES_DEDUCTION_REQUIRED',
      'Manual after-sales deduction must be filled before finance confirmation.',
    );
  }
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
    const hasSubtotalCents = hasOwn(item, 'subtotalCents');
    const subtotalCents = hasSubtotalCents
      ? normalizeNonNegativeInt(
          item?.subtotalCents,
          `items[${index}].subtotalCents`,
        )
      : null;
    const unitPriceCents = hasOwn(item, 'unitPriceCents')
      ? normalizeNonNegativeInt(
          item?.unitPriceCents,
          `items[${index}].unitPriceCents`,
        )
      : subtotalCents === null
        ? normalizeNonNegativeInt(
            item?.unitPriceCents,
            `items[${index}].unitPriceCents`,
          )
        : Math.round(Number(subtotalCents || 0) / quantity);
    if (hasOwn(item || {}, 'serializedUnitIds')) {
      throw createHttpError(
        403,
        'SERIALIZED_SELECTION_SERVER_MANAGED',
        `items[${index}].serializedUnitIds is server-managed; submit only product and quantity.`,
      );
    }
    const serializedUnitIds: string[] = [];
    return {
      id: normalizeOptionalString(item?.id) || crypto.randomUUID(),
      productId: normalizeRequiredString(
        item?.productId,
        `items[${index}].productId`,
      ),
      quantity,
      unitPriceCents,
      subtotalCents:
        subtotalCents === null ? quantity * unitPriceCents : subtotalCents,
      deliveryType: toPrismaDeliveryType(item?.deliveryType),
      notes: normalizeOptionalString(item?.notes),
      sortOrder: normalizeInt(
        item?.sortOrder,
        `items[${index}].sortOrder`,
        index + 1,
      ),
      serializedUnitIds,
      createdAt: now,
    };
  });
}

async function resolveSalesOrderItemSnapshots(
  prisma: any,
  items: any[],
  orderDate: Date,
  currentItems: any[] = [],
  forceCostRefresh = false,
  options: any = {},
) {
  const resolved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const product = await findActiveProductOrThrow(
      prisma,
      item.productId,
      `items[${index}].productId`,
    );
    const current =
      currentItems.find((candidate: any) => candidate.id === item.id) ||
      currentItems[index] ||
      null;
    const sameProduct = current
      ? normalizeOptionalString(current.productId)
        ? normalizeOptionalString(current.productId) === product.id
        : normalizeProductSnapshotName(current.productName) ===
          normalizeProductSnapshotName(product.name)
      : false;
    const requiresCostRefresh =
      forceCostRefresh ||
      !current ||
      !sameProduct ||
      Number(current.quantity || 0) !== Number(item.quantity || 0);
    const subtotalCents =
      item.subtotalCents === undefined || item.subtotalCents === null
        ? Number(item.quantity || 0) * Number(item.unitPriceCents || 0)
        : Number(item.subtotalCents || 0);
    let actualUnitCostCents: number | null;
    let actualCostSubtotalCents: number | null;

    if (product.inventoryTrackingMode === 'SERIALIZED') {
      actualUnitCostCents =
        sameProduct && current
          ? nullableInteger(current.actualUnitCostCents)
          : null;
      actualCostSubtotalCents =
        sameProduct && current
          ? nullableInteger(current.actualCostSubtotalCents)
          : null;
      resolved.push({
        ...item,
        id: current?.id || item.id,
        inventoryLineKey: options.assignQuantityInventoryLineKeys
          ? sameProduct && current?.inventoryLineKey
            ? current.inventoryLineKey
            : serverInventoryLineKey()
          : current?.inventoryLineKey || null,
        inventoryTrackingMode: product.inventoryTrackingMode,
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        subtotalCents,
        actualUnitCostCents,
        actualCostSubtotalCents,
        grossProfitCents:
          actualCostSubtotalCents === null
            ? null
            : subtotalCents - actualCostSubtotalCents,
        serializedUnitIds: [],
        createdAt: current?.createdAt || item.createdAt || new Date(),
      });
      continue;
    }

    if (item.serializedUnitIds.length > 0) {
      throw createHttpError(
        400,
        'PRODUCT_NOT_SERIALIZED',
        `items[${index}] 的普通商品不能选择物流码。`,
      );
    }

    if (requiresCostRefresh) {
      const actualCost = await findEffectiveProductActualCostOrThrow(
        prisma,
        product,
        orderDate,
      );
      actualUnitCostCents = Number(actualCost.costCents);
      actualCostSubtotalCents =
        actualUnitCostCents * Number(item.quantity || 0);
    } else {
      actualUnitCostCents = nullableInteger(current.actualUnitCostCents);
      actualCostSubtotalCents = nullableInteger(
        current.actualCostSubtotalCents,
      );
    }

    resolved.push({
      ...item,
      id: current?.id || item.id,
      inventoryLineKey:
        product.inventoryTrackingMode === 'QUANTITY' &&
        options.assignQuantityInventoryLineKeys
          ? sameProduct && current?.inventoryLineKey
            ? current.inventoryLineKey
            : serverInventoryLineKey()
          : current?.inventoryLineKey || null,
      inventoryTrackingMode: product.inventoryTrackingMode,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      subtotalCents,
      actualUnitCostCents,
      actualCostSubtotalCents,
      grossProfitCents:
        actualCostSubtotalCents === null
          ? null
          : subtotalCents - actualCostSubtotalCents,
      createdAt: current?.createdAt || item.createdAt || new Date(),
    });
  }
  return resolved;
}

function toSalesOrderItemCreateData(item: any) {
  const {
    serializedUnitIds,
    inventoryTrackingMode: _inventoryTrackingMode,
    ...data
  } = item;
  return data;
}

async function findActiveProductOrThrow(
  prisma: any,
  productId: unknown,
  fieldName: string,
) {
  const id = normalizeRequiredString(productId, fieldName);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    throw createHttpError(404, 'PRODUCT_NOT_FOUND', 'Product does not exist.');
  }
  if (!product.isActive) {
    throw createHttpError(
      400,
      'PRODUCT_INACTIVE',
      'Inactive products cannot be used for new or edited items.',
    );
  }
  return product;
}

async function findEffectiveProductActualCostOrThrow(
  prisma: any,
  product: any,
  orderDate: Date,
) {
  const actualCost = await prisma.productActualCost.findFirst({
    where: {
      productId: product.id,
      isActive: true,
      effectiveFrom: { lte: orderDate },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: orderDate } },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!actualCost) {
    throw createHttpError(
      400,
      'PRODUCT_ACTUAL_COST_NOT_EFFECTIVE',
      `该商品在订单日期没有有效实际成本：${product.name}`,
    );
  }
  return actualCost;
}

function salesOrderItemToSnapshotInput(item: any) {
  return {
    id: item.id,
    productId: item.productId,
    quantity: Number(item.quantity || 0),
    unitPriceCents: Number(item.unitPriceCents || 0),
    subtotalCents: Number(item.subtotalCents || 0),
    deliveryType: item.deliveryType,
    notes: item.notes || null,
    sortOrder: Number(item.sortOrder || 0),
    serializedUnitIds: Array.isArray(item.serializedInventoryUnits)
      ? item.serializedInventoryUnits.map((unit: any) => unit.id)
      : [],
    createdAt: item.createdAt,
  };
}

function sumSalesOrderItemSubtotals(items: any[]) {
  return items.reduce(
    (sum: number, item: any) => sum + Number(item.subtotalCents || 0),
    0,
  );
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null;
}

function normalizeProductSnapshotName(value: unknown) {
  return String(normalizeOptionalString(value) || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function buildReconciliationManualData(payload: any, actor: any) {
  return {
    businessDate: parseDate(payload?.businessDate, 'businessDate', true),
    travelGroupSalesCents: 0,
    backOfficeSalesCents: normalizeNonNegativeInt(
      payload?.backOfficeSalesCents,
      'backOfficeSalesCents',
      0,
    ),
    buybackCents: 0,
    externalSalesCents: 0,
    internalPurchaseCents: 0,
    afterSalesCents: 0,
    refundsCents: 0,
    otherReceivableCents: 0,
    notes: normalizeOptionalString(payload?.notes),
    reviewStatus: 'PENDING_REVIEW' as const,
    reviewSourceHash: null,
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
    amountCents: normalizeNonNegativeInt(
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

function toGroupDto(
  group: any,
  kind: string,
  actor: any = null,
  onlyShowMarkedRecords = false,
) {
  const pending = calculateGroupPendingState(group, kind);
  const guestCounts =
    kind === 'travel'
      ? readTravelGroupGuestCounts(group)
      : { guestCount: Number(group.guestCount || 0) };
  const rawSalesOrders = filterGroupSalesOrdersForActor(
    Array.isArray(group.salesOrders) ? group.salesOrders : [],
    group,
    actor,
    onlyShowMarkedRecords,
  );
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
    ...guestCounts,
    tastingRoomNo: group.tastingRoomNo || null,
    tasterName: group.tasterName || null,
    sourceRegion: group.sourceRegion || null,
    ageInfo: group.ageInfo || null,
    mentionedFeitian:
      typeof group.mentionedFeitian === 'boolean'
        ? group.mentionedFeitian
        : null,
    previousStopOrderStatus: group.previousStopOrderStatus || null,
    keyCustomerInfo: group.keyCustomerInfo || null,
    keyCustomerPhotos: toTravelGroupAttachmentDtos(
      group.keyCustomerPhotos,
      'key_customer_photo',
    ),
    guestInfoAttachments: toTravelGroupAttachmentDtos(
      group.guestInfoAttachments,
      'guest_info',
    ),
    liaisonTasterId: group.liaisonTasterId || null,
    liaisonTasterName: group.liaisonTasterName || null,
    liaisonTaster: buildLiaisonTasterSnapshotDto(group),
    expectedArrivalTime: group.expectedArrivalTime || null,
    arrivalTime: group.arrivalTime || null,
    groupType: group.groupType || null,
    wineDetails: group.wineDetails || null,
    departureTime: group.departureTime || null,
    remarks: group.remarks || null,
    status: GROUP_STATUS_FROM_PRISMA[group.status] || group.status,
    parkingFeeCents:
      group.parkingFeeCents === undefined || group.parkingFeeCents === null
        ? 500
        : Number(group.parkingFeeCents),
    cigaretteFeeCents:
      group.cigaretteFeeCents === undefined ||
      group.cigaretteFeeCents === null
        ? null
        : Number(group.cigaretteFeeCents),
    lossStatus: normalizeStoredTravelGroupLossStatus(group.lossStatus),
    lossConfirmedAt: group.lossConfirmedAt
      ? toIsoString(group.lossConfirmedAt)
      : null,
    lossConfirmedById: group.lossConfirmedById || null,
    lossConfirmedBy: group.lossConfirmedBy
      ? {
          id: group.lossConfirmedBy.id,
          name: group.lossConfirmedBy.name,
          username: group.lossConfirmedBy.username,
        }
      : null,
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
    tasterEditCount: Number(group.tasterEditCount || 0),
    tasterEditLimit: null,
    tasterEditRemaining: null,
    tasterEditUnlimited: true,
    tasterLastEditedAt: group.tasterLastEditedAt
      ? toIsoString(group.tasterLastEditedAt)
      : null,
    canEditByCurrentUser: canEditTravelGroupForActor(group, actor),
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

function filterGroupSalesOrdersForActor(
  orders: any[],
  group: any,
  actor: any,
  onlyShowMarkedRecords = false,
) {
  const globallyVisibleOrders = onlyShowMarkedRecords
    ? orders.filter((order: any) => Boolean(order?.financeMark))
    : orders;
  if (actor?.role === 'sales') {
    return globallyVisibleOrders.filter(
      (order: any) =>
        order?.salesUserId === actor.id &&
        isWithinShanghaiToday(order?.createdAt),
    );
  }
  if (actor?.role === 'taster') {
    if (
      group?.tasterId !== actor.id ||
      formatDate(group?.visitDate) < getShanghaiTodayBusinessDate()
    ) {
      return [];
    }
  }
  return globallyVisibleOrders;
}

function canEditTravelGroupForActor(group: any, actor: any) {
  if (actor?.role === 'taster') {
    return (
      formatDate(group?.visitDate) === getShanghaiTodayBusinessDate() &&
      (group?.tasterId === actor.id ||
        group?.liaisonTasterId === actor.id)
    );
  }
  return [
    'super_admin',
    'admin',
    'front_desk',
    'sales',
    'finance',
  ].includes(actor?.role);
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

function buildLiaisonTasterSnapshotDto(group: any) {
  if (group.liaisonTaster) {
    return {
      id: group.liaisonTaster.id,
      name: group.liaisonTaster.name,
      username: group.liaisonTaster.username,
    };
  }
  if (!group.liaisonTasterId && !group.liaisonTasterName) {
    return null;
  }
  return {
    id: group.liaisonTasterId || null,
    name: group.liaisonTasterName || null,
    username: null,
  };
}

function getAfterSalesRefundProofAttachments(order: any) {
  const value = order?.refundProofAttachments;
  return Array.isArray(value)
    ? value.filter(
        (attachment: any) =>
          attachment && typeof attachment === 'object' && !Array.isArray(attachment),
      )
    : [];
}

function findAfterSalesRefundProofAttachment(order: any, attachmentId: string) {
  if (!isSafeAttachmentStorageKey(attachmentId)) {
    return null;
  }
  return (
    getAfterSalesRefundProofAttachments(order).find(
      (attachment: any) =>
        attachment?.id === attachmentId &&
        (attachment?.category === undefined ||
          attachment?.category === 'refund_proof'),
    ) || null
  );
}

function toAfterSalesRefundProofAttachmentDto(attachment: any) {
  const size = Number(attachment?.size || 0);
  return {
    id:
      typeof attachment?.id === 'string' && attachment.id.length > 0
        ? attachment.id
        : null,
    category: 'refund_proof',
    originalName: sanitizeAttachmentOriginalName(
      attachment?.originalName || attachment?.name,
    ),
    contentType:
      typeof attachment?.contentType === 'string'
        ? attachment.contentType
        : null,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    uploadedById:
      typeof attachment?.uploadedById === 'string'
        ? attachment.uploadedById
        : null,
    uploadedAt:
      typeof attachment?.uploadedAt === 'string'
        ? attachment.uploadedAt
        : null,
  };
}

function getTravelGroupAttachmentFieldName(category: string) {
  return category === 'key_customer_photo'
    ? 'keyCustomerPhotos'
    : 'guestInfoAttachments';
}

function getTravelGroupAttachmentMetadata(group: any, category: string) {
  const value = group?.[getTravelGroupAttachmentFieldName(category)];
  return Array.isArray(value)
    ? value.filter(
        (attachment: any) =>
          attachment && typeof attachment === 'object' && !Array.isArray(attachment),
      )
    : [];
}

function findTravelGroupAttachment(group: any, attachmentId: string) {
  if (!isSafeAttachmentStorageKey(attachmentId)) {
    return null;
  }
  for (const category of ['key_customer_photo', 'guest_info']) {
    const attachment = getTravelGroupAttachmentMetadata(group, category).find(
      (candidate: any) =>
        candidate?.id === attachmentId && candidate?.category === category,
    );
    if (attachment) {
      return { attachment, category };
    }
  }
  return null;
}

function toTravelGroupAttachmentDtos(value: any, category: string) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((attachment: any) =>
    toTravelGroupAttachmentDto(attachment, category),
  );
}

function toTravelGroupAttachmentDto(attachment: any, category: string) {
  const size = Number(attachment?.size || 0);
  return {
    id:
      typeof attachment?.id === 'string' && attachment.id.length > 0
        ? attachment.id
        : null,
    category:
      attachment?.category === 'key_customer_photo' ||
      attachment?.category === 'guest_info'
        ? attachment.category
        : category,
    originalName: sanitizeAttachmentOriginalName(
      attachment?.originalName || attachment?.name,
    ),
    contentType:
      typeof attachment?.contentType === 'string'
        ? attachment.contentType
        : null,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    uploadedById:
      typeof attachment?.uploadedById === 'string'
        ? attachment.uploadedById
        : null,
    uploadedAt:
      typeof attachment?.uploadedAt === 'string'
        ? attachment.uploadedAt
        : null,
  };
}

async function cleanupStoredTravelGroupAttachments(attachments: any[]) {
  await Promise.allSettled(
    attachments
      .filter((attachment: any) =>
        isSafeAttachmentStorageKey(attachment?.storageKey),
      )
      .map((attachment: any) =>
        removeTravelGroupAttachmentFile(attachment.storageKey),
      ),
  );
}

function normalizeAttachmentStorageError(error: any, operation: string) {
  if (Number.isInteger(error?.statusCode)) {
    return error;
  }
  return createHttpError(
    500,
    'ATTACHMENT_STORAGE_FAILED',
    `Attachment ${operation} failed.`,
  );
}

function attachmentNotFoundError() {
  return createHttpError(
    404,
    'ATTACHMENT_NOT_FOUND',
    'Attachment does not exist.',
  );
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
      ) ||
      (Array.isArray(order?.afterSalesOrders) &&
        order.afterSalesOrders.length > 0),
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

export function buildFinancePendingLogisticsReasons(order: any) {
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

export function calculateGroupPendingState(
  group: any,
  kind: string,
  now = new Date(),
) {
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

  const visitDate = formatDate(group.visitDate);
  const today = getShanghaiTodayBusinessDate(now);
  const handlingDateReached = Boolean(visitDate) && visitDate! <= today;
  if (handlingDateReached) {
    const missingFields = getTravelGroupFrontDeskMissingFields(group);
    if (
      hasText(group.tasterId) &&
      group.taster !== undefined &&
      !isActiveTasterUser(group.taster) &&
      !missingFields.includes('tasterId')
    ) {
      missingFields.push('tasterId');
    }
    const reasonByField: Record<string, string> = {
      licensePlate: 'missing_license_plate',
      guestCount: 'missing_guest_count',
      cigaretteFeeCents: 'missing_cigarette_fee',
      tastingRoomNo: 'missing_tasting_room_no',
      tasterId: 'missing_taster',
      arrivalTime: 'missing_arrival_time',
      groupType: 'missing_group_type',
    };
    for (const field of missingFields) {
      addFinding('pending_front_desk', reasonByField[field]);
    }
    if (!hasText(group.departureTime)) {
      addFinding('pending_sales', 'missing_departure_time');
    }
    if (normalizeStoredTravelGroupLossStatus(group.lossStatus) === 'PENDING') {
      addFinding('pending_sales', 'loss_not_confirmed');
    }
  }

  const salesOrders = getEffectiveSalesOrders(group.salesOrders);
  if (salesOrders.length === 0 && !hasText(group.tasterSummary)) {
    addFinding('pending_taster', 'no_order_and_missing_taster_summary');
  }

  if (!group.financeMark && isAfterVisitDayEnd(group.visitDate, now)) {
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
      'pending_sales',
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

function normalizeStoredTravelGroupLossStatus(value: unknown) {
  const status = String(value || 'PENDING')
    .trim()
    .toUpperCase();
  return TRAVEL_GROUP_LOSS_STATUSES.has(status) ? status : 'PENDING';
}

function isAfterVisitDayEnd(value: unknown, now = new Date()) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return now.getTime() > end.getTime();
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
    productId: item.productId || null,
    productName: item.productName,
    quantity: Number(item.quantity || 0),
    unit: item.unit,
    note: item.note || null,
    sortOrder: Number(item.sortOrder || 0),
  };
}

function getSalesOrderInclude(options: any = {}): any {
  return {
    items: {
      include: {
        serializedInventoryUnits: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        inventoryReservations: {
          include: {
            assignments: {
              where: {
                status: { in: ['RESERVED', 'OUTBOUND'] },
              },
              include: {
                serializedUnit: true,
              },
              orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    },
    customer: true,
    travelGroup: getSalesOrderTravelGroupInclude(),
    personalPointsGuide: true,
    commissionRecords: getSalesOrderTasterCommissionInclude(),
    ...(options.includeSalesUser ? { salesUser: true } : {}),
  };
}

function getSalesOrderProfitInclude(): any {
  return {
    items: true,
    afterSalesOrders: true,
    commissionRecords: true,
  };
}

function getSalesOrderTravelGroupInclude(): any {
  return {};
}

function getSalesOrderTasterCommissionInclude(): any {
  return {
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
  };
}

function getAfterSalesOrderInclude(): any {
  return {
    salesOrder: {
      include: getSalesOrderInclude(),
    },
    afterSalesSalesOrder: {
      include: getSalesOrderInclude(),
    },
    customer: true,
    items: {
      orderBy: {
        sortOrder: 'asc',
      },
    },
  };
}

function toAfterSalesOrderDto(order: any, actor?: any) {
  return {
    id: order.id,
    afterSalesNo: order.afterSalesNo,
    sourceSalesOrderId: order.salesOrderId,
    sourceSalesOrder: order.salesOrder
      ? toSalesOrderDto(order.salesOrder)
      : null,
    afterSalesSalesOrderId: order.afterSalesSalesOrderId || null,
    afterSalesSalesOrder: order.afterSalesSalesOrder
      ? toSalesOrderDto(order.afterSalesSalesOrder)
      : null,
    items: (order.items || []).map(toAfterSalesOrderItemDto),
    deductionCalculationMode:
      order.deductionCalculationMode || 'manual_product_reference',
    sourceAgencyDeductionCents: Number(
      order.sourceAgencyDeductionCents || 0,
    ),
    agencyDeductionRate:
      order.agencyDeductionRate === null ||
      order.agencyDeductionRate === undefined
        ? null
        : Number(order.agencyDeductionRate),
    dailyRebateRate: Number(order.dailyRebateRate || 0),
    monthlyRebateRate: Number(order.monthlyRebateRate || 0),
    agencyDeductionRuleId: order.agencyDeductionRuleId || null,
    agencyRebateRuleId: order.agencyRebateRuleId || null,
    calculationDate: formatDate(order.calculationDate),
    agencyDeductionAdjustmentCents:
      order.agencyDeductionAdjustmentCents === null ||
      order.agencyDeductionAdjustmentCents === undefined
        ? null
        : Number(order.agencyDeductionAdjustmentCents),
    financialEffectStatus: String(
      order.financialEffectStatus || 'PENDING_CONFIRMATION',
    ).toLowerCase(),
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
    warehouseConfirmedById: order.warehouseConfirmedById || null,
    warehouseConfirmedAt: order.warehouseConfirmedAt
      ? toIsoString(order.warehouseConfirmedAt)
      : null,
    warehouseConfirmNote: order.warehouseConfirmNote || null,
    refundProofAttachments: getAfterSalesRefundProofAttachments(order).map(
      toAfterSalesRefundProofAttachmentDto,
    ),
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

function toAfterSalesOrderItemDto(item: any) {
  const expectedReturnQty = Number(item.expectedReturnQty || 0);
  const postedReceivedQty = Number(item.postedReceivedQty || 0);
  return {
    id: item.id,
    afterSalesOrderId: item.afterSalesOrderId,
    sourceSalesOrderItemId: item.sourceSalesOrderItemId || null,
    productId: item.productId || null,
    productName: item.productName,
    unit: item.unit || null,
    quantity: Number(item.quantity || 0),
    originalUnitPriceCents: Number(item.originalUnitPriceCents || 0),
    subtotalCents: Number(item.subtotalCents || 0),
    returnRequired: Boolean(item.returnRequired),
    expectedReturnQty,
    postedReceivedQty,
    remainingReturnQty: Math.max(
      0,
      expectedReturnQty - postedReceivedQty,
    ),
    returnProgressStatus: !item.returnRequired
      ? 'not_required'
      : postedReceivedQty <= 0
        ? 'waiting_receive'
        : postedReceivedQty < expectedReturnQty
          ? 'partially_received'
          : 'received',
    isHistoricalPlaceholder: Boolean(item.isHistoricalPlaceholder),
    notes: item.notes || null,
    sortOrder: Number(item.sortOrder || 0),
  };
}

function attachAfterSalesCommissionAndPointsImpact(
  order: any,
  impact: any,
) {
  return {
    ...order,
    __commissionAndPointsImpact: impact || null,
  };
}

function toAfterSalesOrderMutationResult(order: any) {
  const dto = toAfterSalesOrderDto(order);
  const impact = order?.__commissionAndPointsImpact || null;
  const warnings = Array.isArray(impact?.warnings) ? impact.warnings : [];
  const travelGroupIds = normalizeIdList(
    (impact?.summaryResults || []).map(
      (result: any) => result?.travelGroupId,
    ),
  );
  const pendingAfterSalesRefundAmountCents = Math.max(
    0,
    Number(
      impact?.recalculation?.calculation?.amounts
        ?.unconfirmedRefundAmountCents || 0,
    ),
  );
  return {
    afterSalesOrder: dto,
    warningCodes: warnings.map((warning: any) => warning.code),
    warnings,
    commissionAndPointsImpact: {
      refreshed: Boolean(impact?.recalculation),
      salesOrderId: order?.salesOrderId || null,
      afterSalesOrderId: order?.id || null,
      travelGroupIds,
      pendingAfterSalesRefundAmountCents,
      warningCodes: warnings.map((warning: any) => warning.code),
      warnings,
    },
  };
}

function toSalesOrderDto(order: any) {
  const tasterCommission = toSalesOrderTasterCommissionDto(order);
  const tasterCommissionCents = tasterCommission?.amountCents ?? 0;
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: ORDER_TYPE_FROM_PRISMA[order.orderType] || order.orderType,
    sourceSalesOrderId: order.sourceSalesOrderId || null,
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
    shippingDate: formatDate(order.shippingDate),
    shippingRiskWarnings: buildSalesOrderShippingRiskWarnings(order),
    canEditShippingDate: false,
    salesFormNo: order.salesFormNo || null,
    totalAmountCents: Number(order.totalAmountCents || 0),
    entryAmountCents: Number(
      order.entryAmountCents ?? order.totalAmountCents ?? 0,
    ),
    tasterCommissionCents,
    tasterCommission,
    tasterId: order.travelGroup?.tasterId || null,
    tasterName: order.travelGroup?.tasterName || null,
    cashOnDeliveryAmountCents: Number(order.cashOnDeliveryAmountCents || 0),
    deliverySummary: toSalesOrderDeliverySummary(order.items),
    logisticsMethod: order.logisticsMethod || null,
    logisticsProviderCode: normalizeLogisticsProviderCode(
      order.logisticsProviderCode,
      order.logisticsMethod,
    ),
    packingStatus: order.packingStatus
      ? String(order.packingStatus).toLowerCase()
      : null,
    packageCount: Number(order.packageCount || 0),
    warehouseRemark: order.warehouseRemark || null,
    hasPackingMark: Boolean(order.hasPackingMark),
    logisticsNo: order.logisticsNo || null,
    trackingState: order.trackingState || null,
    trackingStateLabel: order.trackingStateLabel || null,
    trackingLatestLocation: order.trackingLatestLocation || null,
    trackingLatestDescription: order.trackingLatestDescription || null,
    trackingEventAt: order.trackingEventAt
      ? toIsoString(order.trackingEventAt)
      : null,
    trackingCheckedAt: order.trackingCheckedAt
      ? toIsoString(order.trackingCheckedAt)
      : null,
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
    pointsDestination: String(
      order.pointsDestination || 'TRAVEL_AGENCY',
    ),
    personalPointsGuideId: order.personalPointsGuideId || null,
    personalPointsGuide: order.personalPointsGuide
      ? {
          id: order.personalPointsGuide.id,
          name: order.personalPointsGuide.name,
          phone: order.personalPointsGuide.phone,
          isActive: Boolean(order.personalPointsGuide.isActive),
        }
      : null,
    personalGuideNameSnapshot:
      order.personalGuideNameSnapshot || null,
    personalDailyRebateRate:
      order.personalDailyRebateRate === null ||
      order.personalDailyRebateRate === undefined
        ? null
        : order.personalDailyRebateRate.toString(),
    personalMonthlyRebateRate:
      order.personalMonthlyRebateRate === null ||
      order.personalMonthlyRebateRate === undefined
        ? null
        : order.personalMonthlyRebateRate.toString(),
    pointsDestinationChangedById:
      order.pointsDestinationChangedById || null,
    pointsDestinationChangedAt: order.pointsDestinationChangedAt
      ? toIsoString(order.pointsDestinationChangedAt)
      : null,
    personalRatesUpdatedById:
      order.personalRatesUpdatedById || null,
    personalRatesUpdatedAt: order.personalRatesUpdatedAt
      ? toIsoString(order.personalRatesUpdatedAt)
      : null,
    salesEditCount: Number(order.salesEditCount || 0),
    salesEditLimit: 1,
    salesEditRemaining: Math.max(
      0,
      1 - Number(order.salesEditCount || 0),
    ),
    salesEditedAt: order.salesEditedAt
      ? toIsoString(order.salesEditedAt)
      : null,
    canEditByCurrentUser: false,
    items: Array.isArray(order.items)
      ? order.items.map(toSalesOrderItemDto)
      : [],
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
  };
}

function toSalesOrderDtoForActor(order: any, actor: any) {
  const dto = {
    ...toSalesOrderDto(order),
    travelGroup: order.travelGroup
      ? toGroupDto(order.travelGroup, 'travel', actor)
      : null,
    canEditByCurrentUser: canEditSalesOrderForActor(order, actor),
    canEditShippingDate: canEditSalesOrderShippingDateForActor(
      order,
      actor,
    ),
    items: Array.isArray(order.items)
      ? order.items.map((item: any) =>
          toSalesOrderItemDto(item, actor),
        )
      : [],
  };
  if (actor?.role !== 'taster') {
    return dto;
  }
  return {
    ...dto,
    entryAmountCents: 0,
    tasterCommissionCents: 0,
    tasterCommission: null,
    financeRemark: null,
    financeMark: false,
    markedById: null,
    markedAt: null,
    customer: dto.customer
      ? {
          ...dto.customer,
          financeMark: false,
          markedById: null,
          markedAt: null,
        }
      : null,
  };
}

function canEditSalesOrderForActor(order: any, actor: any) {
  if (
    actor?.role === 'super_admin' ||
    actor?.role === 'admin' ||
    actor?.role === 'finance'
  ) {
    return true;
  }
  return (
    actor?.role === 'sales' &&
    order?.salesUserId === actor.id &&
    isWithinShanghaiToday(order?.createdAt) &&
    Number(order?.salesEditCount || 0) < 1
  );
}

function canEditSalesOrderShippingDateForActor(order: any, actor: any) {
  if (order?.packingStatus === 'PACKED') {
    return false;
  }
  if (
    actor?.role === 'finance' ||
    actor?.role === 'after_sales'
  ) {
    return true;
  }
  if (actor?.role === 'sales') {
    return order?.salesUserId === actor.id;
  }
  return actor?.role === 'warehouse' && isWarehouseReadableSalesOrder(order);
}

function buildSalesOrderShippingRiskWarnings(order: any) {
  const warnings: Array<{ code: string; message: string }> = [];
  if (
    isSameShanghaiNaturalDay(
      order?.shippingDate,
      order?.createdAt,
    )
  ) {
    warnings.push({
      code: 'SAME_DAY_SHIPPING',
      message: SAME_DAY_SHIPPING_WARNING,
    });
  }
  const hasInventoryShortage = (order?.items || []).some((item: any) =>
    (item?.inventoryReservations || []).some((reservation: any) => {
      const fulfilled =
        Number(reservation?.reservedQty || 0) +
        Number(reservation?.assignedQty || 0) +
        Number(reservation?.outboundQty || 0);
      return Number(reservation?.requestedQty || 0) > fulfilled;
    }),
  );
  if (hasInventoryShortage) {
    warnings.push({
      code: 'INVENTORY_SHORTAGE',
      message: '当前库存不足，订单可继续处理，请协调补货或调整仓库。',
    });
  }
  return warnings;
}

function toSalesOrderTasterCommissionDto(order: any) {
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

function toSalesOrderItemDto(item: any, actor?: any) {
  const dto: any = {
    id: item.id,
    productId: item.productId || null,
    productName: item.productName,
    unit: item.unit || null,
    quantity: Number(item.quantity || 0),
    unitPriceCents: Number(item.unitPriceCents || 0),
    subtotalCents: Number(item.subtotalCents || 0),
    deliveryType:
      DELIVERY_TYPE_FROM_PRISMA[item.deliveryType] || item.deliveryType,
    notes: item.notes || null,
    sortOrder: Number(item.sortOrder || 0),
  };
  if (
    !['super_admin', 'admin', 'warehouse'].includes(actor?.role)
  ) {
    return dto;
  }
  const reservation = Array.isArray(item.inventoryReservations)
    ? item.inventoryReservations[0]
    : null;
  if (!reservation) {
    return dto;
  }
  const assignments = Array.isArray(reservation.assignments)
    ? reservation.assignments.filter(
        (assignment: any) =>
          assignment.status === 'RESERVED' ||
          assignment.status === 'OUTBOUND',
      )
    : [];
  dto.inventoryLineKey = item.inventoryLineKey || null;
  dto.serializedFulfillment = {
    status: String(reservation.status || '').toLowerCase(),
    requestedQty: Number(reservation.requestedQty || 0),
    assignedQty: Number(reservation.assignedQty || 0),
    outboundQty: Number(reservation.outboundQty || 0),
    unassignedQty: Math.max(
      0,
      Number(reservation.requestedQty || 0) -
        Number(reservation.outboundQty || 0) -
        Number(reservation.assignedQty || 0),
    ),
    units: assignments.map((assignment: any) => ({
      assignmentStatus: String(
        assignment.status || '',
      ).toLowerCase(),
      ...toSalesOrderSerializedUnitDto(
        assignment.serializedUnit || {},
      ),
    })),
  };
  return dto;
}

function toSalesOrderSerializedUnitDto(unit: any) {
  return {
    id: unit.id,
    moutaiName: unit.moutaiName || null,
    logisticsCode: unit.logisticsCode || null,
    factoryDate: unit.factoryDate ? formatDate(unit.factoryDate) : null,
    productionBatch: unit.productionBatch || null,
    batchSerialNo: unit.batchSerialNo || null,
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
    sourceRegion: group.sourceRegion || '',
    ageInfo: group.ageInfo || '',
    licensePlate: group.licensePlate || '',
    guideName: group.guideName || '',
    guidePhone: group.guidePhone || '',
    adultCount: Number(group.adultCount || 0),
    childCount: Number(group.childCount || 0),
    guestCount: Number(group.guestCount || 0),
    tastingRoomNo: group.tastingRoomNo || '',
    tasterName: group.tasterName || '',
    liaisonTasterName: group.liaisonTasterName || '',
    expectedArrivalTime: group.expectedArrivalTime || '',
    arrivalTime: group.arrivalTime || '',
    departureTime: group.departureTime || '',
    groupType: group.groupType || '',
    mentionedFeitian: nullableBooleanLabel(group.mentionedFeitian),
    previousStopOrderStatus: group.previousStopOrderStatus || '',
    keyCustomerInfo: group.keyCustomerInfo || '',
    keyCustomerPhotoCount: Array.isArray(group.keyCustomerPhotos)
      ? group.keyCustomerPhotos.length
      : 0,
    guestInfoAttachmentCount: Array.isArray(group.guestInfoAttachments)
      ? group.guestInfoAttachments.length
      : 0,
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
    shippingDate: formatDate(order.shippingDate) || '',
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

function nullableBooleanLabel(value: unknown) {
  if (typeof value !== 'boolean') {
    return '';
  }
  return booleanLabel(value);
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

function buildSalesOrderQrCodeResponse(
  order: any,
  baseUrl: unknown,
  rawToken: unknown,
) {
  const publicUrl = buildPublicSalesSheetUrl(baseUrl, rawToken);
  const salesSheet = buildSalesSheetDto(order, {
    publicToken: normalizeOptionalString(rawToken),
    publicUrl,
  });
  return {
    salesSheet,
    qrCode: salesSheet.qrCode,
  };
}

function buildPublicSalesSheetUnavailableResult() {
  return {
    statusCode: 404,
    html: renderPublicSalesSheetErrorHtml({
      title: '销售单暂不可用',
      message: '此链接无效或已失效，请联系销售人员重新获取。',
    }),
  };
}

function toSalesOrderQrCodeLogDto(order: any) {
  return {
    id: order?.id || null,
    orderNo: order?.orderNo || null,
    salesUserId: order?.salesUserId || null,
    qrCode: {
      tokenPresent: hasText(order?.qrCodeTokenHash),
      tokenFingerprint: buildQrCodeTokenFingerprint(order?.qrCodeTokenHash),
      generatedAt: toIsoString(order?.qrCodeGeneratedAt),
      expiresAt: toIsoString(order?.qrCodeExpiresAt),
      revokedAt: toIsoString(order?.qrCodeRevokedAt),
    },
  };
}

function buildAggregatedReconciliationDto(
  businessDate: string,
  orders: any[],
  refunds: any[],
  manual: any,
) {
  const calculation = calculateReconciliation({
    businessDate,
    orders,
    refunds,
    manual,
  });
  const storedReviewStatus =
    String(manual?.reviewStatus || '').toUpperCase() === 'REVIEWED'
      ? 'REVIEWED'
      : 'PENDING_REVIEW';
  const reviewIsStale =
    storedReviewStatus === 'REVIEWED' &&
    String(manual?.reviewSourceHash || '') !== calculation.sourceHash;
  const reviewStatus = reviewIsStale
    ? 'pending_review'
    : storedReviewStatus === 'REVIEWED'
      ? 'reviewed'
      : 'pending_review';
  const status =
    reviewStatus === 'pending_review'
      ? 'pending_review'
      : calculation.differenceCents === 0
        ? 'balanced'
        : 'difference';
  const paymentMethods = normalizedReconciliationPaymentMethods(
    manual?.paymentMethods,
  );

  return {
    id: manual?.id || null,
    businessDate,
    timezone: RECONCILIATION_TIMEZONE,
    travelGroupSalesCents: calculation.travelGroupSalesCents,
    backOfficeSalesCents: calculation.backOfficeSalesCents,
    buybackCents: calculation.buybackCents,
    externalSalesCents: calculation.externalSalesCents,
    internalPurchaseCents: calculation.internalPurchaseCents,
    afterSalesCents: calculation.afterSalesCents,
    refundsCents: calculation.refundsCents,
    receivableTotalCents: calculation.receivableTotalCents,
    actualTotalCents: calculation.actualTotalCents,
    differenceCents: calculation.differenceCents,
    reviewStatus,
    status,
    reviewIsStale,
    reviewedById: manual?.reviewedById || null,
    reviewedByName: manual?.reviewedBy?.name || null,
    reviewedAt: manual?.reviewedAt
      ? toIsoString(manual.reviewedAt)
      : null,
    notes: manual?.notes || null,
    paymentMethods,
    createdAt: manual?.createdAt ? toIsoString(manual.createdAt) : null,
    updatedAt: manual?.updatedAt ? toIsoString(manual.updatedAt) : null,
  };
}

function toReconciliationManualAuditDto(row: any) {
  return {
    id: row?.id || null,
    businessDate: formatDatabaseDate(row?.businessDate),
    backOfficeSalesCents: Number(row?.backOfficeSalesCents || 0),
    notes: row?.notes || null,
    paymentMethods: normalizedReconciliationPaymentMethods(
      row?.paymentMethods,
    ),
    reviewStatus:
      String(row?.reviewStatus || '').toUpperCase() === 'REVIEWED'
        ? 'reviewed'
        : 'pending_review',
    reviewedById: row?.reviewedById || null,
    reviewedByName: row?.reviewedBy?.name || null,
    reviewedAt: row?.reviewedAt ? toIsoString(row.reviewedAt) : null,
  };
}

function normalizedReconciliationPaymentMethods(methods: unknown) {
  return (Array.isArray(methods) ? methods : [])
    .slice()
    .sort(
      (left: any, right: any) =>
        Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0),
    )
    .map((method: any) => ({
      id: method?.id || null,
      name: String(method?.name || ''),
      amountCents: Number(method?.amountCents || 0),
      sortOrder: Number(method?.sortOrder || 0),
    }));
}

function groupFactsByBusinessDate(
  facts: any[],
  dateForFact: (fact: any) => string | null,
) {
  const grouped = new Map<string, any[]>();
  for (const fact of Array.isArray(facts) ? facts : []) {
    const businessDate = dateForFact(fact);
    if (!businessDate) {
      continue;
    }
    const rows = grouped.get(businessDate) || [];
    rows.push(fact);
    grouped.set(businessDate, rows);
  }
  return grouped;
}

function requireReconciliationBusinessDate(value: unknown, fieldName: string) {
  const businessDate = normalizeReconciliationBusinessDate(value);
  if (!businessDate) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be a valid YYYY-MM-DD date.`,
    );
  }
  return businessDate;
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

function getShanghaiTodayBusinessDate(now = new Date()) {
  return formatShanghaiBusinessDate(now)!;
}

function getShanghaiTodayDate(now = new Date()) {
  return new Date(`${getShanghaiTodayBusinessDate(now)}T00:00:00.000Z`);
}

function getShanghaiTodayCreatedAtRange(now = new Date()) {
  const range = buildShanghaiNaturalDayRange(
    getShanghaiTodayBusinessDate(now),
  )!;
  return {
    start: range.start,
    end: new Date(range.end.getTime() + 1),
  };
}

function isWithinShanghaiToday(value: unknown, now = new Date()) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const range = getShanghaiTodayCreatedAtRange(now);
  return date >= range.start && date < range.end;
}

function assertSalesCanUseTravelGroup(actor: any, travelGroup: any) {
  if (actor?.role !== 'sales') {
    return;
  }
  if (
    formatDate(travelGroup?.visitDate) === getShanghaiTodayBusinessDate()
  ) {
    return;
  }
  throw createHttpError(
    403,
    'SALES_ORDER_TRAVEL_GROUP_DATE_NOT_ALLOWED',
    'Sales can only create or edit orders for today travel groups.',
  );
}

async function claimSalesOrderEditOpportunity(
  tx: any,
  actor: any,
  id: string,
  now: Date,
) {
  const range = getShanghaiTodayCreatedAtRange(now);
  const result = await tx.salesOrder.updateMany({
    where: {
      id,
      salesUserId: actor.id,
      createdAt: {
        gte: range.start,
        lt: range.end,
      },
      salesEditCount: {
        lt: 1,
      },
    },
    data: {
      salesEditCount: {
        increment: 1,
      },
      salesEditedAt: now,
      updatedById: actor.id,
      updatedAt: now,
    },
  });
  if (Number(result?.count || 0) !== 1) {
    throw createHttpError(
      409,
      'SALES_ORDER_EDIT_LIMIT_REACHED',
      'The sales order edit opportunity has already been used.',
    );
  }
}

async function recordTravelGroupTasterEditActivity(
  tx: any,
  actor: any,
  id: string,
  now: Date,
) {
  if (actor?.role !== 'taster') {
    return;
  }
  const result = await tx.travelGroup.updateMany({
    where: {
      id,
      visitDate: getShanghaiTodayDate(now),
      OR: [
        { tasterId: actor.id },
        { liaisonTasterId: actor.id },
      ],
    },
    data: {
      tasterLastEditedAt: now,
      updatedById: actor.id,
      updatedAt: now,
    },
  });
  if (Number(result?.count || 0) === 1) {
    return;
  }
  const current = await tx.travelGroup.findUnique({
    where: {
      id,
    },
  });
  if (current) {
    assertTasterCanEditTravelGroup(actor, current);
  }
  throw createHttpError(
    404,
    'TRAVEL_GROUP_NOT_FOUND',
    'Travel group does not exist.',
  );
}

function assertTasterCanEditTravelGroup(actor: any, current: any) {
  if (actor?.role !== 'taster') {
    return;
  }
  if (
    formatDate(current?.visitDate) !== getShanghaiTodayBusinessDate()
  ) {
    throw createHttpError(
      403,
      'TRAVEL_GROUP_EDIT_DATE_NOT_ALLOWED',
      'Tasters can only edit travel groups scheduled for today.',
    );
  }
  if (
    current?.tasterId === actor.id ||
    current?.liaisonTasterId === actor.id
  ) {
    return;
  }
  throw createHttpError(
    403,
    'PERMISSION_DENIED',
    'Taster is not assigned to this travel group.',
  );
}

function assertTravelGroupCreateAllowedFields(actor: any, payload: any) {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.prototype.hasOwnProperty.call(payload, 'parkingFeeCents')
  ) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      'parkingFeeCents is managed by the server.',
    );
  }
  if (actor?.role === 'front_desk') {
    const salesFields = ['departureTime', 'tastingItems', 'lossStatus'].filter(
      (field) => hasOwn(payload, field),
    );
    if (salesFields.length > 0) {
      throw createHttpError(
        403,
        'FIELD_PERMISSION_DENIED',
        `Fields are not allowed for front_desk: ${salesFields.join(', ')}.`,
      );
    }
  }
  const serverManagedAttachmentFields = [
    'keyCustomerPhotos',
    'guestInfoAttachments',
  ].filter((field) =>
    Object.prototype.hasOwnProperty.call(payload || {}, field),
  );
  if (serverManagedAttachmentFields.length > 0) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      `Attachment fields must use the attachment API: ${serverManagedAttachmentFields.join(', ')}.`,
    );
  }
  if (
    actor?.role === 'front_desk' &&
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.prototype.hasOwnProperty.call(payload, 'expectedArrivalTime')
  ) {
    throw createHttpError(
      403,
      'FIELD_PERMISSION_DENIED',
      'expectedArrivalTime is not allowed for front_desk.',
    );
  }
}

function assertTravelGroupPatchAllowedFields(
  actor: any,
  payload: any,
  current: any,
) {
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

function assertSalesCanEditTravelGroup(actor: any, current: any) {
  if (actor?.role !== 'sales') {
    return;
  }
  if (canSalesHandleTravelGroup(current)) {
    return;
  }
  throw createHttpError(
    403,
    'TRAVEL_GROUP_SALES_EDIT_NOT_ALLOWED',
    'Sales can only edit today travel groups or overdue pending sales groups.',
  );
}

function buildSalesTravelGroupScope(now = new Date()) {
  const today = getShanghaiTodayDate(now);
  return {
    OR: [
      { visitDate: today },
      {
        visitDate: { lt: today },
        OR: [
          { departureTime: null },
          { departureTime: '' },
          { lossStatus: 'PENDING' },
        ],
      },
    ],
  };
}

function canSalesHandleTravelGroup(group: any, now = new Date()) {
  const visitDate = formatDate(group?.visitDate);
  const today = getShanghaiTodayBusinessDate(now);
  if (visitDate === today) {
    return true;
  }
  return (
    Boolean(visitDate) &&
    visitDate! < today &&
    (!hasText(group?.departureTime) ||
      normalizeStoredTravelGroupLossStatus(group?.lossStatus) === 'PENDING')
  );
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

function assignNullableBoolean(data: any, key: string, value: unknown) {
  if (value === undefined) {
    return;
  }
  data[key] =
    value === null || value === '' ? null : normalizeBoolean(value, key);
}

function assignOptionalClockTime(data: any, key: string, value: unknown) {
  if (value === undefined) {
    return;
  }
  const normalized = normalizeOptionalString(value);
  if (normalized === null) {
    data[key] = null;
    return;
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${key} must use HH:mm format.`,
    );
  }
  data[key] = normalized;
}

function assignOptionalTravelGroupType(data: any, value: unknown) {
  if (value === undefined) {
    return;
  }
  const normalized = normalizeOptionalString(value);
  if (normalized !== null && !TRAVEL_GROUP_TYPES.has(normalized)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'groupType must be a supported travel group type.',
    );
  }
  data.groupType = normalized;
}

function assertDepartureNotBeforeArrival(
  arrivalTime: unknown,
  departureTime: unknown,
) {
  const arrivalMinutes = parseClockMinutes(arrivalTime);
  const departureMinutes = parseClockMinutes(departureTime);
  if (
    arrivalMinutes !== null &&
    departureMinutes !== null &&
    departureMinutes < arrivalMinutes
  ) {
    throw createHttpError(
      400,
      'DEPARTURE_BEFORE_ARRIVAL',
      'departureTime must not be earlier than arrivalTime.',
    );
  }
}

function isValidClockTime(value: unknown) {
  return (
    typeof value === 'string' &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim())
  );
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

function normalizeStrictBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
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

function normalizeCentsAmount(
  value: unknown,
  fieldName: string,
  minimum: number,
) {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} is required.`,
    );
  }
  const numberValue = Number(value);
  if (
    !Number.isSafeInteger(numberValue) ||
    numberValue < minimum ||
    numberValue > 2147483647
  ) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${fieldName} must be an integer between ${minimum} and 2147483647.`,
    );
  }
  return numberValue;
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

async function findActiveTasterUser(
  prisma: any,
  id: string,
  fieldName: 'tasterId' | 'liaisonTasterId',
) {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
  });
  const isLiaison = fieldName === 'liaisonTasterId';
  if (!user) {
    throw createHttpError(
      404,
      isLiaison ? 'LIAISON_TASTER_NOT_FOUND' : 'TASTER_NOT_FOUND',
      `${fieldName} does not reference an existing user.`,
    );
  }
  if (!isActiveTasterUser(user)) {
    throw createHttpError(
      400,
      isLiaison ? 'INVALID_LIAISON_TASTER' : 'INVALID_TASTER',
      `${fieldName} must reference an active taster user.`,
    );
  }
  return user;
}

async function findActiveRoleUser(
  prisma: any,
  id: string,
  fieldName: string,
  roles: string[],
) {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
  });
  if (!user) {
    throw createHttpError(
      404,
      'ASSIGNEE_NOT_FOUND',
      `${fieldName} does not reference an existing user.`,
    );
  }
  if (!Boolean(user.isActive) || !roles.includes(String(user.role || ''))) {
    throw createHttpError(
      400,
      'INVALID_ASSIGNEE',
      `${fieldName} must reference an active user with an allowed role.`,
    );
  }
  return user;
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

export const serializedInventoryOrderTestHooks = {
  buildSalesOrderItems,
  resolveSalesOrderItemSnapshots,
  toSalesOrderItemCreateData,
  toSalesOrderItemDto,
};

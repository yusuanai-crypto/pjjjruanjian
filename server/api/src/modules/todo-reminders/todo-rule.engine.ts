import {
  buildFinancePendingLogisticsReasons,
  calculateGroupPendingState,
} from '../business-data/business-data.nest.service';

export type TodoSourceType =
  | 'TRAVEL_GROUP'
  | 'SALES_ORDER'
  | 'AFTER_SALES_ORDER'
  | 'INVENTORY_ALERT'
  | 'STOCKTAKE';
export type TodoPriority = 'NORMAL' | 'IMPORTANT' | 'URGENT';
export type TodoStatus = 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
export type TodoTargetRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'BOSS'
  | 'FRONT_DESK'
  | 'TASTER'
  | 'FINANCE'
  | 'WAREHOUSE'
  | 'SALES'
  | 'AFTER_SALES';

export interface TodoRuleMatch {
  ruleCode: string;
  sourceType: TodoSourceType;
  sourceId: string;
  sourceNumber: string;
  targetRole: TodoTargetRole;
  title: string;
  content: string;
  priority: TodoPriority;
  slaHours: number;
}

const EFFECTIVE_SALES_ORDER_STATUSES = new Set(['VALID', 'PARTIAL_REFUND']);

export class TodoRuleEngine {
  evaluate(
    sourceType: TodoSourceType,
    source: any,
    now = new Date(),
  ): TodoRuleMatch[] {
    if (!source?.id) {
      return [];
    }
    switch (sourceType) {
      case 'TRAVEL_GROUP':
        return this.evaluateTravelGroup(source, now);
      case 'SALES_ORDER':
        return this.evaluateSalesOrder(source);
      case 'AFTER_SALES_ORDER':
        return this.evaluateAfterSalesOrder(source);
      case 'INVENTORY_ALERT':
        return this.evaluateInventoryAlert(source);
      case 'STOCKTAKE':
        return this.evaluateStocktake(source);
      default:
        return [];
    }
  }

  resolutionStatus(sourceType: TodoSourceType, source: any): TodoStatus {
    if (!source) {
      return 'CANCELLED';
    }
    if (
      sourceType === 'SALES_ORDER' &&
      ['CANCELLED', 'REFUNDED'].includes(String(source.status || '').toUpperCase())
    ) {
      return 'CANCELLED';
    }
    if (
      sourceType === 'INVENTORY_ALERT' &&
      String(source.status || '').toUpperCase() === 'CANCELLED'
    ) {
      return 'CANCELLED';
    }
    return 'RESOLVED';
  }

  dueAt(priority: TodoPriority, detectedAt = new Date()): Date {
    const hours =
      priority === 'URGENT' ? 2 : priority === 'IMPORTANT' ? 8 : 24;
    return new Date(detectedAt.getTime() + hours * 60 * 60 * 1000);
  }

  private evaluateTravelGroup(group: any, now: Date): TodoRuleMatch[] {
    const pending = calculateGroupPendingState(group, 'travel', now);
    const reasons = new Set<string>(pending.reasons || []);
    const sourceNumber = safeSourceNumber(group.groupNo, group.id);
    const matches: TodoRuleMatch[] = [];
    const frontDeskReasons = [
      'missing_license_plate',
      'missing_guest_count',
      'missing_cigarette_fee',
      'missing_tasting_room_no',
      'missing_taster',
      'missing_arrival_time',
      'missing_group_type',
    ].filter((reason) => reasons.has(reason));
    if (frontDeskReasons.length > 0) {
      matches.push(
        match({
          ruleCode: 'TRAVEL_GROUP_FRONT_DESK_DETAILS',
          sourceType: 'TRAVEL_GROUP',
          source: group,
          sourceNumber,
          targetRole: 'FRONT_DESK',
          title: '旅行团资料待补充',
          content: `旅行团 ${sourceNumber} 尚有资料需要补充。`,
          priority: 'NORMAL',
        }),
      );
    }

    const salesReasons = [
      'missing_departure_time',
      'loss_not_confirmed',
    ].filter((reason) => reasons.has(reason));
    if (pending.status === 'pending_sales' && salesReasons.length > 0) {
      matches.push(
        match({
          ruleCode: 'TRAVEL_GROUP_SALES_COMPLETION',
          sourceType: 'TRAVEL_GROUP',
          source: group,
          sourceNumber,
          targetRole: 'SALES',
          title: '旅行团离店与损耗待补充',
          content: `旅行团 ${sourceNumber} 尚未完成离店时间或损耗确认。`,
          priority: 'IMPORTANT',
        }),
      );
    }

    if (
      reasons.has('no_order_and_missing_taster_summary') &&
      hasReachedTravelGroupHandlingTime(group, now)
    ) {
      matches.push(
        match({
          ruleCode: 'TRAVEL_GROUP_TASTER_SUMMARY',
          sourceType: 'TRAVEL_GROUP',
          source: group,
          sourceNumber,
          targetRole: 'TASTER',
          title: '品鉴总结待填写',
          content: `旅行团 ${sourceNumber} 尚未填写品鉴总结。`,
          priority: 'NORMAL',
        }),
      );
    }

    if (reasons.has('finance_unmarked_after_day_end')) {
      matches.push(
        match({
          ruleCode: 'TRAVEL_GROUP_FINANCE_MARK',
          sourceType: 'TRAVEL_GROUP',
          source: group,
          sourceNumber,
          targetRole: 'FINANCE',
          title: '旅行团待财务标记',
          content: `旅行团 ${sourceNumber} 已结束接待，等待财务标记。`,
          priority: 'IMPORTANT',
        }),
      );
    }
    return matches;
  }

  private evaluateSalesOrder(order: any): TodoRuleMatch[] {
    const status = String(order.status || '').toUpperCase();
    const sourceNumber = safeSourceNumber(order.orderNo, order.id);
    const matches: TodoRuleMatch[] = [];
    const hasOrderShortage = (
      Array.isArray(order.inventoryAlerts)
        ? order.inventoryAlerts
        : []
    ).some(
      (alert: any) =>
        String(alert?.type || '').toUpperCase() ===
          'ORDER_SHORTAGE' &&
        String(alert?.status || '').toUpperCase() === 'ACTIVE',
    );
    if (hasOrderShortage) {
      for (const target of [
        {
          ruleCode: 'INVENTORY_ORDER_SHORTAGE_WAREHOUSE',
          targetRole: 'WAREHOUSE',
        },
        {
          ruleCode: 'INVENTORY_ORDER_SHORTAGE_ADMIN',
          targetRole: 'ADMIN',
        },
        {
          ruleCode: 'INVENTORY_ORDER_SHORTAGE_SUPER_ADMIN',
          targetRole: 'SUPER_ADMIN',
        },
      ] as const) {
        matches.push(
          match({
            ruleCode: target.ruleCode,
            sourceType: 'SALES_ORDER',
            source: order,
            sourceNumber,
            targetRole: target.targetRole,
            title: '订单库存待处理',
            content: `销售订单 ${sourceNumber} 存在库存待处理事项，请在库存模块处理。`,
            priority: 'IMPORTANT',
          }),
        );
      }
    }
    if (!EFFECTIVE_SALES_ORDER_STATUSES.has(status)) {
      return matches;
    }
    const items = Array.isArray(order.items) ? order.items : [];
    const hasShippingItem = items.some(
      (item: any) =>
        String(item?.deliveryType || '').toUpperCase() === 'SHIPPING',
    );
    const packingStatus = String(order.packingStatus || '').toUpperCase();
    if (
      hasShippingItem &&
      ['PENDING', 'PACKING', 'ABNORMAL'].includes(packingStatus)
    ) {
      matches.push(
        match({
          ruleCode: 'SALES_ORDER_WAREHOUSE_FULFILLMENT',
          sourceType: 'SALES_ORDER',
          source: order,
          sourceNumber,
          targetRole: 'WAREHOUSE',
          title:
            packingStatus === 'ABNORMAL'
              ? '邮寄订单履行异常'
              : '邮寄订单待库管处理',
          content: `销售订单 ${sourceNumber} 等待库管处理。`,
          priority: packingStatus === 'ABNORMAL' ? 'URGENT' : 'IMPORTANT',
        }),
      );
    }

    if (packingStatus === 'ABNORMAL') {
      matches.push(
        match({
          ruleCode: 'SALES_ORDER_SALES_FULFILLMENT_ABNORMAL',
          sourceType: 'SALES_ORDER',
          source: order,
          sourceNumber,
          targetRole: 'SALES',
          title: '订单履行异常待关注',
          content: `销售订单 ${sourceNumber} 的履行状态异常。`,
          priority: 'URGENT',
        }),
      );
    }

    const financeReasons = new Set(
      buildFinancePendingLogisticsReasons(order),
    );
    if (financeReasons.has('missing_logistics_no')) {
      matches.push(
        financeOrderMatch(
          order,
          sourceNumber,
          'SALES_ORDER_FINANCE_LOGISTICS_NO',
          '邮寄订单待补物流单号',
        ),
      );
    }
    if (financeReasons.has('missing_logistics_fee')) {
      matches.push(
        financeOrderMatch(
          order,
          sourceNumber,
          'SALES_ORDER_FINANCE_LOGISTICS_FEE',
          '邮寄订单待填写物流费用',
        ),
      );
    }
    if (financeReasons.has('pending_invoice')) {
      matches.push(
        financeOrderMatch(
          order,
          sourceNumber,
          'SALES_ORDER_FINANCE_INVOICE',
          '订单发票待开具',
        ),
      );
    }
    return matches;
  }

  private evaluateAfterSalesOrder(order: any): TodoRuleMatch[] {
    const status = String(order.status || '').toUpperCase();
    if (status === 'COMPLETED') {
      return [];
    }
    const sourceNumber = safeSourceNumber(order.afterSalesNo, order.id);
    const priority: TodoPriority =
      status === 'WAITING_REFUND' ? 'URGENT' : 'IMPORTANT';
    const matches: TodoRuleMatch[] = [
      match({
        ruleCode: 'AFTER_SALES_HANDLE',
        sourceType: 'AFTER_SALES_ORDER',
        source: order,
        sourceNumber,
        targetRole: 'AFTER_SALES',
        title: '售后事项待处理',
        content: `售后单 ${sourceNumber} 尚未处理完成。`,
        priority,
      }),
    ];

    if (
      ['WAITING_RECEIVE', 'WAITING_RESEND'].includes(status) &&
      !order.warehouseConfirmedAt
    ) {
      matches.push(
        match({
          ruleCode: 'AFTER_SALES_WAREHOUSE_HANDLE',
          sourceType: 'AFTER_SALES_ORDER',
          source: order,
          sourceNumber,
          targetRole: 'WAREHOUSE',
          title: '售后事项待库管处理',
          content: `售后单 ${sourceNumber} 等待库管确认。`,
          priority: 'IMPORTANT',
        }),
      );
    }
    if (status === 'WAITING_REFUND' && !order.financeConfirmed) {
      matches.push(
        match({
          ruleCode: 'AFTER_SALES_FINANCE_REFUND',
          sourceType: 'AFTER_SALES_ORDER',
          source: order,
          sourceNumber,
          targetRole: 'FINANCE',
          title: '售后退款待财务确认',
          content: `售后单 ${sourceNumber} 等待财务退款确认。`,
          priority: 'URGENT',
        }),
      );
    }
    return matches;
  }

  private evaluateInventoryAlert(alert: any): TodoRuleMatch[] {
    if (String(alert.status || '').toUpperCase() !== 'ACTIVE') {
      return [];
    }
    const type = String(alert.type || '').toUpperCase();
    const sourceNumber = safeSourceNumber(
      alert.sourceNumber,
      alert.id,
    );
    const definitions: Record<
      string,
      {
        title: string;
        content: string;
        priority: TodoPriority;
        roles: TodoTargetRole[];
      }
    > = {
      LOW_STOCK: {
        title: '库存低于最低库存',
        content: `仓库商品 ${sourceNumber} 需要补货处理。`,
        priority: 'IMPORTANT',
        roles: inventoryGlobalRoles('WAREHOUSE'),
      },
      NEGATIVE_AVAILABLE: {
        title: '库存缺货待处理',
        content: `仓库商品 ${sourceNumber} 存在缺货，请在库存模块处理。`,
        priority: 'URGENT',
        roles: inventoryGlobalRoles('WAREHOUSE'),
      },
      PENDING_COST: {
        title: '库存采购成本待补录',
        content: `仓库商品 ${sourceNumber} 存在待补成本库存，请在库存模块处理。`,
        priority: 'IMPORTANT',
        roles: inventoryGlobalRoles('FINANCE'),
      },
      ORDER_SHORTAGE: {
        title: '订单库存待配',
        content: `仓库商品 ${sourceNumber} 存在订单履约待配事项，请在库存模块处理。`,
        priority: 'IMPORTANT',
        roles: inventoryGlobalRoles('WAREHOUSE'),
      },
      TRANSFER_OVERDUE: {
        title: '调拨逾期待收货',
        content: `仓库商品 ${sourceNumber} 存在逾期待收货调拨，请在库存模块处理。`,
        priority: 'URGENT',
        roles: inventoryGlobalRoles('WAREHOUSE'),
      },
    };
    const definition = definitions[type];
    if (!definition) {
      return [];
    }
    return definition.roles.map((targetRole) =>
      match({
        ruleCode: `INVENTORY_${type}_${targetRole}`,
        sourceType: 'INVENTORY_ALERT',
        source: alert,
        sourceNumber,
        targetRole,
        title: definition.title,
        content: definition.content,
        priority: definition.priority,
      }),
    );
  }

  private evaluateStocktake(stocktake: any): TodoRuleMatch[] {
    if (String(stocktake.status || '').toUpperCase() !== 'SUBMITTED') {
      return [];
    }
    const sourceNumber = safeSourceNumber(
      stocktake.stocktakeNo,
      stocktake.id,
    );
    return (['BOSS', 'ADMIN', 'SUPER_ADMIN'] as TodoTargetRole[]).map(
      (targetRole) =>
        match({
          ruleCode: `INVENTORY_STOCKTAKE_APPROVAL_${targetRole}`,
          sourceType: 'STOCKTAKE',
          source: stocktake,
          sourceNumber,
          targetRole,
          title: '库存盘点待审批',
          content: `盘点单 ${sourceNumber} 等待审批，请在库存模块处理。`,
          priority: 'IMPORTANT',
        }),
    );
  }
}

function inventoryGlobalRoles(
  specialist: 'WAREHOUSE' | 'FINANCE',
): TodoTargetRole[] {
  return [specialist, 'BOSS', 'ADMIN', 'SUPER_ADMIN'];
}

function match(input: {
  ruleCode: string;
  sourceType: TodoSourceType;
  source: any;
  sourceNumber: string;
  targetRole: TodoTargetRole;
  title: string;
  content: string;
  priority: TodoPriority;
}): TodoRuleMatch {
  return {
    ruleCode: input.ruleCode,
    sourceType: input.sourceType,
    sourceId: input.source.id,
    sourceNumber: input.sourceNumber,
    targetRole: input.targetRole,
    title: input.title,
    content: input.content,
    priority: input.priority,
    slaHours:
      input.priority === 'URGENT'
        ? 2
        : input.priority === 'IMPORTANT'
          ? 8
          : 24,
  };
}

function financeOrderMatch(
  order: any,
  sourceNumber: string,
  ruleCode: string,
  title: string,
): TodoRuleMatch {
  return match({
    ruleCode,
    sourceType: 'SALES_ORDER',
    source: order,
    sourceNumber,
    targetRole: 'FINANCE',
    title,
    content: `销售订单 ${sourceNumber} 等待财务处理。`,
    priority: 'IMPORTANT',
  });
}

function safeSourceNumber(value: unknown, fallback: unknown): string {
  const text = String(value || '').trim();
  return text.slice(0, 80) || String(fallback || '').slice(0, 36);
}

function hasReachedTravelGroupHandlingTime(group: any, now: Date): boolean {
  const visitDate = dateOnly(group?.visitDate);
  if (!visitDate) {
    return false;
  }
  const clock =
    parseClock(group?.expectedArrivalTime) ||
    parseClock(group?.arrivalTime) ||
    '00:00';
  const handlingAt = new Date(`${visitDate}T${clock}:00+08:00`);
  return Number.isFinite(handlingAt.getTime()) && now >= handlingAt;
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  const matchValue = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return matchValue?.[1] || null;
}

function parseClock(value: unknown): string | null {
  const matchValue = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!matchValue) {
    return null;
  }
  const hours = Number(matchValue[1]);
  const minutes = Number(matchValue[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

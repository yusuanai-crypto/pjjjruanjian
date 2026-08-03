import { PROFIT_TAX_RATE } from './profit-tax-service-fee.helper';

export interface ProfitFeeSnapshotRepairIssue {
  code: string;
  message: string;
  actionHint: string;
  orderId: string;
  orderNo: string;
  paymentDetailId?: string | null;
}

export interface ProfitFeeSnapshotRepairResult {
  orderId: string;
  orderNo: string;
  changedCount: number;
  issues: ProfitFeeSnapshotRepairIssue[];
}

export async function repairOrderProfitFeeSnapshots(
  prisma: any,
  salesOrderId: string,
  options: { actorId?: string | null; now?: Date } = {},
): Promise<ProfitFeeSnapshotRepairResult> {
  const now = options.now || new Date();
  const order = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      paymentDetails: {
        include: { paymentMethod: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!order) {
    return missingOrderResult(salesOrderId);
  }
  const context = {
    orderId: String(order.id),
    orderNo: String(order.orderNo || order.id),
  };
  const financeMarked = order.financeMark === true;
  const paymentDetails = Array.isArray(order.paymentDetails)
    ? order.paymentDetails
    : [];
  const issues: ProfitFeeSnapshotRepairIssue[] = [];
  if (paymentDetails.length === 0) {
    issues.push(
      issue(
        context,
        'PAYMENT_DETAILS_MISSING',
        '订单缺少付款明细，付款手续费无法计算。',
        '请补齐付款明细或配置付款方式手续费率。',
      ),
    );
  }
  const paymentTotalCents = paymentDetails.reduce(
    (sum: number, detail: any) => sum + integerCents(detail?.amountCents),
    0,
  );
  if (
    paymentDetails.length > 0 &&
    paymentTotalCents !== integerCents(order.totalAmountCents)
  ) {
    issues.push(
      issue(
        context,
        'PAYMENT_TOTAL_MISMATCH',
        '收款明细合计与订单总额不一致。',
        '请补齐付款明细并核对每条付款金额。',
      ),
    );
  }
  for (const detail of paymentDetails) {
    if (
      detail?.serviceFeeRateSnapshot == null &&
      (!detail?.paymentMethodId || !detail?.paymentMethod)
    ) {
      issues.push(
        issue(
          context,
          'PAYMENT_METHOD_MISSING',
          '收款明细关联的付款方式不存在。',
          '请补齐付款明细或配置付款方式手续费率。',
          detail?.id,
        ),
      );
      continue;
    }
    if (
      detail.serviceFeeRateSnapshot == null &&
      normalizeRate(detail.paymentMethod.serviceFeeRate) == null
    ) {
      issues.push(
        issue(
          context,
          'PAYMENT_METHOD_SERVICE_FEE_RATE_REQUIRED',
          '付款明细的手续费率快照和付款方式当前手续费率均缺失。',
          '请补齐付款明细或配置付款方式手续费率。',
          detail.id,
        ),
      );
    }
  }
  if (issues.length > 0) {
    return { ...context, changedCount: 0, issues };
  }
  if (!financeMarked) {
    return { ...context, changedCount: 0, issues: [] };
  }

  let changedCount = 0;
  if (order.taxRateSnapshot == null) {
    const result = await prisma.salesOrder.updateMany({
      where: { id: order.id, financeMark: true, taxRateSnapshot: null },
      data: { taxRateSnapshot: PROFIT_TAX_RATE },
    });
    changedCount += Number(result?.count || 0);
  }
  if (order.profitFeeSnapshottedAt == null) {
    const result = await prisma.salesOrder.updateMany({
      where: {
        id: order.id,
        financeMark: true,
        profitFeeSnapshottedAt: null,
      },
      data: {
        profitFeeSnapshottedAt: now,
        ...(options.actorId
          ? { profitFeeSnapshottedById: options.actorId }
          : {}),
      },
    });
    changedCount += Number(result?.count || 0);
  }
  for (const detail of paymentDetails) {
    if (detail.serviceFeeRateSnapshot == null) {
      const result = await prisma.salesOrderPaymentDetail.updateMany({
        where: {
          id: detail.id,
          salesOrderId: order.id,
          serviceFeeRateSnapshot: null,
          salesOrder: { financeMark: true },
        },
        data: {
          serviceFeeRateSnapshot: normalizeRate(
            detail.paymentMethod.serviceFeeRate,
          ),
        },
      });
      changedCount += Number(result?.count || 0);
    }
    if (detail.serviceFeeBaseAmountSnapshotCents == null) {
      const result = await prisma.salesOrderPaymentDetail.updateMany({
        where: {
          id: detail.id,
          salesOrderId: order.id,
          serviceFeeBaseAmountSnapshotCents: null,
          salesOrder: { financeMark: true },
        },
        data: {
          serviceFeeBaseAmountSnapshotCents: integerCents(
            detail.amountCents,
          ),
        },
      });
      changedCount += Number(result?.count || 0);
    }
  }
  return { ...context, changedCount, issues: [] };
}

function issue(
  context: { orderId: string; orderNo: string },
  code: string,
  message: string,
  actionHint: string,
  paymentDetailId?: unknown,
): ProfitFeeSnapshotRepairIssue {
  return {
    ...context,
    code,
    message,
    actionHint,
    ...(paymentDetailId == null
      ? {}
      : { paymentDetailId: String(paymentDetailId) }),
  };
}

function missingOrderResult(orderId: string): ProfitFeeSnapshotRepairResult {
  const context = { orderId, orderNo: orderId };
  return {
    ...context,
    changedCount: 0,
    issues: [
      issue(
        context,
        'SALES_ORDER_NOT_FOUND',
        '订单不存在。',
        '请刷新页面并确认订单是否已被归档。',
      ),
    ],
  };
}

function normalizeRate(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
  return text;
}

function integerCents(value: unknown): number {
  const cents = Number(value || 0);
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError('cents must be a safe integer.');
  }
  return cents;
}

import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

export const PROFIT_FEE_BACKFILL_TAX_RATE = '0.010000';

type BackfillMode = 'DRY_RUN' | 'APPLY';
type RateIssueReason = 'MISSING' | 'INVALID';

type ProfitFeeBackfillOptions = {
  apply?: boolean;
  now?: Date;
};

type MissingRateDetailReport = {
  paymentDetailId: string;
  paymentMethodId: string;
  paymentMethodNameSnapshot: string;
  reason: RateIssueReason;
};

type MissingRateOrderReport = {
  salesOrderId: string;
  orderNo: string;
  paymentDetails: MissingRateDetailReport[];
};

type MissingRatePaymentMethodReport = {
  paymentMethodId: string;
  paymentMethodName: string;
  reason: RateIssueReason;
  affectedOrderCount: number;
};

type UnknownHistoricalRefundOrderReport = {
  salesOrderId: string;
  orderNo: string;
  confirmedRefundCount: number;
  confirmedRefundAmountCents: number;
};

type FailedOrderReport = {
  salesOrderId: string;
  orderNo: string;
  code: 'BACKFILL_TRANSACTION_FAILED';
};

export type ProfitFeeSnapshotBackfillReport = {
  reportVersion: 1;
  generatedAt: string;
  mode: BackfillMode;
  taxRateSnapshot: string;
  scannedOrderCount: number;
  snapshotMissingOrderCount: number;
  backfillableOrderCount: number;
  appliedOrderCount: number;
  missingRatePaymentMethods: MissingRatePaymentMethodReport[];
  missingRateOrders: MissingRateOrderReport[];
  historicalRefundPaymentDetailUnknownOrders: UnknownHistoricalRefundOrderReport[];
  failedOrders: FailedOrderReport[];
  privacyStatement: string;
};

type CliOptions = {
  apply: boolean;
  help: boolean;
  reportPath?: string;
};

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  financeMark: true,
  taxRateSnapshot: true,
  profitFeeSnapshottedAt: true,
  paymentDetails: {
    select: {
      id: true,
      salesOrderId: true,
      paymentMethodId: true,
      paymentMethodNameSnapshot: true,
      amountCents: true,
      serviceFeeRateSnapshot: true,
      serviceFeeBaseAmountSnapshotCents: true,
      paymentMethod: {
        select: {
          id: true,
          name: true,
          serviceFeeRate: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
  afterSalesOrders: {
    where: {
      financeConfirmed: true,
      refundAmountCents: { gt: 0 },
      refundPaymentDetailId: null,
    },
    select: {
      refundAmountCents: true,
    },
  },
} as const;

export async function backfillProfitFeeSnapshots(
  prisma: any,
  options: ProfitFeeBackfillOptions = {},
): Promise<ProfitFeeSnapshotBackfillReport> {
  const apply = options.apply === true;
  const snapshotTime = new Date(options.now ?? new Date());
  if (Number.isNaN(snapshotTime.getTime())) {
    throw new Error('Invalid backfill timestamp.');
  }

  const orders = await prisma.salesOrder.findMany({
    where: { financeMark: true },
    select: ORDER_SELECT,
    orderBy: [{ id: 'asc' }],
  });

  const missingRateMethodMap = new Map<
    string,
    MissingRatePaymentMethodReport & { orderIds: Set<string> }
  >();
  const missingRateOrders: MissingRateOrderReport[] = [];
  const unknownRefundOrders: UnknownHistoricalRefundOrderReport[] = [];
  const failedOrders: FailedOrderReport[] = [];
  const backfillableOrders: any[] = [];
  let snapshotMissingOrderCount = 0;

  for (const order of orders) {
    const unknownRefunds = Array.isArray(order.afterSalesOrders)
      ? order.afterSalesOrders
      : [];
    if (unknownRefunds.length > 0) {
      unknownRefundOrders.push({
        salesOrderId: String(order.id),
        orderNo: String(order.orderNo),
        confirmedRefundCount: unknownRefunds.length,
        confirmedRefundAmountCents: unknownRefunds.reduce(
          (sum: number, refund: any) =>
            sum + safeIntegerCents(refund.refundAmountCents),
          0,
        ),
      });
    }

    if (!hasMissingProfitFeeSnapshot(order)) {
      continue;
    }
    snapshotMissingOrderCount += 1;

    const issues = collectMissingRateIssues(order);
    if (issues.length > 0) {
      const orderReport: MissingRateOrderReport = {
        salesOrderId: String(order.id),
        orderNo: String(order.orderNo),
        paymentDetails: issues.map((issue) => ({
          paymentDetailId: issue.paymentDetailId,
          paymentMethodId: issue.paymentMethodId,
          paymentMethodNameSnapshot: issue.paymentMethodNameSnapshot,
          reason: issue.reason,
        })),
      };
      missingRateOrders.push(orderReport);
      for (const issue of issues) {
        const key = `${issue.paymentMethodId}\u0000${issue.reason}`;
        const current = missingRateMethodMap.get(key);
        if (current) {
          current.orderIds.add(String(order.id));
          continue;
        }
        missingRateMethodMap.set(key, {
          paymentMethodId: issue.paymentMethodId,
          paymentMethodName: issue.paymentMethodName,
          reason: issue.reason,
          affectedOrderCount: 0,
          orderIds: new Set([String(order.id)]),
        });
      }
      continue;
    }
    backfillableOrders.push(order);
  }

  let appliedOrderCount = 0;
  if (apply) {
    for (const order of backfillableOrders) {
      try {
        const result = await prisma.$transaction(async (tx: any) =>
          applyOrderBackfill(tx, String(order.id), snapshotTime),
        );
        if (result === 'APPLIED') {
          appliedOrderCount += 1;
        }
      } catch {
        failedOrders.push({
          salesOrderId: String(order.id),
          orderNo: String(order.orderNo),
          code: 'BACKFILL_TRANSACTION_FAILED',
        });
      }
    }
  }

  return {
    reportVersion: 1,
    generatedAt: snapshotTime.toISOString(),
    mode: apply ? 'APPLY' : 'DRY_RUN',
    taxRateSnapshot: PROFIT_FEE_BACKFILL_TAX_RATE,
    scannedOrderCount: orders.length,
    snapshotMissingOrderCount,
    backfillableOrderCount: backfillableOrders.length,
    appliedOrderCount,
    missingRatePaymentMethods: Array.from(missingRateMethodMap.values())
      .map(({ orderIds, ...row }) => ({
        ...row,
        affectedOrderCount: orderIds.size,
      }))
      .sort(
        (left, right) =>
          left.paymentMethodName.localeCompare(right.paymentMethodName, 'zh-CN') ||
          left.paymentMethodId.localeCompare(right.paymentMethodId) ||
          left.reason.localeCompare(right.reason),
      ),
    missingRateOrders,
    historicalRefundPaymentDetailUnknownOrders: unknownRefundOrders,
    failedOrders,
    privacyStatement:
      '本报告仅包含订单标识、付款方式快照和汇总金额，不包含客户姓名、电话、地址或其他客户隐私。',
  };
}

async function applyOrderBackfill(
  tx: any,
  salesOrderId: string,
  snapshotTime: Date,
): Promise<'APPLIED' | 'SKIPPED'> {
  const order = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: ORDER_SELECT,
  });
  if (
    !order ||
    order.financeMark !== true ||
    !hasMissingProfitFeeSnapshot(order) ||
    collectMissingRateIssues(order).length > 0
  ) {
    return 'SKIPPED';
  }

  let changedFieldCount = 0;
  if (order.taxRateSnapshot == null) {
    const result = await tx.salesOrder.updateMany({
      where: {
        id: salesOrderId,
        financeMark: true,
        taxRateSnapshot: null,
      },
      data: { taxRateSnapshot: PROFIT_FEE_BACKFILL_TAX_RATE },
    });
    changedFieldCount += Number(result?.count ?? 0);
  }
  if (order.profitFeeSnapshottedAt == null) {
    const result = await tx.salesOrder.updateMany({
      where: {
        id: salesOrderId,
        financeMark: true,
        profitFeeSnapshottedAt: null,
      },
      data: { profitFeeSnapshottedAt: snapshotTime },
    });
    changedFieldCount += Number(result?.count ?? 0);
  }

  for (const detail of order.paymentDetails ?? []) {
    const normalizedCurrentRate = normalizeRate(
      detail.paymentMethod?.serviceFeeRate,
    );
    if (normalizedCurrentRate == null) {
      throw new Error('Payment method rate changed during backfill.');
    }
    if (detail.serviceFeeRateSnapshot == null) {
      const result = await tx.salesOrderPaymentDetail.updateMany({
        where: {
          id: String(detail.id),
          salesOrderId,
          serviceFeeRateSnapshot: null,
          salesOrder: { financeMark: true },
        },
        data: { serviceFeeRateSnapshot: normalizedCurrentRate },
      });
      changedFieldCount += Number(result?.count ?? 0);
    }
    if (detail.serviceFeeBaseAmountSnapshotCents == null) {
      const result = await tx.salesOrderPaymentDetail.updateMany({
        where: {
          id: String(detail.id),
          salesOrderId,
          serviceFeeBaseAmountSnapshotCents: null,
          salesOrder: { financeMark: true },
        },
        data: {
          serviceFeeBaseAmountSnapshotCents: safeIntegerCents(
            detail.amountCents,
          ),
        },
      });
      changedFieldCount += Number(result?.count ?? 0);
    }
  }

  return changedFieldCount > 0 ? 'APPLIED' : 'SKIPPED';
}

function hasMissingProfitFeeSnapshot(order: any): boolean {
  return (
    order.taxRateSnapshot == null ||
    order.profitFeeSnapshottedAt == null ||
    (order.paymentDetails ?? []).some(
      (detail: any) =>
        detail.serviceFeeRateSnapshot == null ||
        detail.serviceFeeBaseAmountSnapshotCents == null,
    )
  );
}

function collectMissingRateIssues(order: any) {
  const issues: Array<
    MissingRateDetailReport & { paymentMethodName: string }
  > = [];
  for (const detail of order.paymentDetails ?? []) {
    const rawRate = detail.paymentMethod?.serviceFeeRate;
    const normalizedRate = normalizeRate(rawRate);
    if (normalizedRate != null) {
      continue;
    }
    issues.push({
      paymentDetailId: String(detail.id),
      paymentMethodId: String(detail.paymentMethodId),
      paymentMethodNameSnapshot: String(
        detail.paymentMethodNameSnapshot || '未知付款方式',
      ),
      paymentMethodName: String(
        detail.paymentMethod?.name ||
          detail.paymentMethodNameSnapshot ||
          '未知付款方式',
      ),
      reason: rawRate == null ? 'MISSING' : 'INVALID',
    });
  }
  return issues;
}

function normalizeRate(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match || match[1] === '-') {
    return null;
  }
  const integerPart = match[2];
  const fractionalPart = match[3] ?? '';
  const denominator = 10n ** BigInt(fractionalPart.length);
  const numerator = BigInt(`${integerPart}${fractionalPart}` || '0');
  if (numerator > denominator) {
    return null;
  }
  const normalizedInteger = BigInt(integerPart).toString();
  return fractionalPart.length > 0
    ? `${normalizedInteger}.${fractionalPart}`
    : normalizedInteger;
}

function safeIntegerCents(value: unknown): number {
  const cents = Number(value ?? 0);
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Invalid integer cents value.');
  }
  return cents;
}

export function parseProfitFeeBackfillArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--dry-run') {
      options.apply = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--report') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--report requires a file path.');
      }
      options.reportPath = value;
      index += 1;
    } else if (arg.startsWith('--report=')) {
      const value = arg.slice('--report='.length);
      if (!value) {
        throw new Error('--report requires a file path.');
      }
      options.reportPath = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export async function writeProfitFeeBackfillReport(
  reportPath: string,
  report: ProfitFeeSnapshotBackfillReport,
): Promise<string> {
  const absolutePath = resolve(reportPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return absolutePath;
}

function printHelp() {
  process.stdout.write(`Usage:
  npm run backfill:profit-fee-snapshots
  npm run backfill:profit-fee-snapshots -- --apply

Options:
  --dry-run       Scan and report only. This is the default.
  --apply         Fill missing snapshots for eligible marked orders.
  --report <path> Also write the privacy-safe JSON report to this path.
  --help          Show this help.
`);
}

async function main() {
  const cli = parseProfitFeeBackfillArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }
  const prisma = new PrismaClient();
  try {
    const report = await backfillProfitFeeSnapshots(prisma, {
      apply: cli.apply,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (cli.reportPath) {
      const reportPath = await writeProfitFeeBackfillReport(
        cli.reportPath,
        report,
      );
      process.stderr.write(`Backfill report written to ${reportPath}\n`);
    }
    if (report.failedOrders.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

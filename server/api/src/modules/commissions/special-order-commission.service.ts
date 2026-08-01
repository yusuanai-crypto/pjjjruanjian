import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

const SPECIAL_ORDER_TYPES = new Set(['INTERNAL', 'EXTERNAL', 'BUYBACK']);
const MAINTENANCE_ROLES = new Set([
  'finance',
  'boss',
  'admin',
  'super_admin',
]);
const TARGET_TYPE = 'ORDER_MANUAL_COMMISSION';
const SOURCE_TYPE = 'MANUAL_ORDER';
const TRANSACTION_OPTIONS = {
  isolationLevel: 'Serializable' as any,
  maxWait: 5_000,
  timeout: 30_000,
};

const RECORD_INCLUDE = {
  targetUser: {
    select: { id: true, name: true, username: true, role: true, isActive: true },
  },
  createdBy: {
    select: { id: true, name: true, username: true, role: true },
  },
  updatedBy: {
    select: { id: true, name: true, username: true, role: true },
  },
  adjustments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} as const;

@Injectable()
export class SpecialOrderCommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogs: OperationLogsNestService,
  ) {}

  canMaintain(actor: any) {
    return MAINTENANCE_ROLES.has(normalizeRole(actor?.role));
  }

  async list(actor: any, salesOrderId: string, includeInactive = false) {
    requireMaintenance(actor);
    const orderId = requiredId(salesOrderId, 'salesOrderId');
    await requireSpecialOrder(this.prisma as any, orderId);
    const records = await (this.prisma as any).commissionRecord.findMany({
      where: {
        salesOrderId: orderId,
        targetType: TARGET_TYPE,
        manualInput: true,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: RECORD_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return records.map(toDto);
  }

  async create(
    actor: any,
    salesOrderId: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireMaintenance(actor);
    const orderId = requiredId(salesOrderId, 'salesOrderId');
    const body = objectPayload(payload, 'commission');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const operationKey = `special-commission:create:${idempotencyKey}`;

    const record = await (this.prisma as any).$transaction(
      async (tx: any) => {
        const replay = await findReplay(tx, operationKey, orderId);
        if (replay) return replay;
        const order = await requireSpecialOrder(tx, orderId);
        const recipient = await resolveRecipient(tx, body);
        const rate = normalizeRate(body);
        const note = optionalText(body.note ?? body.remark, 'note', 2_000);
        const existing = recipient.targetUserId
          ? await tx.commissionRecord.findFirst({
              where: {
                salesOrderId: orderId,
                targetType: TARGET_TYPE,
                targetUserId: recipient.targetUserId,
                manualInput: true,
              },
            })
          : null;
        if (existing?.isActive) {
          throw createHttpError(
            409,
            'SPECIAL_ORDER_COMMISSION_RECIPIENT_DUPLICATED',
            'The selected employee already has a commission entry for this order.',
          );
        }
        const amounts = await calculateAmounts(tx, order, rate);
        const now = new Date();
        const data = buildRecordData({
          order,
          recipient,
          rate,
          amounts,
          note,
          actor,
          now,
        });
        const created = existing
          ? await tx.commissionRecord.update({
              where: { id: existing.id },
              data: {
                ...data,
                isActive: true,
                deactivatedAt: null,
                manualVersion: { increment: 1 },
                updatedAt: now,
              },
            })
          : await tx.commissionRecord.create({
              data: {
                id: crypto.randomUUID(),
                ...data,
                createdById: actor.id,
                createdAt: now,
                updatedAt: now,
              },
            });
        await appendAdjustment(tx, {
          record: created,
          order,
          actor,
          operationKey,
          adjustmentType: 'CREATED',
          previousBaseAmountCents: 0,
          previousAmountCents: 0,
          refundAmountCents: amounts.refundAmountCents,
          reason: note || 'Order commission created.',
          sourceSnapshot: { commissionRecordId: created.id },
        });
        await this.appendLog(
          tx,
          actor,
          'create',
          orderId,
          null,
          created,
          metadata,
        );
        return tx.commissionRecord.findUnique({
          where: { id: created.id },
          include: RECORD_INCLUDE,
        });
      },
      TRANSACTION_OPTIONS,
    );
    return toDto(record);
  }

  async update(
    actor: any,
    salesOrderId: string,
    commissionId: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireMaintenance(actor);
    const orderId = requiredId(salesOrderId, 'salesOrderId');
    const recordId = requiredId(commissionId, 'commissionId');
    const body = objectPayload(payload, 'commission update');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const operationKey = `special-commission:update:${idempotencyKey}`;
    const expectedVersion = requiredNonNegativeInteger(
      body.manualVersion,
      'manualVersion',
    );

    const record = await (this.prisma as any).$transaction(
      async (tx: any) => {
        const replay = await findReplay(tx, operationKey, orderId, recordId);
        if (replay) return replay;
        const order = await requireSpecialOrder(tx, orderId);
        const current = await requireManualRecord(tx, orderId, recordId, true);
        if (Number(current.manualVersion || 0) !== expectedVersion) {
          versionConflict();
        }
        const recipient = await resolveRecipient(tx, {
          recipientType: body.recipientType ?? current.recipientType,
          targetUserId: body.targetUserId ?? current.targetUserId,
          recipientName:
            body.recipientName ?? current.recipientNameSnapshot,
        });
        if (recipient.targetUserId) {
          const duplicate = await tx.commissionRecord.findFirst({
            where: {
              salesOrderId: orderId,
              targetType: TARGET_TYPE,
              targetUserId: recipient.targetUserId,
              manualInput: true,
              isActive: true,
              id: { not: recordId },
            },
          });
          if (duplicate) {
            throw createHttpError(
              409,
              'SPECIAL_ORDER_COMMISSION_RECIPIENT_DUPLICATED',
              'The selected employee already has a commission entry for this order.',
            );
          }
        }
        const rate = hasRate(body)
          ? normalizeRate(body)
          : normalizeStoredRate(current.rateSnapshot);
        const note = Object.prototype.hasOwnProperty.call(body, 'note') ||
          Object.prototype.hasOwnProperty.call(body, 'remark')
          ? optionalText(body.note ?? body.remark, 'note', 2_000)
          : current.calculationNote;
        const amounts = await calculateAmounts(tx, order, rate);
        const now = new Date();
        const changed = await tx.commissionRecord.updateMany({
          where: {
            id: recordId,
            salesOrderId: orderId,
            manualVersion: expectedVersion,
            isActive: true,
          },
          data: {
            ...buildRecordData({
              order,
              recipient,
              rate,
              amounts,
              note,
              actor,
              now,
            }),
            manualVersion: { increment: 1 },
            updatedAt: now,
          },
        });
        if (Number(changed?.count || 0) !== 1) versionConflict();
        const updated = await tx.commissionRecord.findUnique({
          where: { id: recordId },
        });
        await appendAdjustment(tx, {
          record: updated,
          order,
          actor,
          operationKey,
          adjustmentType: 'MANUAL_UPDATE',
          previousBaseAmountCents: Number(current.baseAmountCents || 0),
          previousAmountCents: Number(current.amountCents || 0),
          refundAmountCents: amounts.refundAmountCents,
          reason: note || 'Order commission updated.',
          sourceSnapshot: {
            beforeRecipientName: current.recipientNameSnapshot,
            beforeRate: String(current.rateSnapshot || '0'),
          },
        });
        await this.appendLog(
          tx,
          actor,
          'update',
          orderId,
          current,
          updated,
          metadata,
        );
        return tx.commissionRecord.findUnique({
          where: { id: recordId },
          include: RECORD_INCLUDE,
        });
      },
      TRANSACTION_OPTIONS,
    );
    return toDto(record);
  }

  async remove(
    actor: any,
    salesOrderId: string,
    commissionId: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireMaintenance(actor);
    const orderId = requiredId(salesOrderId, 'salesOrderId');
    const recordId = requiredId(commissionId, 'commissionId');
    const body = objectPayload(payload, 'commission deletion');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const operationKey = `special-commission:delete:${idempotencyKey}`;
    const expectedVersion = requiredNonNegativeInteger(
      body.manualVersion,
      'manualVersion',
    );
    const reason = requiredText(body.reason, 'reason', 500);

    const record = await (this.prisma as any).$transaction(
      async (tx: any) => {
        const replay = await findReplay(tx, operationKey, orderId, recordId);
        if (replay) return replay;
        const order = await requireSpecialOrder(tx, orderId);
        const current = await requireManualRecord(tx, orderId, recordId, true);
        if (Number(current.manualVersion || 0) !== expectedVersion) {
          versionConflict();
        }
        const now = new Date();
        const changed = await tx.commissionRecord.updateMany({
          where: {
            id: recordId,
            salesOrderId: orderId,
            manualVersion: expectedVersion,
            isActive: true,
          },
          data: {
            baseAmountCents: 0,
            adjustmentAmountCents: Number(current.originalAmountCents || 0),
            amountCents: 0,
            isActive: false,
            deactivatedAt: now,
            manualVersion: { increment: 1 },
            calculationNote: reason,
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        if (Number(changed?.count || 0) !== 1) versionConflict();
        const updated = await tx.commissionRecord.findUnique({
          where: { id: recordId },
        });
        await appendAdjustment(tx, {
          record: updated,
          order,
          actor,
          operationKey,
          adjustmentType: 'DELETED',
          previousBaseAmountCents: Number(current.baseAmountCents || 0),
          previousAmountCents: Number(current.amountCents || 0),
          refundAmountCents: Number(current.confirmedRefundAmountCents || 0),
          reason,
          sourceSnapshot: { softDelete: true },
        });
        await this.appendLog(
          tx,
          actor,
          'delete',
          orderId,
          current,
          updated,
          metadata,
        );
        return tx.commissionRecord.findUnique({
          where: { id: recordId },
          include: RECORD_INCLUDE,
        });
      },
      TRANSACTION_OPTIONS,
    );
    return toDto(record);
  }

  async recalculateOrderInTransaction(
    tx: any,
    salesOrderId: string,
    actor: any,
    options: {
      operationKey: string;
      adjustmentType?: string;
      reason?: string | null;
      afterSalesOrderId?: string | null;
      sourceSnapshot?: any;
    },
  ) {
    const order = await requireSpecialOrder(tx, salesOrderId);
    const records = await tx.commissionRecord.findMany({
      where: {
        salesOrderId,
        targetType: TARGET_TYPE,
        manualInput: true,
        isActive: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const updatedIds: string[] = [];
    for (const current of records) {
      const operationKey = `${options.operationKey}:${current.id}`;
      const existing = await tx.commissionAdjustment.findUnique({
        where: { operationKey },
      });
      if (existing) {
        updatedIds.push(current.id);
        continue;
      }
      const rate = normalizeStoredRate(current.rateSnapshot);
      const amounts = await calculateAmounts(tx, order, rate);
      const nextOriginalAmount = multiplyCentsByRate(
        amounts.originalBaseAmountCents,
        rate,
      );
      const nextEffectiveAmount = multiplyCentsByRate(
        amounts.effectiveBaseAmountCents,
        rate,
      );
      const now = new Date();
      const updated = await tx.commissionRecord.update({
        where: { id: current.id },
        data: {
          grossAmountCents: amounts.originalBaseAmountCents,
          confirmedRefundAmountCents: amounts.refundAmountCents,
          baseAmountCents: amounts.effectiveBaseAmountCents,
          originalAmountCents: nextOriginalAmount,
          adjustmentAmountCents: Math.max(
            0,
            nextOriginalAmount - nextEffectiveAmount,
          ),
          amountCents: nextEffectiveAmount,
          attributionDate: order.orderDate,
          manualVersion: { increment: 1 },
          updatedById: actor?.id || null,
          updatedAt: now,
          sourceSnapshot: buildSourceSnapshot(
            order,
            current.recipientType,
            current.recipientNameSnapshot,
            options.sourceSnapshot,
          ),
        },
      });
      await appendAdjustment(tx, {
        record: updated,
        order,
        actor,
        operationKey,
        adjustmentType: options.adjustmentType || 'ORDER_RECALC',
        previousBaseAmountCents: Number(current.baseAmountCents || 0),
        previousAmountCents: Number(current.amountCents || 0),
        refundAmountCents: amounts.refundAmountCents,
        reason: options.reason || null,
        afterSalesOrderId: options.afterSalesOrderId || null,
        sourceSnapshot: options.sourceSnapshot || null,
      });
      updatedIds.push(current.id);
    }
    return { recordIds: updatedIds };
  }

  async applyAfterSalesInTransaction(
    tx: any,
    afterSalesOrder: any,
    actor: any,
  ) {
    const orderType = normalizeEnum(afterSalesOrder?.salesOrder?.orderType);
    if (
      !SPECIAL_ORDER_TYPES.has(orderType) ||
      !afterSalesOrder?.salesOrder?.workflowStatus
    ) {
      return { recordIds: [] };
    }
    const sourceOrder = await requireSpecialOrder(tx, afterSalesOrder.salesOrderId);
    const confirmedRefundAmount = (sourceOrder.afterSalesOrders || []).reduce(
      (sum: number, refund: any) =>
        refund?.financeConfirmed
          ? safeAdd(sum, nonNegativeInteger(refund.refundAmountCents))
          : sum,
      0,
    );
    if (
      normalizeEnum(sourceOrder.workflowStatus) !== 'CANCELLED' &&
      normalizeEnum(sourceOrder.status) !== 'CANCELLED'
    ) {
      const nextStatus =
        confirmedRefundAmount <= 0
          ? 'VALID'
          : confirmedRefundAmount >= nonNegativeInteger(sourceOrder.totalAmountCents)
            ? 'REFUNDED'
            : 'PARTIAL_REFUND';
      if (normalizeEnum(sourceOrder.status) !== nextStatus) {
        await tx.salesOrder.update({
          where: { id: sourceOrder.id },
          data: {
            status: nextStatus,
            updatedById: actor?.id || null,
            updatedAt: new Date(),
          },
        });
      }
    }
    const operationVersion = toIso(
      afterSalesOrder.financeConfirmed
        ? afterSalesOrder.financeConfirmedAt || afterSalesOrder.updatedAt
        : afterSalesOrder.updatedAt,
    );
    return this.recalculateOrderInTransaction(
      tx,
      afterSalesOrder.salesOrderId,
      actor,
      {
        operationKey: `after-sales:${afterSalesOrder.id}:finance:${
          afterSalesOrder.financeConfirmed ? 'confirmed' : 'reversed'
        }:${operationVersion || 'legacy'}`,
        adjustmentType: afterSalesOrder.financeConfirmed
          ? 'REFUND'
          : 'REFUND_REVERSAL',
        reason: `After-sales ${afterSalesOrder.afterSalesNo || afterSalesOrder.id}`,
        afterSalesOrderId: afterSalesOrder.id,
        sourceSnapshot: {
          afterSalesOrderId: afterSalesOrder.id,
          afterSalesNo: afterSalesOrder.afterSalesNo || null,
          refundAmountCents: Number(afterSalesOrder.refundAmountCents || 0),
          financeConfirmed: Boolean(afterSalesOrder.financeConfirmed),
        },
      },
    );
  }

  private async appendLog(
    tx: any,
    actor: any,
    action: string,
    orderId: string,
    before: any,
    after: any,
    metadata: any,
  ) {
    await this.operationLogs.appendLog(
      {
        userId: actor.id,
        action: `special_order_commissions.${action}`,
        module: 'special_orders',
        operationType: action === 'create' ? 'CREATE' : 'UPDATE',
        entityType: 'commission_record',
        entityId: after?.id || before?.id,
        beforeData: before ? summarizeRecord(before) : null,
        afterData: after ? summarizeRecord(after) : null,
        requestSummary: { salesOrderId: orderId },
        ipAddress: metadata?.ipAddress || null,
        requestId: metadata?.requestId || null,
      },
      tx,
    );
  }
}

async function requireSpecialOrder(tx: any, id: string) {
  const order = await tx.salesOrder.findUnique({
    where: { id },
    include: {
      afterSalesOrders: {
        select: {
          id: true,
          afterSalesNo: true,
          refundAmountCents: true,
          financeConfirmed: true,
          financeConfirmedAt: true,
        },
      },
    },
  });
  if (
    !order ||
    !order.workflowStatus ||
    !SPECIAL_ORDER_TYPES.has(normalizeEnum(order.orderType))
  ) {
    throw createHttpError(
      404,
      'SPECIAL_ORDER_NOT_FOUND',
      'Special order does not exist.',
    );
  }
  return order;
}

async function requireManualRecord(
  tx: any,
  orderId: string,
  recordId: string,
  active: boolean,
) {
  const record = await tx.commissionRecord.findFirst({
    where: {
      id: recordId,
      salesOrderId: orderId,
      targetType: TARGET_TYPE,
      manualInput: true,
      ...(active ? { isActive: true } : {}),
    },
  });
  if (!record) {
    throw createHttpError(
      404,
      'SPECIAL_ORDER_COMMISSION_NOT_FOUND',
      'Order commission entry does not exist.',
    );
  }
  return record;
}

async function findReplay(
  tx: any,
  operationKey: string,
  orderId: string,
  expectedRecordId?: string,
) {
  const adjustment = await tx.commissionAdjustment.findUnique({
    where: { operationKey },
  });
  if (!adjustment) return null;
  if (
    adjustment.salesOrderId !== orderId ||
    (expectedRecordId && adjustment.commissionRecordId !== expectedRecordId)
  ) {
    throw createHttpError(
      409,
      'SPECIAL_ORDER_COMMISSION_IDEMPOTENCY_CONFLICT',
      'The idempotency key was already used for another commission operation.',
    );
  }
  return tx.commissionRecord.findUnique({
    where: { id: adjustment.commissionRecordId },
    include: RECORD_INCLUDE,
  });
}

async function resolveRecipient(tx: any, body: any) {
  const recipientType = normalizeEnum(body.recipientType || 'EMPLOYEE');
  if (recipientType === 'EMPLOYEE') {
    const targetUserId = requiredId(
      body.targetUserId ?? body.employeeId,
      'targetUserId',
    );
    const employee = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!employee?.isActive) {
      throw createHttpError(
        404,
        'SPECIAL_ORDER_COMMISSION_EMPLOYEE_NOT_FOUND',
        'The selected active employee account does not exist.',
      );
    }
    return {
      recipientType: 'EMPLOYEE',
      targetUserId,
      recipientNameSnapshot: employee.name || employee.username,
    };
  }
  if (recipientType === 'OTHER' || recipientType === 'NON_EMPLOYEE') {
    return {
      recipientType: 'OTHER',
      targetUserId: null,
      recipientNameSnapshot: requiredText(
        body.recipientName ?? body.personName,
        'recipientName',
        100,
      ),
    };
  }
  throw createHttpError(
    400,
    'SPECIAL_ORDER_COMMISSION_RECIPIENT_TYPE_INVALID',
    'recipientType must be employee or other.',
  );
}

async function calculateAmounts(tx: any, order: any, rate: number) {
  const refunds = Array.isArray(order.afterSalesOrders)
    ? order.afterSalesOrders
    : await tx.afterSalesOrder.findMany({
        where: { salesOrderId: order.id, financeConfirmed: true },
        select: { refundAmountCents: true, financeConfirmed: true },
      });
  const refundAmountCents = refunds.reduce(
    (sum: number, refund: any) =>
      refund?.financeConfirmed
        ? safeAdd(sum, nonNegativeInteger(refund.refundAmountCents))
        : sum,
    0,
  );
  const originalBaseAmountCents = nonNegativeInteger(order.totalAmountCents);
  const isClosed =
    ['CANCELLED', 'REFUNDED'].includes(normalizeEnum(order.status)) ||
    normalizeEnum(order.workflowStatus) === 'CANCELLED';
  const effectiveBaseAmountCents = isClosed
    ? 0
    : Math.max(0, originalBaseAmountCents - refundAmountCents);
  return {
    originalBaseAmountCents,
    effectiveBaseAmountCents,
    refundAmountCents: Math.min(originalBaseAmountCents, refundAmountCents),
    originalAmountCents: multiplyCentsByRate(originalBaseAmountCents, rate),
    effectiveAmountCents: multiplyCentsByRate(effectiveBaseAmountCents, rate),
  };
}

function buildRecordData(input: any) {
  const { order, recipient, rate, amounts, note, actor, now } = input;
  return {
    salesOrderId: order.id,
    travelGroupId: null,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: null,
    targetType: TARGET_TYPE,
    targetUserId: recipient.targetUserId,
    recipientType: recipient.recipientType,
    recipientNameSnapshot: recipient.recipientNameSnapshot,
    attributionDate: order.orderDate,
    sourceType: SOURCE_TYPE,
    agencyId: null,
    agencyName: null,
    grossAmountCents: amounts.originalBaseAmountCents,
    confirmedRefundAmountCents: amounts.refundAmountCents,
    baseAmountCents: amounts.effectiveBaseAmountCents,
    deductionAmountCents: 0,
    rateSnapshot: rate.toFixed(4),
    originalAmountCents: amounts.originalAmountCents,
    adjustmentAmountCents: Math.max(
      0,
      amounts.originalAmountCents - amounts.effectiveAmountCents,
    ),
    amountCents: amounts.effectiveAmountCents,
    pointsCents: 0,
    manualInput: true,
    isActive: true,
    deactivatedAt: null,
    isConfirmed: true,
    confirmedById: actor.id,
    confirmedAt: now,
    calculationVersion: 'special_order_manual_v1',
    calculationNote: note,
    ruleSnapshot: {
      source: SOURCE_TYPE,
      rateScale: 4,
      rounding: 'half_up_cent',
    },
    sourceSnapshot: buildSourceSnapshot(
      order,
      recipient.recipientType,
      recipient.recipientNameSnapshot,
    ),
    updatedById: actor.id,
  };
}

function buildSourceSnapshot(
  order: any,
  recipientType: string,
  recipientName: string,
  extra: any = null,
) {
  return {
    sourceType: SOURCE_TYPE,
    salesOrder: {
      id: order.id,
      orderNo: order.orderNo,
      orderType: String(order.orderType || '').toLowerCase(),
      orderDate: toDateOnly(order.orderDate),
      totalAmountCents: Number(order.totalAmountCents || 0),
      status: String(order.status || '').toLowerCase(),
    },
    recipientType: String(recipientType || '').toLowerCase(),
    recipientName,
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

async function appendAdjustment(tx: any, input: any) {
  const current = input.record;
  const originalAmountCents = Number(current.originalAmountCents || 0);
  const effectiveAmountCents = Number(current.amountCents || 0);
  await tx.commissionAdjustment.create({
    data: {
      id: crypto.randomUUID(),
      commissionRecordId: current.id,
      salesOrderId: input.order.id,
      afterSalesOrderId: input.afterSalesOrderId || null,
      operationKey: input.operationKey,
      adjustmentType: input.adjustmentType,
      originalBaseAmountCents: Number(current.grossAmountCents || 0),
      previousEffectiveBaseAmountCents: Number(
        input.previousBaseAmountCents || 0,
      ),
      effectiveBaseAmountCents: Number(current.baseAmountCents || 0),
      originalAmountCents,
      previousEffectiveAmountCents: Number(input.previousAmountCents || 0),
      adjustmentAmountCents:
        Number(input.previousAmountCents || 0) - effectiveAmountCents,
      effectiveAmountCents,
      refundAmountCents: Number(input.refundAmountCents || 0),
      actorUserId: input.actor?.id || null,
      actorNameSnapshot: input.actor?.name || null,
      actorRoleSnapshot: input.actor?.role || null,
      reason: input.reason || null,
      sourceSnapshot: input.sourceSnapshot || null,
      createdAt: new Date(),
    },
  });
}

function toDto(record: any) {
  return {
    id: record.id,
    salesOrderId: record.salesOrderId,
    recipientType: String(record.recipientType || '').toLowerCase(),
    targetUserId: record.targetUserId || null,
    targetUser: publicUser(record.targetUser),
    recipientName: record.recipientNameSnapshot || record.targetUser?.name || '',
    rateSnapshot: String(record.rateSnapshot || '0'),
    ratePercent: formatDecimal(Number(record.rateSnapshot || 0) * 100),
    originalBaseAmountCents: Number(record.grossAmountCents || 0),
    effectiveBaseAmountCents: Number(record.baseAmountCents || 0),
    confirmedRefundAmountCents: Number(
      record.confirmedRefundAmountCents || 0,
    ),
    originalAmountCents: Number(
      record.originalAmountCents ?? record.amountCents ?? 0,
    ),
    adjustmentAmountCents: Number(record.adjustmentAmountCents || 0),
    effectiveAmountCents: Number(record.amountCents || 0),
    attributionDate: toDateOnly(record.attributionDate),
    note: record.calculationNote || null,
    sourceType: String(record.sourceType || SOURCE_TYPE).toLowerCase(),
    isActive: record.isActive !== false,
    manualVersion: Number(record.manualVersion || 0),
    createdBy: publicUser(record.createdBy),
    createdAt: toIso(record.createdAt),
    updatedBy: publicUser(record.updatedBy),
    updatedAt: toIso(record.updatedAt),
    adjustments: (record.adjustments || []).map((adjustment: any) => ({
      id: adjustment.id,
      adjustmentType: String(adjustment.adjustmentType || '').toLowerCase(),
      afterSalesOrderId: adjustment.afterSalesOrderId || null,
      originalBaseAmountCents: Number(
        adjustment.originalBaseAmountCents || 0,
      ),
      previousEffectiveBaseAmountCents: Number(
        adjustment.previousEffectiveBaseAmountCents || 0,
      ),
      effectiveBaseAmountCents: Number(
        adjustment.effectiveBaseAmountCents || 0,
      ),
      originalAmountCents: Number(adjustment.originalAmountCents || 0),
      previousEffectiveAmountCents: Number(
        adjustment.previousEffectiveAmountCents || 0,
      ),
      adjustmentAmountCents: Number(adjustment.adjustmentAmountCents || 0),
      effectiveAmountCents: Number(adjustment.effectiveAmountCents || 0),
      refundAmountCents: Number(adjustment.refundAmountCents || 0),
      actorUserId: adjustment.actorUserId || null,
      actorName: adjustment.actorNameSnapshot || null,
      actorRole: adjustment.actorRoleSnapshot || null,
      reason: adjustment.reason || null,
      createdAt: toIso(adjustment.createdAt),
    })),
  };
}

function summarizeRecord(record: any) {
  return {
    id: record.id,
    salesOrderId: record.salesOrderId,
    recipientType: record.recipientType,
    recipientName: record.recipientNameSnapshot,
    targetUserId: record.targetUserId,
    grossAmountCents: Number(record.grossAmountCents || 0),
    baseAmountCents: Number(record.baseAmountCents || 0),
    rateSnapshot: String(record.rateSnapshot || '0'),
    originalAmountCents: Number(record.originalAmountCents || 0),
    adjustmentAmountCents: Number(record.adjustmentAmountCents || 0),
    amountCents: Number(record.amountCents || 0),
    isActive: record.isActive !== false,
    manualVersion: Number(record.manualVersion || 0),
  };
}

function requireMaintenance(actor: any) {
  if (!MAINTENANCE_ROLES.has(normalizeRole(actor?.role))) {
    throw createHttpError(
      403,
      'SPECIAL_ORDER_COMMISSION_PERMISSION_DENIED',
      'Only finance, boss, or administrators may maintain order commissions.',
    );
  }
}

function normalizeRate(body: any) {
  const raw = body.ratePercent !== undefined
    ? Number(body.ratePercent) / 100
    : Number(body.rateSnapshot ?? body.rate);
  if (!Number.isFinite(raw) || raw < 0 || raw > 999999.9999) {
    throw createHttpError(
      400,
      'SPECIAL_ORDER_COMMISSION_RATE_INVALID',
      'Commission rate must be a non-negative decimal value.',
    );
  }
  return Math.round(raw * 10_000) / 10_000;
}

function normalizeStoredRate(value: unknown) {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate < 0) {
    throw createHttpError(
      409,
      'SPECIAL_ORDER_COMMISSION_RATE_INVALID',
      'Stored commission rate is invalid.',
    );
  }
  return Math.round(rate * 10_000) / 10_000;
}

function hasRate(body: any) {
  return ['ratePercent', 'rateSnapshot', 'rate'].some((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
}

export function multiplyCentsByRate(cents: number, rate: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw createHttpError(
      400,
      'SPECIAL_ORDER_COMMISSION_BASE_INVALID',
      'Commission base amount must be a non-negative integer number of cents.',
    );
  }
  const rateUnits = Math.round(rate * 10_000);
  if (!Number.isSafeInteger(rateUnits) || rateUnits < 0) {
    throw createHttpError(
      400,
      'SPECIAL_ORDER_COMMISSION_RATE_INVALID',
      'Commission rate is invalid.',
    );
  }
  const rounded =
    (BigInt(cents) * BigInt(rateUnits) + 5_000n) / 10_000n;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result) || result > 2_147_483_647) {
    throw createHttpError(
      400,
      'SPECIAL_ORDER_COMMISSION_AMOUNT_OVERFLOW',
      'Calculated commission amount exceeds the supported money range.',
    );
  }
  return result;
}

function objectPayload(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, 'VALIDATION_FAILED', `${label} must be an object.`);
  }
  return value as Record<string, any>;
}

function requiredId(value: unknown, field: string) {
  return requiredText(value, field, 36);
}

function requiredIdempotencyKey(value: unknown) {
  const key = requiredText(value, 'idempotencyKey', 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9:._/-]*$/.test(key)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'idempotencyKey contains unsupported characters.',
    );
  }
  return key;
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const text = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!text || text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${field} is required and must not exceed ${maxLength} characters.`,
    );
  }
  return text;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function requiredNonNegativeInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${field} must be a non-negative integer.`,
    );
  }
  return parsed;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function safeAdd(left: number, right: number) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw createHttpError(
      400,
      'SPECIAL_ORDER_COMMISSION_AMOUNT_OVERFLOW',
      'Commission amount calculation exceeds the supported range.',
    );
  }
  return value;
}

function versionConflict(): never {
  throw createHttpError(
    409,
    'SPECIAL_ORDER_COMMISSION_VERSION_CONFLICT',
    'The commission entry changed concurrently. Refresh and retry.',
  );
}

function normalizeRole(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEnum(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function publicUser(user: any) {
  return user
    ? {
        id: user.id,
        name: user.name || null,
        username: user.username || null,
        role: normalizeRole(user.role),
      }
    : null;
}

function toDateOnly(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toIso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDecimal(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, '');
}

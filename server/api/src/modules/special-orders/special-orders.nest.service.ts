import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as ExcelJS from 'exceljs';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionRecordsNestService } from '../commissions/commission-records.nest.service';
import { SpecialOrderCommissionService } from '../commissions/special-order-commission.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { withGeneratedSalesOrderNo } from '../business-data/sales-order-no.helper';
import { defaultBackfillShippingDate } from '../business-data/sales-order-shipping-date.helper';
import {
  assertAllowedFields,
  claimSpecialOrderTransition,
  invalidTransition,
  isSelfScopedSpecialOrderActor,
  isSpecialOrderReviewer,
  normalizeDeliveryType,
  normalizeEnum,
  normalizeExternalPartyType,
  normalizeInventoryCondition,
  normalizeLogisticsCode,
  normalizeObject,
  normalizeRole,
  normalizeSpecialOrderType,
  normalizeWorkflowStatus,
  notFound,
  optionalBoolean,
  optionalDate,
  optionalId,
  optionalInteger,
  optionalReason,
  optionalText,
  requestHash,
  requiredBoolean,
  requiredDate,
  requiredId,
  requiredIdempotencyKey,
  requiredInteger,
  requiredReason,
  requiredText,
  requiredWorkflowVersion,
  requireSpecialOrderCreator,
  requireSpecialOrderRead,
  requireSpecialOrderReviewer,
  SPECIAL_ORDER_EFFECTIVE_STATUSES,
  validation,
  versionConflict,
} from './special-order.policy';
import { SpecialOrderInventoryService } from './special-order-inventory.service';

const SPECIAL_ORDER_INCLUDE = {
  customer: true,
  sourceSalesOrder: {
    select: {
      id: true,
      orderNo: true,
      orderType: true,
      workflowStatus: true,
      customerId: true,
      customerName: true,
      totalAmountCents: true,
    },
  },
  internalEmployee: {
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      isActive: true,
    },
  },
  approvedBy: {
    select: { id: true, name: true, username: true, role: true },
  },
  createdBy: {
    select: { id: true, name: true, username: true, role: true },
  },
  updatedBy: {
    select: { id: true, name: true, username: true, role: true },
  },
  items: {
    include: {
      product: true,
      warehouse: true,
      specialSerializedUnits: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
  specialWorkflowEvents: {
    include: {
      actor: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
    orderBy: [{ workflowVersion: 'asc' }, { id: 'asc' }],
  },
  specialAttachments: {
    orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
  },
  specialSettlements: {
    include: {
      payments: {
        include: { paymentMethod: true, recordedBy: true },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      },
      reversedBy: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  commissionRecords: {
    where: {
      targetType: 'ORDER_MANUAL_COMMISSION',
      manualInput: true,
    },
    include: {
      targetUser: {
        select: { id: true, name: true, username: true, role: true },
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
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} as const;

const MUTATION_TRANSACTION_OPTIONS = {
  isolationLevel: 'Serializable' as any,
  maxWait: 5_000,
  timeout: 30_000,
};

@Injectable()
export class SpecialOrdersNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogs: OperationLogsNestService,
    private readonly inventory: SpecialOrderInventoryService,
    private readonly commissions: CommissionRecordsNestService,
    private readonly specialOrderCommissions: SpecialOrderCommissionService,
  ) {}

  async list(actor: any, filters: any = {}) {
    requireSpecialOrderRead(actor);
    const where = buildListWhere(actor, filters);
    const take = normalizeTake(filters?.limit, 100);
    const skip = normalizeSkip(filters?.skip);
    const prisma = this.db();
    const [orders, total, pendingCount] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: SPECIAL_ORDER_INCLUDE,
        orderBy: [
          { lastSubmittedAt: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take,
      }),
      prisma.salesOrder.count({ where }),
      isSpecialOrderReviewer(actor)
        ? prisma.salesOrder.count({
            where: {
              workflowStatus: 'PENDING',
              orderType: { in: ['INTERNAL', 'EXTERNAL', 'BUYBACK'] },
            },
          })
        : Promise.resolve(0),
    ]);
    return {
      orders: orders.map((order: any) => toSpecialOrderDto(order)),
      total: Number(total || 0),
      pendingCount: Number(pendingCount || 0),
    };
  }

  async get(actor: any, id: string) {
    requireSpecialOrderRead(actor);
    const order = await this.loadScopedOrder(
      this.db(),
      actor,
      requiredId(id, 'id'),
    );
    return toSpecialOrderDto(order);
  }

  async getReferenceData(actor: any, filters: any = {}) {
    requireSpecialOrderRead(actor);
    const keyword = optionalText(filters?.keyword, 'keyword', 100);
    const customerId = optionalId(filters?.customerId, 'customerId');
    const customerWhere = keyword
      ? {
          OR: [
            { name: { contains: keyword } },
            { phone: { contains: keyword } },
          ],
        }
      : {};
    const prisma = this.db();
    const [
      employees,
      products,
      warehouses,
      guides,
      travelAgencies,
      paymentMethods,
      customers,
      sourceSalesOrders,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
        },
        orderBy: [{ name: 'asc' }, { username: 'asc' }],
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          unit: true,
          notes: true,
          inventoryTrackingMode: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.warehouse.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          isDefault: true,
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      prisma.guide.findMany({
        where: { isActive: true },
        select: { id: true, name: true, phone: true },
        orderBy: { name: 'asc' },
      }),
      prisma.travelAgency.findMany({
        select: {
          id: true,
          name: true,
          contactName: true,
          contactPhone: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.paymentMethod.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          isDefault: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.customer.findMany({
        where: customerWhere,
        select: {
          id: true,
          name: true,
          phone: true,
          province: true,
          city: true,
          district: true,
          address: true,
          notes: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        take: normalizeTake(filters?.limit, 100),
      }),
      customerId
        ? prisma.salesOrder.findMany({
            where: {
              customerId,
              orderType: {
                notIn: ['BUYBACK', 'AFTER_SALES'],
              },
              status: {
                in: ['VALID', 'PARTIAL_REFUND'],
              },
              OR: [
                { workflowStatus: null },
                {
                  workflowStatus: {
                    in: ['APPROVED', 'COMPLETED'],
                  },
                },
              ],
            },
            select: {
              id: true,
              orderNo: true,
              orderDate: true,
              totalAmountCents: true,
              orderType: true,
              workflowStatus: true,
            },
            orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
            take: 100,
          })
        : Promise.resolve([]),
    ]);
    return {
      employees: employees.map(userDto),
      products: products.map((product: any) => ({
        ...product,
        inventoryTrackingMode: String(
          product.inventoryTrackingMode || 'NONE',
        ).toLowerCase(),
      })),
      warehouses,
      defaultWarehouse:
        warehouses.find((warehouse: any) => warehouse.isDefault) || null,
      guides,
      travelAgencies,
      paymentMethods: paymentMethods.map((method: any) => ({
        ...method,
        category: String(method.category || '').toLowerCase(),
      })),
      customers,
      sourceSalesOrders: sourceSalesOrders.map((order: any) => ({
        ...order,
        orderDate: formatDate(order.orderDate),
        orderType: String(order.orderType || '').toLowerCase(),
        workflowStatus: order.workflowStatus
          ? String(order.workflowStatus).toLowerCase()
          : null,
      })),
    };
  }

  async create(actor: any, payload: unknown, metadata: any = {}) {
    requireSpecialOrderCreator(actor);
    const body = normalizeObject(payload, 'special order');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const hash = requestHash(body);
    const receiptIds: string[] = [];
    const created = await this.db().$transaction(
      async (tx: any) => {
        const replay = await tx.salesOrder.findUnique({
          where: { specialOrderCreateKey: idempotencyKey },
          include: SPECIAL_ORDER_INCLUDE,
        });
        if (replay) {
          if (replay.specialOrderCreateHash !== hash) {
            idempotencyConflict();
          }
          assertScoped(actor, replay);
          return replay;
        }

        const input = await resolveSpecialOrderInput(tx, actor, body);
        const now = new Date();
        return withGeneratedSalesOrderNo(
          tx.salesOrder,
          input.orderDate,
          async (orderNo) => {
            const orderId = crypto.randomUUID();
            const order = await tx.salesOrder.create({
              data: {
                id: orderId,
                orderNo,
                orderType: input.orderType,
                sourceSalesOrderId: input.sourceSalesOrderId,
                travelGroupId: null,
                customerId: input.customer?.id || null,
                customerName: input.customerName,
                customerPhone: input.customer?.phone || null,
                province: input.customer?.province || null,
                city: input.customer?.city || null,
                district: input.customer?.district || null,
                address: input.customer?.address || null,
                orderDate: input.orderDate,
                shippingDateMode: 'SCHEDULED',
                shippingDate: defaultBackfillShippingDate(now),
                shippingDateSource: 'SYSTEM_DEFAULT',
                totalAmountCents: input.totalAmountCents,
                cashOnDeliveryAmountCents: 0,
                logisticsMethod: null,
                packingStatus: input.hasShipping ? 'PENDING' : 'PACKED',
                status: 'VALID',
                remark: input.remark,
                salesUserId:
                  normalizeRole(actor.role) === 'sales' ? actor.id : null,
                pointsDestination: 'TRAVEL_AGENCY',
                fulfillmentWarehouseId:
                  input.singleWarehouseId || null,
                completedAt: now,
                completedById: actor.id,
                workflowStatus: 'COMPLETED',
                workflowVersion: 1,
                specialOrderCreateKey: idempotencyKey,
                specialOrderCreateHash: hash,
                hasOriginalPurchase: input.hasOriginalPurchase,
                sourceRemark: input.sourceRemark,
                internalEmployeeId: input.internalEmployeeId,
                externalPartyType: input.externalPartyType,
                externalPartyId: input.externalPartyId,
                externalPartyNameSnapshot:
                  input.externalPartyNameSnapshot,
                approvedById: actor.id,
                approvedAt: now,
                inventoryAppliedAt: now,
                inventoryPolicyVersion: 1,
                createdById: actor.id,
                updatedById: actor.id,
                createdAt: now,
                updatedAt: now,
                items: {
                  create: input.items.map((item: any) => ({
                    ...item.data,
                    specialSerializedUnits: {
                      create: item.serials,
                    },
                  })),
                },
                specialAttachments: {
                  create: input.attachments.map((attachment: any) => ({
                    ...attachment,
                    uploadedById: actor.id,
                    uploadedAt: now,
                  })),
                },
              },
              include: SPECIAL_ORDER_INCLUDE,
            });
            const postedOrder = await this.reload(tx, order.id);
            const approvalPosting =
              await this.inventory.postApprovalInTransaction(
                tx,
                actor,
                postedOrder,
                1,
                metadata,
              );
            const completionPosting =
              await this.inventory.postCompletionInTransaction(
                tx,
                actor,
                postedOrder,
                1,
                metadata,
              );
            receiptIds.push(
              ...approvalPosting.commandReceiptIds,
              ...completionPosting.commandReceiptIds,
            );
            const settlement = await createSettlement(tx, postedOrder, now);
            await replaceSettlementPayments(
              tx,
              actor,
              postedOrder,
              settlement,
              input.payments,
              idempotencyKey,
              now,
            );
            const completedOrder = await this.reload(tx, order.id);
            await this.appendWorkflowEvent(
              tx,
              actor,
              completedOrder,
              {
                eventType: 'CREATED',
                fromStatus: null,
                toStatus: 'COMPLETED',
                workflowVersion: 1,
                idempotencyKey,
                requestHash: hash,
                payloadSnapshot: {
                  ...eventOrderSnapshot(completedOrder),
                  directCompleted: true,
                  inventoryDocumentIds: [
                    ...approvalPosting.documentIds,
                    ...completionPosting.documentIds,
                  ],
                },
              },
            );
            await this.appendOperationLog(
              tx,
              actor,
              'create',
              null,
              completedOrder,
              metadata,
            );
            return this.reload(tx, order.id);
          },
          input.orderType,
        );
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    await this.inventory.dispatchCommittedReceipts(receiptIds);
    return toSpecialOrderDto(created);
  }

  async update(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderCreator(actor);
    const orderId = requiredId(id, 'id');
    const body = normalizeObject(payload, 'special order update');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const hash = requestHash(body);
    const receiptIds: string[] = [];
    const updated = await this.db().$transaction(
      async (tx: any) => {
        const replay = await this.resolveEventReplay(
          tx,
          actor,
          orderId,
          idempotencyKey,
          hash,
        );
        if (replay) {
          return replay;
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        if (current.workflowStatus === 'COMPLETED') {
          requireSpecialOrderReviewer(actor);
          assertVersion(current, expectedVersion);
          const merged = payloadFromExisting(current, body);
          const input = await resolveSpecialOrderInput(
            tx,
            actor,
            merged,
            current,
          );
          const nextVersion = expectedVersion + 1;
          const reason = optionalReason(body.reason) || 'Completed order edited.';
          const reversal = await this.inventory.reverseInTransaction(
            tx,
            actor,
            current,
            nextVersion,
            reason,
            metadata,
          );
          receiptIds.push(...reversal.commandReceiptIds);
          const claimed = await tx.salesOrder.updateMany({
            where: {
              id: orderId,
              workflowStatus: 'COMPLETED',
              workflowVersion: expectedVersion,
            },
            data: {
              customerId: input.customer.id,
              customerName: input.customerName,
              customerPhone: input.customer.phone || null,
              province: input.customer.province || null,
              city: input.customer.city || null,
              district: input.customer.district || null,
              address: input.customer.address || null,
              orderDate: input.orderDate,
              totalAmountCents: input.totalAmountCents,
              remark: input.remark,
              packingStatus: input.hasShipping ? 'PENDING' : 'PACKED',
              fulfillmentWarehouseId: input.singleWarehouseId || null,
              workflowVersion: nextVersion,
              inventoryAppliedAt: new Date(),
              inventoryVersion: { increment: 1 },
              updatedById: actor.id,
              updatedAt: new Date(),
            },
          });
          assertClaimed(claimed);
          const existingItemIds = (current.items || []).map(
            (item: any) => item.id,
          );
          if (existingItemIds.length > 0) {
            await tx.specialOrderItemSerializedUnit.deleteMany({
              where: { salesOrderItemId: { in: existingItemIds } },
            });
            await tx.salesOrderItem.deleteMany({
              where: { id: { in: existingItemIds } },
            });
          }
          for (const item of input.items) {
            await tx.salesOrderItem.create({
              data: {
                ...item.data,
                salesOrderId: orderId,
                specialSerializedUnits: { create: item.serials },
              },
            });
          }
          const changedOrder = await this.reload(tx, orderId);
          const approvalPosting =
            await this.inventory.postApprovalInTransaction(
              tx,
              actor,
              changedOrder,
              nextVersion,
              metadata,
            );
          const completionPosting =
            await this.inventory.postCompletionInTransaction(
              tx,
              actor,
              changedOrder,
              nextVersion,
              metadata,
            );
          receiptIds.push(
            ...approvalPosting.commandReceiptIds,
            ...completionPosting.commandReceiptIds,
          );
          let settlement = await tx.specialOrderSettlement.findUnique({
            where: { activeOrderKey: orderId },
          });
          if (!settlement) {
            settlement = await createSettlement(tx, changedOrder, new Date());
          }
          await replaceSettlementPayments(
            tx,
            actor,
            changedOrder,
            settlement,
            input.payments,
            idempotencyKey,
            new Date(),
          );
          await this.specialOrderCommissions.recalculateOrderInTransaction(
            tx,
            orderId,
            actor,
            {
              operationKey: `special-order:update:${idempotencyKey}`,
              adjustmentType: 'ORDER_RECALC',
              reason,
              sourceSnapshot: {
                previousTotalAmountCents: Number(
                  current.totalAmountCents || 0,
                ),
                totalAmountCents: input.totalAmountCents,
              },
            },
          );
          const next = await this.reload(tx, orderId);
          await this.appendWorkflowEvent(tx, actor, next, {
            eventType: 'UPDATED',
            fromStatus: 'COMPLETED',
            toStatus: 'COMPLETED',
            workflowVersion: nextVersion,
            idempotencyKey,
            requestHash: hash,
            reason,
            payloadSnapshot: {
              ...eventOrderSnapshot(next),
              reversalDocumentIds: reversal.documentIds,
              inventoryDocumentIds: [
                ...approvalPosting.documentIds,
                ...completionPosting.documentIds,
              ],
            },
          });
          await this.appendOperationLog(
            tx,
            actor,
            'update_completed',
            current,
            next,
            metadata,
          );
          return this.reload(tx, orderId);
        }
        if (!['DRAFT', 'REJECTED'].includes(current.workflowStatus)) {
          invalidTransition(current.workflowStatus, 'update');
        }
        assertVersion(current, expectedVersion);
        const merged = payloadFromExisting(current, body);
        const input = await resolveSpecialOrderInput(
          tx,
          actor,
          merged,
          current,
        );
        const nextVersion = expectedVersion + 1;
        const claimed = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: current.workflowStatus,
            workflowVersion: expectedVersion,
          },
          data: {
            customerId: input.customer?.id || null,
            customerName: input.customerName,
            customerPhone: input.customer?.phone || null,
            province: input.customer?.province || null,
            city: input.customer?.city || null,
            district: input.customer?.district || null,
            address: input.customer?.address || null,
            orderDate: input.orderDate,
            sourceSalesOrderId: input.sourceSalesOrderId,
            totalAmountCents: input.totalAmountCents,
            remark: input.remark,
            packingStatus: input.hasShipping ? 'PENDING' : 'PACKED',
            fulfillmentWarehouseId:
              input.singleWarehouseId || null,
            hasOriginalPurchase: input.hasOriginalPurchase,
            sourceRemark: input.sourceRemark,
            internalEmployeeId: input.internalEmployeeId,
            externalPartyType: input.externalPartyType,
            externalPartyId: input.externalPartyId,
            externalPartyNameSnapshot:
              input.externalPartyNameSnapshot,
            workflowVersion: nextVersion,
            updatedById: actor.id,
            updatedAt: new Date(),
          },
        });
        assertClaimed(claimed);

        if (Object.prototype.hasOwnProperty.call(body, 'items')) {
          const existingItemIds = (current.items || []).map(
            (item: any) => item.id,
          );
          if (existingItemIds.length > 0) {
            await tx.specialOrderItemSerializedUnit.deleteMany({
              where: { salesOrderItemId: { in: existingItemIds } },
            });
            await tx.salesOrderItem.deleteMany({
              where: { id: { in: existingItemIds } },
            });
          }
          for (const item of input.items) {
            await tx.salesOrderItem.create({
              data: {
                ...item.data,
                salesOrderId: orderId,
                specialSerializedUnits: {
                  create: item.serials,
                },
              },
            });
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'attachments')) {
          await tx.specialOrderAttachment.deleteMany({
            where: { salesOrderId: orderId },
          });
          for (const attachment of input.attachments) {
            await tx.specialOrderAttachment.create({
              data: {
                id: crypto.randomUUID(),
                salesOrderId: orderId,
                ...attachment,
                uploadedById: actor.id,
                uploadedAt: new Date(),
              },
            });
          }
        }
        const next = await this.reload(tx, orderId);
        await this.appendWorkflowEvent(tx, actor, next, {
          eventType: 'UPDATED',
          fromStatus: current.workflowStatus,
          toStatus: current.workflowStatus,
          workflowVersion: nextVersion,
          idempotencyKey,
          requestHash: hash,
          payloadSnapshot: eventOrderSnapshot(next),
        });
        await this.appendOperationLog(
          tx,
          actor,
          'update',
          current,
          next,
          metadata,
        );
        return this.reload(tx, orderId);
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    await this.inventory.dispatchCommittedReceipts(receiptIds);
    return toSpecialOrderDto(updated);
  }

  async cancel(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderRead(actor);
    const body = normalizeObject(payload, 'special order cancellation');
    const orderId = requiredId(id, 'id');
    const candidate = await this.loadScopedOrder(this.db(), actor, orderId);
    if (candidate.workflowStatus === 'CANCELLED') {
      requireSpecialOrderReviewer(actor);
      const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
      const event = await this.db().specialOrderWorkflowEvent.findUnique({
        where: { idempotencyKey },
      });
      if (
        event?.salesOrderId === orderId &&
        event?.requestHash === requestHash(body)
      ) {
        return toSpecialOrderDto(candidate);
      }
      invalidTransition(candidate.workflowStatus, 'cancel');
    }
    if (candidate.workflowStatus === 'COMPLETED') {
      requireSpecialOrderReviewer(actor);
      const reason = requiredReason(body.reason);
      const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
      const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
      const hash = requestHash(body);
      const receiptIds: string[] = [];
      const cancelled = await this.db().$transaction(
        async (tx: any) => {
          const replay = await this.resolveEventReplay(
            tx,
            actor,
            orderId,
            idempotencyKey,
            hash,
          );
          if (replay) return replay;
          const current = await this.loadScopedOrder(tx, actor, orderId);
          if (current.workflowStatus !== 'COMPLETED') {
            invalidTransition(current.workflowStatus, 'cancel');
          }
          assertVersion(current, expectedVersion);
          const nextVersion = expectedVersion + 1;
          const posting = await this.inventory.reverseInTransaction(
            tx,
            actor,
            current,
            nextVersion,
            reason,
            metadata,
          );
          receiptIds.push(...posting.commandReceiptIds);
          const changed = await tx.salesOrder.updateMany({
            where: {
              id: orderId,
              workflowStatus: 'COMPLETED',
              workflowVersion: expectedVersion,
            },
            data: {
              workflowStatus: 'CANCELLED',
              workflowVersion: nextVersion,
              status: 'CANCELLED',
              inventoryAppliedAt: null,
              updatedById: actor.id,
              updatedAt: new Date(),
            },
          });
          assertClaimed(changed);
          await reverseActiveSettlement(tx, current, actor, reason);
          await tx.specialOrderPayment.updateMany({
            where: { salesOrderId: orderId, reversedAt: null },
            data: {
              reversedAt: new Date(),
              reversedById: actor.id,
              reversalReason: reason,
            },
          });
          await this.specialOrderCommissions.recalculateOrderInTransaction(
            tx,
            orderId,
            actor,
            {
              operationKey: `special-order:void:${idempotencyKey}`,
              adjustmentType: 'VOID',
              reason,
            },
          );
          const next = await this.reload(tx, orderId);
          await this.appendWorkflowEvent(tx, actor, next, {
            eventType: 'CANCELLED',
            fromStatus: 'COMPLETED',
            toStatus: 'CANCELLED',
            workflowVersion: nextVersion,
            idempotencyKey,
            requestHash: hash,
            reason,
            payloadSnapshot: {
              reversalDocumentIds: posting.documentIds,
              financialReversed: true,
              commissionReversed: true,
            },
          });
          await this.appendOperationLog(
            tx,
            actor,
            'void',
            current,
            next,
            metadata,
          );
          return this.reload(tx, orderId);
        },
        MUTATION_TRANSACTION_OPTIONS,
      );
      await this.inventory.dispatchCommittedReceipts(receiptIds);
      return toSpecialOrderDto(cancelled);
    }
    return this.transition(actor, id, body, metadata, {
      action: 'cancel',
      allowedFrom: ['DRAFT', 'REJECTED'],
      toStatus: 'CANCELLED',
      eventType: 'CANCELLED',
      authorize: (current) => {
        if (
          !isSpecialOrderReviewer(actor) &&
          current.createdById !== actor.id
        ) {
          notFound();
        }
      },
      reason: optionalReason(body.reason),
    });
  }

  async submit(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderCreator(actor);
    const body = normalizeObject(payload, 'special order submission');
    const orderId = requiredId(id, 'id');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const hash = requestHash(body);
    const receiptIds: string[] = [];
    const submitted = await this.db().$transaction(
      async (tx: any) => {
        const replay = await this.resolveEventReplay(
          tx,
          actor,
          orderId,
          idempotencyKey,
          hash,
        );
        if (replay) {
          return replay;
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        if (!['DRAFT', 'REJECTED'].includes(current.workflowStatus)) {
          invalidTransition(current.workflowStatus, 'submit');
        }
        if (
          !isSpecialOrderReviewer(actor) &&
          current.createdById !== actor.id
        ) {
          notFound();
        }
        assertVersion(current, expectedVersion);
        await validatePersistedOrderForSubmission(tx, current);
        const now = new Date();
        const pendingVersion = expectedVersion + 1;
        const claimed = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: current.workflowStatus,
            workflowVersion: expectedVersion,
          },
          data: {
            workflowStatus: 'PENDING',
            workflowVersion: pendingVersion,
            lastSubmittedAt: now,
            rejectionReason: null,
            unapprovalReason: null,
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        assertClaimed(claimed);
        const submitEventType =
          current.workflowStatus === 'REJECTED'
            ? 'RESUBMITTED'
            : 'SUBMITTED';
        await this.appendWorkflowEvent(tx, actor, current, {
          eventType: submitEventType,
          fromStatus: current.workflowStatus,
          toStatus: 'PENDING',
          workflowVersion: pendingVersion,
          idempotencyKey: isSpecialOrderReviewer(actor)
            ? `${idempotencyKey}:submitted`
            : idempotencyKey,
          requestHash: hash,
          payloadSnapshot: {
            orderId,
            submittedAt: now.toISOString(),
          },
        });

        if (!isSpecialOrderReviewer(actor)) {
          const next = await this.reload(tx, orderId);
          await this.appendOperationLog(
            tx,
            actor,
            submitEventType.toLowerCase(),
            current,
            next,
            metadata,
          );
          return next;
        }

        const approvedVersion = pendingVersion + 1;
        const approvedClaim = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: 'PENDING',
            workflowVersion: pendingVersion,
          },
          data: {
            workflowStatus: 'APPROVED',
            workflowVersion: approvedVersion,
            approvedById: actor.id,
            approvedAt: now,
            inventoryAppliedAt: now,
            inventoryPolicyVersion: 1,
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        assertClaimed(approvedClaim);
        const pending = await this.reload(tx, orderId);
        const posting = await this.inventory.postApprovalInTransaction(
          tx,
          actor,
          pending,
          approvedVersion,
          metadata,
        );
        receiptIds.push(...posting.commandReceiptIds);
        await createSettlement(tx, pending, now);
        await this.refreshCommissionOnApproval(tx, pending, actor);
        await this.appendWorkflowEvent(tx, actor, pending, {
          eventType: 'AUTO_APPROVE',
          fromStatus: 'PENDING',
          toStatus: 'APPROVED',
          workflowVersion: approvedVersion,
          idempotencyKey,
          requestHash: hash,
          payloadSnapshot: {
            autoApproved: true,
            inventoryDocumentIds: posting.documentIds,
          },
        });
        const next = await this.reload(tx, orderId);
        await this.appendOperationLog(
          tx,
          actor,
          'auto_approve',
          current,
          next,
          metadata,
        );
        return next;
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    await this.inventory.dispatchCommittedReceipts(receiptIds);
    return toSpecialOrderDto(submitted);
  }

  async withdraw(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderCreator(actor);
    const body = normalizeObject(payload, 'special order withdrawal');
    return this.transition(actor, id, body, metadata, {
      action: 'withdraw',
      allowedFrom: ['PENDING'],
      toStatus: 'DRAFT',
      eventType: 'WITHDRAWN',
      authorize: (current) => {
        if (current.createdById !== actor.id) {
          notFound();
        }
      },
      reason: optionalReason(body.reason),
    });
  }

  async approve(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderReviewer(actor);
    const body = normalizeObject(payload, 'special order approval');
    const orderId = requiredId(id, 'id');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const hash = requestHash(body);
    const receiptIds: string[] = [];
    const approved = await this.db().$transaction(
      async (tx: any) => {
        const replay = await this.resolveEventReplay(
          tx,
          actor,
          orderId,
          idempotencyKey,
          hash,
        );
        if (replay) {
          return replay;
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        if (current.workflowStatus !== 'PENDING') {
          invalidTransition(current.workflowStatus, 'approve');
        }
        assertVersion(current, expectedVersion);
        await validatePersistedOrderForSubmission(tx, current);
        const now = new Date();
        const nextVersion = await claimSpecialOrderTransition(
          tx.salesOrder,
          {
            id: orderId,
            fromStatus: 'PENDING',
            toStatus: 'APPROVED',
            expectedVersion,
            data: {
            approvedById: actor.id,
            approvedAt: now,
            inventoryAppliedAt: now,
            inventoryPolicyVersion: 1,
            rejectionReason: null,
            updatedById: actor.id,
            updatedAt: now,
            },
          },
        );
        const claimedOrder = await this.reload(tx, orderId);
        const posting = await this.inventory.postApprovalInTransaction(
          tx,
          actor,
          claimedOrder,
          nextVersion,
          metadata,
        );
        receiptIds.push(...posting.commandReceiptIds);
        await createSettlement(tx, claimedOrder, now);
        await this.refreshCommissionOnApproval(
          tx,
          claimedOrder,
          actor,
        );
        await this.appendWorkflowEvent(tx, actor, claimedOrder, {
          eventType: 'APPROVED',
          fromStatus: 'PENDING',
          toStatus: 'APPROVED',
          workflowVersion: nextVersion,
          idempotencyKey,
          requestHash: hash,
          payloadSnapshot: {
            inventoryDocumentIds: posting.documentIds,
          },
        });
        const next = await this.reload(tx, orderId);
        await this.appendOperationLog(
          tx,
          actor,
          'approve',
          current,
          next,
          metadata,
        );
        return next;
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    await this.inventory.dispatchCommittedReceipts(receiptIds);
    return toSpecialOrderDto(approved);
  }

  async reject(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderReviewer(actor);
    const body = normalizeObject(payload, 'special order rejection');
    return this.transition(actor, id, body, metadata, {
      action: 'reject',
      allowedFrom: ['PENDING'],
      toStatus: 'REJECTED',
      eventType: 'REJECTED',
      reason: requiredReason(body.reason),
      data: {
        rejectionReason: requiredReason(body.reason),
      },
    });
  }

  async unapprove(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderReviewer(actor);
    const body = normalizeObject(payload, 'special order unapproval');
    const reason = requiredReason(body.reason);
    const orderId = requiredId(id, 'id');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const hash = requestHash(body);
    const receiptIds: string[] = [];
    const unapproved = await this.db().$transaction(
      async (tx: any) => {
        const replay = await this.resolveEventReplay(
          tx,
          actor,
          orderId,
          idempotencyKey,
          hash,
        );
        if (replay) {
          return replay;
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        if (
          !['APPROVED', 'COMPLETED'].includes(current.workflowStatus)
        ) {
          invalidTransition(current.workflowStatus, 'unapprove');
        }
        assertVersion(current, expectedVersion);
        await assertCommissionReversalIsSafe(tx, orderId);
        const nextVersion = expectedVersion + 1;
        const claimed = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: current.workflowStatus,
            workflowVersion: expectedVersion,
          },
          data: {
            workflowStatus: 'PENDING',
            workflowVersion: nextVersion,
            approvedById: null,
            approvedAt: null,
            completedAt: null,
            completedById: null,
            inventoryAppliedAt: null,
            unapprovalReason: reason,
            updatedById: actor.id,
            updatedAt: new Date(),
          },
        });
        assertClaimed(claimed);
        const posting = await this.inventory.reverseInTransaction(
          tx,
          actor,
          current,
          nextVersion,
          reason,
          metadata,
        );
        receiptIds.push(...posting.commandReceiptIds);
        await reverseActiveSettlement(
          tx,
          current,
          actor,
          reason,
        );
        await reverseUnconfirmedCommissions(tx, orderId);
        await this.appendWorkflowEvent(tx, actor, current, {
          eventType: 'UNAPPROVED',
          fromStatus: current.workflowStatus,
          toStatus: 'PENDING',
          workflowVersion: nextVersion,
          idempotencyKey,
          requestHash: hash,
          reason,
          payloadSnapshot: {
            reversalDocumentIds: posting.documentIds,
            financialReversed: true,
          },
        });
        const next = await this.reload(tx, orderId);
        await this.appendOperationLog(
          tx,
          actor,
          'unapprove',
          current,
          next,
          metadata,
        );
        return next;
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    await this.inventory.dispatchCommittedReceipts(receiptIds);
    return toSpecialOrderDto(unapproved);
  }

  async complete(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderReviewer(actor);
    const body = normalizeObject(payload, 'special order completion');
    const orderId = requiredId(id, 'id');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const hash = requestHash(body);
    const receiptIds: string[] = [];
    const completed = await this.db().$transaction(
      async (tx: any) => {
        const replay = await this.resolveEventReplay(
          tx,
          actor,
          orderId,
          idempotencyKey,
          hash,
        );
        if (replay) {
          return replay;
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        if (current.workflowStatus !== 'APPROVED') {
          invalidTransition(current.workflowStatus, 'complete');
        }
        assertVersion(current, expectedVersion);
        const nextVersion = expectedVersion + 1;
        const now = new Date();
        const claimed = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: 'APPROVED',
            workflowVersion: expectedVersion,
          },
          data: {
            workflowStatus: 'COMPLETED',
            workflowVersion: nextVersion,
            completedAt: now,
            completedById: actor.id,
            packingStatus: 'PACKED',
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        assertClaimed(claimed);
        const posting = await this.inventory.postCompletionInTransaction(
          tx,
          actor,
          current,
          nextVersion,
          metadata,
        );
        receiptIds.push(...posting.commandReceiptIds);
        await this.appendWorkflowEvent(tx, actor, current, {
          eventType: 'COMPLETED',
          fromStatus: 'APPROVED',
          toStatus: 'COMPLETED',
          workflowVersion: nextVersion,
          idempotencyKey,
          requestHash: hash,
          payloadSnapshot: {
            inventoryDocumentIds: posting.documentIds,
          },
        });
        const next = await this.reload(tx, orderId);
        await this.appendOperationLog(
          tx,
          actor,
          'complete',
          current,
          next,
          metadata,
        );
        return next;
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    await this.inventory.dispatchCommittedReceipts(receiptIds);
    return toSpecialOrderDto(completed);
  }

  async recordPayment(
    actor: any,
    id: string,
    payload: unknown,
    metadata: any = {},
  ) {
    requireSpecialOrderReviewer(actor);
    const body = normalizeObject(payload, 'special order payment');
    assertAllowedFields(
      body,
      [
        'idempotencyKey',
        'workflowVersion',
        'amountCents',
        'paymentMethodId',
        'paymentMethodName',
        'paidAt',
        'referenceNo',
        'remark',
      ],
      'special order payment',
    );
    const orderId = requiredId(id, 'id');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const amountCents = requiredInteger(
      body.amountCents,
      'amountCents',
      { min: 1 },
    );
    const hash = requestHash(body);
    const paid = await this.db().$transaction(
      async (tx: any) => {
        const paymentReplay =
          await tx.specialOrderPayment.findUnique({
            where: { idempotencyKey },
          });
        if (paymentReplay) {
          if (
            paymentReplay.requestHash !== hash ||
            paymentReplay.salesOrderId !== orderId
          ) {
            idempotencyConflict();
          }
          return this.loadScopedOrder(tx, actor, orderId);
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        if (
          !SPECIAL_ORDER_EFFECTIVE_STATUSES.has(
            current.workflowStatus,
          )
        ) {
          invalidTransition(current.workflowStatus, 'record payment for');
        }
        assertVersion(current, expectedVersion);
        const settlement = (current.specialSettlements || []).find(
          (value: any) => value.isActive,
        );
        if (!settlement) {
          throw createHttpError(
            409,
            'SPECIAL_ORDER_SETTLEMENT_MISSING',
            'The approved special order has no active settlement.',
          );
        }
        const nextSettled =
          Number(settlement.settledAmountCents || 0) + amountCents;
        if (nextSettled > Number(settlement.totalAmountCents || 0)) {
          throw createHttpError(
            409,
            'SPECIAL_ORDER_PAYMENT_EXCEEDS_BALANCE',
            'Payment amount exceeds the unsettled special-order balance.',
          );
        }
        const method = body.paymentMethodId
          ? await tx.paymentMethod.findUnique({
              where: {
                id: requiredId(
                  body.paymentMethodId,
                  'paymentMethodId',
                ),
              },
            })
          : null;
        if (body.paymentMethodId && !method?.isActive) {
          throw createHttpError(
            404,
            'PAYMENT_METHOD_NOT_FOUND',
            'Active payment method does not exist.',
          );
        }
        const methodName = method?.name
          ? String(method.name)
          : requiredText(
              body.paymentMethodName,
              'paymentMethodName',
              80,
            );
        const nextVersion = expectedVersion + 1;
        const claimed = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: current.workflowStatus,
            workflowVersion: expectedVersion,
          },
          data: {
            workflowVersion: nextVersion,
            updatedById: actor.id,
            updatedAt: new Date(),
          },
        });
        assertClaimed(claimed);
        const paymentStatus =
          nextSettled === Number(settlement.totalAmountCents)
            ? 'PAID'
            : 'PARTIAL';
        const settlementClaimed =
          await tx.specialOrderSettlement.updateMany({
            where: {
              id: settlement.id,
              version: settlement.version,
              isActive: true,
            },
            data: {
              settledAmountCents: nextSettled,
              paymentStatus,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
        assertClaimed(settlementClaimed);
        const payment = await tx.specialOrderPayment.create({
          data: {
            id: crypto.randomUUID(),
            salesOrderId: orderId,
            settlementId: settlement.id,
            direction: settlement.direction,
            amountCents,
            paymentMethodId: method?.id || null,
            paymentMethodNameSnapshot: methodName,
            paidAt: optionalDate(body.paidAt, 'paidAt') || new Date(),
            referenceNo: optionalText(
              body.referenceNo,
              'referenceNo',
              120,
            ),
            remark: optionalText(body.remark, 'remark', 500),
            idempotencyKey,
            requestHash: hash,
            recordedById: actor.id,
            createdAt: new Date(),
          },
        });
        await this.appendWorkflowEvent(tx, actor, current, {
          eventType: 'PAYMENT_RECORDED',
          fromStatus: current.workflowStatus,
          toStatus: current.workflowStatus,
          workflowVersion: nextVersion,
          idempotencyKey,
          requestHash: hash,
          payloadSnapshot: {
            paymentId: payment.id,
            direction: normalizeEnum(settlement.direction),
            amountCents,
            paymentStatus,
          },
        });
        const next = await this.reload(tx, orderId);
        await this.appendOperationLog(
          tx,
          actor,
          'payment_recorded',
          current,
          next,
          metadata,
        );
        return next;
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    return toSpecialOrderDto(paid);
  }

  async exportXlsx(actor: any, filters: any = {}) {
    requireSpecialOrderReviewer(actor);
    const orders = await this.db().salesOrder.findMany({
      where: buildListWhere(actor, filters),
      include: SPECIAL_ORDER_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5_001,
    });
    if (orders.length > 5_000) {
      throw createHttpError(
        400,
        'SPECIAL_ORDER_EXPORT_LIMIT_EXCEEDED',
        'Special-order export exceeds 5000 orders. Narrow the filters.',
      );
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Jiangjiu Special Orders';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('内购外销回购订单', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { header: '订单号', key: 'orderNo', width: 20 },
      { header: '订单类型', key: 'orderType', width: 12 },
      { header: '客户姓名', key: 'customerName', width: 18 },
      { header: '手机号', key: 'customerPhone', width: 16 },
      { header: '地址', key: 'customerAddress', width: 32 },
      { header: '商品明细', key: 'items', width: 42 },
      { header: '上单金额(元)', key: 'totalAmount', width: 16 },
      { header: '已支付金额(元)', key: 'paidAmount', width: 16 },
      { header: '未支付金额(元)', key: 'unpaidAmount', width: 16 },
      { header: '支付方式汇总', key: 'paymentSummary', width: 34 },
      { header: '结算状态', key: 'paymentStatus', width: 14 },
      { header: '提成对象汇总', key: 'commissionRecipients', width: 28 },
      { header: '提成比例汇总', key: 'commissionRates', width: 22 },
      { header: '有效提成总额(元)', key: 'commissionTotal', width: 18 },
      { header: '提成状态', key: 'commissionStatus', width: 14 },
      { header: '订单日期', key: 'orderDate', width: 14 },
      { header: '创建人', key: 'creator', width: 16 },
      { header: '创建时间', key: 'createdAt', width: 22 },
      { header: '作废/退款状态', key: 'status', width: 16 },
      { header: '备注', key: 'remark', width: 30 },
    ];
    for (const raw of orders) {
      const order = toSpecialOrderDto(raw);
      const activeSettlement = order.settlement;
      const commissions = (raw.commissionRecords || []).filter(
        (record: any) => record.isActive !== false,
      );
      const paidAmountCents = Number(
        activeSettlement?.settledAmountCents || 0,
      );
      sheet.addRow({
        orderNo: order.orderNo,
        orderType: orderTypeLabel(order.orderType),
        customerName: order.customerName,
        customerPhone: order.customerPhone || '',
        customerAddress: [
          order.province,
          order.city,
          order.district,
          order.address,
        ]
          .filter(Boolean)
          .join(''),
        items: order.items
          .map(
            (item: any) =>
              `${item.productName} × ${item.quantity} = ${(item.subtotalCents / 100).toFixed(2)}`,
          )
          .join('\n'),
        totalAmount: order.totalAmountCents / 100,
        paidAmount: paidAmountCents / 100,
        unpaidAmount:
          Math.max(0, order.totalAmountCents - paidAmountCents) / 100,
        paymentSummary: (activeSettlement?.payments || [])
          .map(
            (payment: any) =>
              `${payment.paymentMethodNameSnapshot} ${(payment.amountCents / 100).toFixed(2)}`,
          )
          .join('；'),
        paymentStatus: activeSettlement?.paymentStatus || 'unpaid',
        commissionRecipients: commissions
          .map(
            (record: any) =>
              record.recipientNameSnapshot || record.targetUser?.name || '',
          )
          .filter(Boolean)
          .join('；'),
        commissionRates: commissions
          .map(
            (record: any) =>
              `${(Number(record.rateSnapshot || 0) * 100).toFixed(2)}%`,
          )
          .join('；'),
        commissionTotal:
          commissions.reduce(
            (sum: number, record: any) =>
              sum + Number(record.amountCents || 0),
            0,
          ) / 100,
        commissionStatus: commissions.length > 0 ? '已维护' : '未维护',
        orderDate: order.orderDate,
        creator: order.createdBy?.name || '',
        createdAt: order.createdAt || '',
        status: `${workflowStatusLabel(order.workflowStatus)}/${String(raw.status || '').toLowerCase()}`,
        remark: order.remark || '',
      });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
    for (const key of [
      'totalAmount',
      'paidAmount',
      'unpaidAmount',
      'commissionTotal',
    ]) {
      sheet.getColumn(key).numFmt = '0.00';
    }

    const commissionSheet = workbook.addWorksheet('提成明细', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    commissionSheet.columns = [
      { header: '订单号', key: 'orderNo', width: 20 },
      { header: '订单类型', key: 'orderType', width: 12 },
      { header: '对象类型', key: 'recipientType', width: 16 },
      { header: '员工账号/人员姓名', key: 'recipient', width: 24 },
      { header: '提成基数(元)', key: 'base', width: 16 },
      { header: '比例', key: 'rate', width: 12 },
      { header: '原提成金额(元)', key: 'original', width: 18 },
      { header: '冲减金额(元)', key: 'adjustment', width: 16 },
      { header: '有效金额(元)', key: 'effective', width: 16 },
      { header: '归属日期', key: 'attributionDate', width: 14 },
      { header: '操作记录', key: 'operations', width: 48 },
    ];
    for (const raw of orders) {
      for (const record of raw.commissionRecords || []) {
        commissionSheet.addRow({
          orderNo: raw.orderNo,
          orderType: orderTypeLabel(
            String(raw.orderType || '').toLowerCase(),
          ),
          recipientType:
            String(record.recipientType || '').toUpperCase() === 'EMPLOYEE'
              ? '内部员工'
              : '非员工/其他人员',
          recipient:
            record.targetUser?.username ||
            record.recipientNameSnapshot ||
            '',
          base: Number(record.baseAmountCents || 0) / 100,
          rate: `${(Number(record.rateSnapshot || 0) * 100).toFixed(2)}%`,
          original: Number(record.originalAmountCents || 0) / 100,
          adjustment: Number(record.adjustmentAmountCents || 0) / 100,
          effective: Number(record.amountCents || 0) / 100,
          attributionDate: formatDate(
            record.attributionDate || raw.orderDate,
          ),
          operations: (record.adjustments || [])
            .map(
              (item: any) =>
                `${toIso(item.createdAt) || ''} ${item.adjustmentType || ''} ${item.reason || ''}`,
            )
            .join('\n'),
        });
      }
    }
    commissionSheet.getRow(1).font = { bold: true };
    for (const key of ['base', 'original', 'adjustment', 'effective']) {
      commissionSheet.getColumn(key).numFmt = '0.00';
    }
    const data = await workbook.xlsx.writeBuffer();
    return {
      fileName: `special-orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
      buffer: Buffer.from(data as any),
    };
  }

  async getPrintData(actor: any, id: string) {
    const order = await this.get(actor, id);
    return {
      page: {
        size: 'A4',
        orientation: 'portrait',
      },
      title: `${orderTypeLabel(order.orderType)}单`,
      companyRole:
        order.orderType === 'buyback' ? 'buyer' : 'seller',
      companyRoleLabel:
        order.orderType === 'buyback'
          ? '本公司为买方'
          : '本公司为卖方',
      order,
      totals: {
        totalAmountCents: order.totalAmountCents,
        receivableTotalCents:
          order.orderType === 'buyback' ? 0 : order.totalAmountCents,
        payableTotalCents:
          order.orderType === 'buyback' ? order.totalAmountCents : 0,
        netCashFlowCents:
          order.orderType === 'buyback'
            ? -order.totalAmountCents
            : order.totalAmountCents,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async transition(
    actor: any,
    id: string,
    body: Record<string, any>,
    metadata: any,
    config: {
      action: string;
      allowedFrom: string[];
      toStatus: string;
      eventType: string;
      authorize?: (current: any) => void;
      reason?: string | null;
      data?: Record<string, any>;
    },
  ) {
    const orderId = requiredId(id, 'id');
    const idempotencyKey = requiredIdempotencyKey(body.idempotencyKey);
    const expectedVersion = requiredWorkflowVersion(body.workflowVersion);
    const hash = requestHash(body);
    const changed = await this.db().$transaction(
      async (tx: any) => {
        const replay = await this.resolveEventReplay(
          tx,
          actor,
          orderId,
          idempotencyKey,
          hash,
        );
        if (replay) {
          return replay;
        }
        const current = await this.loadScopedOrder(tx, actor, orderId);
        config.authorize?.(current);
        if (!config.allowedFrom.includes(current.workflowStatus)) {
          invalidTransition(current.workflowStatus, config.action);
        }
        assertVersion(current, expectedVersion);
        const nextVersion = expectedVersion + 1;
        const claimed = await tx.salesOrder.updateMany({
          where: {
            id: orderId,
            workflowStatus: current.workflowStatus,
            workflowVersion: expectedVersion,
          },
          data: {
            workflowStatus: config.toStatus,
            workflowVersion: nextVersion,
            ...config.data,
            updatedById: actor.id,
            updatedAt: new Date(),
          },
        });
        assertClaimed(claimed);
        await this.appendWorkflowEvent(tx, actor, current, {
          eventType: config.eventType,
          fromStatus: current.workflowStatus,
          toStatus: config.toStatus,
          workflowVersion: nextVersion,
          idempotencyKey,
          requestHash: hash,
          reason: config.reason || null,
          payloadSnapshot: { orderId },
        });
        const next = await this.reload(tx, orderId);
        await this.appendOperationLog(
          tx,
          actor,
          config.action,
          current,
          next,
          metadata,
        );
        return next;
      },
      MUTATION_TRANSACTION_OPTIONS,
    );
    return toSpecialOrderDto(changed);
  }

  private async reload(tx: any, id: string) {
    const order = await tx.salesOrder.findUnique({
      where: { id },
      include: SPECIAL_ORDER_INCLUDE,
    });
    if (!order) {
      notFound();
    }
    return order;
  }

  private async loadScopedOrder(tx: any, actor: any, id: string) {
    const order = await tx.salesOrder.findUnique({
      where: { id },
      include: SPECIAL_ORDER_INCLUDE,
    });
    if (!order || !order.workflowStatus) {
      notFound();
    }
    if (!['INTERNAL', 'EXTERNAL', 'BUYBACK'].includes(order.orderType)) {
      notFound();
    }
    assertScoped(actor, order);
    return order;
  }

  private async resolveEventReplay(
    tx: any,
    actor: any,
    orderId: string,
    idempotencyKey: string,
    hash: string,
  ) {
    const event = await tx.specialOrderWorkflowEvent.findUnique({
      where: { idempotencyKey },
    });
    if (!event) {
      return null;
    }
    if (
      event.salesOrderId !== orderId ||
      event.requestHash !== hash
    ) {
      idempotencyConflict();
    }
    return this.loadScopedOrder(tx, actor, orderId);
  }

  private async appendWorkflowEvent(
    tx: any,
    actor: any,
    order: any,
    input: any,
  ) {
    await tx.specialOrderWorkflowEvent.create({
      data: {
        id: crypto.randomUUID(),
        salesOrderId: order.id,
        eventType: input.eventType,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        workflowVersion: input.workflowVersion,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        reason: input.reason || null,
        payloadSnapshot: input.payloadSnapshot || null,
        actorUserId: actor.id,
        actorNameSnapshot: actor.name || null,
        actorRoleSnapshot: actor.role || null,
        createdAt: new Date(),
      },
    });
  }

  private async appendOperationLog(
    tx: any,
    actor: any,
    action: string,
    before: any,
    after: any,
    metadata: any,
  ) {
    await this.operationLogs.appendLog(
      {
        userId: actor.id,
        action: `special_orders.${action}`,
        module: 'special_orders',
        operationType: action === 'create' ? 'CREATE' : 'UPDATE',
        entityType: 'special_order',
        entityId: after?.id || before?.id,
        beforeData: before ? eventOrderSnapshot(before) : null,
        afterData: after ? eventOrderSnapshot(after) : null,
        requestSummary: {
          workflowVersion:
            after?.workflowVersion ?? before?.workflowVersion,
          workflowStatus:
            after?.workflowStatus ?? before?.workflowStatus,
        },
        ipAddress: metadata?.ipAddress || null,
        requestId: metadata?.requestId || null,
      },
      tx,
    );
  }

  private async refreshCommissionOnApproval(
    tx: any,
    order: any,
    actor: any,
  ) {
    if (normalizeEnum(order.orderType) === 'BUYBACK') {
      await tx.commissionRecord.deleteMany({
        where: {
          salesOrderId: order.id,
          manualInput: false,
        },
      });
      return;
    }
    await this.commissions.recalculateSalesOrderRecords(order.id, {
      prisma: tx,
      actor,
    });
  }

  private db(): any {
    return this.prisma as any;
  }
}

async function resolveSpecialOrderInput(
  tx: any,
  actor: any,
  body: Record<string, any>,
  existing?: any,
) {
  const orderType = normalizeSpecialOrderType(
    body.orderType ?? existing?.orderType,
  );
  if (
    existing &&
    normalizeEnum(existing.orderType) !== orderType
  ) {
    throw createHttpError(
      409,
      'SPECIAL_ORDER_TYPE_IMMUTABLE',
      'Special order type cannot change after creation.',
    );
  }
  const orderDate = requiredDate(
    body.orderDate ?? existing?.orderDate,
    'orderDate',
  );
  const remark = optionalText(
    body.remark ?? existing?.remark,
    'remark',
    2_000,
  );
  const defaultWarehouse =
    orderType === 'BUYBACK'
      ? await requireDefaultWarehouse(tx)
      : null;
  const customer = await resolveSpecialOrderCustomer(
    tx,
    actor,
    body,
    existing,
  );
  const customerName = customer.name;
  const sourceSalesOrderId: string | null = null;
  const sourceRemark: string | null = null;
  const hasOriginalPurchase: boolean | null = null;
  const internalEmployeeId: string | null = null;
  const externalPartyType: string | null = null;
  const externalPartyId: string | null = null;
  const externalPartyNameSnapshot: string | null = null;

  const itemBodies = Array.isArray(body.items)
    ? body.items
    : existing
      ? persistedItemsToInput(existing.items)
      : null;
  if (!itemBodies || itemBodies.length === 0) {
    validation('items must contain at least one product line.');
  }
  if (itemBodies.length > 200) {
    validation('items must not contain more than 200 product lines.');
  }
  const productIds = Array.from(
    new Set(
      itemBodies.map((item: any, index: number) =>
        requiredId(item?.productId, `items[${index}].productId`),
      ),
    ),
  );
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
  });
  const productById = new Map(
    products.map((product: any) => [product.id, product]),
  );
  const items = [];
  const warehouseIds = new Set<string>();
  let totalAmountCents = 0;
  let hasShipping = false;
  const allCodes = new Set<string>();

  for (const [index, raw] of itemBodies.entries()) {
    const item = normalizeObject(raw, `items[${index}]`);
    const productId = requiredId(
      item.productId,
      `items[${index}].productId`,
    );
    const product: any = productById.get(productId);
    if (!product?.isActive) {
      throw createHttpError(
        404,
        'PRODUCT_NOT_FOUND',
        `Active product does not exist for items[${index}].`,
      );
    }
    const quantity = requiredInteger(
      item.quantity,
      `items[${index}].quantity`,
      { min: 1, max: 100_000 },
    );
    const subtotalCents = requiredInteger(
      item.totalPriceCents ?? item.subtotalCents,
      `items[${index}].totalPriceCents`,
      { min: 0 },
    );
    const unitPriceCents = Math.round(subtotalCents / quantity);
    const listUnitPriceCents = unitPriceCents;
    const isGift = false;
    const priceOverrideReason = null;
    const adjustmentReason = null;
    totalAmountCents = safeAdd(totalAmountCents, subtotalCents);
    const discountAmountCents = 0;
    const deliveryType = normalizeDeliveryType(item.deliveryType);
    hasShipping = hasShipping || deliveryType === 'SHIPPING';
    const warehouseId =
      orderType === 'BUYBACK'
        ? defaultWarehouse.id
        : requiredId(
            item.warehouseId,
            `items[${index}].warehouseId`,
          );
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
    });
    if (!warehouse?.isActive) {
      throw createHttpError(
        409,
        'SPECIAL_ORDER_WAREHOUSE_INACTIVE',
        `Active warehouse does not exist for items[${index}].`,
      );
    }
    warehouseIds.add(warehouseId);
    const inventoryCondition = normalizeInventoryCondition(
      item.inventoryCondition,
    );
    const rawCodes = Array.isArray(item.logisticsCodes)
      ? item.logisticsCodes
      : Array.isArray(item.specialSerializedUnits)
        ? item.specialSerializedUnits.map(
            (serial: any) =>
              serial.logisticsCodeSnapshot || serial.logisticsCode,
          )
        : [];
    const serials = rawCodes.map(
      (value: any, serialIndex: number) => {
        const code = normalizeLogisticsCode(
          typeof value === 'object'
            ? value.logisticsCode || value.logisticsCodeSnapshot
            : value,
          `items[${index}].logisticsCodes[${serialIndex}]`,
        );
        if (allCodes.has(code.normalized)) {
          validation(
            `Duplicate logistics code in order: ${code.snapshot}.`,
          );
        }
        allCodes.add(code.normalized);
        return {
          id: crypto.randomUUID(),
          logisticsCodeSnapshot: code.snapshot,
          normalizedLogisticsCode: code.normalized,
          sortOrder: serialIndex,
          createdAt: new Date(),
        };
      },
    );
    if (
      orderType === 'BUYBACK' &&
      normalizeEnum(product.inventoryTrackingMode) === 'SERIALIZED' &&
      (quantity <= 0 || serials.length !== quantity)
    ) {
      validation(
        `items[${index}] requires exactly one logistics code per serialized buyback bottle.`,
      );
    }
    if (
      !(
        orderType === 'BUYBACK' &&
        normalizeEnum(product.inventoryTrackingMode) === 'SERIALIZED'
      ) &&
      serials.length > 0
    ) {
      validation(
        `items[${index}].logisticsCodes is only accepted for serialized buyback lines.`,
      );
    }
    const actualCost =
      orderType === 'BUYBACK'
        ? null
        : await tx.productActualCost.findFirst({
            where: {
              productId: product.id,
              isActive: true,
              effectiveFrom: { lte: orderDate },
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gte: orderDate } },
              ],
            },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
          });
    const actualUnitCostCents = actualCost
      ? Number(actualCost.costCents || 0)
      : null;
    const actualCostSubtotalCents =
      actualUnitCostCents === null
        ? null
        : actualUnitCostCents * quantity;
    const itemId = crypto.randomUUID();
    items.push({
      data: {
        id: itemId,
        inventoryLineKey: `special-line:${itemId}`,
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPriceCents,
        subtotalCents,
        actualUnitCostCents,
        actualCostSubtotalCents,
        grossProfitCents:
          actualCostSubtotalCents === null
            ? null
            : subtotalCents - actualCostSubtotalCents,
        deliveryType,
        warehouseId,
        listUnitPriceCents,
        discountAmountCents,
        isGift,
        priceOverrideReason,
        adjustmentReason,
        inventoryCondition,
        notes: optionalText(
          item.notes,
          `items[${index}].notes`,
          2_000,
        ),
        sortOrder: index,
        createdAt: new Date(),
      },
      serials,
    });
  }
  if (totalAmountCents < 0) {
    validation('The whole special-order amount must not be negative.');
  }

  const attachments = normalizeAttachments(
    body.attachments ??
      (existing
        ? existing.specialAttachments
        : []),
  );
  const payments = await resolveSpecialOrderPayments(
    tx,
    body.payments ??
      (existing ? persistedPaymentsToInput(existing) : []),
    totalAmountCents,
  );
  return {
    orderType,
    orderDate,
    remark,
    customer,
    customerName,
    sourceSalesOrderId,
    sourceRemark,
    hasOriginalPurchase,
    internalEmployeeId,
    externalPartyType,
    externalPartyId,
    externalPartyNameSnapshot,
    items,
    totalAmountCents,
    hasShipping,
    singleWarehouseId:
      warehouseIds.size === 1
        ? Array.from(warehouseIds)[0]
        : null,
    attachments,
    payments,
  };
}

async function validatePersistedOrderForSubmission(
  tx: any,
  order: any,
) {
  const input = payloadFromExisting(order, {});
  await resolveSpecialOrderInput(tx, order.createdBy || {}, input, order);
}

function payloadFromExisting(
  order: any,
  patch: Record<string, any>,
) {
  return {
    orderType: String(order.orderType).toLowerCase(),
    orderDate: formatDate(order.orderDate),
    customerId: order.customerId,
    customer: order.customer
      ? {
          name: order.customer.name,
          phone: order.customer.phone,
          province: order.customer.province,
          city: order.customer.city,
          district: order.customer.district,
          address: order.customer.address,
          notes: order.customer.notes,
        }
      : undefined,
    hasOriginalPurchase: order.hasOriginalPurchase,
    sourceSalesOrderId: order.sourceSalesOrderId,
    sourceRemark: order.sourceRemark,
    internalEmployeeId: order.internalEmployeeId,
    externalPartyType: order.externalPartyType
      ? String(order.externalPartyType).toLowerCase()
      : null,
    externalPartyId: order.externalPartyId,
    externalPartyName: order.externalPartyNameSnapshot,
    remark: order.remark,
    payments: persistedPaymentsToInput(order),
    items: persistedItemsToInput(order.items),
    attachments: (order.specialAttachments || []).map(
      (attachment: any) => ({
        originalName: attachment.originalName,
        storageKey: attachment.storageKey,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        checksumSha256: attachment.checksumSha256,
      }),
    ),
    ...patch,
  };
}

function persistedItemsToInput(items: any[]) {
  return (items || []).map((item: any) => ({
    productId: item.productId,
    warehouseId: item.warehouseId,
    quantity: item.quantity,
    totalPriceCents: item.subtotalCents,
    inventoryCondition: String(
      item.inventoryCondition || 'SALEABLE',
    ).toLowerCase(),
    deliveryType: String(item.deliveryType).toLowerCase(),
    notes: item.notes,
    logisticsCodes: (item.specialSerializedUnits || []).map(
      (serial: any) => serial.logisticsCodeSnapshot,
    ),
  }));
}

function persistedPaymentsToInput(order: any) {
  const activeSettlement = (order?.specialSettlements || []).find(
    (settlement: any) => settlement?.isActive,
  );
  return (activeSettlement?.payments || [])
    .filter((payment: any) => !payment.reversedAt)
    .map((payment: any) => ({
      paymentMethodId: payment.paymentMethodId,
      amountCents: Number(payment.amountCents || 0),
      paidAt: payment.paidAt,
      referenceNo: payment.referenceNo,
      remark: payment.remark,
    }));
}

async function resolveSpecialOrderCustomer(
  tx: any,
  actor: any,
  body: Record<string, any>,
  existing?: any,
) {
  const customerId = optionalId(
    body.customerId ??
      (body.customer === undefined ? existing?.customerId : null),
    'customerId',
  );
  const customerPayload = body.customer;
  if (customerId) {
    const current = await tx.customer.findUnique({ where: { id: customerId } });
    if (!current) {
      throw createHttpError(
        404,
        'CUSTOMER_NOT_FOUND',
        'Customer does not exist.',
      );
    }
    if (customerPayload === undefined) return current;
    const patch = normalizeCustomerData(customerPayload, actor, false);
    return tx.customer.update({
      where: { id: current.id },
      data: patch,
    });
  }

  if (!customerPayload || typeof customerPayload !== 'object' || Array.isArray(customerPayload)) {
    validation('customerId or customer is required.');
  }
  const data = normalizeCustomerData(customerPayload, actor, true);
  const duplicateClauses: any[] = [];
  if (data.phone) duplicateClauses.push({ phone: data.phone });
  duplicateClauses.push({
    name: data.name,
    address: data.address,
  });
  const duplicate = await tx.customer.findFirst({
    where: { OR: duplicateClauses },
    orderBy: { updatedAt: 'desc' },
  });
  if (duplicate) {
    return tx.customer.update({
      where: { id: duplicate.id },
      data: normalizeCustomerData(customerPayload, actor, false),
    });
  }
  return tx.customer.create({
    data: {
      id: crypto.randomUUID(),
      ...data,
    },
  });
}

function normalizeCustomerData(payload: any, actor: any, creating: boolean) {
  const now = new Date();
  const data: any = {
    updatedById: actor.id,
    updatedAt: now,
  };
  const fields = ['phone', 'province', 'city', 'district', 'address', 'notes'];
  if (creating || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    data.name = requiredText(payload.name, 'customer.name', 100);
  }
  for (const field of fields) {
    if (creating || Object.prototype.hasOwnProperty.call(payload, field)) {
      const maxLength = field === 'phone' ? 30 : field === 'address' ? 255 : field === 'notes' ? 2_000 : 60;
      data[field] = optionalText(payload[field], `customer.${field}`, maxLength);
    }
  }
  if (creating) {
    Object.assign(data, {
      financeMark: false,
      markedById: null,
      markedAt: null,
      createdById: actor.id,
      createdAt: now,
    });
  }
  return data;
}

async function resolveSpecialOrderPayments(
  tx: any,
  value: unknown,
  orderTotalCents: number,
) {
  if (!Array.isArray(value)) {
    validation('payments must be an array.');
  }
  if (value.length > 50) {
    validation('payments must not contain more than 50 entries.');
  }
  const payments = [];
  let paidAmountCents = 0;
  for (const [index, raw] of value.entries()) {
    const payment = normalizeObject(raw, `payments[${index}]`);
    const paymentMethodId = requiredId(
      payment.paymentMethodId,
      `payments[${index}].paymentMethodId`,
    );
    const method = await tx.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });
    if (!method?.isActive) {
      throw createHttpError(
        404,
        'PAYMENT_METHOD_NOT_FOUND',
        `Active payment method does not exist for payments[${index}].`,
      );
    }
    const amountCents = requiredInteger(
      payment.amountCents,
      `payments[${index}].amountCents`,
      { min: 1 },
    );
    paidAmountCents = safeAdd(paidAmountCents, amountCents);
    payments.push({
      paymentMethodId: method.id,
      paymentMethodNameSnapshot: method.name,
      amountCents,
      paidAt: payment.paidAt
        ? requiredDate(payment.paidAt, `payments[${index}].paidAt`)
        : new Date(),
      referenceNo: optionalText(
        payment.referenceNo ?? payment.voucherNo,
        `payments[${index}].referenceNo`,
        120,
      ),
      remark: optionalText(
        payment.remark,
        `payments[${index}].remark`,
        500,
      ),
    });
  }
  if (paidAmountCents > orderTotalCents) {
    throw createHttpError(
      400,
      'SPECIAL_ORDER_PAYMENT_EXCEEDS_TOTAL',
      'Total payment amount must not exceed the order amount.',
    );
  }
  return payments;
}

async function replaceSettlementPayments(
  tx: any,
  actor: any,
  order: any,
  settlement: any,
  payments: any[],
  operationKey: string,
  now: Date,
) {
  await tx.specialOrderPayment.updateMany({
    where: {
      settlementId: settlement.id,
      reversedAt: null,
    },
    data: {
      reversedAt: now,
      reversedById: actor.id,
      reversalReason: 'Payment details replaced with the order mutation.',
    },
  });
  let settledAmountCents = 0;
  for (const [index, payment] of payments.entries()) {
    const idempotencyKey = `${operationKey}:payment:${index + 1}`;
    const data = {
      salesOrderId: order.id,
      settlementId: settlement.id,
      direction: settlement.direction,
      amountCents: payment.amountCents,
      paymentMethodId: payment.paymentMethodId,
      paymentMethodNameSnapshot: payment.paymentMethodNameSnapshot,
      paidAt: payment.paidAt,
      referenceNo: payment.referenceNo,
      remark: payment.remark,
    };
    await tx.specialOrderPayment.create({
      data: {
        id: crypto.randomUUID(),
        ...data,
        idempotencyKey,
        requestHash: requestHash(data),
        recordedById: actor.id,
        createdAt: now,
      },
    });
    settledAmountCents = safeAdd(
      settledAmountCents,
      Number(payment.amountCents || 0),
    );
  }
  const totalAmountCents = Number(order.totalAmountCents || 0);
  const paymentStatus =
    settledAmountCents === 0 && totalAmountCents > 0
      ? 'UNPAID'
      : settledAmountCents < totalAmountCents
        ? 'PARTIAL'
        : 'PAID';
  const changed = await tx.specialOrderSettlement.updateMany({
    where: { id: settlement.id, version: settlement.version, isActive: true },
    data: {
      totalAmountCents,
      settledAmountCents,
      paymentStatus,
      version: { increment: 1 },
      updatedAt: now,
    },
  });
  assertClaimed(changed);
}

function normalizeAttachments(value: unknown) {
  if (!Array.isArray(value)) {
    validation('attachments must be an array.');
  }
  if (value.length > 20) {
    validation('attachments must not contain more than 20 files.');
  }
  const storageKeys = new Set<string>();
  return value.map((raw: unknown, index: number) => {
    const attachment = normalizeObject(
      raw,
      `attachments[${index}]`,
    );
    const storageKey = requiredText(
      attachment.storageKey,
      `attachments[${index}].storageKey`,
      191,
    );
    if (storageKeys.has(storageKey)) {
      validation(`attachments[${index}].storageKey is duplicated.`);
    }
    storageKeys.add(storageKey);
    const checksum = optionalText(
      attachment.checksumSha256,
      `attachments[${index}].checksumSha256`,
      64,
    )?.toLowerCase();
    if (checksum && !/^[0-9a-f]{64}$/.test(checksum)) {
      validation(
        `attachments[${index}].checksumSha256 must be a SHA-256 hash.`,
      );
    }
    return {
      id: crypto.randomUUID(),
      originalName: requiredText(
        attachment.originalName,
        `attachments[${index}].originalName`,
        255,
      ),
      storageKey,
      contentType: optionalText(
        attachment.contentType,
        `attachments[${index}].contentType`,
        120,
      ),
      sizeBytes: requiredInteger(
        attachment.sizeBytes ?? 0,
        `attachments[${index}].sizeBytes`,
        { min: 0 },
      ),
      checksumSha256: checksum || null,
    };
  });
}

async function requireDefaultWarehouse(tx: any) {
  const warehouses = await tx.warehouse.findMany({
    where: {
      isActive: true,
      isDefault: true,
      activeDefaultKey: 'ACTIVE_DEFAULT',
    },
    orderBy: { id: 'asc' },
    take: 2,
  });
  if (warehouses.length !== 1) {
    throw createHttpError(
      409,
      'INVENTORY_DEFAULT_WAREHOUSE_NOT_UNIQUE',
      'Exactly one active default warehouse is required for buyback orders.',
    );
  }
  return warehouses[0];
}

async function createSettlement(tx: any, order: any, now: Date) {
  const existing = await tx.specialOrderSettlement.findUnique({
    where: { activeOrderKey: order.id },
  });
  if (existing) {
    return existing;
  }
  const total = Number(order.totalAmountCents || 0);
  return tx.specialOrderSettlement.create({
    data: {
      id: crypto.randomUUID(),
      salesOrderId: order.id,
      activeOrderKey: order.id,
      direction:
        normalizeEnum(order.orderType) === 'BUYBACK'
          ? 'PAYABLE'
          : 'RECEIVABLE',
      totalAmountCents: total,
      settledAmountCents: 0,
      paymentStatus: total === 0 ? 'PAID' : 'UNPAID',
      isActive: true,
      version: 0,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function reverseActiveSettlement(
  tx: any,
  order: any,
  actor: any,
  reason: string,
) {
  const active = await tx.specialOrderSettlement.findUnique({
    where: { activeOrderKey: order.id },
  });
  if (!active) {
    throw createHttpError(
      409,
      'SPECIAL_ORDER_FINANCIAL_REVERSAL_UNSAFE',
      'The active settlement is missing and cannot be reversed safely.',
    );
  }
  const changed = await tx.specialOrderSettlement.updateMany({
    where: {
      id: active.id,
      version: active.version,
      isActive: true,
      activeOrderKey: order.id,
    },
    data: {
      activeOrderKey: null,
      isActive: false,
      reversedAt: new Date(),
      reversedById: actor.id,
      reversalReason: reason,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  assertClaimed(changed);
}

async function assertCommissionReversalIsSafe(
  tx: any,
  orderId: string,
) {
  const confirmedCount = await tx.commissionRecord.count({
    where: {
      salesOrderId: orderId,
      manualInput: false,
      isConfirmed: true,
    },
  });
  if (Number(confirmedCount || 0) > 0) {
    throw createHttpError(
      409,
      'SPECIAL_ORDER_COMMISSION_REVERSAL_UNSAFE',
      'Confirmed commission records exist. Reverse their settlement before unapproving the special order.',
    );
  }
}

async function reverseUnconfirmedCommissions(
  tx: any,
  orderId: string,
) {
  await tx.commissionRecord.deleteMany({
    where: {
      salesOrderId: orderId,
      manualInput: false,
      isConfirmed: false,
    },
  });
}

function buildListWhere(actor: any, filters: any) {
  const clauses: any[] = [
    {
      workflowStatus: { not: null },
      orderType: { in: ['INTERNAL', 'EXTERNAL', 'BUYBACK'] },
    },
  ];
  if (isSelfScopedSpecialOrderActor(actor)) {
    clauses.push({ createdById: actor.id });
  }
  if (filters?.orderType) {
    clauses.push({
      orderType: normalizeSpecialOrderType(filters.orderType),
    });
  }
  if (filters?.workflowStatus) {
    clauses.push({
      workflowStatus: normalizeWorkflowStatus(filters.workflowStatus),
    });
  }
  if (
    String(filters?.pendingOnly || '').toLowerCase() === 'true'
  ) {
    clauses.push({ workflowStatus: 'PENDING' });
  }
  const keyword =
    typeof filters?.keyword === 'string'
      ? filters.keyword.trim()
      : typeof filters?.query === 'string'
        ? filters.query.trim()
        : '';
  if (keyword) {
    clauses.push({
      OR: [
        { orderNo: { contains: keyword } },
        { customerName: { contains: keyword } },
        { externalPartyNameSnapshot: { contains: keyword } },
        { items: { some: { productName: { contains: keyword } } } },
      ],
    });
  }
  const dateFrom = optionalDate(filters?.dateFrom, 'dateFrom');
  const dateTo = optionalDate(filters?.dateTo, 'dateTo');
  if (dateFrom || dateTo) {
    clauses.push({
      orderDate: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: endOfDay(dateTo) } : {}),
      },
    });
  }
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

function assertScoped(actor: any, order: any) {
  if (
    isSelfScopedSpecialOrderActor(actor) &&
    order.createdById !== actor.id
  ) {
    notFound();
  }
}

function assertVersion(order: any, expected: number) {
  if (Number(order.workflowVersion) !== expected) {
    versionConflict();
  }
}

function assertClaimed(result: any) {
  if (Number(result?.count || 0) !== 1) {
    versionConflict();
  }
}

function toSpecialOrderDto(order: any): any {
  const settlements = (order.specialSettlements || []).map(
    toSettlementDto,
  );
  const activeSettlement =
    settlements.find((settlement: any) => settlement.isActive) || null;
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: String(order.orderType || '').toLowerCase(),
    workflowStatus: String(
      order.workflowStatus || '',
    ).toLowerCase(),
    workflowVersion: Number(order.workflowVersion || 0),
    orderDate: formatDate(order.orderDate),
    customerId: order.customerId || null,
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || null,
    province: order.province || null,
    city: order.city || null,
    district: order.district || null,
    address: order.address || null,
    customerNotes: order.customer?.notes || null,
    status: String(order.status || '').toLowerCase(),
    hasOriginalPurchase:
      order.hasOriginalPurchase === null ||
      order.hasOriginalPurchase === undefined
        ? null
        : Boolean(order.hasOriginalPurchase),
    sourceSalesOrderId: order.sourceSalesOrderId || null,
    sourceSalesOrder: order.sourceSalesOrder
      ? {
          ...order.sourceSalesOrder,
          orderType: String(
            order.sourceSalesOrder.orderType || '',
          ).toLowerCase(),
          workflowStatus: order.sourceSalesOrder.workflowStatus
            ? String(
                order.sourceSalesOrder.workflowStatus,
              ).toLowerCase()
            : null,
        }
      : null,
    sourceRemark: order.sourceRemark || null,
    internalEmployeeId: order.internalEmployeeId || null,
    internalEmployee: userDto(order.internalEmployee),
    externalPartyType: order.externalPartyType
      ? String(order.externalPartyType).toLowerCase()
      : null,
    externalPartyId: order.externalPartyId || null,
    externalPartyNameSnapshot:
      order.externalPartyNameSnapshot || null,
    totalAmountCents: Number(order.totalAmountCents || 0),
    remark: order.remark || null,
    packingStatus: String(
      order.packingStatus || '',
    ).toLowerCase(),
    approvedBy: userDto(order.approvedBy),
    approvedAt: toIso(order.approvedAt),
    completedAt: toIso(order.completedAt),
    lastSubmittedAt: toIso(order.lastSubmittedAt),
    rejectionReason: order.rejectionReason || null,
    unapprovalReason: order.unapprovalReason || null,
    createdById: order.createdById || null,
    createdBy: userDto(order.createdBy),
    updatedBy: userDto(order.updatedBy),
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt),
    items: (order.items || []).map((item: any) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      inventoryTrackingMode: String(
        item.product?.inventoryTrackingMode || 'NONE',
      ).toLowerCase(),
      warehouseId: item.warehouseId || null,
      warehouse: item.warehouse
        ? {
            id: item.warehouse.id,
            code: item.warehouse.code,
            name: item.warehouse.name,
            isDefault: Boolean(item.warehouse.isDefault),
          }
        : null,
      quantity: Number(item.quantity || 0),
      listUnitPriceCents: Number(item.listUnitPriceCents || 0),
      unitPriceCents: Number(item.unitPriceCents || 0),
      discountAmountCents: Number(item.discountAmountCents || 0),
      subtotalCents: Number(item.subtotalCents || 0),
      totalPriceCents: Number(item.subtotalCents || 0),
      isGift: Boolean(item.isGift),
      priceOverrideReason: item.priceOverrideReason || null,
      adjustmentReason: item.adjustmentReason || null,
      inventoryCondition: String(
        item.inventoryCondition || 'SALEABLE',
      ).toLowerCase(),
      deliveryType: String(
        item.deliveryType || 'SHIPPING',
      ).toLowerCase(),
      notes: item.notes || null,
      sortOrder: Number(item.sortOrder || 0),
      logisticsCodes: (item.specialSerializedUnits || []).map(
        (serial: any) => serial.logisticsCodeSnapshot,
      ),
    })),
    attachments: (order.specialAttachments || []).map(
      (attachment: any) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        storageKey: attachment.storageKey,
        contentType: attachment.contentType,
        sizeBytes: Number(attachment.sizeBytes || 0),
        checksumSha256: attachment.checksumSha256,
        uploadedById: attachment.uploadedById,
        uploadedAt: toIso(attachment.uploadedAt),
      }),
    ),
    workflowEvents: (order.specialWorkflowEvents || []).map(
      (event: any) => ({
        id: event.id,
        eventType: String(event.eventType).toLowerCase(),
        fromStatus: event.fromStatus
          ? String(event.fromStatus).toLowerCase()
          : null,
        toStatus: String(event.toStatus).toLowerCase(),
        workflowVersion: Number(event.workflowVersion),
        reason: event.reason || null,
        actor: userDto(event.actor) || {
          id: event.actorUserId,
          name: event.actorNameSnapshot,
          role: String(
            event.actorRoleSnapshot || '',
          ).toLowerCase(),
        },
        createdAt: toIso(event.createdAt),
      }),
    ),
    settlement: activeSettlement,
    settlementHistory: settlements,
    financial: {
      receivableTotalCents:
        normalizeEnum(order.orderType) === 'BUYBACK'
          ? 0
          : SPECIAL_ORDER_EFFECTIVE_STATUSES.has(
                normalizeEnum(order.workflowStatus),
              )
            ? Number(order.totalAmountCents || 0)
            : 0,
      payableTotalCents:
        normalizeEnum(order.orderType) === 'BUYBACK' &&
        SPECIAL_ORDER_EFFECTIVE_STATUSES.has(
          normalizeEnum(order.workflowStatus),
        )
          ? Number(order.totalAmountCents || 0)
          : 0,
      netCashFlowCents:
        SPECIAL_ORDER_EFFECTIVE_STATUSES.has(
          normalizeEnum(order.workflowStatus),
        )
          ? normalizeEnum(order.orderType) === 'BUYBACK'
            ? -Number(order.totalAmountCents || 0)
            : Number(order.totalAmountCents || 0)
          : 0,
    },
  };
}

function toSettlementDto(settlement: any) {
  return {
    id: settlement.id,
    direction: String(settlement.direction).toLowerCase(),
    totalAmountCents: Number(settlement.totalAmountCents || 0),
    settledAmountCents: Number(
      settlement.settledAmountCents || 0,
    ),
    paymentStatus: String(
      settlement.paymentStatus || 'UNPAID',
    ).toLowerCase(),
    isActive: Boolean(settlement.isActive),
    reversedAt: toIso(settlement.reversedAt),
    reversalReason: settlement.reversalReason || null,
    reversedBy: userDto(settlement.reversedBy),
    payments: (settlement.payments || [])
      .filter((payment: any) => !payment.reversedAt)
      .map((payment: any) => ({
      id: payment.id,
      direction: String(payment.direction).toLowerCase(),
      amountCents: Number(payment.amountCents || 0),
      paymentMethodId: payment.paymentMethodId || null,
      paymentMethodNameSnapshot:
        payment.paymentMethodNameSnapshot,
      paidAt: toIso(payment.paidAt),
      referenceNo: payment.referenceNo || null,
      remark: payment.remark || null,
      recordedBy: userDto(payment.recordedBy),
      createdAt: toIso(payment.createdAt),
      })),
    createdAt: toIso(settlement.createdAt),
    updatedAt: toIso(settlement.updatedAt),
  };
}

function userDto(user: any) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: String(user.role || '').toLowerCase(),
    isActive:
      user.isActive === undefined ? undefined : Boolean(user.isActive),
  };
}

function eventOrderSnapshot(order: any) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: String(order.orderType || '').toLowerCase(),
    workflowStatus: order.workflowStatus
      ? String(order.workflowStatus).toLowerCase()
      : null,
    workflowVersion:
      order.workflowVersion === null ||
      order.workflowVersion === undefined
        ? null
        : Number(order.workflowVersion),
    customerId: order.customerId || null,
    customerName: order.customerName || null,
    totalAmountCents: Number(order.totalAmountCents || 0),
    itemCount: Array.isArray(order.items)
      ? order.items.length
      : undefined,
  };
}

function counterpartyName(order: any) {
  return (
    order.internalEmployee?.name ||
    order.externalPartyNameSnapshot ||
    order.customerName ||
    ''
  );
}

function orderTypeLabel(value: string) {
  return {
    internal: '内购',
    external: '外销',
    buyback: '回购',
  }[value] || value;
}

function workflowStatusLabel(value: string) {
  return {
    draft: '草稿',
    pending: '待审核',
    approved: '已审核',
    completed: '已完成',
    rejected: '已驳回',
    cancelled: '已取消',
  }[value] || value;
}

function normalizeTake(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, 200)
    : fallback;
}

function normalizeSkip(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeMultiply(left: number, right: number) {
  const value = left * right;
  if (!Number.isSafeInteger(value)) {
    validation('Line amount exceeds the safe integer cents range.');
  }
  return value;
}

function safeAdd(left: number, right: number) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    validation('Order amount exceeds the safe integer cents range.');
  }
  return value;
}

function formatDate(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toISOString().slice(0, 10);
}

function toIso(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toISOString();
}

function endOfDay(value: Date) {
  const end = new Date(value);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function idempotencyConflict(): never {
  throw createHttpError(
    409,
    'SPECIAL_ORDER_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with different request content.',
  );
}

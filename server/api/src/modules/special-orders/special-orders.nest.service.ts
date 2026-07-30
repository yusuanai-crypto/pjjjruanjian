import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as ExcelJS from 'exceljs';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionRecordsNestService } from '../commissions/commission-records.nest.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import { withGeneratedSalesOrderNo } from '../business-data/sales-order-no.helper';
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

        const input = await resolveSpecialOrderInput(
          tx,
          actor,
          body,
        );
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
                shippingDate: null,
                shippingDateSource: null,
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
                workflowStatus: 'DRAFT',
                workflowVersion: 0,
                specialOrderCreateKey: idempotencyKey,
                specialOrderCreateHash: hash,
                hasOriginalPurchase: input.hasOriginalPurchase,
                sourceRemark: input.sourceRemark,
                internalEmployeeId: input.internalEmployeeId,
                externalPartyType: input.externalPartyType,
                externalPartyId: input.externalPartyId,
                externalPartyNameSnapshot:
                  input.externalPartyNameSnapshot,
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
            await this.appendWorkflowEvent(
              tx,
              actor,
              order,
              {
                eventType: 'CREATED',
                fromStatus: null,
                toStatus: 'DRAFT',
                workflowVersion: 0,
                idempotencyKey,
                requestHash: hash,
                payloadSnapshot: eventOrderSnapshot(order),
              },
            );
            await this.appendOperationLog(
              tx,
              actor,
              'create',
              null,
              order,
              metadata,
            );
            return this.reload(tx, order.id);
          },
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
    requireSpecialOrderRead(actor);
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
    const sheet = workbook.addWorksheet('内购外销回购', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { header: '订单号', key: 'orderNo', width: 20 },
      { header: '类型', key: 'orderType', width: 12 },
      { header: '工作流状态', key: 'workflowStatus', width: 14 },
      { header: '订单日期', key: 'orderDate', width: 14 },
      { header: '创建人', key: 'creator', width: 16 },
      { header: '往来对象', key: 'counterparty', width: 22 },
      { header: '商品', key: 'product', width: 26 },
      { header: '仓库', key: 'warehouse', width: 18 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '成交单价(元)', key: 'unitPrice', width: 16 },
      { header: '行金额(元)', key: 'subtotal', width: 16 },
      { header: '应收(元)', key: 'receivable', width: 14 },
      { header: '应付(元)', key: 'payable', width: 14 },
      { header: '已结算(元)', key: 'settled', width: 14 },
      { header: '结算状态', key: 'paymentStatus', width: 12 },
      { header: '备注', key: 'remark', width: 30 },
    ];
    for (const raw of orders) {
      const order = toSpecialOrderDto(raw);
      const activeSettlement = order.settlement;
      for (const item of order.items) {
        sheet.addRow({
          orderNo: order.orderNo,
          orderType: orderTypeLabel(order.orderType),
          workflowStatus: workflowStatusLabel(order.workflowStatus),
          orderDate: order.orderDate,
          creator: order.createdBy?.name || '',
          counterparty: counterpartyName(order),
          product: item.productName,
          warehouse: item.warehouse?.name || '',
          quantity: item.quantity,
          unitPrice: item.unitPriceCents / 100,
          subtotal: item.subtotalCents / 100,
          receivable:
            activeSettlement?.direction === 'receivable'
              ? activeSettlement.totalAmountCents / 100
              : 0,
          payable:
            activeSettlement?.direction === 'payable'
              ? activeSettlement.totalAmountCents / 100
              : 0,
          settled:
            (activeSettlement?.settledAmountCents || 0) / 100,
          paymentStatus: activeSettlement?.paymentStatus || '',
          remark: order.remark || '',
        });
      }
    }
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
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
  let customer: any = null;
  let customerName = '';
  let sourceSalesOrderId: string | null = null;
  let sourceRemark: string | null = null;
  let hasOriginalPurchase: boolean | null = null;
  let internalEmployeeId: string | null = null;
  let externalPartyType: string | null = null;
  let externalPartyId: string | null = null;
  let externalPartyNameSnapshot: string | null = null;

  if (orderType === 'BUYBACK') {
    const customerId = requiredId(
      body.customerId ?? existing?.customerId,
      'customerId',
    );
    customer = await tx.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw createHttpError(
        404,
        'CUSTOMER_NOT_FOUND',
        'Buyback customer does not exist.',
      );
    }
    customerName = customer.name;
    hasOriginalPurchase = requiredBoolean(
      body.hasOriginalPurchase ??
        existing?.hasOriginalPurchase,
      'hasOriginalPurchase',
    );
    if (hasOriginalPurchase) {
      sourceSalesOrderId = requiredId(
        body.sourceSalesOrderId ??
          existing?.sourceSalesOrderId,
        'sourceSalesOrderId',
      );
      const source = await tx.salesOrder.findUnique({
        where: { id: sourceSalesOrderId },
      });
      if (
        !source ||
        source.customerId !== customer.id ||
        normalizeEnum(source.orderType) === 'BUYBACK' ||
        (source.workflowStatus &&
          !SPECIAL_ORDER_EFFECTIVE_STATUSES.has(
            normalizeEnum(source.workflowStatus),
          ))
      ) {
        throw createHttpError(
          409,
          'BUYBACK_SOURCE_ORDER_INVALID',
          'Original purchase order must be an effective sales order belonging to the selected customer.',
        );
      }
      sourceRemark = null;
    } else {
      if (body.sourceSalesOrderId) {
        validation(
          'sourceSalesOrderId must be empty when hasOriginalPurchase is false.',
        );
      }
      sourceSalesOrderId = null;
      sourceRemark = requiredText(
        body.sourceRemark ?? existing?.sourceRemark,
        'sourceRemark',
        2_000,
      );
    }
  } else if (orderType === 'INTERNAL') {
    internalEmployeeId = requiredId(
      body.internalEmployeeId ??
        existing?.internalEmployeeId,
      'internalEmployeeId',
    );
    const employee = await tx.user.findUnique({
      where: { id: internalEmployeeId },
    });
    if (!employee?.isActive) {
      throw createHttpError(
        404,
        'INTERNAL_EMPLOYEE_NOT_FOUND',
        'Active internal employee account does not exist.',
      );
    }
    customerName = employee.name;
    const optionalCustomerId = optionalId(
      body.customerId ?? existing?.customerId,
      'customerId',
    );
    if (optionalCustomerId) {
      customer = await tx.customer.findUnique({
        where: { id: optionalCustomerId },
      });
      if (!customer) {
        throw createHttpError(
          404,
          'CUSTOMER_NOT_FOUND',
          'Related customer does not exist.',
        );
      }
    }
  } else {
    externalPartyType = normalizeExternalPartyType(
      body.externalPartyType ??
        existing?.externalPartyType,
    );
    if (externalPartyType === 'GUIDE') {
      externalPartyId = requiredId(
        body.externalPartyId ?? existing?.externalPartyId,
        'externalPartyId',
      );
      const guide = await tx.guide.findUnique({
        where: { id: externalPartyId },
      });
      if (!guide) {
        throw createHttpError(
          404,
          'GUIDE_NOT_FOUND',
          'External guide does not exist.',
        );
      }
      externalPartyNameSnapshot = guide.name;
    } else if (externalPartyType === 'TRAVEL_AGENCY') {
      externalPartyId = requiredId(
        body.externalPartyId ?? existing?.externalPartyId,
        'externalPartyId',
      );
      const agency = await tx.travelAgency.findUnique({
        where: { id: externalPartyId },
      });
      if (!agency) {
        throw createHttpError(
          404,
          'TRAVEL_AGENCY_NOT_FOUND',
          'External travel agency does not exist.',
        );
      }
      externalPartyNameSnapshot = agency.name;
    } else {
      if (body.externalPartyId) {
        validation(
          'externalPartyId must be empty for externalPartyType=other.',
        );
      }
      externalPartyId = null;
      externalPartyNameSnapshot = requiredText(
        body.externalPartyName ??
          body.externalPartyNameSnapshot ??
          existing?.externalPartyNameSnapshot,
        'externalPartyName',
        160,
      );
    }
    customerName = externalPartyNameSnapshot;
    const optionalCustomerId = optionalId(
      body.customerId ?? existing?.customerId,
      'customerId',
    );
    if (optionalCustomerId) {
      customer = await tx.customer.findUnique({
        where: { id: optionalCustomerId },
      });
      if (!customer) {
        throw createHttpError(
          404,
          'CUSTOMER_NOT_FOUND',
          'Related customer does not exist.',
        );
      }
    }
  }

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
      { nonZero: true, min: -100_000, max: 100_000 },
    );
    const adjustmentReason =
      quantity < 0
        ? requiredReason(
            item.adjustmentReason,
            `items[${index}].adjustmentReason`,
          )
        : optionalReason(
            item.adjustmentReason,
            `items[${index}].adjustmentReason`,
          );
    const listUnitPriceCents = requiredInteger(
      item.listUnitPriceCents ?? item.unitPriceCents ?? 0,
      `items[${index}].listUnitPriceCents`,
      { min: 0 },
    );
    const isGift = optionalBoolean(
      item.isGift,
      `items[${index}].isGift`,
      false,
    );
    const unitPriceCents = isGift
      ? 0
      : requiredInteger(
          item.unitPriceCents ?? 0,
          `items[${index}].unitPriceCents`,
          { min: 0 },
        );
    const priceOverrideReason =
      !isGift && unitPriceCents !== listUnitPriceCents
        ? requiredReason(
            item.priceOverrideReason,
            `items[${index}].priceOverrideReason`,
          )
        : optionalReason(
            item.priceOverrideReason,
            `items[${index}].priceOverrideReason`,
          );
    const subtotalCents = safeMultiply(quantity, unitPriceCents);
    totalAmountCents = safeAdd(totalAmountCents, subtotalCents);
    const discountAmountCents =
      optionalInteger(
        item.discountAmountCents,
        `items[${index}].discountAmountCents`,
      ) ??
      (quantity > 0
        ? Math.max(
            0,
            safeMultiply(quantity, listUnitPriceCents) -
              subtotalCents,
          )
        : 0);
    if (discountAmountCents < 0) {
      validation(
        `items[${index}].discountAmountCents must be non-negative.`,
      );
    }
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
        actualUnitCostCents: null,
        actualCostSubtotalCents: null,
        grossProfitCents: null,
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
    listUnitPriceCents: item.listUnitPriceCents,
    unitPriceCents: item.unitPriceCents,
    discountAmountCents: item.discountAmountCents,
    isGift: item.isGift,
    priceOverrideReason: item.priceOverrideReason,
    adjustmentReason: item.adjustmentReason,
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
    payments: (settlement.payments || []).map((payment: any) => ({
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

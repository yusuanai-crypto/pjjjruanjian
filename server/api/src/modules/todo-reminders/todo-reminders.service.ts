import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  TodoRuleEngine,
  TodoRuleMatch,
  TodoSourceType,
} from './todo-rule.engine';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const SNOOZE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
const PERSONAL_REMINDER_MAX_MS = 365 * 24 * 60 * 60 * 1000;
const MANAGER_ROLES: any[] = ['BOSS', 'ADMIN', 'SUPER_ADMIN'];
const SOURCE_SCAN_LIMIT = 200;

@Injectable()
export class TodoRemindersService {
  private readonly logger = new Logger(TodoRemindersService.name);
  private maintenanceRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogs: OperationLogsNestService,
    private readonly ruleEngine: TodoRuleEngine,
  ) {}

  async listForUser(actor: any, input: any = {}) {
    const filters = parseListFilters(input);
    const todoWhere = buildTodoWhere(filters);
    const where: any = {
      userId: actor.id,
      ...(filters.archived === null
        ? {}
        : { archivedAt: filters.archived ? { not: null } : null }),
      ...(Object.keys(todoWhere).length > 0
        ? { todo: { is: todoWhere } }
        : {}),
    };
    const [total, recipients] = await Promise.all([
      this.prisma.todoRecipient.count({ where }),
      this.prisma.todoRecipient.findMany({
        where,
        include: { todo: true },
        orderBy: [
          { todo: { priority: 'desc' } },
          { todo: { dueAt: 'asc' } },
          { createdAt: 'desc' },
        ],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    return {
      reminders: recipients.map(toReminderDto),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }

  async summaryForUser(actor: any) {
    const now = new Date();
    const { start, end } = shanghaiDayBounds(now);
    const base = {
      userId: actor.id,
      archivedAt: null,
    };
    const [unfinished, unread, todayDue, overdue, urgent] = await Promise.all([
      this.prisma.todoRecipient.count({
        where: { ...base, todo: { is: { status: 'ACTIVE' } } },
      }),
      this.prisma.todoRecipient.count({
        where: {
          ...base,
          readAt: null,
          todo: { is: { status: 'ACTIVE' } },
        },
      }),
      this.prisma.todoRecipient.count({
        where: {
          ...base,
          todo: {
            is: {
              status: 'ACTIVE',
              dueAt: { gte: start, lt: end },
            },
          },
        },
      }),
      this.prisma.todoRecipient.count({
        where: {
          ...base,
          todo: { is: { status: 'ACTIVE', dueAt: { lt: now } } },
        },
      }),
      this.prisma.todoRecipient.count({
        where: {
          ...base,
          todo: { is: { status: 'ACTIVE', priority: 'URGENT' } },
        },
      }),
    ]);
    return { unfinished, unread, todayDue, overdue, urgent };
  }

  async getForUser(actor: any, id: string) {
    const recipient = await this.findRecipientForUser(actor.id, id);
    return toReminderDto(recipient);
  }

  async markRead(actor: any, id: string) {
    const current = await this.findRecipientForUser(actor.id, id);
    if (current.readAt) {
      return toReminderDto(current);
    }
    const updated = await this.prisma.todoRecipient.update({
      where: { id: current.id },
      data: { readAt: new Date() },
      include: { todo: true },
    });
    return toReminderDto(updated);
  }

  async updatePreferences(actor: any, id: string, payload: any) {
    assertOnlyFields(payload, ['personalNote', 'personalRemindAt']);
    const current = await this.findRecipientForUser(actor.id, id);
    const data: any = {};
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'personalNote')) {
      data.personalNote = optionalBoundedText(
        payload?.personalNote,
        'personalNote',
        2000,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        payload || {},
        'personalRemindAt',
      )
    ) {
      data.personalRemindAt = optionalFutureDate(
        payload?.personalRemindAt,
        'personalRemindAt',
        PERSONAL_REMINDER_MAX_MS,
      );
    }
    const updated = await this.prisma.todoRecipient.update({
      where: { id: current.id },
      data,
      include: { todo: true },
    });
    await this.appendUserAudit(actor, 'todo_reminders.preferences.update', current, updated);
    return toReminderDto(updated);
  }

  async snooze(actor: any, id: string, payload: any) {
    assertOnlyFields(payload, ['until']);
    const current = await this.findRecipientForUser(actor.id, id);
    if (current.todo.status !== 'ACTIVE') {
      throw createHttpError(
        400,
        'TODO_NOT_ACTIVE',
        'Only active reminders can be snoozed.',
      );
    }
    const until = requiredFutureDate(
      payload?.until,
      'until',
      SNOOZE_MAX_MS,
    );
    const updated = await this.prisma.todoRecipient.update({
      where: { id: current.id },
      data: {
        snoozedUntil: until,
        personalRemindAt: until,
      },
      include: { todo: true },
    });
    await this.appendUserAudit(actor, 'todo_reminders.snooze', current, updated);
    return toReminderDto(updated);
  }

  async verifyCompletion(actor: any, id: string) {
    const current = await this.findRecipientForUser(actor.id, id);
    await this.reconcileSource(
      current.todo.sourceType as TodoSourceType,
      current.todo.sourceId,
    );
    const updated = await this.findRecipientForUser(actor.id, id);
    if (updated.todo.status === 'ACTIVE') {
      throw createHttpError(
        409,
        'TODO_SOURCE_STILL_ACTIVE',
        'The source business condition is still active.',
      );
    }
    return toReminderDto(updated);
  }

  async archive(actor: any, id: string) {
    const current = await this.findRecipientForUser(actor.id, id);
    if (current.todo.status === 'ACTIVE') {
      throw createHttpError(
        409,
        'ACTIVE_TODO_CANNOT_BE_ARCHIVED',
        'Active reminders cannot be archived.',
      );
    }
    const updated = await this.prisma.todoRecipient.update({
      where: { id: current.id },
      data: { archivedAt: current.archivedAt || new Date() },
      include: { todo: true },
    });
    await this.appendUserAudit(actor, 'todo_reminders.archive', current, updated);
    return toReminderDto(updated);
  }

  async safeReconcileSource(sourceType: TodoSourceType, sourceId: string) {
    try {
      await this.reconcileSource(sourceType, sourceId);
    } catch (error) {
      this.logger.error(
        `Todo reconciliation failed for ${sourceType}:${sourceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async reconcileSource(
    sourceType: TodoSourceType,
    sourceId: string,
    now = new Date(),
  ) {
    const source = await this.loadSource(sourceType, sourceId);
    const matches = source
      ? this.ruleEngine.evaluate(sourceType, source, now)
      : [];
    const activeRuleCodes = new Set(matches.map((item) => item.ruleCode));

    for (const ruleMatch of matches) {
      const todo = await this.activateRule(ruleMatch, now);
      await this.ensureBusinessRecipients(todo);
    }

    const stale = await this.prisma.businessTodo.findMany({
      where: {
        sourceType,
        sourceId,
        status: 'ACTIVE',
        ...(activeRuleCodes.size > 0
          ? { ruleCode: { notIn: Array.from(activeRuleCodes) } }
          : {}),
      },
    });
    const resolutionStatus = this.ruleEngine.resolutionStatus(
      sourceType,
      source,
    );
    for (const todo of stale) {
      await this.prisma.businessTodo.update({
        where: { id: todo.id },
        data: {
          status: resolutionStatus,
          resolvedAt: now,
          lastDetectedAt: now,
        },
      });
    }
    return {
      active: matches.length,
      closed: stale.length,
    };
  }

  async runMaintenanceCycle(now = new Date()) {
    if (this.maintenanceRunning) {
      return { skipped: true };
    }
    this.maintenanceRunning = true;
    try {
      const sources = await this.collectBoundedSources();
      for (const source of sources) {
        await this.safeReconcileSource(source.sourceType, source.sourceId);
      }
      const escalated = await this.createEscalations(now);
      const backfilled = await this.backfillRecipients();
      return {
        skipped: false,
        reconciled: sources.length,
        escalated,
        backfilled,
      };
    } finally {
      this.maintenanceRunning = false;
    }
  }

  async backfillExistingData() {
    const totals: Record<string, number> = {};
    for (const sourceType of [
      'TRAVEL_GROUP',
      'SALES_ORDER',
      'AFTER_SALES_ORDER',
    ] as TodoSourceType[]) {
      let cursor: string | undefined;
      let count = 0;
      for (;;) {
        const rows = await this.sourceDelegate(sourceType).findMany({
          orderBy: { id: 'asc' },
          take: SOURCE_SCAN_LIMIT,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true },
        });
        if (rows.length === 0) {
          break;
        }
        for (const row of rows) {
          await this.reconcileSource(sourceType, row.id);
          count += 1;
        }
        cursor = rows[rows.length - 1].id;
      }
      totals[sourceType] = count;
    }
    await this.createEscalations(new Date());
    await this.backfillRecipients();
    return totals;
  }

  private async findRecipientForUser(userId: string, id: string) {
    const recipient = await this.prisma.todoRecipient.findFirst({
      where: { id: normalizeId(id), userId },
      include: { todo: true },
    });
    if (!recipient) {
      throw createHttpError(
        404,
        'TODO_REMINDER_NOT_FOUND',
        'The reminder does not exist.',
      );
    }
    return recipient;
  }

  private async activateRule(ruleMatch: TodoRuleMatch, now: Date) {
    const key = {
      ruleCode: ruleMatch.ruleCode,
      sourceType: ruleMatch.sourceType,
      sourceId: ruleMatch.sourceId,
    };
    const existing = await this.prisma.businessTodo.findUnique({
      where: { ruleCode_sourceType_sourceId: key },
    });
    const freshDueAt = new Date(
      now.getTime() + ruleMatch.slaHours * 60 * 60 * 1000,
    );
    const data = {
      targetRole: ruleMatch.targetRole,
      title: ruleMatch.title,
      content: ruleMatch.content,
      priority: ruleMatch.priority,
      sourceSnapshot: { sourceNumber: ruleMatch.sourceNumber },
      lastDetectedAt: now,
    };
    if (!existing) {
      return this.prisma.businessTodo.create({
        data: {
          id: crypto.randomUUID(),
          ...key,
          ...data,
          status: 'ACTIVE',
          dueAt: freshDueAt,
          firstDetectedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    const reactivated = existing.status !== 'ACTIVE';
    const dueAt = reactivated
      ? freshDueAt
      : new Date(existing.dueAt) < freshDueAt
        ? new Date(existing.dueAt)
        : freshDueAt;
    const updated = await this.prisma.businessTodo.update({
      where: { id: existing.id },
      data: {
        ...data,
        status: 'ACTIVE',
        dueAt,
        resolvedAt: null,
        ...(reactivated ? { firstDetectedAt: now } : {}),
      },
    });
    if (reactivated) {
      await this.prisma.todoRecipient.updateMany({
        where: { todoId: updated.id },
        data: {
          archivedAt: null,
          readAt: null,
          snoozedUntil: null,
          personalRemindAt: null,
        },
      });
    }
    return updated;
  }

  private async ensureBusinessRecipients(todo: any) {
    const users = await this.prisma.user.findMany({
      where: {
        role: todo.targetRole,
        isActive: true,
      },
      select: { id: true },
    });
    for (const user of users) {
      await this.prisma.todoRecipient.upsert({
        where: {
          todoId_userId: { todoId: todo.id, userId: user.id },
        },
        update: {},
        create: {
          id: crypto.randomUUID(),
          todoId: todo.id,
          userId: user.id,
          recipientReason: 'BUSINESS',
        },
      });
    }
    return users.length;
  }

  private async createEscalations(now: Date) {
    const todos = await this.prisma.businessTodo.findMany({
      where: { status: 'ACTIVE', dueAt: { lte: now } },
      take: SOURCE_SCAN_LIMIT,
    });
    const managers = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: MANAGER_ROLES } },
      select: { id: true },
    });
    let createdOrConfirmed = 0;
    for (const todo of todos) {
      for (const manager of managers) {
        await this.prisma.todoRecipient.upsert({
          where: {
            todoId_userId: { todoId: todo.id, userId: manager.id },
          },
          update: {},
          create: {
            id: crypto.randomUUID(),
            todoId: todo.id,
            userId: manager.id,
            recipientReason: 'ESCALATION',
          },
        });
        createdOrConfirmed += 1;
      }
    }
    return createdOrConfirmed;
  }

  private async backfillRecipients() {
    const todos = await this.prisma.businessTodo.findMany({
      where: { status: 'ACTIVE' },
      take: SOURCE_SCAN_LIMIT,
    });
    let count = 0;
    for (const todo of todos) {
      count += await this.ensureBusinessRecipients(todo);
    }
    return count;
  }

  private async collectBoundedSources() {
    const map = new Map<string, { sourceType: TodoSourceType; sourceId: string }>();
    const active = await this.prisma.businessTodo.findMany({
      where: { status: 'ACTIVE' },
      select: { sourceType: true, sourceId: true },
      take: SOURCE_SCAN_LIMIT,
      orderBy: { lastDetectedAt: 'asc' },
    });
    for (const item of active) {
      addSource(map, item.sourceType as TodoSourceType, item.sourceId);
    }
    for (const sourceType of [
      'TRAVEL_GROUP',
      'SALES_ORDER',
      'AFTER_SALES_ORDER',
    ] as TodoSourceType[]) {
      const rows = await this.sourceDelegate(sourceType).findMany({
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
        take: SOURCE_SCAN_LIMIT,
      });
      for (const row of rows) {
        addSource(map, sourceType, row.id);
      }
    }
    return Array.from(map.values());
  }

  private sourceDelegate(sourceType: TodoSourceType): any {
    switch (sourceType) {
      case 'TRAVEL_GROUP':
        return this.prisma.travelGroup;
      case 'SALES_ORDER':
        return this.prisma.salesOrder;
      case 'AFTER_SALES_ORDER':
        return this.prisma.afterSalesOrder;
    }
  }

  private async loadSource(sourceType: TodoSourceType, sourceId: string) {
    switch (sourceType) {
      case 'TRAVEL_GROUP':
        return this.prisma.travelGroup.findUnique({
          where: { id: sourceId },
          include: {
            salesOrders: {
              include: { items: true },
            },
          },
        });
      case 'SALES_ORDER':
        return this.prisma.salesOrder.findUnique({
          where: { id: sourceId },
          include: { items: true },
        });
      case 'AFTER_SALES_ORDER':
        return this.prisma.afterSalesOrder.findUnique({
          where: { id: sourceId },
        });
    }
  }

  private async appendUserAudit(
    actor: any,
    action: string,
    before: any,
    after: any,
  ) {
    await this.operationLogs.appendLog({
      userId: actor.id,
      action,
      module: 'todo_reminders',
      operationType: 'UPDATE',
      entityType: 'todo_recipient',
      entityId: after.id,
      beforeData: toRecipientAuditDto(before),
      afterData: toRecipientAuditDto(after),
    });
  }
}

function parseListFilters(input: any) {
  const page = positiveInteger(input?.page, 1, 1, 1_000_000);
  const pageSize = positiveInteger(
    input?.pageSize,
    PAGE_SIZE_DEFAULT,
    1,
    PAGE_SIZE_MAX,
  );
  return {
    page,
    pageSize,
    status: enumValue(input?.status, ['ACTIVE', 'RESOLVED', 'CANCELLED']),
    priority: enumValue(input?.priority, ['NORMAL', 'IMPORTANT', 'URGENT']),
    sourceType: enumValue(input?.sourceType, [
      'TRAVEL_GROUP',
      'SALES_ORDER',
      'AFTER_SALES_ORDER',
    ]),
    keyword: boundedQuery(input?.keyword, 100),
    overdue: optionalBoolean(input?.overdue),
    dueToday: optionalBoolean(input?.dueToday),
    archived: optionalBoolean(input?.archived, false),
  };
}

function buildTodoWhere(filters: ReturnType<typeof parseListFilters>) {
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.keyword) {
    where.OR = [
      { title: { contains: filters.keyword } },
      { content: { contains: filters.keyword } },
      { sourceId: { contains: filters.keyword } },
    ];
  }
  if (filters.overdue === true) {
    where.status = 'ACTIVE';
    where.dueAt = { lt: new Date() };
  } else if (filters.overdue === false) {
    where.dueAt = { gte: new Date() };
  }
  if (filters.dueToday === true) {
    const bounds = shanghaiDayBounds(new Date());
    where.dueAt = { gte: bounds.start, lt: bounds.end };
  }
  return where;
}

function toReminderDto(recipient: any) {
  const todo = recipient.todo;
  const snapshot =
    todo?.sourceSnapshot &&
    typeof todo.sourceSnapshot === 'object' &&
    !Array.isArray(todo.sourceSnapshot)
      ? todo.sourceSnapshot
      : {};
  return {
    id: recipient.id,
    todoId: todo.id,
    ruleCode: todo.ruleCode,
    sourceType: todo.sourceType,
    sourceId: todo.sourceId,
    sourceNumber:
      typeof snapshot.sourceNumber === 'string'
        ? snapshot.sourceNumber
        : todo.sourceId,
    targetRole: String(todo.targetRole || '').toLowerCase(),
    title: todo.title,
    content: todo.content,
    priority: todo.priority,
    status: todo.status,
    dueAt: toIso(todo.dueAt),
    firstDetectedAt: toIso(todo.firstDetectedAt),
    lastDetectedAt: toIso(todo.lastDetectedAt),
    resolvedAt: todo.resolvedAt ? toIso(todo.resolvedAt) : null,
    recipientReason: recipient.recipientReason,
    readAt: recipient.readAt ? toIso(recipient.readAt) : null,
    personalNote: recipient.personalNote || null,
    personalRemindAt: recipient.personalRemindAt
      ? toIso(recipient.personalRemindAt)
      : null,
    snoozedUntil: recipient.snoozedUntil
      ? toIso(recipient.snoozedUntil)
      : null,
    archivedAt: recipient.archivedAt ? toIso(recipient.archivedAt) : null,
    createdAt: toIso(recipient.createdAt),
    updatedAt: toIso(recipient.updatedAt),
  };
}

function toRecipientAuditDto(recipient: any) {
  return {
    id: recipient.id,
    todoId: recipient.todoId,
    readAt: recipient.readAt ? toIso(recipient.readAt) : null,
    hasPersonalNote: Boolean(recipient.personalNote),
    personalRemindAt: recipient.personalRemindAt
      ? toIso(recipient.personalRemindAt)
      : null,
    snoozedUntil: recipient.snoozedUntil
      ? toIso(recipient.snoozedUntil)
      : null,
    archivedAt: recipient.archivedAt ? toIso(recipient.archivedAt) : null,
  };
}

function assertOnlyFields(payload: any, allowedFields: string[]) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      'A JSON object is required.',
    );
  }
  const unexpected = Object.keys(payload).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpected.length > 0) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `Unsupported fields: ${unexpected.join(', ')}.`,
    );
  }
}

function optionalBoundedText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw createHttpError(400, 'VALIDATION_FAILED', `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${field} is too long.`,
    );
  }
  return text || null;
}

function optionalFutureDate(
  value: unknown,
  field: string,
  maxFutureMs: number,
) {
  if (value === null || value === undefined || value === '') return null;
  return requiredFutureDate(value, field, maxFutureMs);
}

function requiredFutureDate(
  value: unknown,
  field: string,
  maxFutureMs: number,
) {
  const date = new Date(String(value || ''));
  const now = Date.now();
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${field} must be a future date.`,
    );
  }
  if (date.getTime() - now > maxFutureMs) {
    throw createHttpError(
      400,
      'VALIDATION_FAILED',
      `${field} is outside the allowed range.`,
    );
  }
  return date;
}

function positiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (
    !Number.isInteger(numberValue) ||
    numberValue < min ||
    numberValue > max
  ) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'Invalid pagination.');
  }
  return numberValue;
}

function enumValue(value: unknown, values: string[]) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!values.includes(normalized)) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'Invalid filter value.');
  }
  return normalized;
}

function optionalBoolean(value: unknown, fallback: boolean | null = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw createHttpError(400, 'VALIDATION_FAILED', 'Invalid boolean filter.');
}

function boundedQuery(value: unknown, maxLength: number) {
  const text = String(value || '').trim();
  if (text.length > maxLength) {
    throw createHttpError(400, 'VALIDATION_FAILED', 'Keyword is too long.');
  }
  return text || null;
}

function normalizeId(value: unknown) {
  const text = String(value || '').trim();
  if (!/^[0-9a-zA-Z_-]{1,100}$/.test(text)) {
    throw createHttpError(
      404,
      'TODO_REMINDER_NOT_FOUND',
      'The reminder does not exist.',
    );
  }
  return text;
}

function shanghaiDayBounds(value: Date) {
  const dateText = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const start = new Date(`${dateText}T00:00:00+08:00`);
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

function toIso(value: any) {
  return new Date(value).toISOString();
}

function addSource(
  map: Map<string, { sourceType: TodoSourceType; sourceId: string }>,
  sourceType: TodoSourceType,
  sourceId: string,
) {
  map.set(`${sourceType}:${sourceId}`, { sourceType, sourceId });
}

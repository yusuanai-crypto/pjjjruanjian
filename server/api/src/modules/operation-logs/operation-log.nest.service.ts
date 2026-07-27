import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as ExcelJS from 'exceljs';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditContextService } from './audit-context.service';
import {
  sanitizeAuditData,
  sanitizeOperationLogData,
} from './audit-data-sanitizer';
import {
  OPERATION_LOG_RESULTS,
  OPERATION_LOG_TYPES,
  parseOperationLogFilters,
  parseOperationLogId,
} from './operation-log-policy';
import { presentOperationLog } from './operation-log-presentation';

const DEFAULT_EXPORT_LIMIT = 5000;
const MAX_EXPORT_LIMIT = 20_000;

@Injectable()
export class OperationLogsNestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext?: AuditContextService,
  ) {}

  async appendLog(log: any, prisma: any = this.prisma) {
    const context = this.auditContext?.current();
    const actor = await this.resolveActor(log, prisma, context?.actor);
    const action = boundedString(log.action, 100);
    const entityType = boundedString(log.entityType, 100);
    if (!action || !entityType) {
      throw createHttpError(
        500,
        'AUDIT_LOG_INVALID',
        'Audit log action and entity type are required.',
      );
    }
    const sanitized = sanitizeOperationLogData(log);
    const operationType = normalizeOperationType(
      log.operationType || inferOperationType(action),
    );
    const result = normalizeResult(log.result || 'SUCCESS');
    const requestId = boundedString(
      log.requestId || context?.requestId,
      64,
    );
    const created = await prisma.operationLog.create({
      data: {
        id: log.id || crypto.randomUUID(),
        userId: log.userId || actor?.id || null,
        actorNameSnapshot:
          boundedString(log.actorNameSnapshot || actor?.name, 100),
        actorUsernameSnapshot:
          boundedString(log.actorUsernameSnapshot || actor?.username, 100),
        actorRoleSnapshot:
          boundedString(log.actorRoleSnapshot || actor?.role, 32),
        module: boundedString(log.module || action.split('.')[0], 100),
        operationType,
        action,
        entityType,
        entityId: boundedString(log.entityId, 100),
        result,
        beforeData: sanitized.beforeData,
        afterData: sanitized.afterData,
        requestSummary: sanitized.requestSummary,
        sanitizationSummary: sanitized.sanitizationSummary,
        httpMethod: boundedString(
          log.httpMethod || context?.httpMethod,
          10,
        ),
        requestPath: boundedString(
          log.requestPath || context?.requestPath,
          255,
        ),
        requestId,
        statusCode: optionalInteger(
          log.statusCode ??
            (result === 'SUCCESS' ? successStatusFor(log.httpMethod || context?.httpMethod) : null),
          100,
          599,
        ),
        errorCode: boundedString(log.errorCode, 100),
        errorMessage: sanitized.errorMessage,
        userAgent: boundedSanitizedString(
          log.userAgent || context?.userAgent,
          512,
        ),
        durationMs: optionalInteger(
          log.durationMs ??
            (context
              ? Math.max(0, Date.now() - context.startedAtMs)
              : null),
          0,
          2_147_483_647,
        ),
        ipAddress: boundedString(log.ipAddress || context?.ipAddress, 45),
        archivedAt: log.archivedAt ? validDate(log.archivedAt) : null,
        createdAt: log.createdAt ? validDate(log.createdAt) : new Date(),
      },
    });
    this.auditContext?.markExplicitLog(action);
    return toAppLog(created, false);
  }

  async listLogs(input: any = {}) {
    const filters = parseOperationLogFilters(input);
    const delegate = this.delegateFor(filters.archived);
    const where = buildWhere(filters);
    const total = await delegate.count({ where });
    const logs = await delegate.findMany({
      where,
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    });
    return {
      logs: logs.map((log: any) => toAppLog(log, filters.archived)),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }

  async getLog(idInput: unknown, archivedInput: unknown = false) {
    const id = parseOperationLogId(idInput);
    const { archived } = parseOperationLogFilters({
      archived: archivedInput,
      page: 1,
      pageSize: 1,
    });
    const delegate = this.delegateFor(archived);
    const log = await delegate.findUnique({
      where: {
        id,
      },
    });
    if (!log) {
      throw createHttpError(
        404,
        'OPERATION_LOG_NOT_FOUND',
        'The operation log does not exist.',
      );
    }
    return toAppLog(log, archived);
  }

  async filterOptions() {
    const users = await this.loadCurrentUsers();
    const online = await this.loadDistinctOptions(
      this.prisma.operationLog,
      false,
    );
    const archived = await this.loadDistinctOptions(
      (this.prisma as any).operationLogArchive,
      true,
    );
    const userMap = new Map<string, any>();
    for (const user of users) {
      userMap.set(userKey(user), user);
    }
    for (const source of [online.users, archived.users]) {
      for (const user of source) {
        const key = userKey(user);
        if (key && !userMap.has(key)) {
          userMap.set(key, user);
        }
      }
    }
    return {
      users: Array.from(userMap.values()).sort((left, right) =>
        String(left.name || left.username || '').localeCompare(
          String(right.name || right.username || ''),
          'zh-CN',
        ),
      ),
      modules: uniqueSorted([...online.modules, ...archived.modules]),
      operationTypes: OPERATION_LOG_TYPES.map((value: string) => ({
        value,
        label: operationTypeLabel(value),
      })),
      results: OPERATION_LOG_RESULTS.map((value: string) => ({
        value,
        label: value === 'SUCCESS' ? '成功' : '失败',
      })),
    };
  }

  async exportExcel(input: any = {}) {
    const filters = parseOperationLogFilters({
      ...input,
      page: 1,
      pageSize: 1,
    });
    const delegate = this.delegateFor(filters.archived);
    const where = buildWhere(filters);
    const limit = exportLimit();
    const total = await delegate.count({ where });
    if (total > limit) {
      throw createHttpError(
        400,
        'OPERATION_LOG_EXPORT_LIMIT_EXCEEDED',
        `The export contains ${total} rows, exceeding the ${limit}-row limit. Narrow the filters and try again.`,
      );
    }
    const rows = await delegate.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit,
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Jiangjiu Audit';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(
      filters.archived ? '历史操作日志' : '在线操作日志',
      {
        views: [{ state: 'frozen', ySplit: 1 }],
      },
    );
    worksheet.columns = exportColumns();
    for (const raw of rows) {
      const log = toAppLog(raw, filters.archived);
      const display = presentOperationLog(log);
      worksheet.addRow({
        createdAt: log.createdAt ? new Date(log.createdAt) : '',
        actor: display.actor,
        module: display.module,
        operation: display.operation,
        object: display.object,
        content: display.summary,
        result: display.result,
        details: display.details,
      });
    }
    worksheet.getRow(1).font = { bold: true };
    worksheet.autoFilter = {
      from: 'A1',
      to: 'H1',
    };
    worksheet.getColumn('A').numFmt = 'yyyy"年"m"月"d"日" hh:mm:ss';
    worksheet.eachRow((row, rowNumber) => {
      row.alignment = {
        vertical: 'top',
        wrapText: rowNumber > 1,
      };
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return {
      buffer: Buffer.from(buffer),
      count: rows.length,
      fileName: `操作日志_${filters.archived ? '历史' : '在线'}_${date}.xlsx`,
    };
  }

  private delegateFor(archived: boolean): any {
    const delegate = archived
      ? (this.prisma as any).operationLogArchive
      : this.prisma.operationLog;
    if (!delegate) {
      throw createHttpError(
        503,
        'OPERATION_LOG_STORE_UNAVAILABLE',
        archived
          ? 'The operation log archive is not available.'
          : 'The operation log store is not available.',
      );
    }
    return delegate;
  }

  private async resolveActor(log: any, prisma: any, contextActor: any) {
    if (
      log.actorNameSnapshot ||
      log.actorUsernameSnapshot ||
      log.actorRoleSnapshot
    ) {
      return contextActor || null;
    }
    if (contextActor && (!log.userId || contextActor.id === log.userId)) {
      return contextActor;
    }
    if (!log.userId || typeof prisma?.user?.findUnique !== 'function') {
      return null;
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: log.userId },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
        },
      });
      return user
        ? {
            ...user,
            role: normalizeRoleSnapshot(user.role),
          }
        : null;
    } catch (_error) {
      return null;
    }
  }

  private async loadCurrentUsers() {
    if (typeof (this.prisma as any)?.user?.findMany !== 'function') {
      return [];
    }
    const users = await (this.prisma as any).user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    return users.map((user: any) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      role: normalizeRoleSnapshot(user.role),
      isActive: Boolean(user.isActive),
      historicalOnly: false,
    }));
  }

  private async loadDistinctOptions(delegate: any, historicalOnly: boolean) {
    if (!delegate || typeof delegate.findMany !== 'function') {
      return {
        users: [],
        modules: [],
      };
    }
    const rows = await delegate.findMany({
      select: {
        userId: true,
        actorNameSnapshot: true,
        actorUsernameSnapshot: true,
        actorRoleSnapshot: true,
        module: true,
      },
      distinct: [
        'userId',
        'actorNameSnapshot',
        'actorUsernameSnapshot',
        'actorRoleSnapshot',
        'module',
      ],
    });
    const users = [];
    const modules = [];
    for (const row of rows) {
      if (row.module) {
        modules.push(String(row.module));
      }
      if (
        row.userId ||
        row.actorNameSnapshot ||
        row.actorUsernameSnapshot
      ) {
        users.push({
          id: row.userId || null,
          name: row.actorNameSnapshot || row.actorUsernameSnapshot || '未知用户',
          username: row.actorUsernameSnapshot || '',
          role: row.actorRoleSnapshot || '',
          isActive: false,
          historicalOnly,
        });
      }
    }
    return {
      users,
      modules: uniqueSorted(modules),
    };
  }
}

function buildWhere(filters: any) {
  const and: any[] = [];
  if (filters.userId) and.push({ userId: filters.userId });
  if (filters.module) and.push({ module: filters.module });
  if (filters.operationType) {
    and.push({ operationType: filters.operationType });
  }
  if (filters.action) and.push({ action: filters.action });
  if (filters.entityType) and.push({ entityType: filters.entityType });
  if (filters.entityId) and.push({ entityId: filters.entityId });
  if (filters.result) and.push({ result: filters.result });
  if (filters.ipAddress) and.push({ ipAddress: filters.ipAddress });
  if (filters.requestId) and.push({ requestId: filters.requestId });
  if (filters.startTime || filters.endTime) {
    and.push({
      createdAt: {
        ...(filters.startTime ? { gte: filters.startTime } : {}),
        ...(filters.endTime ? { lte: filters.endTime } : {}),
      },
    });
  }
  if (filters.keyword) {
    const businessKeywordFilters = businessKeywordJsonFilters(
      filters.keyword,
    );
    and.push({
      OR: [
        { action: { contains: filters.keyword } },
        { entityType: { contains: filters.keyword } },
        { entityId: { contains: filters.keyword } },
        { actorNameSnapshot: { contains: filters.keyword } },
        { actorUsernameSnapshot: { contains: filters.keyword } },
        ...businessKeywordFilters,
      ],
    });
  }
  return and.length === 0 ? {} : { AND: and };
}

function businessKeywordJsonFilters(keyword: string): any[] {
  const paths = [
    '$.name',
    '$.productName',
    '$.orderNo',
    '$.salesOrderNo',
    '$.afterSalesNo',
    '$.groupNo',
    '$.travelGroupNo',
    '$.customerName',
    '$.username',
    '$.title',
  ];
  return paths.flatMap((path) => [
    {
      beforeData: {
        path,
        string_contains: keyword,
      },
    },
    {
      afterData: {
        path,
        string_contains: keyword,
      },
    },
  ]);
}

function toAppLog(log: any, archived: boolean) {
  const output = sanitizeAuditData({
    id: log.id,
    userId: log.userId,
    actorNameSnapshot: log.actorNameSnapshot,
    actorUsernameSnapshot: log.actorUsernameSnapshot,
    actorRoleSnapshot: normalizeRoleSnapshot(log.actorRoleSnapshot),
    module: log.module || actionModule(log.action),
    operationType: log.operationType || inferOperationType(log.action),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    result: log.result || 'SUCCESS',
    beforeData: log.beforeData,
    afterData: log.afterData,
    requestSummary: log.requestSummary,
    sanitizationSummary: log.sanitizationSummary,
    httpMethod: log.httpMethod,
    requestPath: log.requestPath,
    requestId: log.requestId,
    statusCode: log.statusCode,
    errorCode: log.errorCode,
    errorMessage: log.errorMessage,
    userAgent: log.userAgent,
    durationMs: log.durationMs,
    ipAddress: log.ipAddress,
    archived,
    archivedAt: toIsoString(log.archivedAt),
    createdAt: toIsoString(log.createdAt),
  });
  return output && typeof output === 'object' ? output : {};
}

function normalizeOperationType(value: unknown): string {
  const normalized = String(value || '').trim().toUpperCase();
  return OPERATION_LOG_TYPES.includes(normalized) ? normalized : 'OTHER';
}

function normalizeResult(value: unknown): string {
  const normalized = String(value || '').trim().toUpperCase();
  return OPERATION_LOG_RESULTS.includes(normalized) ? normalized : 'FAILURE';
}

function inferOperationType(action: unknown): string {
  const normalized = String(action || '').toLowerCase();
  if (normalized.startsWith('auth.login')) return 'LOGIN';
  if (normalized.startsWith('auth.logout')) return 'LOGOUT';
  if (normalized.includes('export')) return 'EXPORT';
  if (normalized.includes('import')) return 'IMPORT';
  if (normalized.includes('upload') || normalized.includes('attachments.create')) {
    return 'UPLOAD';
  }
  if (normalized.includes('download')) return 'DOWNLOAD';
  if (normalized.includes('delete') || normalized.includes('revoke')) {
    return 'DELETE';
  }
  if (
    normalized.includes('status') ||
    normalized.includes('enable') ||
    normalized.includes('disable') ||
    normalized.includes('confirm')
  ) {
    return 'STATUS_CHANGE';
  }
  if (normalized.includes('review')) return 'REVIEW';
  if (normalized.endsWith('.create')) return 'CREATE';
  if (normalized.endsWith('.read') || normalized.endsWith('.list')) return 'READ';
  if (
    normalized.includes('.update') ||
    normalized.includes('.reset_password') ||
    normalized.includes('.change_password')
  ) {
    return 'UPDATE';
  }
  return 'OTHER';
}

function actionModule(action: unknown): string | null {
  const value = String(action || '');
  const separator = value.indexOf('.');
  return separator > 0 ? value.slice(0, separator) : null;
}

function normalizeRoleSnapshot(value: unknown): string | null {
  const normalized = String(value || '').trim();
  const map: Record<string, string> = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    BOSS: 'boss',
    FRONT_DESK: 'front_desk',
    SALES: 'sales',
    FINANCE: 'finance',
    WAREHOUSE: 'warehouse',
    AFTER_SALES: 'after_sales',
    TASTER: 'taster',
  };
  return normalized ? map[normalized] || normalized.toLowerCase() : null;
}

function boundedSanitizedString(
  value: unknown,
  maximumLength: number,
): string | null {
  const sanitized = sanitizeAuditData(value);
  return boundedString(
    typeof sanitized === 'string' ? sanitized : null,
    maximumLength,
  );
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function successStatusFor(method: unknown): number {
  return String(method || '').toUpperCase() === 'POST' ? 201 : 200;
}

function validDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(
      500,
      'AUDIT_LOG_DATE_INVALID',
      'Audit log date is invalid.',
    );
  }
  return date;
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function exportLimit(): number {
  const parsed = Number(process.env.OPERATION_LOG_EXPORT_MAX_ROWS);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_EXPORT_LIMIT
    ? parsed
    : DEFAULT_EXPORT_LIMIT;
}

function exportColumns(): Partial<ExcelJS.Column>[] {
  return [
    { header: '操作时间', key: 'createdAt', width: 24 },
    { header: '操作人', key: 'actor', width: 16 },
    { header: '所属模块', key: 'module', width: 18 },
    { header: '操作类型', key: 'operation', width: 14 },
    { header: '操作对象', key: 'object', width: 30 },
    { header: '操作内容', key: 'content', width: 56 },
    { header: '结果', key: 'result', width: 10 },
    { header: '业务明细', key: 'details', width: 64 },
  ];
}

function operationTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    CREATE: '新增',
    READ: '查看',
    UPDATE: '修改',
    DELETE: '删除',
    LOGIN: '登录',
    LOGOUT: '退出登录',
    IMPORT: '导入',
    EXPORT: '导出',
    UPLOAD: '上传',
    DOWNLOAD: '下载',
    REVIEW: '审核',
    STATUS_CHANGE: '状态变更',
    OTHER: '其他',
  };
  return labels[value] || value;
}

function userKey(user: any): string {
  return String(
    user?.id ||
      `${user?.username || ''}|${user?.name || ''}|${user?.role || ''}`,
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

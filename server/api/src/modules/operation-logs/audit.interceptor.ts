import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import * as crypto from 'node:crypto';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';

import { getRequestIp } from '../../common/request-ip';
import {
  AUDIT_OPERATION_METADATA,
  type AuditOperationMetadata,
} from './audit-operation.decorator';
import {
  AuditContextService,
  type AuditRequestContext,
} from './audit-context.service';
import { OperationLogsNestService } from './operation-log.nest.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditContext: AuditContextService,
    private readonly operationLogs: OperationLogsNestService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const metadata = this.readMetadata(context);
    const requestPath = auditRouteTemplate(context);
    if (metadata.exclude || shouldExclude(requestPath)) {
      return next.handle();
    }

    const requestContext: AuditRequestContext = {
      requestId: resolveRequestId(request),
      startedAtMs: Date.now(),
      httpMethod: String(request?.method || '').toUpperCase(),
      requestPath,
      ipAddress: getRequestIp(request),
      userAgent: boundedString(request?.headers?.['user-agent'], 512),
      requestSummary: buildRequestSummary(request),
      actor: request?.currentUser || null,
      explicitLogCount: 0,
      explicitActions: new Set<string>(),
    };
    request.auditRequestId = requestContext.requestId;

    return defer(() =>
      this.auditContext.run(requestContext, () =>
        next.handle().pipe(
          mergeMap((value) => {
            const inferred = inferAuditOperation(
              requestContext.httpMethod,
              requestContext.requestPath,
              'SUCCESS',
            );
            const requestAction = metadata.action || inferred.action;
            if (
              requestContext.explicitActions.has(requestAction) ||
              (requestContext.httpMethod !== 'GET' &&
                requestContext.explicitLogCount > 0)
            ) {
              return from([value]);
            }
            return from(
              this.writeRequestLog({
                request,
                response,
                requestContext,
                metadata,
                value,
                result: 'SUCCESS',
              }),
            ).pipe(map(() => value));
          }),
          catchError((error) =>
            from(
              this.writeRequestLog({
                request,
                response,
                requestContext,
                metadata,
                error,
                result: 'FAILURE',
              }).catch(() => undefined),
            ).pipe(mergeMap(() => throwError(() => error))),
          ),
        ),
      ),
    );
  }

  private readMetadata(context: ExecutionContext): AuditOperationMetadata {
    return (
      Reflect.getMetadata(AUDIT_OPERATION_METADATA, context.getHandler()) ||
      Reflect.getMetadata(AUDIT_OPERATION_METADATA, context.getClass()) ||
      {}
    );
  }

  private async writeRequestLog(input: {
    request: any;
    response: any;
    requestContext: AuditRequestContext;
    metadata: AuditOperationMetadata;
    value?: any;
    error?: any;
    result: 'SUCCESS' | 'FAILURE';
  }) {
    const actor =
      input.requestContext.actor || input.request?.currentUser || null;
    const inferred = inferAuditOperation(
      input.requestContext.httpMethod,
      input.requestContext.requestPath,
      input.result,
    );
    const action = input.metadata.action || inferred.action;
    const requestSummary = {
      ...(input.requestContext.requestSummary || {}),
      ...(input.result === 'SUCCESS'
        ? returnedCountSummary(input.value)
        : {}),
    };
    const statusCode =
      input.result === 'SUCCESS'
        ? Number(input.response?.statusCode || 200)
        : errorStatusCode(input.error);
    const errorCode =
      input.result === 'FAILURE' ? safeErrorCode(input.error) : null;

    await this.operationLogs.appendLog({
      userId: actor?.id || null,
      actorNameSnapshot: actor?.name || null,
      actorUsernameSnapshot: actor?.username || null,
      actorRoleSnapshot: actor?.role || null,
      module: input.metadata.module || inferred.module,
      operationType:
        input.metadata.operationType || inferred.operationType,
      action:
        input.result === 'FAILURE' && action === 'auth.login'
          ? 'auth.login_failed'
          : action,
      entityType: input.metadata.entityType || inferred.entityType,
      entityId: firstEntityId(input.request?.params),
      result: input.result,
      httpMethod: input.requestContext.httpMethod,
      requestPath: input.requestContext.requestPath,
      requestId: input.requestContext.requestId,
      statusCode,
      errorCode,
      errorMessage:
        errorCode === null ? null : `Request failed (${errorCode}).`,
      userAgent: input.requestContext.userAgent,
      durationMs: Math.max(
        0,
        Date.now() - input.requestContext.startedAtMs,
      ),
      ipAddress: input.requestContext.ipAddress,
      requestSummary,
    });
  }
}

export function auditRouteTemplate(context: ExecutionContext): string {
  const controllerPath = metadataPath(
    Reflect.getMetadata(PATH_METADATA, context.getClass()),
  );
  const handlerPath = metadataPath(
    Reflect.getMetadata(PATH_METADATA, context.getHandler()),
  );
  return `/${['api', controllerPath, handlerPath]
    .map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;
}

function metadataPath(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] || '');
  }
  return String(value || '');
}

function shouldExclude(path: string): boolean {
  return (
    path === '/api' ||
    path.startsWith('/api/public/') ||
    path.startsWith('/api/health') ||
    path.startsWith('/api/assets/')
  );
}

function resolveRequestId(request: any): string {
  const supplied = boundedString(request?.headers?.['x-request-id'], 64);
  if (supplied && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(supplied)) {
    return supplied;
  }
  return crypto.randomUUID();
}

function buildRequestSummary(request: any): Record<string, unknown> | null {
  const summary: Record<string, unknown> = {};
  const query = request?.query;
  if (query && typeof query === 'object') {
    const keys = Object.keys(query)
      .filter((key) => isSafeObjectKey(key))
      .slice(0, 50)
      .sort();
    if (keys.length > 0) {
      summary.filterKeys = keys;
      const safeFilters: Record<string, unknown> = {};
      for (const key of keys) {
        const normalizedKey = normalizeKey(key);
        const value = query[key];
        if (normalizedKey === 'keyword' || normalizedKey.endsWith('name')) {
          safeFilters[key] = presentMarker(value);
        } else if (isSafeFilterValueKey(normalizedKey)) {
          safeFilters[key] = boundedPrimitive(value);
        }
      }
      if (Object.keys(safeFilters).length > 0) {
        summary.filters = safeFilters;
      }
    }
  }

  const body = request?.body;
  if (
    body &&
    typeof body === 'object' &&
    !Buffer.isBuffer(body)
  ) {
    const bodyKeys = Object.keys(body)
      .filter((key) => isSafeObjectKey(key))
      .slice(0, 50)
      .sort();
    if (bodyKeys.length > 0) {
      summary.bodyKeys = bodyKeys;
    }
    if (
      String(request?.path || request?.url || '').includes('/auth/login')
    ) {
      summary.loginIdentifier = boundedPrimitive(body.username);
    }
  }

  const targetId = firstEntityId(request?.params);
  if (targetId) {
    summary.targetId = targetId;
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

function isSafeObjectKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.length > 0 &&
    !normalized.includes('password') &&
    !normalized.includes('token') &&
    !normalized.includes('authorization') &&
    !normalized.includes('cookie') &&
    !normalized.includes('secret') &&
    !normalized.includes('code') &&
    !normalized.includes('phone') &&
    !normalized.includes('mobile') &&
    !normalized.includes('address') &&
    !normalized.includes('question') &&
    !normalized.includes('content') &&
    !normalized.includes('file')
  );
}

function isSafeFilterValueKey(key: string): boolean {
  return (
    key.endsWith('id') ||
    key === 'module' ||
    key === 'operationtype' ||
    key === 'action' ||
    key === 'entitytype' ||
    key === 'result' ||
    key === 'archived' ||
    key === 'page' ||
    key === 'pagesize' ||
    key === 'starttime' ||
    key === 'endtime' ||
    key === 'status' ||
    key === 'type' ||
    key === 'category' ||
    key === 'enabled'
  );
}

function presentMarker(value: unknown): string {
  const text = String(value || '');
  return `[PRESENT:${Math.min(text.length, 999)}]`;
}

function boundedPrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return `[${Math.min(value.length, 999)} values]`;
  }
  return boundedString(value, 100) || '';
}

function returnedCountSummary(value: any): Record<string, number> {
  const source =
    value && typeof value === 'object' && value.data !== undefined
      ? value.data
      : value;
  if (Array.isArray(source)) {
    return { returnedCount: source.length };
  }
  if (!source || typeof source !== 'object') {
    return {};
  }
  if (Number.isFinite(Number(source.total))) {
    return { returnedCount: Math.max(0, Number(source.total)) };
  }
  for (const key of [
    'logs',
    'items',
    'users',
    'orders',
    'groups',
    'customers',
    'records',
    'products',
  ]) {
    if (Array.isArray(source[key])) {
      return { returnedCount: source[key].length };
    }
  }
  return {};
}

export function inferAuditOperation(
  method: string,
  requestPath: string,
  result: 'SUCCESS' | 'FAILURE' = 'SUCCESS',
) {
  const segments = requestPath
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const controller = normalizeSegment(segments[0] || 'unknown');
  const module =
    controller === 'warehouse'
      ? 'warehouse'
      : controller;
  const tail = segments.slice(controller === 'warehouse' ? 2 : 1);
  const namedTail = tail
    .filter((segment) => !segment.startsWith(':'))
    .map(normalizeSegment)
    .filter(Boolean);
  const hasEntityId = tail.some((segment) => segment.startsWith(':'));
  const suffix = namedTail.join('.');
  const lowerMethod = method.toUpperCase();
  let operationType = operationTypeFor(lowerMethod, suffix, module);
  let verb = '';

  if (module === 'auth') {
    verb = suffix || 'other';
    if (verb === 'change_password') {
      operationType = 'UPDATE';
    }
  } else if (suffix) {
    verb = suffix;
    if (
      ![
        'export',
        'download',
        'upload',
        'import',
        'review',
      ].some((candidate) => verb.includes(candidate))
    ) {
      verb = `${verb}.${verbForMethod(lowerMethod, hasEntityId)}`;
    }
  } else {
    verb = verbForMethod(lowerMethod, hasEntityId);
  }

  const action = `${module}.${verb}`.slice(0, 100);
  return {
    module,
    operationType,
    action:
      result === 'FAILURE' && action === 'auth.login'
        ? 'auth.login_failed'
        : action,
    entityType: singularEntityType(module),
  };
}

function operationTypeFor(
  method: string,
  suffix: string,
  module: string,
): string {
  if (module === 'auth' && suffix === 'login') return 'LOGIN';
  if (module === 'auth' && suffix === 'logout') return 'LOGOUT';
  if (suffix.includes('batch_import') || suffix.includes('import')) return 'IMPORT';
  if (suffix.includes('export')) return 'EXPORT';
  if (suffix.includes('upload') || suffix.includes('attachments')) {
    if (method === 'POST') return 'UPLOAD';
  }
  if (suffix.includes('download')) return 'DOWNLOAD';
  if (suffix.includes('review') || suffix.includes('approve')) return 'REVIEW';
  if (
    suffix.includes('status') ||
    suffix.includes('enable') ||
    suffix.includes('disable') ||
    suffix.includes('confirm') ||
    suffix.includes('finance_mark')
  ) {
    return 'STATUS_CHANGE';
  }
  if (method === 'GET') return 'READ';
  if (method === 'POST') return 'CREATE';
  if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';
  return 'OTHER';
}

function verbForMethod(method: string, hasEntityId: boolean): string {
  if (method === 'GET') return hasEntityId ? 'read' : 'list';
  if (method === 'POST') return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  return 'other';
}

function singularEntityType(module: string): string {
  const known: Record<string, string> = {
    users: 'user',
    customers: 'customer',
    products: 'product',
    sales_orders: 'sales_order',
    travel_groups: 'travel_group',
    guides: 'guide',
    travel_agencies: 'travel_agency',
    operation_logs: 'operation_log',
  };
  return known[module] || module.replace(/s$/, '');
}

function normalizeSegment(value: string): string {
  return String(value || '')
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/-/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
}

function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function firstEntityId(params: any): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }
  for (const key of ['id', 'userId', 'attachmentId', 'businessDate']) {
    const value = boundedString(params[key], 36);
    if (value) {
      return value;
    }
  }
  return null;
}

function errorStatusCode(error: any): number {
  const value =
    typeof error?.getStatus === 'function'
      ? error.getStatus()
      : error?.statusCode || error?.status;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 400 && parsed <= 599
    ? parsed
    : 500;
}

function safeErrorCode(error: any): string {
  const code = boundedString(error?.code, 100);
  if (code && /^[A-Z0-9_.:-]+$/i.test(code)) {
    return code;
  }
  const response =
    typeof error?.getResponse === 'function' ? error.getResponse() : null;
  const responseCode = boundedString(response?.code || response?.error?.code, 100);
  return responseCode && /^[A-Z0-9_.:-]+$/i.test(responseCode)
    ? responseCode
    : 'REQUEST_FAILED';
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'node:crypto';

import { createHttpError } from '../errors';
import { getRequestIp } from '../request-ip';
import { auditRouteTemplate } from '../../modules/operation-logs/audit.interceptor';
import { OperationLogsNestService } from '../../modules/operation-logs/operation-log.nest.service';
import { REQUIRED_ROLES_METADATA } from './required-roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRED_ROLES_METADATA,
        [context.getHandler(), context.getClass()],
      ) || [];
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const role = request.currentUser?.role;
    if (
      requiredRoles.includes(role) ||
      (role === 'super_admin' && requiredRoles.includes('admin'))
    ) {
      return true;
    }
    const error = createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this action.',
    );
    try {
      const requestId = request.auditRequestId || crypto.randomUUID();
      request.auditRequestId = requestId;
      await this.operationLogsService.appendLog({
        userId: request.currentUser?.id || null,
        action: 'security.authorization_failed',
        module: 'security',
        operationType: 'OTHER',
        entityType: 'request',
        result: 'FAILURE',
        httpMethod: request?.method,
        requestPath: auditRouteTemplate(context),
        requestId,
        statusCode: 403,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'Request authorization failed.',
        ipAddress: getRequestIp(request),
        userAgent: request?.headers?.['user-agent'],
        requestSummary: {
          requiredRoles,
        },
      });
    } catch (_auditError) {
      // Authorization errors must keep their original public contract.
    }
    throw error;
  }
}

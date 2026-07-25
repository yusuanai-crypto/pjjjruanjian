import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import * as crypto from 'node:crypto';

import { getRequestIp } from '../request-ip';
import { AuthNestService } from '../../modules/auth/auth.nest.service';
import { auditRouteTemplate } from '../../modules/operation-logs/audit.interceptor';
import { OperationLogsNestService } from '../../modules/operation-logs/operation-log.nest.service';

@Injectable()
export class AuthUserGuard implements CanActivate {
  constructor(
    private readonly authService: AuthNestService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    try {
      request.currentUser =
        await this.authService.authenticateRequest(request);
      return true;
    } catch (error) {
      await this.recordFailure(context, request, error);
      throw error;
    }
  }

  private async recordFailure(
    context: ExecutionContext,
    request: any,
    error: any,
  ) {
    try {
      const requestId = request.auditRequestId || crypto.randomUUID();
      request.auditRequestId = requestId;
      await this.operationLogsService.appendLog({
        action: 'security.authentication_failed',
        module: 'security',
        operationType: 'OTHER',
        entityType: 'request',
        result: 'FAILURE',
        httpMethod: request?.method,
        requestPath: auditRouteTemplate(context),
        requestId,
        statusCode: errorStatus(error),
        errorCode: safeErrorCode(error),
        errorMessage: 'Request authentication failed.',
        ipAddress: getRequestIp(request),
        userAgent: request?.headers?.['user-agent'],
      });
    } catch (_auditError) {
      // Authentication errors must keep their original public contract.
    }
  }
}

function errorStatus(error: any): number {
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 401;
}

function safeErrorCode(error: any): string {
  const code = String(error?.code || 'AUTHENTICATION_FAILED');
  return /^[A-Z0-9_.:-]{1,100}$/i.test(code)
    ? code
    : 'AUTHENTICATION_FAILED';
}

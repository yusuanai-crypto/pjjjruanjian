import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { createHttpError } from '../errors';
import { REQUIRED_ROLES_METADATA } from './required-roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to perform this action.',
    );
  }
}
